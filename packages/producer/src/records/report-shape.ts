/**
 * CP1-REPORT: the shape of a `clossys.queue-entry/2` kind report, read by the request store's writers
 * (records/request.ts writeRequest, createRequest) and by records/report.ts. A report says the tool itself is wrong or
 * missing a step: a bug, a gap or an ask about a clossys verb, an installed skill or an agent. Producer owns every report:
 * it is routed by one fixed upstream rule (REPORT_RULE, never a routing.json row) to assignee producer, about loop.audit,
 * the loop that takes reports back (its `reports` step re-runs each recorded check after a reinstall and closes the
 * passing ones). Store: `clossys/agents/producer/queue.report/entries/<id>.json`.
 */
import { createHash } from "node:crypto";
import { recordSchema } from "./slot.js";
import { validateAgainst } from "./schema.js";
import type { Actor, EntryRoute, Ref, RequestEvent } from "./types.js";

export const REPORT_KIND = "report";
export const REPORT_QUEUE = "queue.report";
/** The loop that takes a report back: loop.audit's `reports` step. A report's target names it. */
export const REPORT_TARGET = "producer/loop.audit";
export const REPORT_ABOUT = /^(verb|skill|agent)\/[a-z][a-z0-9-]*$/;
export const REPORT_WHAT = ["bug", "gap", "ask"] as const;
export type ReportWhat = (typeof REPORT_WHAT)[number];
export const REPORT_OUTCOMES = ["fixed", "declined"] as const;
export type ReportOutcome = (typeof REPORT_OUTCOMES)[number];
/** Who closes a report: Producer (a recheck, a merged duplicate) or the owner. */
export const REPORT_CLOSERS = ["owner", "producer"] as const;

/** The one routing rule of a report: whatever it is about, Producer owns it and the result goes upstream. */
export const REPORT_RULE = "clossys.queue-entry/2 kind report: any about -> upstream, assignee producer";
/** The route every report carries: row upstream, the sha256 of REPORT_RULE, assignee producer. */
export const reportRoute = (): EntryRoute => ({ row: "upstream", table: createHash("sha256").update(REPORT_RULE).digest("hex"), assignee: "producer" });

export interface ReportEvidence {
  readonly path?: string;
  readonly sha256?: string;
  /** A `clossys check ...` command; a fixed close (and the recheck) re-runs it. */
  readonly check?: string;
  readonly exitCode?: number;
  readonly output?: string;
  /**
   * CP1-LOOP-LEARN: the failure text normalized (reportSignature): what stays the same when the same cause fails again.
   * Producer dedupes a signed report on about, what and signature, and a signed report matching a fixed-closed one is a
   * repeat. A report without one keeps the about-and-what key and is never a repeat.
   */
  readonly signature?: string;
}
export interface ReportEntry {
  readonly schema: "clossys.queue-entry/2";
  readonly id: string;
  readonly kind: typeof REPORT_KIND;
  readonly from: string;
  readonly assignee: "producer";
  readonly target: typeof REPORT_TARGET;
  readonly status: "open" | "closed";
  readonly opened: string;
  readonly closed?: string;
  readonly why: string;
  readonly source: "cli" | "check";
  readonly route: EntryRoute;
  readonly about: string;
  readonly what: ReportWhat;
  readonly evidence?: ReportEvidence;
  readonly outcome?: ReportOutcome;
  readonly result?: string;
  /** CP1-LOOP-LEARN: a fixed close's guard, the scripts/rules/registry.json rule (with a fixture run) that keeps it fixed. */
  readonly guard?: string;
  /** CP1-LOOP-LEARN: the fixed-closed report this one repeats (same about, what and signature) and that close's guard. */
  readonly repeatOf?: { readonly report: string; readonly guard?: string };
  readonly notified?: { readonly to: string; readonly at: string };
  readonly closedAt?: string;
  readonly createdBy: Actor;
  readonly createdAt: string;
  readonly refs: readonly Ref[];
  readonly events: readonly RequestEvent[];
}

/** `foundry@<version or sha>`: the Foundry release or commit a fix landed in. */
export const FOUNDRY_RESULT = /^foundry@[0-9A-Za-z][0-9A-Za-z.+-]*$/;
/** `queue.report#<id>`: the report a declined duplicate merges into. */
export const QUEUE_RESULT = /^queue\.report#[0-9]{8}T[0-9]{4}Z-[a-z0-9][a-z0-9-]*$/;
/** `R-<NAME>`: a rule id of scripts/rules/registry.json, a fixed close's `--guard`. */
export const REPORT_GUARD = /^R-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
/** The longest signature kept: enough to tell two causes apart, short enough to read in a list. */
const SIGNATURE_MAX = 400;

/**
 * CP1-LOOP-LEARN: a failure text with what changes between runs of the same cause removed: times and dates, paths,
 * shas and numbers become `<time>`, `<path>`, `<sha>` and `<n>`; whitespace collapses and case folds. Two failures of one
 * cause share a signature; undefined when nothing is left to sign.
 */
