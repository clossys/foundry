/**
 * `clossys receipt --packet <unit.md>`: the packet's Validation list becomes a commands file, each command runs in the
 * checkout, and receipt.json plus receipt.md record what ran (command, exit code, duration, the sha256 of the
 * normalized output tail) at which head. `clossys review --packet` parses the packet again, holds the receipt to that
 * command list and its expected exit codes, re-runs it at the head and fails on any difference. An executor's receipt
 * is this output, never a hand-written claim.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { git, run, tailSha } from "./exec.js";
import type { Finding } from "./types.js";

export const COMMANDS_SCHEMA = "clossys.review-commands/1";
export const RECEIPT_SCHEMA = "clossys.receipt/1";

/** The first word of an inline code span that makes it a command (with at least one argument). */
export const EXECUTABLES = ["clossys", "cmp", "df", "diff", "git", "node", "npm", "npx", "wt"] as const;
/** `clossys` in a packet runs the checkout's own built CLI. */
export const CLOSSYS_CLI = "node packages/producer/dist/cli/index.js";
/** Verbs a receipt never runs: they would run the receipt (or a review of it) again. */
export const SELF_VERBS = ["review", "receipt"] as const;

/** expect: the exit code the packet expects, 0 unless the list item says `exits N` right after the span. */
export interface Command { readonly id: string; readonly run: string; readonly from: string; readonly expect: number }
export interface CommandsFile { readonly schema: typeof COMMANDS_SCHEMA; readonly packet: string; readonly commands: readonly Command[]; readonly skipped: readonly { readonly text: string; readonly reason: string }[] }
export interface ReceiptEntry { readonly id: string; readonly run: string; readonly expect: number; readonly exit: number; readonly ms: number; readonly tailSha256: string }
export interface Receipt { readonly schema: typeof RECEIPT_SCHEMA; readonly packet: string; readonly head: string; readonly tree: string; readonly dirty: boolean; readonly at: string; readonly commands: readonly ReceiptEntry[]; readonly skipped: CommandsFile["skipped"] }

/** The Validation section's list items: from a `Validation` heading to the next heading of the same or a higher level. */
export function validationItems(markdown: string): string[] {
  const lines = markdown.split("\n");
  const start = lines.findIndex(line => /^#{1,6}\s+Validation\b/i.test(line));
  if (start < 0) return [];
  const level = /^(#+)/.exec(lines[start]!)![1]!.length;
  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const heading = /^(#+)\s/.exec(line);
    if (heading && heading[1]!.length <= level) break;
    if (heading) continue;
    if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) items.push(line.trim());
    else if (line.trim() && items.length) items[items.length - 1] += ` ${line.trim()}`;
  }
  return items;
}

/** One inline code span as the command a receipt runs, or why it is not one. */
export function commandOf(span: string): { run: string } | { reason: string } {
  let words = span.trim().split(/\s+/);
  if (words.length < 2 || !(EXECUTABLES as readonly string[]).includes(words[0]!)) return { reason: "not a command" };
  // The admission wrapper (`wt run <options> -- <command>`) is not part of what the command proves.
  if (words[0] === "wt") {
    const at = words.indexOf("--");
    if (words[1] !== "run" || at < 0 || at === words.length - 1) return { reason: "wt without a wrapped command" };
    words = words.slice(at + 1);
  }
  if (words[0] === "clossys") {
    if ((SELF_VERBS as readonly string[]).includes(words[1] ?? "")) return { reason: `clossys ${words[1]} runs the receipt itself` };
    return { run: `${CLOSSYS_CLI} ${words.slice(1).join(" ")}` };
  }
  return { run: words.join(" ") };
}

/** The text right after a command's span that names another expected exit code: `exits 1`, `must exit 2`, `(exit 1)`. */
export const EXPECT_EXIT = /^\W{0,2}\s*(?:must\s+|should\s+)?exits?(?:\s+code)?\s+(\d+)\b/i;

/** The commands file of a packet's markdown. */
export function parsePacket(markdown: string, packet: string): CommandsFile {
  const commands: Command[] = [], skipped: { text: string; reason: string }[] = [];
  for (const item of validationItems(markdown)) {
    for (const match of item.matchAll(/`([^`]+)`/g)) {
      const parsed = commandOf(match[1]!);
      if ("reason" in parsed) { if (parsed.reason !== "not a command") skipped.push({ text: match[1]!, reason: parsed.reason }); continue; }
      const after = item.slice(match.index! + match[0].length).split("`")[0]!;
      const expect = Number(EXPECT_EXIT.exec(after)?.[1] ?? 0);
      const same = commands.find(command => command.run === parsed.run);
      if (same && same.expect !== expect) throw new Error(`${packet}: \`${parsed.run}\` is listed expecting exit ${same.expect} and exit ${expect}`);
      if (!same) commands.push({ id: `c${commands.length + 1}`, run: parsed.run, from: match[1]!, expect });
    }
  }
  return { schema: COMMANDS_SCHEMA, packet, commands, skipped };
}

