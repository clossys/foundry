/**
 * `clossys review <base> <head>` and `clossys receipt --packet <unit.md>` (docs/review.md): the mechanical review of
 * a diff and the executor's receipt, both run from code so no reviewer re-runs them by hand.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { git } from "../review/exec.js";
import { REVIEW_DOC, reviewDoc } from "../review/doc.js";
import { receiptDir, takeReceipt } from "../review/receipt.js";
import { formatReview, runReview } from "../review/review.js";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";

export const REVIEW_USAGE = "Usage: clossys review <base> <head> [--packet <unit.md>] [--receipt <receipt.json>] [--seed <s>] [--root <repo>] [--json]\n"
  + "       clossys review --check-doc|--write-doc [--root <repo>]\n"
  + "  Runs the mechanical review of base...head in a temporary worktree of head (docs/review.md);\n"
  + "  the report ends with MECHANICAL: PASS|FAIL <head-sha> <tree-sha>. Exit 0 PASS, 1 FAIL.";

export const RECEIPT_USAGE = "Usage: clossys receipt --packet <unit.md> [--out <dir>] [--root <repo>] [--json]\n"
  + "  Runs the packet's Validation commands in the checkout and writes commands.json, receipt.json and receipt.md\n"
  + "  (default <packet dir>/<packet name>.receipt/). Exit 1 when a command exits non-zero.";

const repoRoot = (start: string) => { try { return git(start, ["rev-parse", "--show-toplevel"]); } catch { return start; } };

function options(argv: readonly string[], usage: string, flags: readonly string[], values: readonly string[]) {
  const positional: string[] = [], set = new Set<string>(), given = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (flags.includes(arg)) { set.add(arg); continue; }
    if (values.includes(arg)) {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new CliUsageError(`${arg} requires a value\n${usage}`);
      given.set(arg, value);
      continue;
    }
    if (arg.startsWith("--")) throw new CliUsageError(`Unknown option ${arg}\n${usage}`);
    positional.push(arg);
  }
  return { positional, set, given };
}

export async function runReviewCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  if (argv.includes("--help")) return { exitCode: 0, message: REVIEW_USAGE };
  const { positional, set, given } = options(argv, REVIEW_USAGE, ["--json", "--check-doc", "--write-doc"], ["--packet", "--receipt", "--seed", "--root"]);
  const root = given.has("--root") ? resolve(cwd, given.get("--root")!) : repoRoot(cwd);
  if (set.has("--check-doc") || set.has("--write-doc")) {
    const file = join(root, REVIEW_DOC), text = reviewDoc();
    if (set.has("--write-doc")) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); return { exitCode: 0, root, message: `review: wrote ${REVIEW_DOC}` }; }
    const current = existsSync(file) ? readFileSync(file, "utf8") : "";
    return current === text
      ? { exitCode: 0, root, message: `review: ${REVIEW_DOC} matches the code` }
      : { exitCode: 1, root, message: `review: ${REVIEW_DOC} differs from the code; run clossys review --write-doc` };
  }
  if (positional.length !== 2) throw new CliUsageError(`review needs <base> and <head>\n${REVIEW_USAGE}`);
  const report = runReview({
    repo: root, base: positional[0]!, head: positional[1]!,
    ...(given.has("--packet") ? { packet: resolve(cwd, given.get("--packet")!) } : {}),
    ...(given.has("--receipt") ? { receipt: resolve(cwd, given.get("--receipt")!) } : {}),
    ...(given.has("--seed") ? { seed: given.get("--seed")! } : {}),
    log: line => process.stderr.write(`${line}\n`),
  });
  return { exitCode: report.verdict === "PASS" ? 0 : 1, root, message: formatReview(report), ...(set.has("--json") ? { output: report } : {}) };
}

export async function runReceiptCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  if (argv.includes("--help")) return { exitCode: 0, message: RECEIPT_USAGE };
  const { positional, set, given } = options(argv, RECEIPT_USAGE, ["--json"], ["--packet", "--out", "--root"]);
  if (positional.length || !given.has("--packet")) throw new CliUsageError(`receipt needs --packet <unit.md>\n${RECEIPT_USAGE}`);
  const packet = resolve(cwd, given.get("--packet")!);
  if (!existsSync(packet)) throw new CliUsageError(`receipt: no packet at ${packet}`);
  const root = given.has("--root") ? resolve(cwd, given.get("--root")!) : repoRoot(cwd);
  const out = given.has("--out") ? resolve(cwd, given.get("--out")!) : receiptDir(packet);
  const receipt = takeReceipt(packet, root, out);
  const red = receipt.commands.filter(entry => entry.exit !== 0);
  const message = [
    `receipt: ${receipt.commands.length} command(s) at ${receipt.head}${receipt.dirty ? " (DIRTY)" : ""}, ${red.length} non-zero; wrote ${out}/receipt.json`,
    ...receipt.commands.map(entry => `  ${entry.id} exit ${entry.exit} ${entry.run}`),
  ].join("\n");
  return { exitCode: red.length ? 1 : 0, root, message, ...(set.has("--json") ? { output: receipt } : {}) };
}
