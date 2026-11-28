/**
 * CP1-REPORT: tool feedback as a `clossys.queue-entry/2` kind report in the consumer's own queue
 * (`clossys/agents/producer/queue.report/entries/<id>.json`, shape in records/report-shape.ts). A consumer agent or the
 * owner files one when a clossys verb refuses with no next step or a step has no verb (`clossys request --kind report`);
 * a loop run files one when a step could not run (loop/runner.ts, the same fileReport). Producer owns every report: it
 * dedupes on about plus what (plus the evidence signature, CP1-LOOP-LEARN), keeps the failing check's output as
 * evidence, and tracks it to closure. loop.audit's `reports` step takes reports back (`clossys request --kind report
 * --recheck`): after a reinstall it re-runs each open report's recorded check and lists the passing ones. CP1-LOOP-LEARN:
 * a fixed close names a guard rule of scripts/rules/registry.json with a fixture run; a signed report matching a
 * fixed-closed one is filed as a REPEAT linking that report and its guard; Producer declines only a duplicate. Writes go
 * through the request store's writers (records/request.ts createRequest, writeRequest) under its lock. Nothing here
 * reaches the network.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { SLOT_REF } from "../loop/names.js";
import { PRODUCER_ROOT } from "./ledger.js";
import { addressed, canonical, createRequest, REQUEST_ID, REQUEST_SCHEMA, REQUEST_SEATS, RequestError, requestsDir, withRequestLock, writeRequest } from "./request.js";
import {
  FOUNDRY_RESULT, QUEUE_RESULT, REPORT_ABOUT, REPORT_CLOSERS, REPORT_GUARD, REPORT_KIND, REPORT_OUTCOMES, REPORT_QUEUE, REPORT_TARGET, REPORT_WHAT, reportIssues, reportRoute, reportSignature,
  type ReportEntry, type ReportEvidence, type ReportOutcome, type ReportWhat,
} from "./report-shape.js";
import type { Actor, Ref, RequestEvent } from "./types.js";

export { REPORT_QUEUE, REPORT_TARGET, reportSignature, type ReportEntry } from "./report-shape.js";

/** Runs a `clossys check ...` command's words in the consumer root; the CLI passes the in-process verb runner. */
export type CheckRunner = (argv: readonly string[], root: string) => Promise<{ readonly exitCode: number; readonly message: string }>;
/** The evidence output kept on an entry: the first characters of what the check printed. */
const OUTPUT_MAX = 2000;
const CHECK_COMMAND = /^clossys check( .*)?$/;

let version: string | undefined;
/** The installed Producer's version: the `foundry@<version>` a recheck closes a report with. */
export function producerVersion(): string {
  if (version === undefined) {
    try { version = (JSON.parse(readFileSync(join(PRODUCER_ROOT, "package.json"), "utf8")) as { version?: string }).version ?? "0.0.0"; } catch { version = "0.0.0"; }
  }
  return version;
}
const stampOf = (at: string) => `${at.slice(0, 4)}${at.slice(5, 7)}${at.slice(8, 10)}T${at.slice(11, 13)}${at.slice(14, 16)}Z`;
const reportPath = (consumer: string, id: string) => join(requestsDir(consumer, REPORT_KIND), `${id}.json`);
const withEvent = (entry: ReportEntry, op: RequestEvent["op"], at: string, by: string, detail: string): ReportEntry =>
  ({ ...entry, events: [...entry.events, { id: `${entry.id}#${entry.events.length + 1}`, at, op, by, detail }] });

/** Hours since an entry was raised, to one decimal: how long it has waited (`--list --json` ageHours). */
export const ageHours = (createdAt: string, now: string): number => Math.max(0, Math.round((Date.parse(now) - Date.parse(createdAt)) / 360_000) / 10);

