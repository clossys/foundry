/**
 * The next legal step of a unit (CP1-UNITNEXT): an adapter over this loop engine's plan binding
 * (`./plan-binding.js`), fingerprints (`./staleness.js`) and blocker owners (`./types.js`) that reads a
 * unit's step verdicts and the facts around it and names its state and the one step it may run next.
 *
 * Order (R-UNIT-STEP-ORDER): exec, rebase onto the integration tip, `check --fast`, mech, review, fold.
 * A step past exec runs only on an installed tree, with no carry pending, on a head rebased onto the
 * current tip, and only on the head the earlier verdicts were given at; a failed precondition is refused
 * and named. A verdict, or a queued or running check, given at another head is superseded: it is never
 * counted, live or passing.
 *
 * WIP (R-UNIT-WIP): at most `cap` units past exec and not folded; a new unit is pulled only after a fold.
 *
 * Verdict lines: every step's record ends with one fixed-form line (`STEP_VERDICT_FORMS`); a record with
 * none counts as a failed step. Pure: no filesystem, git or clock access here; a caller reads them and
 * hands this module the text and facts.
 */
import { bindPlan, decidePlanExecution } from "./plan-binding.js";
import { fingerprintInputs } from "./staleness.js";
import { BLOCKER_OWNERS, type BlockerKind, type Fingerprint } from "./types.js";

export const UNIT_STEPS = Object.freeze(["exec", "rebase", "fast", "mech", "review", "fold"] as const);
export type UnitStep = (typeof UNIT_STEPS)[number];

/** The steps whose verdict is read from a record; rebase and fold are read from git (the tip in the head, the head in the tip). */
export const RECORDED_STEPS = Object.freeze(["exec", "fast", "mech", "review"] as const);
export type RecordedStep = (typeof RECORDED_STEPS)[number];

/** How many units may be past exec and not folded at once, unless configured otherwise. */
export const UNIT_WIP_CAP_DEFAULT = 4;

/** The fixed-form verdict line each recorded step ends with, as each step's own tool prints it. */
export const STEP_VERDICT_FORMS: Readonly<Record<RecordedStep, string>> = Object.freeze({
  exec: "DONE: <sha> | BLOCKED: <reason> (the executor's receipt)",
  fast: "FAST PASS|FAIL|INCOMPLETE <sha> (clossys check --fast), or its clossys.fast-check/1 record",
  mech: "a clossys.review/1 record (clossys review --json): its verdict, head and base",
  review: "REVIEW: PASS|FAIL <sha> (the reviewer's verdict file)",
});

export interface StepVerdict {
  readonly step: RecordedStep;
  readonly pass: boolean;
  /** The commit the verdict was given at; null when the line names none (a BLOCKED receipt). */
  readonly head: string | null;
  /** The base the step ran against, when its record carries one. */
  readonly base: string | null;
  readonly line: string;
}

const SHA = "[0-9a-f]{7,40}";
const lastLine = (text: string, pattern: RegExp): RegExpMatchArray | null => {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index--) { const match = lines[index]!.match(pattern); if (match) return match; }
  return null;
};

/**
 * The step's verdict from its record's text, or null when the record holds no fixed-form verdict line
 * (which counts as a failed step). A JSON record is read by its schema; any other text by its last
 * matching line.
 */
export function parseStepVerdict(step: RecordedStep, text: string): StepVerdict | null {
  let doc: unknown;
  try { doc = JSON.parse(text); } catch { doc = undefined; }
  if (doc && typeof doc === "object" && !Array.isArray(doc)) {
    const record = doc as Record<string, unknown>;
    const str = (key: string) => (typeof record[key] === "string" && new RegExp(`^${SHA}$`).test(record[key] as string) ? (record[key] as string) : null);
    if (step === "fast" && record.schema === "clossys.fast-check/1" && typeof record.verdict === "string" && str("head")) {
      return { step, pass: record.verdict === "FAST PASS", head: str("head"), base: str("base"), line: `${record.verdict} ${str("head")}` };
    }
    if (step === "mech" && record.schema === "clossys.review/1" && (record.verdict === "PASS" || record.verdict === "FAIL") && str("head")) {
      return { step, pass: record.verdict === "PASS", head: str("head"), base: str("base"), line: `MECHANICAL: ${record.verdict} ${str("head")}` };
    }
    return null;
  }
  if (step === "exec") {
    const match = lastLine(text, new RegExp(`^(?:DONE: (${SHA})|BLOCKED:.*)$`));
    return match ? { step, pass: match[1] !== undefined, head: match[1] ?? null, base: null, line: match[0] } : null;
  }
  if (step === "fast") {
    const match = lastLine(text, new RegExp(`^FAST (PASS|FAIL|INCOMPLETE) (${SHA})$`));
    return match ? { step, pass: match[1] === "PASS", head: match[2]!, base: null, line: match[0] } : null;
  }
  if (step === "review") {
    const match = lastLine(text, new RegExp(`^REVIEW: (PASS|FAIL) (${SHA})$`));
    return match ? { step, pass: match[1] === "PASS", head: match[2]!, base: null, line: match[0] } : null;
  }
  // mech: only its JSON record names the base it ran against, and a mech verdict with no base cannot show it was not stale.
  return null;
}

