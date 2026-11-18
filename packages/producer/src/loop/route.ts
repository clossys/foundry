/**
 * Queue entries a loop run raises (flows.md N16 and F6): a finding about a slot is breakage, so it goes to that slot's
 * agent as a clossys.queue-entry/2 kind fix (records/request.ts raiseWork, routed by the table) with its check, its
 * findings and its cause (foundry-build-0048 Q10); a finding with no slot to own it (a missing fact, a tree-wide
 * finding) goes to the owner as a `queue.clarify`. One open entry per subject: a finding whose subject already has an
 * open entry raises nothing.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { danglingReason } from "../check/refs-dangling.js";
import { createQueueEntry, entryStamp, listQueueEntryFiles, readQueueEntry, slugOf } from "../queue/entry.js";
import { ANSWER_RULES, entrySchemaIssues } from "../queue/rules.js";
import { consumerFacts, routeEntry, type RoutingFacts } from "../queue/routing.js";
import { raiseWork, RequestError, workQueue, type SlotRequest } from "../records/request.js";
import { parseRefString } from "../records/resolve.js";
import { PRODUCER_ROOT } from "../package-path.js";
import type { Iso, QueueEntry, QueueName, Ref } from "../records/types.js";

export const RUN_CLI = "clossys run";
export const RUN_BY = `code:${RUN_CLI}`;

/** This Producer package's version, for `createdBy` of what `clossys run` writes. */
export function producerVersion(): string {
  try { return (JSON.parse(readFileSync(join(PRODUCER_ROOT, "package.json"), "utf8")) as { version?: string }).version ?? "0.0.0"; } catch { return "0.0.0"; }
}

export interface Finding { readonly check?: string; readonly subject: string; readonly detail: string }

export interface Raise {
  readonly queue: QueueName;
  readonly subject: Ref;
  readonly decider: QueueEntry["decider"];
  readonly ask: string;
  readonly slug: string;
  readonly default?: string | null;
  readonly options?: QueueEntry["options"];
  /** Refs beyond the subject, such as the candidate a sign-off names with its sha256. */
  readonly refs?: readonly Ref[];
}

/** `queue.fix#<id>` */
export const entryName = (entry: Pick<QueueEntry, "queue" | "id">): string => `${entry.queue}#${entry.id}`;

/** An entry a run raised, either schema: its queue folder and id (`entryName` names it). */
export type Raised = Pick<QueueEntry, "queue" | "id">;
/** A clossys.queue-entry/2 change or fix as a raised entry: its kind's queue folder and its id. */
export const raisedOf = (request: Pick<SlotRequest, "kind" | "id">): Raised => ({ queue: workQueue(request.kind as "fix") as QueueName, id: request.id });

/**
 * Breakage a run raises on a placed slot (foundry-build-0048 Q10): a kind fix, from the broken slot itself (so its
 * closure notifies that slot), with the check that failed, its findings verbatim and what broke it. The router assigns
 * it; an open fix on the same slot from the same requester is returned instead (`raised: false`).
 */
export interface FixRaise {
  readonly target: string;
  readonly check: string;
  readonly findings: readonly string[];
  readonly cause: string;
  readonly why: string;
}
export function raiseFix(root: string, fix: FixRaise, at: Iso): { request: SlotRequest; raised: boolean } {
  const { request, created } = raiseWork(join(root, "clossys"), {
    kind: "fix", target: fix.target, from: fix.target, why: fix.why, source: "check", by: "producer", at,
    check: fix.check, findings: fix.findings, cause: fix.cause, createdBy: { actor: "code", cli: RUN_CLI, version: producerVersion() },
  });
  return { request, raised: created };
}

const sameSubject = (a: Ref, b: Ref): boolean => a.to === b.to && (a.record ?? "") === (b.record ?? "");

/** The open entry of `queue` about `subject`, if any. */
export function openEntryFor(root: string, queue: QueueName, subject: Ref): QueueEntry | undefined {
  for (const at of listQueueEntryFiles(root)) {
    if (at.queue !== queue) continue;
    const read = readQueueEntry(at);
    if (read.ok && read.entry.status === "open" && sameSubject(read.entry.subject, subject)) return read.entry;
  }
  return undefined;
}

/**
 * Writes one entry raised by `clossys run`, valid by the queue schema and every answer rule. With `dedupe`, an open
 * entry of the same queue and subject is returned instead (`raised: false`).
 */
export function raiseEntry(root: string, raise: Raise, at: Iso, dedupe = true): { entry: QueueEntry; raised: boolean } {
  if (dedupe) {
    const open = openEntryFor(root, raise.queue, raise.subject);
    if (open) return { entry: open, raised: false };
  }
  const entry: QueueEntry = {
    schema: "clossys.queue-entry/1",
    id: `${entryStamp(at)}-${slugOf(raise.slug)}`,
    agent: "producer",
    kind: "queue-entry",
    status: "open",
    createdBy: { actor: "code", cli: RUN_CLI, version: producerVersion() },
    createdAt: at,
    refs: [raise.subject, ...(raise.refs ?? [])],
    queue: raise.queue,
    ask: raise.ask,
    subject: raise.subject,
    decider: raise.decider,
    default: raise.default ?? null,
    ...(raise.options ? { options: raise.options } : {}),
    events: [{ at, op: "raised", by: RUN_BY }],
  };
  const issues = [...entrySchemaIssues(entry), ...ANSWER_RULES.flatMap(rule => rule.issues(entry, root))];
  if (issues.length) throw new Error(`clossys run: the ${raise.queue} entry would not be valid: ${issues.join("; ")}`);
  return { entry: createQueueEntry(root, entry), raised: true };
}

