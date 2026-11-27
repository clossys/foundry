/**
 * CP1-REPORT: tool feedback as a `clossys.queue-entry/2` kind report in the consumer's own queue
 * (`clossys/agents/producer/queue.report/entries/<id>.json`, shape in records/report-shape.ts). A consumer agent or the
 * owner files one when a clossys verb refuses with no next step or a step has no verb (`clossys request --kind report`);
 * a loop run files one when a step could not run (loop/runner.ts, the same fileReport). Producer owns every report: it
 * dedupes on about plus what, keeps the failing check's output as evidence, and tracks it to closure. loop.audit's
 * `reports` step takes reports back (`clossys request --kind report --recheck`): after a reinstall it re-runs each
 * open report's recorded check and closes the passing ones fixed. Writes go through the request store's writers
 * (records/request.ts createRequest, writeRequest) under its lock. Nothing here reaches the network.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { SLOT_REF } from "../loop/names.js";
import { PRODUCER_ROOT } from "./ledger.js";
import { createRequest, REQUEST_ID, REQUEST_SCHEMA, REQUEST_SEATS, RequestError, requestsDir, withRequestLock, writeRequest } from "./request.js";
import {
  FOUNDRY_RESULT, QUEUE_RESULT, REPORT_ABOUT, REPORT_CLOSERS, REPORT_KIND, REPORT_OUTCOMES, REPORT_QUEUE, REPORT_TARGET, REPORT_WHAT, reportIssues, reportRoute,
  type ReportEntry, type ReportEvidence, type ReportOutcome, type ReportWhat,
} from "./report-shape.js";
import type { Actor, Ref, RequestEvent } from "./types.js";

export { REPORT_QUEUE, REPORT_TARGET, type ReportEntry } from "./report-shape.js";

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
 * Files a report, or returns the open one with the same about and what (Producer dedupes; nothing is written then).
 * Both the CLI and a loop run's failed step file through here.
 */
export function fileReport(consumer: string, input: FileReportInput, options: { readonly dry?: boolean } = {}): { report: ReportEntry; created: boolean } {
  if (!REPORT_ABOUT.test(input.about)) throw new RequestError(`--about must be verb/<name>, skill/<name> or agent/<name>, got ${input.about}`);
  if (!(REPORT_WHAT as readonly string[]).includes(input.what)) throw new RequestError(`--what must be ${REPORT_WHAT.join(", ")}, got ${input.what}`);
  if (input.from !== "owner" && !SLOT_REF.test(input.from)) throw new RequestError(`--from must be owner or <agent>/<slot id>, got ${input.from}`);
  if (!(REQUEST_SEATS as readonly string[]).includes(input.by)) throw new RequestError(`--by must be one of ${REQUEST_SEATS.join(", ")}, got ${input.by}`);
  if (!input.why.trim()) throw new RequestError("--why says what went wrong");
  return withRequestLock(consumer, `report-${input.about.replace(/\//g, "-")}-${input.what}`, () => {
    const existing = listReports(consumer).map(read => read.report).find(report => report?.status === "open" && report.about === input.about && report.what === input.what);
    if (existing) return { report: existing, created: false };
    const id = `${stampOf(input.at)}-report-${input.about.replace(/\//g, "-")}-${input.what}`.slice(0, 80).replace(/-+$/, "");
    const route = reportRoute();
    const draft: ReportEntry = {
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
    if (options.dry) return { report: draft, created: true };
    return { report: createRequest(consumer, draft), created: true };
  });
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
    return { check: value, exitCode: ran.exitCode, output: ran.message.slice(0, OUTPUT_MAX) };
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

export interface CloseReportInput { readonly outcome: string; readonly result: string; readonly by: string; readonly at: string }
/**
 * Closes a report fixed or declined. A fixed close of a report that records a check re-runs it first: a pass writes
 * Producer's verified event and the close; a fail writes a rejected event and refuses, so the report stays open. A
 * declined duplicate names the report it merges into (`queue.report#<id>`).
 */
export async function closeReport(consumer: string, id: string, input: CloseReportInput, runCheck: CheckRunner): Promise<ReportEntry> {
  if (!(REPORT_CLOSERS as readonly string[]).includes(input.by)) throw new RequestError(`a report closes with --by ${REPORT_CLOSERS.join(" or ")}, got ${input.by}`);
  if (!(REPORT_OUTCOMES as readonly string[]).includes(input.outcome)) throw new RequestError(`a report closes with --outcome ${REPORT_OUTCOMES.join(" or ")}, got ${input.outcome}`);
  if (input.outcome === "fixed" && !FOUNDRY_RESULT.test(input.result)) throw new RequestError(`a fixed report closes with --result foundry@<version or sha>, got ${input.result}`);
  if (input.outcome === "declined" && !FOUNDRY_RESULT.test(input.result) && !QUEUE_RESULT.test(input.result)) throw new RequestError(`a declined report closes with --result foundry@<version or sha> or the report it merges into (queue.report#<id>), got ${input.result}`);
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
    const closing = withEvent({ ...next, status: "closed", outcome: input.outcome as ReportOutcome, result: input.result, notified: { to: report.from, at: input.at }, closedAt: input.at },
      "closed", input.at, input.by, `${input.outcome}: ${input.result}; notified ${report.from}`);
    const closed: ReportEntry = { ...closing, closed: closing.events.at(-1)!.id };
    writeRequest(consumer, closed);
    return closed;
  });
}

/**
 * loop.audit's `reports` step: re-runs each open report's recorded check and closes the passing ones fixed by
 * Producer with `foundry@<installed version>`. A failing check, or a report with no check, stays open untouched.
 */
export async function recheckReports(consumer: string, at: string, runCheck: CheckRunner): Promise<{ closed: string[]; open: string[]; unchecked: string[]; invalid: string[] }> {
  const out = { closed: [] as string[], open: [] as string[], unchecked: [] as string[], invalid: [] as string[] };
  const result = `foundry@${producerVersion()}`;
  for (const read of listReports(consumer)) {
    if (!read.report) { out.invalid.push(`${read.file}: ${read.issues.slice(0, 3).join("; ")}`); continue; }
    const report = read.report;
    if (report.status !== "open") continue;
    if (report.evidence?.check === undefined) { out.unchecked.push(report.id); continue; }
    const ran = await runCheck(checkArgv(report.evidence.check), resolve(consumer, ".."));
    if (ran.exitCode !== 0) { out.open.push(report.id); continue; }
    await closeReport(consumer, report.id, { outcome: "fixed", result, by: "producer", at }, () => Promise.resolve(ran));
    out.closed.push(report.id);
  }
  return out;
}

/**
 * A loop run's step that could not run, or failed with no route on, files a report (about the step's verb, else
 * verb/run): the same fileReport the CLI files through, from `producer/<loop>`, by Producer. Returns the entry name.
 */
export function fileStepReport(root: string, input: { readonly loop: string; readonly runId: string; readonly step: string; readonly cli: string; readonly why: string; readonly at: string }): string {
  const about = `verb/${/^clossys ([a-z][a-z0-9-]*)/.exec(input.cli)?.[1] ?? "run"}`;
  const filed = fileReport(join(root, "clossys"), {
    about, what: "bug", why: `${input.loop} run ${input.runId}: ${input.why}`, from: `producer/${input.loop}`, by: "producer", at: input.at, source: "check",
  });
  return `${REPORT_QUEUE}#${filed.report.id}`;
}
