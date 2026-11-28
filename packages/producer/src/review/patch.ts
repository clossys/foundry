/**
 * `clossys review --mutation <patch> --expect-fail <regex>`: a hand-written mutation of the checkout. The tree is
 * fingerprinted (every tracked and untracked, not ignored, file: path, mode and sha256 of its bytes), the patch is
 * applied with `git apply`, the commands run (each `--run`, else every test that reaches a file the patch touches,
 * each alone), the patch is reversed with `git apply -R`, and the tree is fingerprinted again. PASS only when a
 * command failed with output matching --expect-fail (the mutant is killed for the stated reason), the patch both
 * applied and reversed, the second fingerprint is byte-identical to the first, at least one command ran and none
 * exited 127. Anything else is FAIL.
 */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { packageOf } from "./changes.js";
import { exitText, git, observeRuns, run, type RunEntry } from "./exec.js";
import { coveringTests, testCommand } from "./graph.js";
import { failClosed, ranOf, verdictOf } from "./review.js";
import type { Finding } from "./types.js";

export const MUTATION_SCHEMA = "clossys.review-mutation/1";

/** The mutation findings, by id and when each fails (docs/review.md (not shipped)). */
export const MUTATION_FINDINGS: readonly { readonly id: string; readonly fails: string }[] = [
  { id: "mutation.apply", fails: "git apply of the patch fails" },
  { id: "mutation.no-commands", fails: "no --run is given and no test reaches a file the patch touches" },
  { id: "mutation.not-killed", fails: "no command failed with output matching --expect-fail: the mutant survived, or failed for another reason" },
  { id: "mutation.reverse", fails: "git apply -R of the patch fails after the run" },
  { id: "mutation.restore", fails: "the tree after the reverse is not byte-identical to the tree before the patch" },
];

export interface MutationCommand { readonly run: string; readonly exit: number; readonly ms: number; readonly matched: boolean }
export interface MutationRecord {
  readonly schema: typeof MUTATION_SCHEMA;
  readonly head: string;
  readonly patch: string;
  readonly patchSha256: string;
  readonly expectFail: string;
  readonly commands: readonly MutationCommand[];
  readonly killed: boolean;
  readonly restored: boolean;
  /** Paths whose bytes, mode or presence differ between the fingerprints before and after (empty when restored). */
  readonly changed: readonly string[];
  readonly ran: { readonly commands: number; readonly missing: readonly string[] };
  readonly findings: readonly Finding[];
  readonly verdict: "PASS" | "FAIL";
  readonly line: string;
}

export interface MutationOptions {
  readonly repo: string;
  readonly patch: string;
  readonly expectFail: string;
  /** Shell lines to run in the checkout root; when none, the tests that reach the patched files, each alone. */
  readonly run?: readonly string[];
  readonly timeoutMs?: number;
  readonly log?: (line: string) => void;
}

/** path -> mode and sha256 of the bytes (a symlink: of its target text), for every tracked and untracked file not ignored. */
export function fingerprint(repo: string): Map<string, string> {
  const listed = git(repo, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).split("\0").filter(Boolean);
  const out = new Map<string, string>();
  for (const path of [...new Set(listed)].sort()) {
    const file = join(repo, path);
    let stat;
    try { stat = lstatSync(file); } catch { out.set(path, "absent"); continue; }
    const bytes = stat.isSymbolicLink() ? Buffer.from(readlinkSync(file)) : stat.isFile() ? readFileSync(file) : Buffer.from(`dir`);
    out.set(path, `${stat.mode.toString(8)} ${createHash("sha256").update(bytes).digest("hex")}`);
  }
  return out;
}

/** The paths whose entry differs between two fingerprints, sorted. */
export function fingerprintDiff(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): string[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].filter(path => before.get(path) !== after.get(path)).sort();
}

/** The tree-relative files a patch touches (`git apply --numstat`, renames to their new path). */
function patchedFiles(repo: string, patch: string): string[] {
  const result = run(["git", "apply", "--numstat", "-z", patch], repo);
  if (result.exit) return [];
  return result.stdout.split("\0").map(field => field.split("\t").slice(2).join("\t")).filter(Boolean);
}