/** Where a finding goes: a kind fix on a placed slot its agent's handler answers, or an owner's queue.clarify. */
export type FindingRoute = { readonly fix: FixRaise; readonly slug: string } | { readonly entry: Raise };

/**
 * A finding's owner, as Producer's router (queue/routing.ts) sends a kind fix on its subject: a live slot to its
 * agent's declared fix handler as a kind fix (check, findings, cause), anything else (no slot, or an agent with no
 * declared handler) to the owner's queue.clarify.
 */
export function findingRaise(root: string, finding: Finding, loopLabel: string, cause: string, facts?: RoutingFacts): FindingRoute {
  const head = finding.subject.split(/[/#]/).slice(0, 2).join("/");
  const parsed = parseRefString(head);
  const slotRef: Ref | undefined = parsed && !(parsed.agent === "producer" && /^(queue|ledger)\./.test(parsed.slotId))
    ? { to: `${parsed.agent}/${parsed.slotId}` as Ref["to"], rel: "input" } : undefined;
  const what = `${finding.check ? `${finding.check}: ` : ""}${finding.detail}`;
  const route = slotRef && danglingReason(root, slotRef) === undefined
    ? routeEntry(facts ?? consumerFacts(join(root, "clossys")), { kind: "fix", target: slotRef.to, assignee: parsed!.agent as never }) : undefined;
  if (slotRef && route && route.assignee !== "owner") {
    return { slug: parsed!.slotId, fix: { target: slotRef.to, check: finding.check ?? loopLabel.replace(/ /g, "."), findings: [`${finding.subject}: ${finding.detail}`], cause, why: `${loopLabel} found on ${head}: ${what}` } };
  }
  return { entry: clarifyRaise(root, finding, loopLabel, what) };
}

function clarifyRaise(root: string, finding: Finding, loopLabel: string, what: string): Raise {
  const factsRef: Ref = existsSync(join(root, "clossys", "facts.json")) ? { to: "facts", rel: "input" } : { to: "producer/queue.clarify", rel: "input" };
  return { queue: "queue.clarify", subject: factsRef, decider: "owner", ask: `${loopLabel} found a finding no slot owns (${finding.subject}): ${what}`, slug: `${slugOf(finding.subject)}` };
}

const findingText = (finding: Finding) => `${finding.check ? `${finding.check}: ` : ""}${finding.detail}`;

/**
 * Routes findings, one entry per subject (deduped against open entries): a kind fix per broken slot (its findings
 * together, `cause` what broke it), a queue.clarify per finding no slot owns. A slot the store refuses a fix on (no
 * placed slot after all) goes to the owner's clarify. Returns the entries newly raised.
 */
export function routeFindings(root: string, findings: readonly Finding[], at: Iso, loopLabel: string, cause: string): Raised[] {
  const raised: Raised[] = [];
  const grouped = new Map<string, { route: FindingRoute; findings: Finding[] }>();
  const facts = consumerFacts(join(root, "clossys"));
  for (const finding of findings) {
    const route = findingRaise(root, finding, loopLabel, cause, facts);
    const key = "fix" in route ? `fix ${route.fix.target}` : `${route.entry.queue} ${route.entry.subject.to}`;
    const group = grouped.get(key);
    if (group) group.findings.push(finding);
    else grouped.set(key, { route, findings: [finding] });
  }
  for (const { route, findings: group } of grouped.values()) {
    const more = group.length === 1 ? "" : ` (+${group.length - 1} more: ${group.slice(1).map(findingText).join("; ")})`;
    if ("fix" in route) {
      try {
        const result = raiseFix(root, { ...route.fix, findings: group.map(finding => `${finding.subject}: ${finding.detail}`), why: `${route.fix.why}${more}` }, at);
        if (result.raised) raised.push(raisedOf(result.request));
        continue;
      } catch (error) {
        if (!(error instanceof RequestError)) throw error;
        const result = raiseEntry(root, { ...clarifyRaise(root, group[0]!, loopLabel, findingText(group[0]!)), ask: `${loopLabel} found on ${route.fix.target}, which takes no fix (${error.message}): ${findingText(group[0]!)}${more}` }, at);
        if (result.raised) raised.push(result.entry);
        continue;
      }
    }
    const result = raiseEntry(root, { ...route.entry, ask: `${route.entry.ask}${more}` }, at);
    if (result.raised) raised.push(result.entry);
  }
  return raised;
}