/** Where a packet's receipt lives unless --out says otherwise: `<packet dir>/<packet name>.receipt/`. */
export const receiptDir = (packet: string) => join(dirname(packet), `${basename(packet, ".md")}.receipt`);

export function runCommand(command: Pick<Command, "id" | "run" | "expect">, root: string, timeoutMs?: number): ReceiptEntry {
  const result = run(command.run, root, timeoutMs ? { timeoutMs } : {});
  return { id: command.id, run: command.run, expect: command.expect, exit: result.exit, ms: result.ms, tailSha256: tailSha(result.output, [root]) };
}

export function receiptMarkdown(receipt: Receipt): string {
  return [
    `# Receipt: ${basename(receipt.packet)}`, "",
    `- Head: ${receipt.head} (tree ${receipt.tree})${receipt.dirty ? ", DIRTY: taken on uncommitted changes" : ""}`,
    `- Taken: ${receipt.at} by \`clossys receipt\`; output tails are sha256 of the normalized last lines (docs/review.md)`, "",
    "| # | Command | Expect | Exit | ms | Tail sha256 |", "|---|---|---|---|---|---|",
    ...receipt.commands.map(entry => `| ${entry.id} | \`${entry.run.replace(/\|/g, "\\|")}\` | ${entry.expect} | ${entry.exit}${entry.exit === entry.expect ? "" : " (UNEXPECTED)"} | ${entry.ms} | ${entry.tailSha256.slice(0, 16)} |`),
    ...(receipt.skipped.length ? ["", "Skipped:", ...receipt.skipped.map(item => `- \`${item.text}\`: ${item.reason}`)] : []), "",
  ].join("\n");
}

