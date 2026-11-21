/**
 * The engine model (packages/producer/docs/engine.md, generated from this module and its siblings): Run, Step,
 * Event, Attestation and Gate, each a plain JSON record with a runtime validator that returns its issues (empty when
 * valid). Every record write in a consumer workspace is one Event in `clossys/.state/events.jsonl` (engine/log.ts); Run,
 * Step, Attestation and Gate are the shapes the loop runner, the checks and the gates report through the same log.
 *
 * Node runs this file with type stripping in child writers (engine/*.test.ts), so it holds no enum, namespace or
 * parameter property.
 */

/** A lowercase sha256 hex digest. */
export type Sha256 = string;
/** An ISO-8601 UTC timestamp. */
export type Iso = string;

export const EVENT_SCHEMA = "clossys.event/1" as const;
export const RUN_SCHEMA = "clossys.run/1" as const;
export const ATTESTATION_SCHEMA = "clossys.attestation/1" as const;
export const GATE_SCHEMA = "clossys.gate/1" as const;
/** The `prev` of the first line: no line before it. */
export const GENESIS = "0".repeat(64);

/** A file an event read or left: its workspace-relative POSIX path and the sha256 of its bytes (null when absent). */
export interface EventInput {
  readonly path: string;
  readonly sha256: Sha256 | null;
}

/**
 * One line of `clossys/.state/events.jsonl`. `prev` is the sha256 of the previous line's bytes (GENESIS for the first),
 * `seq` counts lines from 0, and `id` is the sha256 of the line's canonical JSON without `id`, so an edit to any line,
 * the last one included, no longer hashes to its own id.
 */
export interface EngineEvent {
  readonly schema: typeof EVENT_SCHEMA;
  readonly seq: number;
  readonly prev: Sha256;
  readonly actor: string;
  readonly kind: string;
  readonly subject: string;
  readonly at: Iso;
  readonly inputs: readonly EventInput[];
  readonly id: Sha256;
}

/** The fields an event's writer supplies; the log fills schema, seq, prev and id. */
export interface EventDraft {
  readonly actor: string;
  readonly kind: string;
  readonly subject: string;
  readonly at?: Iso;
  readonly inputs: readonly EventInput[];
}

export type StepStatus = "pending" | "running" | "passed" | "failed" | "skipped";
/** One step of a run: a plumb step runs code, a decide step waits for an actor's decision. */
export interface Step {
  readonly id: string;
  readonly mode: "plumb" | "decide";
  readonly status: StepStatus;
  readonly startedAt?: Iso;
  readonly endedAt?: Iso;
  readonly inputs: readonly EventInput[];
  readonly outputs: readonly EventInput[];
}

export type RunStatus = "running" | "passed" | "failed" | "stopped";
/** One run of a loop or the chain: the steps it walked, in order, and how it ended. */
export interface Run {
  readonly schema: typeof RUN_SCHEMA;
  readonly id: string;
  readonly loop: string;
  readonly actor: string;
  readonly status: RunStatus;
  readonly startedAt: Iso;
  readonly endedAt?: Iso;
  readonly steps: readonly Step[];
}

/** A gate's verdict on a subject, by an actor, over the exact inputs it read. */
export interface Attestation {
  readonly schema: typeof ATTESTATION_SCHEMA;
  readonly gate: string;
  readonly subject: string;
  readonly verdict: "pass" | "fail";
  readonly by: string;
  readonly at: Iso;
  readonly inputs: readonly EventInput[];
}

/** A gate: what must attest a subject before the next step runs, and who may. */
export interface Gate {
  readonly schema: typeof GATE_SCHEMA;
  readonly id: string;
  readonly attestedBy: "code" | "agent" | "owner";
  readonly required: boolean;
  readonly description: string;
}