export interface ReadReport { readonly file: string; readonly report?: ReportEntry; readonly issues: readonly string[] }
/** Every report under queue.report/entries, read and judged; an unreadable one is listed with its issue, never dropped. */
export function listReports(consumer: string): ReadReport[] {
  const dir = requestsDir(consumer, REPORT_KIND);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(name => name.endsWith(".json")).sort().map((name): ReadReport => {
    const file = join(dir, name);
    let doc: unknown;
    try { doc = JSON.parse(readFileSync(file, "utf8")); } catch (error) { return { file, issues: [`not JSON: ${error instanceof Error ? error.message : String(error)}`] }; }
    if (name.startsWith(".")) return { file, issues: [`${name} is a hidden file: an entry is <id>.json, and a hidden one is never skipped`] };
    const issues = reportIssues(doc);
    if (!issues.length && (doc as ReportEntry).id !== name.slice(0, -".json".length)) return { file, issues: [`id ${(doc as ReportEntry).id} is not the file name`] };
    return issues.length ? { file, issues } : { file, report: doc as ReportEntry, issues };
  });
}

/** The report `id`, or undefined when queue.report holds none by that id; an invalid one refuses. */
export function readReport(consumer: string, id: string): ReportEntry | undefined {
  if (!REQUEST_ID.test(id)) return undefined;
  const file = reportPath(consumer, id);
  if (!existsSync(file)) return undefined;
  let doc: unknown;
  try { doc = JSON.parse(readFileSync(file, "utf8")); } catch { throw new RequestError(`${REPORT_QUEUE}#${id} is not JSON`); }
  const issues = reportIssues(doc);
  if (issues.length) throw new RequestError(`${REPORT_QUEUE}#${id} is invalid: ${issues.slice(0, 5).join("; ")}`);
  return doc as ReportEntry;
}

export interface FileReportInput {
  readonly about: string;
  readonly what: string;
  readonly why: string;
  /** `<agent>/<slot>` or owner. */
  readonly from: string;
  /** The seat filing it (REQUEST_SEATS). */
  readonly by: string;
  readonly at: string;
  readonly source: "cli" | "check";
  readonly evidence?: ReportEvidence;
  readonly createdBy?: Actor;
}
/**
 * CP1-LOOP-LEARN: the dedupe key of two reports: about, what and the evidence signature. A report without a signature
 * keeps the about-and-what key (it matches only another unsigned report).
 */
export const sameReportKey = (a: Pick<ReportEntry, "about" | "what" | "evidence">, b: Pick<ReportEntry, "about" | "what" | "evidence">): boolean =>
  a.about === b.about && a.what === b.what && a.evidence?.signature === b.evidence?.signature;

/**
 * CP1-LOOP-LEARN: the fixed-closed report `draft` repeats: the latest closed fixed report with its key, when `draft` has a
 * signature. An unsigned report never repeats (its key is about and what only, and would flag every new bug of a verb).
 */
export function fixedMatch(reports: readonly (ReportEntry | undefined)[], draft: Pick<ReportEntry, "about" | "what" | "evidence">): ReportEntry | undefined {
  if (draft.evidence?.signature === undefined) return undefined;
  return reports.filter((report): report is ReportEntry => report?.status === "closed" && report.outcome === "fixed" && sameReportKey(report, draft))
    .sort((a, b) => (a.closedAt ?? "").localeCompare(b.closedAt ?? "") || a.id.localeCompare(b.id)).at(-1);
}

/** `draft` as a repeat of the fixed report `of`: repeatOf names it and its guard, and Producer's repeat event says so. */
export function withRepeat(draft: ReportEntry, of: ReportEntry | undefined): ReportEntry {
  if (!of) return draft;
  const repeatOf = { report: of.id, ...(of.guard !== undefined ? { guard: of.guard } : {}) };
  return withEvent({ ...draft, repeatOf }, "repeat", draft.createdAt, "producer",
    `REPEAT: ${REPORT_QUEUE}#${of.id} closed fixed (${of.result ?? "no result"}) with ${of.guard !== undefined ? `guard ${of.guard}` : "no guard"}, and the same failure is back`);
}

export interface FiledReport {
  readonly report: ReportEntry;
  readonly created: boolean;
  /** CP1-LOOP-LEARN: set when the filed report repeats a fixed-closed one (the CLI exits 1). */
  readonly repeat?: { readonly report: string; readonly guard?: string };
}
/**
 * Files a report, or returns the open one with the same key (about, what and signature; Producer dedupes and nothing is
 * written then). A signed report that matches a fixed-closed report is filed as a REPEAT: it links that report and its
 * guard (repeatOf and a repeat event). Both the CLI and a loop run's failed step file through here.
 */