/** One recorded step: present, with its verdict, or present with no verdict line (`verdict: null`, a failed step). */
export interface StepRecord {
  readonly verdict: StepVerdict | null;
}

/** What the caller read from git, the install and the planner's launch log. */
export interface UnitFacts {
  readonly unit: string;
  /** The unit branch's head; null before it has one. */
  readonly head: string | null;
  /** The integration branch's tip. */
  readonly tip: string;
  /** Whether the tip is an ancestor of (or is) the head: the unit is rebased onto it. */
  readonly tipInHead: boolean;
  /** Whether the head is an ancestor of (or is) the tip: the unit is folded. */
  readonly headInTip: boolean;
  /** Whether the tree the checks run in has its dependencies installed. */
  readonly installed: boolean;
  /** Whether a carry onto this unit is pending. */
  readonly carryPending: boolean;
  /** Whether the planner has launched the unit (its launch log holds a run). */
  readonly launched: boolean;
}

export const CHECK_STATUSES = Object.freeze(["queued", "running", "done", "superseded"] as const);
export type CheckStatus = (typeof CHECK_STATUSES)[number];

/** A queued, running or finished check of one step at one head. */
export interface UnitCheck {
  readonly id: string;
  readonly step: UnitStep;
  readonly head: string;
  readonly status: CheckStatus;
}

export interface WipFacts {
  readonly cap: number;
  /** How many other units are past exec and not folded. */
  readonly pastExec: number;
}

export const UNIT_PRECONDITIONS = Object.freeze([
  "wip-cap", "installed", "carry-pending", "base-not-tip", "head-changed", "out-of-order", "folded",
] as const);
export type UnitPrecondition = (typeof UNIT_PRECONDITIONS)[number];

/** The rule each precondition enforces and the blocker kind (and so owner) a refusal of it rests with. */
export const PRECONDITION_RULE: Readonly<Record<UnitPrecondition, { rule: string; kind: BlockerKind }>> = Object.freeze({
  "wip-cap": { rule: "R-UNIT-WIP", kind: "missing-authority" },
  installed: { rule: "R-UNIT-STEP-ORDER", kind: "unavailable-environment" },
  "carry-pending": { rule: "R-UNIT-STEP-ORDER", kind: "missing-input" },
  "base-not-tip": { rule: "R-UNIT-STEP-ORDER", kind: "failing-evidence" },
  "head-changed": { rule: "R-UNIT-STEP-ORDER", kind: "failing-evidence" },
  "out-of-order": { rule: "R-UNIT-STEP-ORDER", kind: "failing-evidence" },
  folded: { rule: "R-UNIT-STEP-ORDER", kind: "contradiction" },
});

export interface Refusal {
  readonly precondition: UnitPrecondition;
  readonly rule: string;
  readonly owner: string;
  readonly message: string;
}

export interface UnitNext {
  readonly unit: string;
  /** Where the unit stands: `new`, `exec`, `exec-failed`, `<step>-due`, `<step>-failed`, `ready-to-fold` or `folded`. */
  readonly state: string;
  /** The one next legal step; null once folded. */
  readonly next: UnitStep | null;
  readonly reason: string;
  /** Every failed precondition of the step asked for (or, with none asked for, of `next`). Empty when it may run. */
  readonly refused: readonly Refusal[];
  /** Whether the unit counts against the WIP cap: past exec and not folded. */
  readonly pastExec: boolean;
  /** The queued or running checks now superseded by a head change; they are not counted. */
  readonly superseded: readonly UnitCheck[];
  /** The checks still live: queued or running at the current head. */
  readonly live: readonly UnitCheck[];
  /** The step verdicts that hold at the current head, in step order. */
  readonly holding: readonly StepVerdict[];
}

