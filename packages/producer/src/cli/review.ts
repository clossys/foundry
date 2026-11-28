/**
 * `clossys review <base> <head>` and `clossys receipt --packet <unit.md>` (docs/review.md (not shipped)): the mechanical review of
 * a diff and the executor's receipt, both run from code so no reviewer re-runs them by hand.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { batchGate, formatBatch, formatImport, importGate, publishGate } from "../review/cloud.js";
import { git } from "../review/exec.js";
import { REVIEW_DOC, reviewDoc } from "../review/doc.js";
import { formatMutation, runMutation } from "../review/patch.js";
import { receiptDir, receiptVerdict, takeReceipt } from "../review/receipt.js";
import { formatReview, ReviewArgumentError, runReview } from "../review/review.js";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";

export const REVIEW_USAGE = "Usage: clossys review <base> <head> [--packet <unit.md>] [--receipt <receipt.json>] [--fast <fast.json>] [--seed <s>] [--record <review.json>] [--root <repo>] [--json]\n"
  + "       clossys review --mutation <patch> --expect-fail <regex> [--run <command>]... [--record <mutation.json>] [--root <repo>] [--json]\n"
  + "       clossys review --publish <base> <head> --packet <unit.md> [--receipt <receipt.json>] [--unit <branch>] [--push <remote>] [--root <repo>] [--json]\n"
  + "       clossys review --import <gate ref> --head <sha> --base <ref> --packet <unit.md> [--record <review.json>] [--root <repo>] [--json]\n"
  + "       clossys review --batch <tip> --base <ref> --imported <review.json>... [--root <repo>] [--json]\n"
  + "       clossys review --check-doc|--write-doc [--root <repo>]\n"
  + "  Runs the mechanical review of base...head in a temporary worktree of head (docs/review.md);\n"
  + "  the report ends with MECHANICAL: PASS|FAIL <head-sha> <tree-sha>, and --record writes the same JSON record --json prints.\n"
  + "  Fail closed: no command run, or any command exiting 127, is FAIL. A red test that also fails alone at the merge base\n"
  + "  (or that the --fast record at this head lists base-red) is base-red, reported and not failing.\n"
  + "  --mutation applies the patch to the checkout, runs each --run (default: the tests reaching the patched files, each\n"
  + "  alone), reverses it and compares the tree byte for byte; it ends MUTATION: PASS|FAIL <head-sha> <patch-sha256>, PASS only\n"
  + "  when a command failed with output matching --expect-fail and the tree is restored. Exit 0 PASS, 1 FAIL.\n"
  + "  --publish runs the review at head and commits only gate.json and receipt.json to <unit branch>-gate (the unit branch\n"
  + "  never moves). --import re-runs nothing: it refuses unless the result's head and tree are --head's, its base is --base\n"
  + "  and every packet command ran; a cloud FAIL imports as FAIL and the next step is a local run. --batch names the merged\n"
  + "  batch tip, the one local re-run of a batch of imported PASS records.";

export const RECEIPT_USAGE = "Usage: clossys receipt --packet <unit.md> [--out <dir>] [--root <repo>] [--json]\n"
  + "  Runs the packet's Validation commands in the checkout and writes commands.json, receipt.json and receipt.md\n"
  + "  (default <packet dir>/<packet name>.receipt/). Exit 1 when a command's exit code is not the one the packet expects.";

const repoRoot = (start: string) => { try { return git(start, ["rev-parse", "--show-toplevel"]); } catch { return start; } };

function options(argv: readonly string[], usage: string, flags: readonly string[], values: readonly string[], repeated: readonly string[] = []) {
  const positional: string[] = [], set = new Set<string>(), given = new Map<string, string>(), many = new Map<string, string[]>();
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (flags.includes(arg)) { set.add(arg); continue; }
    if (values.includes(arg) || repeated.includes(arg)) {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new CliUsageError(`${arg} requires a value\n${usage}`);
      if (repeated.includes(arg)) many.set(arg, [...(many.get(arg) ?? []), value]);
      else given.set(arg, value);
      continue;
    }
    if (arg.startsWith("--")) throw new CliUsageError(`Unknown option ${arg}\n${usage}`);
    positional.push(arg);
  }
  return { positional, set, given, many };
}

/** Writes a record (the JSON --json prints) to file, making its folder. */
const writeRecord = (file: string, record: unknown) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`); };

export async function runReviewCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  if (argv.includes("--help")) return { exitCode: 0, message: REVIEW_USAGE };
  const { positional, set, given, many } = options(argv, REVIEW_USAGE, ["--json", "--check-doc", "--write-doc", "--publish"], ["--packet", "--receipt", "--seed", "--root", "--fast", "--record", "--mutation", "--expect-fail", "--import", "--head", "--base", "--batch", "--unit", "--push"], ["--run", "--imported"]);
  const root = given.has("--root") ? resolve(cwd, given.get("--root")!) : repoRoot(cwd);
  if (set.has("--check-doc") || set.has("--write-doc")) {
    const file = join(root, REVIEW_DOC), text = reviewDoc();
    if (set.has("--write-doc")) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); return { exitCode: 0, root, message: `review: wrote ${REVIEW_DOC}` }; }
    const current = existsSync(file) ? readFileSync(file, "utf8") : "";
    return current === text
      ? { exitCode: 0, root, message: `review: ${REVIEW_DOC} matches the code` }
      : { exitCode: 1, root, message: `review: ${REVIEW_DOC} differs from the code; run clossys review --write-doc` };
  }
  const record = given.has("--record") ? resolve(cwd, given.get("--record")!) : undefined;
  const cloud = ["--publish", "--import", "--batch"].filter(flag => set.has(flag) || given.has(flag));
  if (cloud.length > 1) throw new CliUsageError(`${cloud.join(" and ")} are separate steps: give one\n${REVIEW_USAGE}`);
  const json = set.has("--json");
  try {
    if (set.has("--publish")) {
      if (positional.length !== 2 || !given.has("--packet")) throw new CliUsageError(`--publish needs <base> <head> and --packet <unit.md>\n${REVIEW_USAGE}`);
      const published = publishGate({
        repo: root, base: positional[0]!, head: positional[1]!, packet: resolve(cwd, given.get("--packet")!),
        ...(given.has("--receipt") ? { receipt: resolve(cwd, given.get("--receipt")!) } : {}),
        ...(given.has("--unit") ? { unit: given.get("--unit")! } : {}),
        ...(given.has("--push") ? { push: given.get("--push")! } : {}),
        log: line => process.stderr.write(`${line}\n`),
      });
      const message = [published.gate.review.line, `gate: ${published.branch} at ${published.commit}${published.pushed ? `, pushed to ${published.pushed}` : ", not pushed"}`, published.line].join("\n");
      return { exitCode: published.gate.verdict === "PASS" ? 0 : 1, root, message, ...(json ? { output: published } : {}) };
    }
    if (given.has("--import")) {
      if (positional.length || !given.has("--head") || !given.has("--base") || !given.has("--packet")) throw new CliUsageError(`--import <gate ref> needs --head <sha>, --base <ref> and --packet <unit.md>\n${REVIEW_USAGE}`);
      const imported = importGate({ repo: root, ref: given.get("--import")!, head: given.get("--head")!, base: given.get("--base")!, packet: resolve(cwd, given.get("--packet")!) });
      if (record && imported.record) writeRecord(record, imported.record);
      return { exitCode: imported.status === "PASS" ? 0 : 1, root, message: formatImport(imported), ...(json ? { output: imported } : {}) };
    }
    if (given.has("--batch")) {
      if (positional.length || !given.has("--base")) throw new CliUsageError(`--batch <tip> needs --base <ref> and --imported <review.json>...\n${REVIEW_USAGE}`);
      const batch = batchGate({ repo: root, tip: given.get("--batch")!, base: given.get("--base")!, imported: (many.get("--imported") ?? []).map(file => resolve(cwd, file)) });
      return { exitCode: batch.rerun ? 0 : 1, root, message: formatBatch(batch), ...(json ? { output: batch } : {}) };
    }
  } catch (error) {
    if (error instanceof ReviewArgumentError) throw new CliUsageError(`${error.message}\n${REVIEW_USAGE}`);
    throw error;
  }
  if (["--head", "--base", "--unit", "--push"].some(flag => given.has(flag)) || many.has("--imported")) throw new CliUsageError(`--head, --base, --unit, --push and --imported go with --publish, --import or --batch\n${REVIEW_USAGE}`);
  if (given.has("--mutation") || given.has("--expect-fail") || many.has("--run")) {
    if (!given.has("--mutation") || !given.has("--expect-fail")) throw new CliUsageError(`--mutation and --expect-fail go together: a mutation states the failure it expects\n${REVIEW_USAGE}`);
    if (positional.length || ["--packet", "--receipt", "--fast", "--seed"].some(flag => given.has(flag))) throw new CliUsageError(`--mutation runs on the checkout alone: no <base> <head>, --packet, --receipt, --fast or --seed\n${REVIEW_USAGE}`);
    const patch = resolve(cwd, given.get("--mutation")!);
    if (!existsSync(patch)) throw new CliUsageError(`review --mutation: no patch at ${patch}`);
    try { new RegExp(given.get("--expect-fail")!); } catch (error) { throw new CliUsageError(`--expect-fail is not a regular expression: ${(error as Error).message}\n${REVIEW_USAGE}`); }
    const mutation = runMutation({ repo: root, patch, expectFail: given.get("--expect-fail")!, ...(many.has("--run") ? { run: many.get("--run")! } : {}), log: line => process.stderr.write(`${line}\n`) });
    if (record) writeRecord(record, mutation);
    return { exitCode: mutation.verdict === "PASS" ? 0 : 1, root, message: formatMutation(mutation), ...(set.has("--json") ? { output: mutation } : {}) };
  }
  if (positional.length !== 2) throw new CliUsageError(`review needs <base> and <head>\n${REVIEW_USAGE}`);
  if (given.has("--receipt") && !given.has("--packet")) throw new CliUsageError(`--receipt needs --packet <unit.md>\n${REVIEW_USAGE}`);
  let report;
  try {
    report = runReview({
    repo: root, base: positional[0]!, head: positional[1]!,
    ...(given.has("--packet") ? { packet: resolve(cwd, given.get("--packet")!) } : {}),
    ...(given.has("--receipt") ? { receipt: resolve(cwd, given.get("--receipt")!) } : {}),
    ...(given.has("--seed") ? { seed: given.get("--seed")! } : {}),
    ...(given.has("--fast") ? { fast: resolve(cwd, given.get("--fast")!) } : {}),
    log: line => process.stderr.write(`${line}\n`),
    });
  } catch (error) {
    if (error instanceof ReviewArgumentError) throw new CliUsageError(`${error.message}\n${REVIEW_USAGE}`);
    throw error;
  }
  if (record) writeRecord(record, report);
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
  const red = receipt.commands.filter(entry => entry.exit !== entry.expect);
  // Fail closed: no command, a 127, or an unexpected exit is FAIL (RECEIPT_VERDICT).
  const { verdict, reasons } = receiptVerdict(receipt.commands);
  const message = [
    `receipt: ${receipt.commands.length} command(s) at ${receipt.head}${receipt.dirty ? " (DIRTY)" : ""}, ${red.length} not the expected exit; wrote ${out}/receipt.json`,
    ...receipt.commands.map(entry => `  ${entry.id} exit ${entry.exit}${entry.exit !== entry.expect ? ` (expected ${entry.expect})` : ""} ${entry.run}`),
    ...reasons.map(reason => `FAIL ${reason}`),
    `RECEIPT: ${verdict} ${receipt.head}`,
  ].join("\n");
  return { exitCode: verdict === "PASS" ? 0 : 1, root, message, ...(set.has("--json") ? { output: receipt } : {}) };
}