export function fileReport(consumer: string, input: FileReportInput, options: { readonly dry?: boolean } = {}): FiledReport {
  const draft = reportDraft(input);
  return withRequestLock(consumer, `report-${input.about.replace(/\//g, "-")}-${input.what}`, () => {
    const reports = listReports(consumer).map(read => read.report);
    const existing = reports.find(report => report?.status === "open" && sameReportKey(report, draft));
    if (existing) return { report: existing, created: false };
    const filed = withRepeat(draft, fixedMatch(reports, draft));
    const repeat = filed.repeatOf ? { repeat: filed.repeatOf } : {};
    if (options.dry) return { report: filed, created: true, ...repeat };
    return { report: createRequest(consumer, filed), created: true, ...repeat };
  });
}

/** The report fileReport writes for `input` (its refusals first), before createRequest names its id: what the writer itself would write. */
export function reportDraft(input: FileReportInput): ReportEntry {
  if (!REPORT_ABOUT.test(input.about)) throw new RequestError(`--about must be verb/<name>, skill/<name> or agent/<name>, got ${input.about}`);
  if (!(REPORT_WHAT as readonly string[]).includes(input.what)) throw new RequestError(`--what must be ${REPORT_WHAT.join(", ")}, got ${input.what}`);
  if (input.from !== "owner" && !SLOT_REF.test(input.from)) throw new RequestError(`--from must be owner or <agent>/<slot id>, got ${input.from}`);
  if (!(REQUEST_SEATS as readonly string[]).includes(input.by)) throw new RequestError(`--by must be one of ${REQUEST_SEATS.join(", ")}, got ${input.by}`);
  if (!input.why.trim()) throw new RequestError("--why says what went wrong");
  const id = `${stampOf(input.at)}-report-${input.about.replace(/\//g, "-")}-${input.what}`.slice(0, 80).replace(/-+$/, "");
  const route = reportRoute();
  return {
    schema: REQUEST_SCHEMA, id, kind: REPORT_KIND, from: input.from, assignee: "producer", target: REPORT_TARGET, status: "open", opened: `${id}#1`,
    why: input.why, source: input.source, route, about: input.about, what: input.what as ReportWhat,
    ...(input.evidence ? { evidence: input.evidence } : {}),
    createdBy: input.createdBy ?? { actor: "code", cli: input.source === "cli" ? "clossys request" : "clossys run", version: producerVersion() },
    createdAt: input.at, refs: SLOT_REF.test(input.from) ? [{ to: input.from as Ref["to"], rel: "raisedBy" }] : [],
    events: [
      { id: `${id}#1`, at: input.at, op: "raised", by: input.by, via: "cli", detail: input.why },
      { id: `${id}#2`, at: input.at, op: "routed", by: "producer", detail: `${route.row} -> ${route.assignee}: Producer owns every report and tracks it to closure` },
    ],
  };
}

/** The report fileReport drafts for `entry`'s about, what, why, from, createdAt and evidence when `agent` files it (`clossys request --kind report --by <agent>`). */
export const agentReportDraft = (entry: ReportEntry, agent: string): ReportEntry =>
  reportDraft({ about: entry.about, what: entry.what, why: entry.why, from: entry.from, by: agent, at: entry.createdAt, source: "cli", ...(entry.evidence ? { evidence: entry.evidence } : {}) });

/**
 * CP1-CHECKS fix round 1 (review-cp1checks-blindA P1-1): why a report an agent step of an agent loop wrote is not the
 * report the report writer itself files for that agent (`clossys request --kind report ... --by <agent>`, source cli).
 * Like agentRaiseIssues: the writer's own draft is rebuilt from the entry's about, what, why, from, createdAt (and its
 * evidence, as the verb kept it, and the repeat the store makes it) with `by` the step's agent (reportDraft, the writer's refusals included) and must equal
 * the entry exactly: its id from its createdAt, or createRequest's -2..-9 suffix; its raised event by the agent via cli
 * and Producer's routed event; its route, raisedBy ref and code actor. No other open report may have the same about and
 * what (the writer dedupes on them and writes nothing then). A report raised by another seat, or a forged or rewritten
 * chain, is refused. Empty when the entry is exactly the writer's.
 */
