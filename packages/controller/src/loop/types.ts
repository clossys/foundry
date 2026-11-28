/**
 * Shared types and vocabularies for the loop engine (issue #1195): the one
 * `sense -> judge -> act -> verify -> learn` loop every role runs, and the
 * per-role state it is re-entrant over. See `./lifecycle.js` for the
 * six-state / three-condition vocabulary a capability's own position is
 * recorded in, and this repository's own canonical loop contract for the
 * human-readable twin of everything declared here.
 */
import type { LifecycleCondition, LifecycleState } from "./lifecycle.js";

/** The one loop, in order. Renamed from `learnOrEscalate` to `learn` by issue #1194. */
export const LOOP_STAGES = Object.freeze(["sense", "judge", "act", "verify", "learn"] as const);
export type LoopStage = (typeof LOOP_STAGES)[number];

/**
 * What changed, and where the loop re-enters for it (issue #1195's trigger
 * table). "Time" is split into the table's own two sub-cases -- a freshness
 * window re-enters at `judge` (the evidence might be stale; re-decide
 * before acting on it), a review window re-enters at `learn` (it is time to
 * adapt or close, whether or not anything looks stale).
 */
export const TRIGGER_KINDS = Object.freeze([
  "inputs-changed",
  "role-changed",
  "freshness-window",
  "review-window",
  "outcome-missed",
  "client-request",
] as const);
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

/** Which capabilities a trigger re-enters: only the ones it actually touched, or every one this role runs. */
export const TRIGGER_SCOPES = Object.freeze(["affected-capabilities-only", "all-capabilities", "named-capability"] as const);
export type TriggerScope = (typeof TRIGGER_SCOPES)[number];

/** The five blocker kinds (issue #1195) and who owns resolving each one. */
export const BLOCKER_KINDS = Object.freeze([
  "missing-input",
  "missing-authority",
  "failing-evidence",
  "unavailable-environment",
  "contradiction",
] as const);
export type BlockerKind = (typeof BLOCKER_KINDS)[number];

/** Fixed, one owner per blocker kind -- never a set, never "it depends." */
export const BLOCKER_OWNERS: Readonly<Record<BlockerKind, string>> = Object.freeze({
  "missing-input": "upstream-role-or-client",
  "missing-authority": "sponsor",
  "failing-evidence": "this-role",
  "unavailable-environment": "named-system-owner",
  contradiction: "advisor",
});

/** One next action: who does it, how, and by when. A blocker without one is not yet a blocker record -- it is a gap. */
export interface NextAction {
  readonly who: string;
  readonly how: string;
  /** ISO 8601 date or datetime. Escalation is measured against this. */
  readonly byWhen: string;
}

/** One capability at rest with exactly one next action, per issue #1195: "no matter the kind, a blocked capability rests with exactly one next action." */
export interface Blocker {
  readonly capabilityId: string;
  readonly kind: BlockerKind;
  /** Always `BLOCKER_OWNERS[kind]` -- carried on the record so a reader never has to re-derive it. */
  readonly owner: string;
  readonly nextAction: NextAction;
  /** ISO 8601 datetime the blocker was recorded. */
  readonly since: string;
}

/** One recorded decision: what was recommended, what was chosen, and when -- issue #1195's own STATUS document "Decisions" section, kept as data. */
export interface Decision {
  readonly recommended: string;
  readonly chosen: string;
  /** ISO 8601 datetime. */
  readonly when: string;
}

/** A path -> content-digest map (see `./staleness.js`), the deterministic fingerprint staleness is compared against. */
export type Fingerprint = Readonly<Record<string, string>>;

/** One capability's full position in the loop. */
export interface LoopCapabilityState {
  readonly id: string;
  readonly state: LifecycleState;
  readonly condition: LifecycleCondition;
  /** Where this capability currently sits in the loop. `null` only when `state` is `absent` or `retired` -- there is nothing to resume. */
  readonly stage: LoopStage | null;
  /** Fingerprints of the inputs the current state was built from -- issue #1195's "every artifact records fingerprints of the inputs it was built from." */
  readonly inputFingerprints: Fingerprint;
  /** Fingerprint of each owned artifact path as the role itself last wrote it -- how a human edit is told apart from the role's own last write. */
  readonly lastWrittenFingerprints: Fingerprint;
  readonly blockers: readonly Blocker[];
  readonly decisions: readonly Decision[];
}

/** Where a unit runs (CP1-PLANNERRUN): a cloud session, or a local checkout. */
export const UNIT_ENVS = Object.freeze(["cloud", "local"] as const);
export type UnitEnv = (typeof UNIT_ENVS)[number];

/** The model tier a unit runs at, lowest first. */
export const UNIT_TIERS = Object.freeze(["low", "mid", "high"] as const);
export type UnitTier = (typeof UNIT_TIERS)[number];

/**
 * A launch's position: `launched` until the unit branch moves (`progressed`), `stale` once the
 * staleness window passed with no pushed progress (see `./staleness.js`), `failed` when the
 * planner records the launch as failed.
 */
export const UNIT_RUN_STATUSES = Object.freeze(["launched", "progressed", "stale", "failed"] as const);
export type UnitRunStatus = (typeof UNIT_RUN_STATUSES)[number];

/** One recorded launch of a unit: which unit, where, at which tier, and when. */
export interface UnitRun {
  readonly unit: string;
  readonly env: UnitEnv;
  readonly tier: UnitTier;
  /** ISO 8601 datetime of the launch. */
  readonly at: string;
  /** The branch the unit pushes its progress to. */
  readonly branch: string;
  /** That branch's head on the remote when the unit launched; `null` when the branch did not exist yet. */
  readonly headAtLaunch: string | null;
  readonly status: UnitRunStatus;
  /** Why the launch failed; present only on a `failed` run. */
  readonly reason?: string;
}

/** The complete per-role machine state, `clossys/<role>/loop.json`. */
export interface LoopState {
  readonly schemaVersion: 1;
  readonly role: string;
  readonly capabilities: Readonly<Record<string, LoopCapabilityState>>;
  /** The planner's launch log (CP1-PLANNERRUN): every launch of each unit, oldest first. Absent for a role that launches nothing. */
  readonly units?: Readonly<Record<string, readonly UnitRun[]>>;
}
