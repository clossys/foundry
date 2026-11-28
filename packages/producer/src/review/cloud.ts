/**
 * A cloud unit's own gate result as the Reviewer's mechanical proof (rule R-REVIEW-CLOUD-PROOF).
 *
 * - publish: `clossys review --publish <base> <head> --packet <unit.md>` runs the mechanical review at head in the
 *   cloud clone and commits only gate.json and receipt.json, with git plumbing, to `<unit branch>-gate`. The unit
 *   branch, the index and the working tree are never changed; publish checks that afterwards.
 * - import: `clossys review --import <gate ref> --head <sha> --base <ref> --packet <unit.md>` re-runs nothing. It refuses
 *   unless the result's head and tree equal the unit head, its base (and the merge base it implies) equals the
 *   recorded base, its receipt was taken clean at that head, and every packet command ran. An accepted result writes
 *   the same clossys.review/1 record a local run writes, with an `imported` note of where it came from.
 * - fallback: a cloud FAIL is never overridden: import prints FAIL, writes the FAIL record, and the next step is a local run.
 * - batch: `clossys review --batch <tip> --base <ref> --imported <record.json>...` names the merged batch tip, the one
 *   commit this machine re-runs per batch, and the commits in it no imported unit covers (made on this machine).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { git, run, tmpRoot } from "./exec.js";
import { parsePacket, readReceipt, receiptFileFor, type Command, type Receipt } from "./receipt.js";
import { failClosed, ReviewArgumentError, runReview, verdictOf, type ReviewOptions } from "./review.js";
import type { Finding, ReviewReport } from "./types.js";

export const GATE_SCHEMA = "clossys.cloud-gate/1";
export const IMPORT_SCHEMA = "clossys.cloud-import/1";
export const BATCH_SCHEMA = "clossys.cloud-batch/1";
/** The files a gate commit holds, and nothing else. */
export const GATE_FILES = ["gate.json", "receipt.json"] as const;
/** The gate branch of a unit branch. */
export const gateBranch = (unit: string) => `${unit}-gate`;

export interface GateResult {
  readonly schema: typeof GATE_SCHEMA;
  /** The unit branch the head is on. */
  readonly unit: string;
  readonly base: string;
  readonly mergeBase: string;
  readonly head: string;
  readonly tree: string;
  /** The packet by file name and sha256, and the commands parsed from it at publish time. */
  readonly packet: { readonly name: string; readonly sha256: string; readonly commands: readonly Command[] };
  readonly receipt: Receipt;
  readonly review: ReviewReport;
  readonly verdict: "PASS" | "FAIL";
  /** `GATE: <verdict> <head> <tree>`. */
  readonly line: string;
}

/** Why an import refuses a gate result (docs/review.md (not shipped)); any one is a refusal, never a PASS. */
export const IMPORT_REFUSALS: readonly { readonly id: string; readonly fails: string }[] = [
  { id: "import.malformed", fails: `the gate ref has no gate.json, or it is not a ${GATE_SCHEMA} document with a review and a receipt` },
  { id: "import.head", fails: "the result's head (or its review's or receipt's head) is not the unit head given with --head" },
  { id: "import.tree", fails: "the result's tree (or its review's tree) is not the unit head's tree" },
  { id: "import.base", fails: "the result's base is not the recorded base given with --base, or its merge base is not the merge base of that base and the head" },
  { id: "import.dirty", fails: "the receipt was taken on uncommitted changes" },
  { id: "import.no-commands", fails: "the packet's Validation list, parsed here, gives no command" },
  { id: "import.command-missing", fails: "a command the packet gives is not in the result's receipt: every packet command must have run" },
  { id: "import.receipt-skipped", fails: "the review ran without the packet, so its receipt step never held the receipt to it" },
  { id: "import.inconsistent", fails: "the result's verdict disagrees with its own findings, its fail-closed counts or its verdict line" },
];

export interface ImportFacts {
  /** The unit head and its tree, resolved here. */
  readonly head: string;
  readonly tree: string;
  /** The recorded base, resolved here, and the merge base of it and the head (null: not provable here). */
  readonly base: string;
  readonly mergeBase: string | null;
  /** The packet's commands, parsed here. */
  readonly commands: readonly Pick<Command, "run" | "expect">[];
}