/** Parse the packet, run every command in root, write commands.json, receipt.json and receipt.md to out. */
export function takeReceipt(packetPath: string, root: string, out = receiptDir(packetPath), timeoutMs?: number): Receipt {
  const packet = resolve(packetPath);
  const commands = parsePacket(readFileSync(packet, "utf8"), packet);
  const dirty = git(root, ["status", "--porcelain"]).trim().length > 0;
  const receipt: Receipt = {
    schema: RECEIPT_SCHEMA, packet, head: git(root, ["rev-parse", "HEAD"]), tree: git(root, ["rev-parse", "HEAD^{tree}"]), dirty,
    at: new Date().toISOString(), commands: commands.commands.map(command => runCommand(command, root, timeoutMs)), skipped: commands.skipped,
  };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "commands.json"), `${JSON.stringify(commands, null, 2)}\n`);
  writeFileSync(join(out, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  writeFileSync(join(out, "receipt.md"), receiptMarkdown(receipt));
  return receipt;
}

export function readReceipt(file: string): Receipt {
  const receipt = JSON.parse(readFileSync(file, "utf8")) as Receipt;
  if (receipt.schema !== RECEIPT_SCHEMA || !Array.isArray(receipt.commands)) throw new Error(`${file}: not a ${RECEIPT_SCHEMA} document`);
  return receipt;
}

const samePath = (a: string, b: string) => { const real = (path: string) => { try { return realpathSync(path); } catch { return resolve(path); } }; return real(a) === real(b); };

/** The receipt findings, by id and when each fails (docs/review.md (not shipped)). */
export const RECEIPT_FINDINGS: readonly { readonly id: string; readonly fails: string }[] = [
  { id: "receipt.missing", fails: "there is no receipt.json for the packet" },
  { id: "receipt.packet", fails: "receipt.json names another packet file than --packet" },
  { id: "receipt.head", fails: "receipt.json was taken at another head" },
  { id: "receipt.dirty", fails: "receipt.json was taken on uncommitted changes" },
  { id: "receipt.command-missing", fails: "a command the packet's Validation list gives (parsed again at review time) is not in receipt.json" },
  { id: "receipt.command-extra", fails: "receipt.json holds a command the packet does not give" },
  { id: "receipt.exit", fails: "a recorded exit code is not the one the packet expects (0 unless the item says `exits N`)" },
  { id: "receipt.mismatch", fails: "a re-run at the head differs from the recorded exit code or output tail" },
];

/**
 * Hold receipt to the packet's own command list (expected, parsed again from packet now), then re-run every packet
 * command it recorded in tree (a checkout of head) and compare: any difference is a fail finding.
 */
export function compareReceipt(receipt: Receipt, expected: CommandsFile, head: string, tree: string, timeoutMs?: number): Finding[] {
  const findings: Finding[] = [];
  const fail = (id: string, subject: string, detail: string) => findings.push({ id, level: "fail", subject, detail });
  if (typeof receipt.packet !== "string" || !samePath(receipt.packet, expected.packet)) fail("receipt.packet", "receipt.json", `taken for ${String(receipt.packet)}, reviewing ${expected.packet}`);
  if (receipt.head !== head) fail("receipt.head", "receipt.json", `taken at ${receipt.head}, reviewing ${head}`);
  if (receipt.dirty !== false) fail("receipt.dirty", "receipt.json", "taken on uncommitted changes");
  const recorded = new Map<string, ReceiptEntry>();
  for (const entry of receipt.commands) {
    if (!expected.commands.some(command => command.run === entry.run)) fail("receipt.command-extra", entry.run, `${entry.id} is not in the packet's Validation list`);
    else if (recorded.has(entry.run)) fail("receipt.command-extra", entry.run, `${entry.id} repeats a recorded command`);
    else recorded.set(entry.run, entry);
  }
  for (const command of expected.commands) {
    const entry = recorded.get(command.run);
    if (!entry) { fail("receipt.command-missing", command.run, `${command.id} of the packet is not in receipt.json`); continue; }
    if (entry.exit !== command.expect) fail("receipt.exit", command.run, `exit ${entry.exit} recorded, the packet expects ${command.expect}`);
    const again = runCommand(command, tree, timeoutMs);
    if (again.exit !== entry.exit) fail("receipt.mismatch", command.run, `exit ${entry.exit} recorded, ${again.exit} at the head`);
    else if (again.tailSha256 !== entry.tailSha256) fail("receipt.mismatch", command.run, `output tail ${String(entry.tailSha256).slice(0, 12)} recorded, ${again.tailSha256.slice(0, 12)} at the head`);
  }
  return findings;
}

/** The receipt file for a packet: --receipt, else the default receipt folder's receipt.json. */
export function receiptFileFor(packet: string, explicit?: string): string | undefined {
  const file = explicit ? resolve(explicit) : join(receiptDir(resolve(packet)), "receipt.json");
  return existsSync(file) ? file : undefined;
}