/** The engine's record shapes and their fields, in order, as engine.md lists them. */
export const ENGINE_TYPES: readonly { readonly name: string; readonly fields: readonly (readonly [field: string, rule: string])[] }[] = [
  { name: "EngineEvent", fields: [
    ["schema", `"${EVENT_SCHEMA}"`], ["seq", "integer from 0, one more than the previous line"], ["prev", "sha256 of the previous line's bytes; GENESIS (64 zeros) on line 0"],
    ["actor", "who wrote: owner[:ref], planner[:ref], agent:<id>, code:<cli> (non-empty, one line)"], ["kind", "<family>.<op>, lowercase (see Event kinds)"],
    ["subject", "the record the event is about (non-empty, one line)"], ["at", "ISO-8601 UTC timestamp"],
    ["inputs", "[{ path, sha256 }]: workspace-relative POSIX paths, sorted and unique; sha256 null when the file is absent"],
    ["id", "sha256 of the line's canonical JSON without id"],
  ] },
  { name: "Step", fields: [["id", "non-empty"], ["mode", "plumb | decide"], ["status", "pending | running | passed | failed | skipped"], ["startedAt", "optional ISO"], ["endedAt", "optional ISO, not before startedAt"], ["inputs", "EventInput[]"], ["outputs", "EventInput[]"]] },
  { name: "Run", fields: [["schema", `"${RUN_SCHEMA}"`], ["id", "non-empty"], ["loop", "non-empty"], ["actor", "non-empty"], ["status", "running | passed | failed | stopped"], ["startedAt", "ISO"], ["endedAt", "optional ISO; required unless running"], ["steps", "Step[], ids unique"]] },
  { name: "Attestation", fields: [["schema", `"${ATTESTATION_SCHEMA}"`], ["gate", "non-empty"], ["subject", "non-empty"], ["verdict", "pass | fail"], ["by", "non-empty"], ["at", "ISO"], ["inputs", "EventInput[]"]] },
  { name: "Gate", fields: [["schema", `"${GATE_SCHEMA}"`], ["id", "non-empty"], ["attestedBy", "code | agent | owner"], ["required", "boolean"], ["description", "non-empty"]] },
];

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const SHA = /^[0-9a-f]{64}$/;
const KIND = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const line = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\r\n]/.test(value);
const iso = (value: unknown): value is string => typeof value === "string" && ISO.test(value) && !Number.isNaN(Date.parse(value));
const extra = (doc: Record<string, unknown>, keys: readonly string[], where: string) =>
  Object.keys(doc).filter(key => !keys.includes(key)).map(key => `${where}: unknown field ${key}`);

/** Issues of an EventInput list: each a relative POSIX path with a sha256 or null, sorted by path, unique. */
export function inputIssues(value: unknown, where: string): string[] {
  if (!Array.isArray(value)) return [`${where}: must be an array`];
  const issues: string[] = [];
  let last: string | undefined;
  value.forEach((input, index) => {
    const at = `${where}[${index}]`;
    if (!isObject(input)) { issues.push(`${at}: must be an object`); return; }
    issues.push(...extra(input, ["path", "sha256"], at));
    const path = input.path;
    if (!line(path) || path.startsWith("/") || path.includes("\\") || path.split("/").some(part => part === "" || part === "." || part === "..")) issues.push(`${at}.path: must be a workspace-relative POSIX path`);
    else {
      if (last !== undefined && path <= last) issues.push(`${at}.path: inputs must be sorted by path and unique (${path} after ${last})`);
      last = path;
    }
    if (!(input.sha256 === null || (typeof input.sha256 === "string" && SHA.test(input.sha256)))) issues.push(`${at}.sha256: must be a sha256 hex digest or null`);
  });
  return issues;
}

const EVENT_KEYS = ["schema", "seq", "prev", "actor", "kind", "subject", "at", "inputs", "id"] as const;
/** Issues of an EventDraft: what a writer may hand appendEvent. */
export function draftIssues(value: unknown): string[] {
  if (!isObject(value)) return ["event: must be an object"];
  const issues = extra(value, ["actor", "kind", "subject", "at", "inputs"], "event");
  if (!line(value.actor)) issues.push("event.actor: must be a non-empty single line");
  if (typeof value.kind !== "string" || !KIND.test(value.kind)) issues.push("event.kind: must be <family>.<op>, lowercase");
  if (!line(value.subject)) issues.push("event.subject: must be a non-empty single line");
  if (value.at !== undefined && !iso(value.at)) issues.push("event.at: must be an ISO-8601 UTC timestamp");
  issues.push(...inputIssues(value.inputs, "event.inputs"));
  return issues;
}
/** Issues of a full event line's shape (the chain checks seq, prev and id against the log). */
export function eventIssues(value: unknown): string[] {
  if (!isObject(value)) return ["event: must be an object"];
  const issues = extra(value, EVENT_KEYS, "event");
  if (value.schema !== EVENT_SCHEMA) issues.push(`event.schema: must be ${EVENT_SCHEMA}`);
  if (!Number.isInteger(value.seq) || (value.seq as number) < 0) issues.push("event.seq: must be a non-negative integer");
  if (typeof value.prev !== "string" || !SHA.test(value.prev)) issues.push("event.prev: must be a sha256 hex digest");
  if (typeof value.id !== "string" || !SHA.test(value.id)) issues.push("event.id: must be a sha256 hex digest");
  if (!iso(value.at)) issues.push("event.at: must be an ISO-8601 UTC timestamp");
  const { schema: _schema, seq: _seq, prev: _prev, id: _id, ...draft } = value;
  return [...issues, ...draftIssues(draft).filter(issue => !issue.startsWith("event.at"))];
}