export interface ImportResult {
  readonly schema: typeof IMPORT_SCHEMA;
  /** PASS: accepted as the mechanical proof; FAIL: the cloud gate failed; REFUSED: the result proves nothing here. */
  readonly status: "PASS" | "FAIL" | "REFUSED";
  readonly gate: { readonly ref: string; readonly commit: string | null };
  readonly head: string;
  readonly base: string;
  readonly refusals: readonly Finding[];
  /** The mechanical record (PASS or FAIL), as a local run writes it. */
  readonly record?: ReviewReport;
  /** What runs next, when the import is not a PASS: a local run of this head. */
  readonly next?: string;
  /** `IMPORT: <status> <head>`. */
  readonly line: string;
}

const MECHANICAL_LINE = /^MECHANICAL: (PASS|FAIL) ([0-9a-f]{40}) ([0-9a-f]{40})$/;

/** The local run a refused or failed import falls back to. */
export const localRun = (base: string, head: string, packet = "<unit.md>") => `clossys review ${base} ${head} --packet ${packet}`;

/**
 * The import's judgement of one gate result against what this machine resolves (facts). Pure: it reads and runs
 * nothing, so parity records can hold it to recorded verdicts.
 */
export function judgeImport(gate: unknown, facts: ImportFacts, ref: string, commit: string | null = null): ImportResult {
  const refusals: Finding[] = [];
  const refuse = (id: string, subject: string, detail: string) => refusals.push({ id, level: "fail", subject, detail });
  const result = gate as Partial<GateResult> | null;
  const done = (record?: ReviewReport): ImportResult => {
    const status = refusals.length ? "REFUSED" : record!.verdict;
    return {
      schema: IMPORT_SCHEMA, status, gate: { ref, commit }, head: facts.head, base: facts.base, refusals,
      ...(status === "REFUSED" ? {} : { record }),
      ...(status === "PASS" ? {} : { next: localRun(facts.base, facts.head) }),
      line: `IMPORT: ${status} ${facts.head}`,
    };
  };
  if (!result || typeof result !== "object" || result.schema !== GATE_SCHEMA || !result.review || typeof result.review !== "object" || !result.receipt || typeof result.receipt !== "object" || !Array.isArray(result.receipt.commands) || !Array.isArray(result.review.findings)) {
    refuse("import.malformed", ref, `not a ${GATE_SCHEMA} document with a review and a receipt`);
    return done();
  }
  const { review, receipt } = result;
  for (const [what, value] of [["result", result.head], ["review", review.head], ["receipt", receipt.head]] as const) {
    if (value !== facts.head) refuse("import.head", what, `the ${what} is at ${String(value).slice(0, 12)}, the unit head is ${facts.head.slice(0, 12)}`);
  }
  for (const [what, value] of [["result", result.tree], ["review", review.tree]] as const) {
    if (value !== facts.tree) refuse("import.tree", what, `the ${what} tree is ${String(value).slice(0, 12)}, the unit head's tree is ${facts.tree.slice(0, 12)}`);
  }
  if (result.base !== facts.base || review.base !== facts.base) refuse("import.base", "base", `the result is over ${String(result.base).slice(0, 12)}, the recorded base is ${facts.base.slice(0, 12)}`);
  else if (facts.mergeBase === null) refuse("import.base", "merge base", "the merge base of the recorded base and the head cannot be computed here: fetch both and import again");
  else if (result.mergeBase !== facts.mergeBase) refuse("import.base", "merge base", `the result's merge base is ${String(result.mergeBase).slice(0, 12)}, the recorded base and the head give ${facts.mergeBase.slice(0, 12)}`);
  if (receipt.dirty !== false) refuse("import.dirty", "receipt", "taken on uncommitted changes");
  if (!facts.commands.length) refuse("import.no-commands", "packet", "the packet's Validation list gives no command to hold the result to");
  for (const command of facts.commands) {
    if (!receipt.commands.some(entry => entry.run === command.run)) refuse("import.command-missing", command.run, "the packet gives this command; the result's receipt never ran it");
  }
  const receiptStep = Array.isArray(review.steps) ? review.steps.find(step => step.step === "receipt") : undefined;
  if (!receiptStep || receiptStep.status === "skip") refuse("import.receipt-skipped", "review", "the review ran without --packet: its receipt was never held to the packet");
  const own = verdictOf([...review.findings, ...failClosed(review.ran ?? { commands: 0, missing: [] })]);
  const line = MECHANICAL_LINE.exec(String(review.line));
  if (review.verdict !== own || result.verdict !== review.verdict || !line || line[1] !== review.verdict || line[2] !== review.head || line[3] !== review.tree || result.line !== `GATE: ${result.verdict} ${result.head} ${result.tree}`) {
    // A PASS whose own findings say FAIL is a FAIL that someone relabelled; it is refused, never imported as either.
    refuse("import.inconsistent", "verdict", `the result says ${String(result.verdict)}, its review says ${String(review.verdict)}, its findings and counts give ${own}, its line is ${JSON.stringify(String(review.line)).slice(0, 120)}`);
  }
  if (refusals.length) return done();
  const record: ReviewReport = { ...review, imported: { ref, commit, unit: String(result.unit), gateVerdict: review.verdict, head: facts.head, tree: facts.tree, base: facts.base, mergeBase: facts.mergeBase! } };
  return done(record);
}