export function agentReportIssues(consumer: string, entry: ReportEntry, agent: string): string[] {
  let draft: ReportEntry;
  const others = listReports(consumer).map(read => read.report).filter(other => other !== undefined && other.id !== entry.id);
  try { draft = agentReportDraft(entry, agent); } catch (error) {
    if (error instanceof RequestError) return [error.message];
    throw error;
  }
  draft = withRepeat(draft, fixedMatch(others, draft));
  const issues: string[] = [];
  // createRequest's own relabel on an id already taken: the draft's id or its -2..-9 suffix, with opened and events renamed.
  const suffix = entry.id.startsWith(draft.id) ? entry.id.slice(draft.id.length) : undefined;
  if (suffix === undefined || !/^(?:-[2-9])?$/.test(suffix)) issues.push(`id ${entry.id}: clossys request names it ${draft.id} (or its -2..-9 suffix) from its createdAt, about and what`);
  else {
    const expected = addressed(draft, entry.id);
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(entry)])].sort()
      .filter(key => canonical((expected as unknown as Record<string, unknown>)[key]) !== canonical((entry as unknown as Record<string, unknown>)[key]));
    if (keys.length) issues.push(`not the report clossys request files for ${agent} (${entry.id}): ${keys.join(", ")} differ${keys.length === 1 ? "s" : ""}`);
  }
  const duplicate = others.find(other => other !== undefined && other.status === "open" && sameReportKey(other, entry));
  if (duplicate) issues.push(`${REPORT_QUEUE}#${duplicate.id} is already open for ${entry.about} ${entry.what}: the writer files no second one`);
  return issues;
}

/**
 * The evidence `--evidence` names: a `clossys check ...` command (run now; its exit code and output are kept, and a check
 * that passes now is refused: it shows nothing) or a file in the repository (its path and sha256).
 */
export async function evidenceOf(root: string, value: string, runCheck: CheckRunner): Promise<ReportEvidence> {
  if (value.startsWith("clossys ")) {
    const argv = checkArgv(value);
    const ran = await runCheck(argv, root);
    if (ran.exitCode === 0) throw new RequestError(`--evidence ${value} passes now (exit 0): a report's check is the one that fails`);
    // CP1-LOOP-LEARN: the check's failure text, signed (reportSignature), is what a repeat of the same cause matches.
    const output = ran.message.slice(0, OUTPUT_MAX);
    const signature = reportSignature(output);
    return { check: value, exitCode: ran.exitCode, output, ...(signature !== undefined ? { signature } : {}) };
  }
  const file = resolve(root, value);
  const rel = relative(root, file);
  if (!rel || rel.split(sep)[0] === ".." || isAbsolute(rel)) throw new RequestError(`--evidence ${value} is not a path in the repository`);
  if (!existsSync(file) || !statSync(file).isFile()) throw new RequestError(`--evidence ${value} is no file in the repository`);
  return { path: rel.split(sep).join("/"), sha256: createHash("sha256").update(readFileSync(file)).digest("hex") };
}
/** A recorded check's words after `clossys` (space-separated, no quoting); --root is the runner's to add. */
function checkArgv(command: string): string[] {
  if (!CHECK_COMMAND.test(command)) throw new RequestError(`a report's check is a clossys check command (clossys check ...), got ${command}`);
  const argv = command.split(/\s+/).filter(Boolean).slice(1);
  if (argv.includes("--root")) throw new RequestError(`a report's check runs in the consumer root: drop --root from ${command}`);
  return argv;
}

/** The rule registry a fixed close's guard is read from, relative to the root that holds `clossys/`. */
export const GUARD_REGISTRY = "scripts/rules/registry.json";

/**
 * CP1-LOOP-LEARN: why `guard` cannot guard a fixed close in `root`, or undefined when it can: a guard is a rule of
 * scripts/rules/registry.json with at least one fixture_runs entry (its check fails on the rule's violation fixture).
 */