const refusal = (precondition: UnitPrecondition, message: string): Refusal => {
  const { rule, kind } = PRECONDITION_RULE[precondition];
  return { precondition, rule, owner: BLOCKER_OWNERS[kind], message };
};

/** Two commits are the same when one names the other (a short sha is a prefix of the full one). */
export function sameCommit(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return a.length <= b.length ? b.startsWith(a) : a.startsWith(b);
}

/** The fingerprint a verdict or check is bound to: the head (and base) it was given at, each spelled as the current fact when it names it. */
const headPrint = (head: string | null, base: string | null, facts: UnitFacts): Fingerprint => fingerprintInputs([
  { path: "head", content: sameCommit(head, facts.head) ? facts.head! : head ?? "" },
  { path: "base", content: base === null ? "" : sameCommit(base, facts.tip) ? facts.tip : base },
]);

/** Whether a verdict still binds at the current head (and, when it names a base, the current tip): `decidePlanExecution` over its fingerprint. */
function holds(verdict: StepVerdict, facts: UnitFacts): boolean {
  const usesBase = verdict.step === "fast" || verdict.step === "mech";
  const binding = bindPlan(verdict, headPrint(verdict.head, usesBase ? verdict.base : null, facts));
  const current = headPrint(facts.head, usesBase ? (verdict.step === "mech" || verdict.base !== null ? facts.tip : null) : null, facts);
  return decidePlanExecution(binding, current).outcome === "execute";
}

/** Queued and running checks split by whether they were queued at the current head. */
export function supersedeChecks(checks: readonly UnitCheck[], head: string | null): { live: UnitCheck[]; superseded: UnitCheck[] } {
  const live: UnitCheck[] = [], superseded: UnitCheck[] = [];
  for (const check of checks) {
    if (check.status !== "queued" && check.status !== "running") continue;
    if (sameCommit(check.head, head)) live.push(check);
    else superseded.push({ ...check, status: "superseded" });
  }
  return { live, superseded };
}

/** The checks with every superseded one marked so; a caller writes this back. */
export function markSuperseded(checks: readonly UnitCheck[], head: string | null): UnitCheck[] {
  const { superseded } = supersedeChecks(checks, head);
  const ids = new Set(superseded.map(check => check.id));
  return checks.map(check => (ids.has(check.id) ? { ...check, status: "superseded" as const } : check));
}

/**
 * The unit's state and its one next legal step. With `asked`, every failed precondition of running that
 * step now is returned in `refused`; without it, those of `next`. With `expectedHead`, a head that moved from
 * it is refused as `head-changed`.
 */