/** The gate result at ref (a gate branch, local or remote-tracking, or a gate commit) and the commit it names. */
export function readGate(repo: string, ref: string): { gate: unknown; commit: string | null } {
  let commit: string | null = null;
  try { commit = git(repo, ["rev-parse", "--verify", `${ref}^{commit}`]); } catch { return { gate: null, commit: null }; }
  try { return { gate: JSON.parse(git(repo, ["show", `${commit}:gate.json`])), commit }; } catch { return { gate: null, commit }; }
}

const resolveCommit = (repo: string, rev: string, what: string) => {
  try { return git(repo, ["rev-parse", "--verify", `${rev}^{commit}`]); } catch { throw new ReviewArgumentError(`${what} ${rev} is not a commit here: fetch it first`); }
};

export interface ImportOptions { readonly repo: string; readonly ref: string; readonly head: string; readonly base: string; readonly packet: string }

/** `clossys review --import`: read the gate result, resolve the facts here, judge. Runs no check. */
export function importGate(options: ImportOptions): ImportResult {
  const head = resolveCommit(options.repo, options.head, "--head");
  const base = resolveCommit(options.repo, options.base, "--base");
  let commands: readonly Command[];
  try { commands = parsePacket(readFileSync(options.packet, "utf8"), options.packet).commands; }
  catch (error) { throw new ReviewArgumentError(`--packet ${options.packet}: ${(error as Error).message}`); }
  let mergeBase: string | null = null;
  try { mergeBase = git(options.repo, ["merge-base", base, head]); } catch { mergeBase = null; }
  const { gate, commit } = readGate(options.repo, options.ref);
  return judgeImport(gate, { head, tree: git(options.repo, ["rev-parse", `${head}^{tree}`]), base, mergeBase, commands }, options.ref, commit);
}

export function formatImport(result: ImportResult): string {
  return [
    `clossys review --import ${result.gate.ref}${result.gate.commit ? ` (${result.gate.commit.slice(0, 12)})` : ""} for ${result.head.slice(0, 12)} over ${result.base.slice(0, 12)}`,
    ...result.refusals.map(item => `  REFUSED ${item.id} ${item.subject}: ${item.detail}`),
    ...(result.record ? [`  cloud gate: ${result.record.line}`] : []),
    ...(result.next ? [`next: a local run, ${result.next}`] : []),
    result.line,
  ].join("\n");
}

/** Replaces this machine's paths in a gate result's text with placeholders: a published result names no local path. */
export function scrubPaths(text: string, roots: readonly string[]): string {
  let out = text;
  for (const root of [...new Set(roots.filter(item => item.length > 1))].sort((a, b) => b.length - a.length)) {
    out = out.split(JSON.stringify(root).slice(1, -1)).join("<local>");
  }
  return out;
}