const STEP_STATUS: readonly StepStatus[] = ["pending", "running", "passed", "failed", "skipped"];
export function stepIssues(value: unknown, where = "step"): string[] {
  if (!isObject(value)) return [`${where}: must be an object`];
  const issues = extra(value, ["id", "mode", "status", "startedAt", "endedAt", "inputs", "outputs"], where);
  if (!line(value.id)) issues.push(`${where}.id: must be non-empty`);
  if (value.mode !== "plumb" && value.mode !== "decide") issues.push(`${where}.mode: must be plumb or decide`);
  if (!STEP_STATUS.includes(value.status as StepStatus)) issues.push(`${where}.status: must be one of ${STEP_STATUS.join(", ")}`);
  for (const key of ["startedAt", "endedAt"] as const) if (value[key] !== undefined && !iso(value[key])) issues.push(`${where}.${key}: must be an ISO-8601 UTC timestamp`);
  if (iso(value.startedAt) && iso(value.endedAt) && Date.parse(value.endedAt) < Date.parse(value.startedAt)) issues.push(`${where}.endedAt: is before startedAt`);
  issues.push(...inputIssues(value.inputs, `${where}.inputs`), ...inputIssues(value.outputs, `${where}.outputs`));
  return issues;
}

const RUN_STATUS: readonly RunStatus[] = ["running", "passed", "failed", "stopped"];
export function runIssues(value: unknown): string[] {
  if (!isObject(value)) return ["run: must be an object"];
  const issues = extra(value, ["schema", "id", "loop", "actor", "status", "startedAt", "endedAt", "steps"], "run");
  if (value.schema !== RUN_SCHEMA) issues.push(`run.schema: must be ${RUN_SCHEMA}`);
  for (const key of ["id", "loop", "actor"] as const) if (!line(value[key])) issues.push(`run.${key}: must be non-empty`);
  if (!RUN_STATUS.includes(value.status as RunStatus)) issues.push(`run.status: must be one of ${RUN_STATUS.join(", ")}`);
  if (!iso(value.startedAt)) issues.push("run.startedAt: must be an ISO-8601 UTC timestamp");
  if (value.endedAt !== undefined && !iso(value.endedAt)) issues.push("run.endedAt: must be an ISO-8601 UTC timestamp");
  if (value.status !== "running" && value.endedAt === undefined) issues.push("run.endedAt: a finished run needs endedAt");
  if (!Array.isArray(value.steps)) issues.push("run.steps: must be an array");
  else {
    const seen = new Set<unknown>();
    value.steps.forEach((step, index) => {
      issues.push(...stepIssues(step, `run.steps[${index}]`));
      const id = isObject(step) ? step.id : undefined;
      if (seen.has(id)) issues.push(`run.steps[${index}].id: duplicate ${String(id)}`);
      seen.add(id);
    });
  }
  return issues;
}

export function attestationIssues(value: unknown): string[] {
  if (!isObject(value)) return ["attestation: must be an object"];
  const issues = extra(value, ["schema", "gate", "subject", "verdict", "by", "at", "inputs"], "attestation");
  if (value.schema !== ATTESTATION_SCHEMA) issues.push(`attestation.schema: must be ${ATTESTATION_SCHEMA}`);
  for (const key of ["gate", "subject", "by"] as const) if (!line(value[key])) issues.push(`attestation.${key}: must be non-empty`);
  if (value.verdict !== "pass" && value.verdict !== "fail") issues.push("attestation.verdict: must be pass or fail");
  if (!iso(value.at)) issues.push("attestation.at: must be an ISO-8601 UTC timestamp");
  issues.push(...inputIssues(value.inputs, "attestation.inputs"));
  return issues;
}

export function gateIssues(value: unknown): string[] {
  if (!isObject(value)) return ["gate: must be an object"];
  const issues = extra(value, ["schema", "id", "attestedBy", "required", "description"], "gate");
  if (value.schema !== GATE_SCHEMA) issues.push(`gate.schema: must be ${GATE_SCHEMA}`);
  if (!line(value.id)) issues.push("gate.id: must be non-empty");
  if (!["code", "agent", "owner"].includes(value.attestedBy as string)) issues.push("gate.attestedBy: must be code, agent or owner");
  if (typeof value.required !== "boolean") issues.push("gate.required: must be a boolean");
  if (!line(value.description)) issues.push("gate.description: must be non-empty");
  return issues;
}