export function guardIssue(root: string, guard: string): string | undefined {
  if (!REPORT_GUARD.test(guard)) return `--guard must be a rule id R-<NAME> of ${GUARD_REGISTRY}, got ${guard}`;
  const file = join(root, ...GUARD_REGISTRY.split("/"));
  if (!existsSync(file)) return `--guard ${guard}: there is no ${GUARD_REGISTRY} in this root to name it`;
  let rules: unknown;
  try { rules = (JSON.parse(readFileSync(file, "utf8")) as { rules?: unknown }).rules; } catch { return `--guard ${guard}: ${GUARD_REGISTRY} is not JSON`; }
  const rule = Array.isArray(rules) ? (rules as { id?: unknown; fixture_runs?: unknown }[]).find(row => row?.id === guard) : undefined;
  if (!rule) return `--guard ${guard}: ${GUARD_REGISTRY} has no rule ${guard}`;
  if (!Array.isArray(rule.fixture_runs) || rule.fixture_runs.length === 0) return `--guard ${guard}: rule ${guard} in ${GUARD_REGISTRY} has no fixture_runs entry, so no check is shown to fail on its violation`;
  return undefined;
}

export interface CloseReportInput { readonly outcome: string; readonly result: string; readonly by: string; readonly at: string; readonly guard?: string }
/**
 * Closes a report fixed or declined. CP1-LOOP-LEARN: a fixed close names its guard (`--guard R-<id>`, guardIssue),
 * whether or not the report records a check, and the closed report keeps it. A fixed close of a report that records a
 * check re-runs it first: a pass writes Producer's verified event and the close; a fail writes a rejected event and
 * refuses, so the report stays open. A declined duplicate names the report it merges into (`queue.report#<id>`);
 * Producer declines only so (any other decline is the owner's).
 */
export async function closeReport(consumer: string, id: string, input: CloseReportInput, runCheck: CheckRunner): Promise<ReportEntry> {
  if (!(REPORT_CLOSERS as readonly string[]).includes(input.by)) throw new RequestError(`a report closes with --by ${REPORT_CLOSERS.join(" or ")}, got ${input.by}`);
  if (!(REPORT_OUTCOMES as readonly string[]).includes(input.outcome)) throw new RequestError(`a report closes with --outcome ${REPORT_OUTCOMES.join(" or ")}, got ${input.outcome}`);
  if (input.outcome === "fixed" && !FOUNDRY_RESULT.test(input.result)) throw new RequestError(`a fixed report closes with --result foundry@<version or sha>, got ${input.result}`);
  if (input.outcome === "declined" && !FOUNDRY_RESULT.test(input.result) && !QUEUE_RESULT.test(input.result)) throw new RequestError(`a declined report closes with --result foundry@<version or sha> or the report it merges into (queue.report#<id>), got ${input.result}`);
  if (input.outcome === "declined" && input.by === "producer" && !QUEUE_RESULT.test(input.result)) throw new RequestError(`Producer declines a report only as a duplicate: --result queue.report#<the report it duplicates>, got ${input.result}; any other decline is the owner's`);
  if (input.outcome !== "fixed" && input.guard !== undefined) throw new RequestError(`--guard goes with --outcome fixed, got --outcome ${input.outcome}`);
  if (input.outcome === "fixed") {
    if (input.guard === undefined) throw new RequestError(`a fixed close names its guard: --guard R-<id>, a rule in ${GUARD_REGISTRY} with a fixture run, so the same failure cannot come back unseen`);
    const issue = guardIssue(resolve(consumer, ".."), input.guard);
    if (issue) throw new RequestError(issue);
  }
  if (QUEUE_RESULT.test(input.result)) {
    const into = input.result.slice(`${REPORT_QUEUE}#`.length);
    if (into === id) throw new RequestError(`${REPORT_QUEUE}#${id} cannot merge into itself`);
    if (!readReport(consumer, into)) throw new RequestError(`--result ${input.result}: no such report`);
  }
  const before = readReport(consumer, id);
  if (!before) throw new RequestError(`no report ${id} under clossys/agents/producer/${REPORT_QUEUE}`);
  if (before.status !== "open") throw new RequestError(`${REPORT_QUEUE}#${id} is already closed`);
  const check = input.outcome === "fixed" ? before.evidence?.check : undefined;
  const ran = check !== undefined ? await runCheck(checkArgv(check), resolve(consumer, "..")) : undefined;
  return withRequestLock(consumer, id, () => {
    const report = readReport(consumer, id)!;
    if (report.status !== "open" || report.events.length !== before.events.length) throw new RequestError(`${REPORT_QUEUE}#${id} changed while its check ran; nothing was closed`);
    let next = report;
    if (ran && check !== undefined) {
      const first = ran.message.split("\n")[0] ?? "";
      if (ran.exitCode !== 0) {
        writeRequest(consumer, withEvent(report, "rejected", input.at, "producer", `check still fails: ${check} (exit ${ran.exitCode})${first ? `: ${first}` : ""}`));
        throw new RequestError(`${REPORT_QUEUE}#${id} stays open: its check ${check} still fails (exit ${ran.exitCode}); a rejected event records it`);
      }
      next = withEvent(next, "verified", input.at, "producer", `check passed: ${check} (exit 0)`);
    }
    const guard = input.outcome === "fixed" ? { guard: input.guard! } : {};
    const closing = withEvent({ ...next, status: "closed", outcome: input.outcome as ReportOutcome, result: input.result, ...guard, notified: { to: report.from, at: input.at }, closedAt: input.at },
      "closed", input.at, input.by, `${input.outcome}: ${input.result}${input.outcome === "fixed" ? `; guard ${input.guard!}` : ""}; notified ${report.from}`);
    const closed: ReportEntry = { ...closing, closed: closing.events.at(-1)!.id };
    writeRequest(consumer, closed);
    return closed;
  });
}