export interface PublishOptions {
  readonly repo: string;
  readonly base: string;
  readonly head: string;
  readonly packet: string;
  /** The unit branch; default: head, when head names a local branch. */
  readonly unit?: string;
  /** A receipt.json taken at head; default: the packet's default receipt folder. */
  readonly receipt?: string;
  /** Push the gate branch, and only it, to this remote. */
  readonly push?: string;
  /** The review to run (tests replace it); default runReview. */
  readonly review?: (options: ReviewOptions) => ReviewReport;
  readonly log?: (line: string) => void;
}

export interface PublishResult { readonly gate: GateResult; readonly branch: string; readonly commit: string; readonly pushed: string | null; readonly line: string }

/** A blob of text in repo's object store. */
const blob = (repo: string, text: string) => {
  const result = run(["git", "hash-object", "-w", "--stdin"], repo, { input: text });
  if (result.exit) throw new Error(`git hash-object: ${result.output.trim()}`);
  return result.stdout.trim();
};

/** `clossys review --publish`: review head, commit gate.json and receipt.json to the gate branch; nothing else moves. */
export function publishGate(options: PublishOptions): PublishResult {
  const repo = options.repo;
  const head = resolveCommit(repo, options.head, "<head>");
  const unit = options.unit ?? (run(["git", "show-ref", "--verify", "--quiet", `refs/heads/${options.head}`], repo).exit === 0 ? options.head : undefined);
  if (!unit) throw new ReviewArgumentError(`--publish needs --unit <branch>: ${options.head} is not a local branch name`);
  const unitRef = `refs/heads/${unit}`;
  const unitBefore = run(["git", "rev-parse", "--verify", "--quiet", unitRef], repo).stdout.trim();
  if (unitBefore && unitBefore !== head) throw new ReviewArgumentError(`the unit branch ${unit} is at ${unitBefore.slice(0, 12)}, not at the head ${head.slice(0, 12)}`);
  const receiptFile = receiptFileFor(options.packet, options.receipt);
  if (!receiptFile) throw new ReviewArgumentError(`no receipt for ${options.packet}: run clossys receipt --packet at the head first`);
  const statusBefore = git(repo, ["status", "--porcelain"]);
  const packetText = readFileSync(options.packet, "utf8");
  const review = (options.review ?? runReview)({ repo, base: options.base, head, packet: options.packet, receipt: receiptFile, ...(options.log ? { log: options.log } : {}) });
  const receipt = readReceipt(receiptFile);
  const gate: GateResult = {
    schema: GATE_SCHEMA, unit, base: review.base, mergeBase: git(repo, ["merge-base", review.base, head]), head: review.head, tree: review.tree,
    packet: { name: basename(options.packet), sha256: createHash("sha256").update(packetText).digest("hex"), commands: parsePacket(packetText, basename(options.packet)).commands },
    receipt: { ...receipt, packet: basename(options.packet) }, review, verdict: review.verdict, line: `GATE: ${review.verdict} ${review.head} ${review.tree}`,
  };
  const roots = [resolve(repo), dirname(resolve(options.packet)), dirname(receiptFile), tmpRoot(), process.env.HOME ?? ""];
  const gateText = scrubPaths(`${JSON.stringify(gate, null, 2)}\n`, roots);
  const receiptText = scrubPaths(`${JSON.stringify(gate.receipt, null, 2)}\n`, roots);
  const tree = run(["git", "mktree"], repo, { input: `100644 blob ${blob(repo, gateText)}\tgate.json\n100644 blob ${blob(repo, receiptText)}\treceipt.json\n` });
  if (tree.exit) throw new Error(`git mktree: ${tree.output.trim()}`);
  const branch = gateBranch(unit), gateRef = `refs/heads/${branch}`;
  const parent = run(["git", "rev-parse", "--verify", "--quiet", gateRef], repo).stdout.trim();
  const commit = git(repo, ["commit-tree", tree.stdout.trim(), ...(parent ? ["-p", parent] : []), "-m", `${gate.line}\n\nunit ${unit}, base ${gate.base}`]);
  git(repo, ["update-ref", gateRef, commit, ...(parent ? [parent] : [""])]);
  let pushed: string | null = null;
  if (options.push) { git(repo, ["push", "--quiet", options.push, `${gateRef}:${gateRef}`]); pushed = options.push; }
  // Publish moves the gate branch only: the unit branch, the index and the working tree are as they were.
  const unitAfter = run(["git", "rev-parse", "--verify", "--quiet", unitRef], repo).stdout.trim();
  if (unitAfter !== unitBefore) throw new Error(`publish moved the unit branch ${unit}: ${unitBefore} -> ${unitAfter}`);
  if (git(repo, ["status", "--porcelain"]) !== statusBefore) throw new Error("publish changed the working tree or the index");
  return { gate, branch, commit, pushed, line: `PUBLISH: ${gate.verdict} ${head} ${branch} ${commit}` };
}