export function unitNext(
  facts: UnitFacts,
  records: Partial<Record<RecordedStep, StepRecord>>,
  checks: readonly UnitCheck[] = [],
  wip: WipFacts = { cap: UNIT_WIP_CAP_DEFAULT, pastExec: 0 },
  asked?: UnitStep,
  expectedHead?: string,
): UnitNext {
  const { live, superseded } = supersedeChecks(checks, facts.head);
  const base = { unit: facts.unit, live, superseded };
  const step = asked ?? null;
  // The caller planned this step on `expectedHead`: refused once the head moved from it.
  const moved = expectedHead !== undefined && !sameCommit(expectedHead, facts.head)
    ? [refusal("head-changed", `the head is ${facts.head ?? "(none)"}, not ${expectedHead}: the step was planned on a superseded head`)] : [];
  const done = (state: string, next: UnitStep | null, reason: string, pastExec: boolean, holding: StepVerdict[], found: Refusal[]): UnitNext => {
    const refused = [...found, ...moved.filter(item => !found.some(other => other.precondition === item.precondition))];
    if (step !== null && step !== next && !refused.length) refused.push(refusal("out-of-order", `${step} is not the next legal step; ${next ?? "nothing"} is (${reason})`));
    return { ...base, state, next, reason, pastExec, holding, refused };
  };

  if (facts.head !== null && facts.headInTip && records.exec?.verdict?.pass) {
    return done("folded", null, "the head is in the integration tip", false, [], step ? [refusal("folded", `the unit is folded at ${facts.tip}; no step runs on it`)] : []);
  }

  const exec = records.exec;
  if (!exec?.verdict?.pass) {
    const state = !exec ? (facts.launched ? "exec" : "new") : "exec-failed";
    const reason = !exec ? (facts.launched ? "launched; no receipt yet" : "not launched") : exec.verdict ? `the receipt says ${exec.verdict.line}` : "the receipt has no verdict line (counted as failed)";
    const refused: Refusal[] = [];
    // A pull of a new unit: refused while the WIP cap is full, until a fold frees a place.
    if (state === "new" && (step === null || step === "exec") && wip.pastExec >= wip.cap) {
      refused.push(refusal("wip-cap", `${wip.pastExec} unit(s) are past exec and not folded, at the WIP cap of ${wip.cap}; pull a new unit only after a fold`));
    }
    return done(state, "exec", reason, false, [], refused);
  }

  // Past exec: the preconditions of every later step, checked in code before any of them runs.
  const holding: StepVerdict[] = [];
  const pre: Refusal[] = [];
  if (!facts.installed) pre.push(refusal("installed", "the tree the checks run in has no installed dependencies; run npm ci first"));
  if (facts.carryPending) pre.push(refusal("carry-pending", "a carry onto this unit is pending; carry it before the next step"));
  const later = (target: UnitStep) => UNIT_STEPS.indexOf(target) > UNIT_STEPS.indexOf("rebase");
  const preFor = (target: UnitStep | null): Refusal[] => (target === null ? [] : pre.filter(item => item.precondition !== "installed" || later(target)));

  if (!facts.tipInHead) {
    const refused = [...preFor(step ?? "rebase")];
    if (step !== null && later(step)) refused.push(refusal("base-not-tip", `the head ${facts.head ?? "(none)"} is not rebased onto the integration tip ${facts.tip}; ${step} never runs on a stale base`));
    return done("rebase-due", "rebase", "the head does not contain the integration tip", true, holding, refused);
  }

  for (const name of ["fast", "mech", "review"] as const) {
    const record = records[name];
    const verdict = record?.verdict ?? null;
    if (verdict && holds(verdict, facts)) {
      holding.push(verdict);
      if (verdict.pass) continue;
      return done(`${name}-failed`, "exec", `${verdict.line}: fix it on the unit branch`, true, holding, preFor(step));
    }
    const refused = [...preFor(step ?? name)];
    let reason: string;
    if (!record) reason = `no ${name} verdict yet`;
    else if (!verdict) reason = `the ${name} record has no verdict line (counted as failed)`;
    else if (!sameCommit(verdict.head, facts.head)) reason = `the ${name} verdict was given at ${verdict.head}, not the head ${facts.head}: superseded`;
    else reason = `the ${name} verdict ran against base ${verdict.base ?? "(unnamed)"}, not the integration tip ${facts.tip}: stale`;
    if (step !== null && UNIT_STEPS.indexOf(step) > UNIT_STEPS.indexOf(name)) {
      const moved = [...RECORDED_STEPS].reverse().map(item => records[item]?.verdict).find(item => item && item.head && !sameCommit(item.head, facts.head));
      if (moved) refused.push(refusal("head-changed", `the head moved from ${moved.head} (the last ${moved.step} verdict) to ${facts.head}; ${step} does not run on a head no verdict was given at`));
    }
    return done(`${name}-due`, name, reason, true, holding, refused);
  }
  return done("ready-to-fold", "fold", "fast, mech and review pass at the head, on the integration tip", true, holding, preFor(step ?? "fold"));
}

/** The one fixed-form verdict line `unit next` ends with. */
export function nextVerdictLine(result: UnitNext, head: string | null, asked?: UnitStep): string {
  const verdict = result.refused.length ? `REFUSED ${[...new Set(result.refused.map(item => item.precondition))].join(",")}` : "OK";
  return `NEXT: ${result.unit} ${result.state} ${result.next ?? "none"} ${head ?? "-"} ${asked ? `${asked} ` : ""}${verdict}`;
}