/**
 * loop.audit's `reports` step: re-runs each open report's recorded check. CP1-LOOP-LEARN: a passing one is listed
 * `passing`, not closed: a fixed close names its guard rule (closeReport), which only the closer can, so it closes with
 * `clossys request <id> --close --outcome fixed --result foundry@<version> --guard R-<id>`. A failing check, or a report
 * with no check, stays open untouched. Nothing is written.
 */
export async function recheckReports(consumer: string, _at: string, runCheck: CheckRunner): Promise<{ passing: string[]; open: string[]; unchecked: string[]; invalid: string[] }> {
  const out = { passing: [] as string[], open: [] as string[], unchecked: [] as string[], invalid: [] as string[] };
  for (const read of listReports(consumer)) {
    if (!read.report) { out.invalid.push(`${read.file}: ${read.issues.slice(0, 3).join("; ")}`); continue; }
    const report = read.report;
    if (report.status !== "open") continue;
    if (report.evidence?.check === undefined) { out.unchecked.push(report.id); continue; }
    const ran = await runCheck(checkArgv(report.evidence.check), resolve(consumer, ".."));
    (ran.exitCode !== 0 ? out.open : out.passing).push(report.id);
  }
  return out;
}

/**
 * A loop run's step that could not run, or failed with no route on, files a report (about the step's verb, else
 * verb/run): the same fileReport the CLI files through, from `producer/<loop>`, by Producer. Returns the entry name,
 * and whether this call filed it (`created`) or an open report with the same about and what was reused unchanged.
 */
export function fileStepReport(root: string, input: { readonly loop: string; readonly runId: string; readonly step: string; readonly cli: string; readonly why: string; readonly at: string }): { readonly entry: string; readonly created: boolean; readonly repeat?: { readonly report: string; readonly guard?: string } } {
  const about = `verb/${/^clossys ([a-z][a-z0-9-]*)/.exec(input.cli)?.[1] ?? "run"}`;
  // CP1-LOOP-LEARN: the step's failure text, signed, so a cause that returns after a fixed close is a REPEAT.
  const signature = reportSignature(input.why);
  const filed = fileReport(join(root, "clossys"), {
    about, what: "bug", why: `${input.loop} run ${input.runId}: ${input.why}`, from: `producer/${input.loop}`, by: "producer", at: input.at, source: "check",
    ...(signature !== undefined ? { evidence: { signature } } : {}),
  });
  return { entry: `${REPORT_QUEUE}#${filed.report.id}`, created: filed.created, ...(filed.repeat ? { repeat: filed.repeat } : {}) };
}