export interface BatchResult {
  readonly schema: typeof BATCH_SCHEMA;
  readonly tip: string;
  readonly base: string;
  readonly units: readonly { readonly file: string; readonly head: string; readonly gate: string }[];
  /** Commits in base..tip that no imported unit head reaches: made on this machine. */
  readonly local: readonly string[];
  readonly refusals: readonly Finding[];
  /** The one local re-run of the batch: the merged tip. */
  readonly rerun?: string;
  /** `BATCH: RERUN <tip>` or `BATCH: REFUSED <tip>`. */
  readonly line: string;
}

/** `clossys review --batch`: the merged tip this machine re-runs once, over imported PASS records merged into it. */
export function batchGate(options: { readonly repo: string; readonly tip: string; readonly base: string; readonly imported: readonly string[] }): BatchResult {
  const tip = resolveCommit(options.repo, options.tip, "--batch");
  const base = resolveCommit(options.repo, options.base, "--base");
  const refusals: Finding[] = [];
  const refuse = (id: string, subject: string, detail: string) => refusals.push({ id, level: "fail", subject, detail });
  const units: { file: string; head: string; gate: string }[] = [];
  if (!options.imported.length) refuse("batch.no-units", "batch", "no --imported record: a batch of nothing imported is a local run, not a batch");
  for (const file of options.imported) {
    let record: Partial<ReviewReport>;
    try { record = JSON.parse(readFileSync(file, "utf8")) as Partial<ReviewReport>; } catch (error) { refuse("batch.unreadable", file, (error as Error).message.split("\n")[0]!); continue; }
    if (record.schema !== "clossys.review/1" || !record.imported || typeof record.head !== "string") { refuse("batch.not-imported", file, "not a clossys.review/1 record written by clossys review --import"); continue; }
    if (record.verdict !== "PASS" || record.imported.gateVerdict !== "PASS") { refuse("batch.not-pass", file, `the imported verdict is ${String(record.verdict)}: a unit merges into a batch only on an imported PASS`); continue; }
    if (record.imported.head !== record.head) { refuse("batch.not-imported", file, "the record's head is not the head it was imported for"); continue; }
    if (run(["git", "merge-base", "--is-ancestor", record.head, tip], options.repo).exit !== 0) { refuse("batch.not-merged", file, `${record.head.slice(0, 12)} is not merged into the batch tip ${tip.slice(0, 12)}`); continue; }
    units.push({ file, head: record.head, gate: String(record.imported.commit ?? record.imported.ref) });
  }
  const local = git(options.repo, ["rev-list", tip, "--not", base, ...units.map(item => item.head)]).split("\n").filter(Boolean);
  const ok = refusals.length === 0;
  return {
    schema: BATCH_SCHEMA, tip, base, units, local, refusals,
    ...(ok ? { rerun: `clossys review ${base} ${tip}` } : {}),
    line: `BATCH: ${ok ? "RERUN" : "REFUSED"} ${tip}`,
  };
}

export function formatBatch(result: BatchResult): string {
  return [
    `clossys review --batch ${result.tip.slice(0, 12)} over ${result.base.slice(0, 12)}: ${result.units.length} imported unit(s), ${result.local.length} commit(s) made here`,
    ...result.units.map(item => `  unit ${item.head.slice(0, 12)} (gate ${item.gate.slice(0, 12)})`),
    ...result.local.map(sha => `  local ${sha.slice(0, 12)}`),
    ...result.refusals.map(item => `  REFUSED ${item.id} ${item.subject}: ${item.detail}`),
    ...(result.rerun ? [`next: the one local run of this batch, ${result.rerun}`] : []),
    result.line,
  ].join("\n");
}