export function runMutation(options: MutationOptions): MutationRecord {
  const repo = resolve(options.repo), patch = resolve(options.patch);
  const log = options.log ?? (() => {});
  const head = git(repo, ["rev-parse", "HEAD"]);
  const patchSha256 = createHash("sha256").update(readFileSync(patch)).digest("hex");
  const expect = new RegExp(options.expectFail, "m");
  const findings: Finding[] = [];
  const fail = (id: string, subject: string, detail: string) => findings.push({ id, level: "fail", subject, detail });
  const commands: MutationCommand[] = [];
  const entries: RunEntry[] = [];
  let restored = false, changed: string[] = [];
  observeRuns(entry => entries.push(entry), () => {
    const before = fingerprint(repo);
    const files = patchedFiles(repo, patch);
    const applied = run(["git", "apply", "--whitespace=nowarn", patch], repo);
    if (applied.exit) { fail("mutation.apply", options.patch, `${exitText(applied)}: ${applied.output.trim().split("\n").slice(-1)[0] ?? ""}`); return; }
    try {
      const planned = options.run?.length
        ? options.run.map(line => ({ argv: line, cwd: repo, label: line }))
        : coveringTests(repo, files.map(path => ({ path, status: "M" })), file => packageOf(repo, file)).all.map(file => {
          const command = testCommand(repo, packageOf(repo, file), file);
          return { argv: command.argv, cwd: command.cwd, label: `${command.argv.slice(command.argv[0] === process.execPath ? 1 : 0).join(" ")} (in ${packageOf(repo, file)})` };
        });
      if (!planned.length) fail("mutation.no-commands", options.patch, "no --run given and no test reaches a file the patch touches");
      for (const item of planned) {
        const result = run(item.argv, item.cwd, options.timeoutMs ? { timeoutMs: options.timeoutMs } : {});
        const matched = result.exit !== 0 && expect.test(result.output);
        commands.push({ run: item.label, exit: result.exit, ms: result.ms, matched });
        log(`mutation: ${item.label} ${exitText(result)}${matched ? " (killed, output matches)" : ""}`);
      }
    } finally {
      const reversed = run(["git", "apply", "-R", "--whitespace=nowarn", patch], repo);
      if (reversed.exit) fail("mutation.reverse", options.patch, `${exitText(reversed)}: ${reversed.output.trim().split("\n").slice(-1)[0] ?? ""}`);
      changed = fingerprintDiff(before, fingerprint(repo));
      restored = !reversed.exit && changed.length === 0;
      if (changed.length) fail("mutation.restore", options.patch, `differs from before the patch: ${changed.slice(0, 10).join(", ")}${changed.length > 10 ? `, +${changed.length - 10} more` : ""}`);
    }
  });
  const killed = commands.some(command => command.matched);
  if (!killed && !findings.some(finding => finding.id === "mutation.apply")) fail("mutation.not-killed", options.patch, `no command failed with output matching /${options.expectFail}/`);
  const ran = ranOf(entries);
  findings.push(...failClosed(ran));
  const verdict = verdictOf(findings);
  return {
    schema: MUTATION_SCHEMA, head, patch, patchSha256, expectFail: options.expectFail, commands, killed, restored, changed, ran, findings, verdict,
    line: `MUTATION: ${verdict} ${head} ${patchSha256}`,
  };
}

/** The text report of a patch mutation: each command, the restore, findings, then the verdict line. */
export function formatMutation(record: MutationRecord): string {
  return [
    `clossys review --mutation ${record.patch} --expect-fail /${record.expectFail}/`,
    ...record.commands.map(command => `  exit ${command.exit}${command.matched ? " killed" : ""} ${command.run}`),
    `killed: ${record.killed ? "yes" : "no"}; restored byte for byte: ${record.restored ? "yes" : `no${record.changed.length ? ` (${record.changed.length} path(s) differ)` : ""}`}`,
    `findings: ${record.findings.length}`,
    ...record.findings.map(finding => `  ${finding.level === "fail" ? "FAIL" : "note"} ${finding.id} ${finding.subject}: ${finding.detail}`),
    record.line,
  ].join("\n");
}
