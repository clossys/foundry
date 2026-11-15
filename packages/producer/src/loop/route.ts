/**
 * Queue entries a loop run raises (flows.md N16 and F6): a finding about a slot goes to that slot's agent as a
 * `queue.fix`; a finding with no slot to own it (a missing fact, a tree-wide finding) goes to the owner as a
 * `queue.clarify`. One open entry per subject and queue: a finding whose subject already has an open entry raises nothing.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { danglingReason } from "../check/refs-dangling.js";
import { createQueueEntry, entryStamp, listQueueEntryFiles, readQueueEntry, slugOf } from "../queue/entry.js";
import { ANSWER_RULES, entrySchemaIssues } from "../queue/rules.js";
import { parseRefString } from "../records/resolve.js";
import { PRODUCER_ROOT } from "../package-path.js";
import type { AgentId, Iso, QueueEntry, QueueName, Ref } from "../records/types.js";

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
}

/** `queue.fix#<id>` */
export const entryName = (entry: Pick<QueueEntry, "queue" | "id">): string => `${entry.queue}#${entry.id}`;

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
    refs: [raise.subject],
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

/** A finding's owner: the agent of an existing consumer slot it names, else the owner. */
export function findingRaise(root: string, finding: Finding, loopLabel: string): Raise {
  const head = finding.subject.split(/[/#]/).slice(0, 2).join("/");
  const parsed = parseRefString(head);
  const slotRef: Ref | undefined = parsed && !(parsed.agent === "producer" && /^(queue|ledger)\./.test(parsed.slotId))
    ? { to: `${parsed.agent}/${parsed.slotId}` as Ref["to"], rel: "input" } : undefined;
  const what = `${finding.check ? `${finding.check}: ` : ""}${finding.detail}`;
  if (slotRef && danglingReason(root, slotRef) === undefined) {
    return { queue: "queue.fix", subject: slotRef, decider: `agent:${parsed!.agent as AgentId}`, ask: `${loopLabel} found on ${head}: ${what}`, slug: parsed!.slotId };
  }
  const facts: Ref = existsSync(join(root, "clossys", "facts.json")) ? { to: "facts", rel: "input" } : { to: "producer/queue.clarify", rel: "input" };
  return { queue: "queue.clarify", subject: facts, decider: "owner", ask: `${loopLabel} found a finding no slot owns (${finding.subject}): ${what}`, slug: `${slugOf(finding.subject)}` };
}

/** Routes findings, one entry per subject (deduped against open entries). Returns the entries newly raised. */
export function routeFindings(root: string, findings: readonly Finding[], at: Iso, loopLabel: string): QueueEntry[] {
  const raised: QueueEntry[] = [];
  const grouped = new Map<string, Finding[]>();
  for (const finding of findings) {
    const raise = findingRaise(root, finding, loopLabel);
    const key = `${raise.queue} ${raise.subject.to}`;
    grouped.set(key, [...(grouped.get(key) ?? []), finding]);
  }
  for (const group of grouped.values()) {
    const first = findingRaise(root, group[0]!, loopLabel);
    const ask = group.length === 1 ? first.ask : `${first.ask} (+${group.length - 1} more: ${group.slice(1).map(f => `${f.check ? `${f.check}: ` : ""}${f.detail}`).join("; ")})`;
    const result = raiseEntry(root, { ...first, ask }, at);
    if (result.raised) raised.push(result.entry);
  }
  return raised;
}