export function reportSignature(text: string): string | undefined {
  const signed = text
    .replace(/\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/g, "<time>")
    .replace(/\b\d{8}T\d{4,6}Z?/g, "<time>")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?\b/g, "<time>")
    .replace(/(?:[A-Za-z]:)?(?:[\w.@~+-]*[\\/])+[\w.@~+-]*/g, "<path>")
    .replace(/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,64}\b/gi, "<sha>")
    .replace(/\d+(?:\.\d+)*/g, "<n>")
    .replace(/\s+/g, " ").trim().toLowerCase().slice(0, SIGNATURE_MAX).trim();
  return signed && /[a-z]/.test(signed.replace(/<(?:time|path|sha|n)>/g, "")) ? signed : undefined;
}

const FOREIGN = ["rel", "link", "options", "want", "check", "findings", "cause", "overlaps", "overlapReason", "decision", "reuse", "proposal"] as const;

/** Every issue of a report entry: the schema, then the report rules the validator cannot state. */
export function reportIssues(doc: unknown): string[] {
  const issues = validateAgainst(recordSchema("queue-entry-2.json"), doc).map(issue => `${issue.path} ${issue.message}`);
  if (issues.length || typeof doc !== "object" || doc === null) return issues;
  const entry = doc as ReportEntry & Record<string, unknown>;
  const out: string[] = [];
  if (entry.kind !== REPORT_KIND) out.push(`$.kind: a report store holds kind report, got ${String(entry.kind)}`);
  if (entry.about === undefined || entry.what === undefined) out.push("$.about, $.what: a report says what it is about (<verb|skill|agent>/<name>) and what it is (bug, gap or ask)");
  if (entry.target !== REPORT_TARGET) out.push(`$.target: a report is taken back by ${REPORT_TARGET}, got ${entry.target}`);
  if (entry.assignee !== "producer") out.push(`$.assignee: Producer owns every report, got ${entry.assignee}`);
  const route = reportRoute();
  if (entry.route?.row !== route.row || entry.route.table !== route.table || entry.route.assignee !== route.assignee || Object.keys(entry.route).length !== 3) out.push(`$.route: a report is routed by Producer's upstream rule (row upstream, table ${route.table.slice(0, 12)}, assignee producer)`);
  for (const field of FOREIGN) if (entry[field] !== undefined) out.push(`$.${field}: a report has no ${field} (that is a slot, change or fix entry's)`);
  if (entry.source !== "cli" && entry.source !== "check") out.push(`$.source: a report is filed by clossys request (cli) or by a loop run (check), got ${entry.source}`);
  const ids = entry.events.map(event => event.id);
  if (ids.some(id => !id.startsWith(`${entry.id}#`))) out.push("every event id is <entry id>#<n>");
  if (entry.events[0]?.id !== entry.opened || entry.events[0]?.op !== "raised") out.push(`opened ${entry.opened} is not the first, raised event`);
  const closes = entry.events.filter(event => event.op === "closed");
  if (entry.status === "closed") {
    for (const field of ["outcome", "result", "notified", "closed", "closedAt"] as const) if (entry[field] === undefined) out.push(`a closed report needs ${field}`);
    if (closes.length !== 1 || entry.closed !== closes[0]?.id || entry.events.at(-1)?.op !== "closed") out.push("a closed report has one closed event, its last, and `closed` names it");
    if (entry.outcome !== undefined && !(REPORT_OUTCOMES as readonly string[]).includes(entry.outcome)) out.push(`$.outcome: a report closes fixed or declined, got ${entry.outcome}`);
    if (entry.outcome === "fixed" && !FOUNDRY_RESULT.test(entry.result ?? "")) out.push(`$.result: a fixed report names foundry@<version or sha>, got ${String(entry.result)}`);
    if (entry.outcome === "declined" && !FOUNDRY_RESULT.test(entry.result ?? "") && !QUEUE_RESULT.test(entry.result ?? "")) out.push(`$.result: a declined report names foundry@<version or sha> or the report it merges into (queue.report#<id>), got ${String(entry.result)}`);
    if (entry.guard !== undefined && entry.outcome !== "fixed") out.push(`$.guard: only a fixed close names a guard rule, got outcome ${String(entry.outcome)}`);
    if (entry.notified !== undefined && entry.notified.to !== entry.from) out.push(`a closed report notifies its filer ${entry.from}, not ${entry.notified.to}`);
    // A fixed close with a recorded check re-ran it and it passed: Producer's verified event right before the close.
    const before = entry.events.at(-2);
    if (entry.outcome === "fixed" && entry.evidence?.check !== undefined && (before?.op !== "verified" || before.by !== "producer" || before.at !== entry.closedAt)) out.push(`a fixed report with a recorded check closes right after Producer's verified event (the check ${entry.evidence.check} passing)`);
  } else if (closes.length || entry.closed !== undefined || entry.closedAt !== undefined || entry.notified !== undefined || entry.outcome !== undefined || entry.result !== undefined || entry.guard !== undefined) {
    out.push(`the event log or the closing fields close the report, but its status is ${entry.status}`);
  }
  // CP1-LOOP-LEARN: a repeat report carries one repeat event, and repeatOf names the fixed report it repeats.
  const repeats = entry.events.filter(event => event.op === "repeat").length;
  if ((entry.repeatOf === undefined) !== (repeats === 0) || repeats > 1) out.push("a repeat report has one repeat event, and repeatOf names the fixed report it repeats");
  if (entry.repeatOf !== undefined && entry.evidence?.signature === undefined) out.push("$.repeatOf: only a report with a signature repeats a fixed one");
  return out;
}
