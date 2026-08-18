import { createGateReasons, gateSatisfied, gateViolated } from "../gates/result.js";
import type { GateResult } from "../gates/result.js";
import type { Finding } from "./types.js";

/**
 * `liveStateSurface`: a scheduler's registration, a deployed artifact, and a
 * repository standard read back through a script are the same statement at
 * three altitudes — *this is what should exist; go and see whether it does.*
 * This module is that statement, named once (#255).
 *
 * It generalizes two vocabularies this same package already shipped,
 * independently, one tier apart:
 *
 *   - `reconciliationFindingKinds` (`./routines.ts`) — the routine tier's
 *     four answers only a live scheduler probe can give.
 *   - `scheduleReconciliationFindingKinds` (`./schedules.ts`) — the schedule
 *     tier's four, wider because deployment is usually a manual step that
 *     merging does not perform.
 *
 * Both are tier-specific data, deliberately not implemented as code, because
 * this package cannot read anyone's machine — see either file's own header.
 * Read side by side, both are the same four kinds wearing a tier's own
 * vocabulary. A third instance arriving from a consuming plane (a policy-
 * drift check that could not read back the live configuration it was
 * comparing against, because the permission it needed was not one the
 * default CI token could be granted) is what made the shape worth naming
 * once rather than rewriting per subject:
 *
 *   - a declaration of intent, checkable offline;
 *   - a live state owned by somewhere else;
 *   - a reconciliation surface that may or may not exist yet;
 *   - and the failure where the offline check goes green and is mistaken
 *     for the whole answer.
 *
 * See `conventions/documents/live-state-reconciliation.md` for the shared
 * document, and that document's own header for why `routine-declaration.md`
 * and `schedule-declaration.md` keep their own tier-specific vocabularies
 * rather than being rewritten to import this one: no behavioural change to
 * either validator was proposed, or made.
 *
 * WHY THIS IS NOT A BOOLEAN
 * --------------------------
 * A gate that can only say pass/fail collapses "I read the live state and it
 * agreed" and "I never read the live state at all" into the same green
 * result. Both tiers this generalizes already learned that lesson on their
 * own terms; the one addition this module makes over both of them is naming
 * the state neither one named: `declared-but-not-verifiable`. A
 * reconciliation surface that cannot currently read live state is a declared
 * gap with a NAMED BLOCKER, never a silent pass — enforced here at the type
 * level (a two-state result literally cannot be constructed; see
 * `liveStateCouldNotVerify` below) rather than left as a convention a future
 * caller might forget.
 *
 * This module reuses this package's own `GateResult` ternary (`../gates/
 * result.ts`) rather than inventing a fifth shape of the same idea — that
 * module's own header already counts four independent reinventions of a
 * three-state result inside this repository alone and says plainly that the
 * next gate should reuse it instead. `satisfied` is `verified`, `violated`
 * is `drifted`, and `indeterminate` is `could-not-verify`, carrying
 * `declared-but-not-verifiable` as its one declared reason and the named
 * blocker as `detail`.
 *
 * Zero I/O. Every declaration and every observation is supplied by the
 * caller; this module never reads a machine, a registry, or a network.
 */

/**
 * The complete finding-kind vocabulary, all five, shipped as one frozen list
 * so a caller can enumerate it (for `--help` text, a report legend, or a
 * lifecycle document) without re-deriving it from the two branches below.
 *
 * The first four are what a *completed* reconciliation attempt can report as
 * drift. The fifth is different in kind, not degree: it is what an attempt
 * that could not complete reports instead, and it is the point of the whole
 * contract — see the module header.
 */
export const LIVE_STATE_SURFACE_FINDING_KINDS = Object.freeze([
  "declared-but-not-live",
  "live-but-not-declared",
  "live-differs-from-declared",
  "live-artifact-predates-its-declaration",
  "declared-but-not-verifiable",
] as const);

export type LiveStateSurfaceFindingKind = (typeof LIVE_STATE_SURFACE_FINDING_KINDS)[number];

/** The four kinds a reconciliation that actually ran can report as drift. */
export type LiveStateDriftKind = Exclude<LiveStateSurfaceFindingKind, "declared-but-not-verifiable">;

/** One reportable disagreement between a declaration and live state. */
export interface LiveStateFinding {
  readonly kind: LiveStateDriftKind;
  /** The subject this finding is about — a toolchain pin, a deployment surface, a manifest entry. */
  readonly subject: string;
  readonly message: string;
}

/**
 * `declared-but-not-verifiable` is this module's one declared indeterminate
 * reason, scoped through `createGateReasons` the same way every other gate
 * in this repository scopes its own vocabulary — see that function's own
 * doc comment for why a fixed, declared set beats an open string.
 */
export const liveStateReconciliationReasons = createGateReasons(["declared-but-not-verifiable"] as const);

export type LiveStateReconciliationReason = (typeof liveStateReconciliationReasons.reasons)[number];

/** One subject's reconciliation outcome: verified, drifted, or could-not-verify. Never a fourth state, never a boolean. */
export type LiveStateReconciliationResult = GateResult<LiveStateFinding, LiveStateReconciliationReason>;

/** A `GateResult` with the subject it is about attached, for a report that reconciles several subjects at once. */
export interface LiveStateSubjectReport {
  readonly subject: string;
  readonly result: LiveStateReconciliationResult;
}

/** Constructs a `verified` report: the declaration and the live state were both read and they agree. */
export function liveStateVerified(subject: string): LiveStateSubjectReport {
  return { subject, result: gateSatisfied(1) };
}

/** Constructs a `drifted` report. `findings` must be non-empty — see `gateViolated`. */
export function liveStateDrifted(subject: string, findings: readonly LiveStateFinding[]): LiveStateSubjectReport {
  return { subject, result: gateViolated(findings) };
}

/**
 * Constructs a `could-not-verify` report. `blocker` is required and must
 * name why live state could not be read — a missing credential, an
 * unreachable API, a permission the ambient token was never granted.
 *
 * This is the enforcement mechanism for the module header's central claim:
 * calling this with an empty blocker throws, the same way `gateSatisfied`
 * throws on a non-positive `evaluated` count and `gateViolated` throws on an
 * empty findings list. A reconciliation surface that cannot read live state
 * is a declared gap with a named blocker; a caller cannot construct the
 * "could not verify, and I decline to say why" report this module refuses
 * to let exist.
 */
export function liveStateCouldNotVerify(subject: string, blocker: string): LiveStateSubjectReport {
  if (typeof blocker !== "string" || blocker.trim() === "") {
    throw new Error(
      "liveStateCouldNotVerify: blocker is required and must name why live state could not be read. A " +
        "reconciliation surface that cannot read live state is a declared gap with a named blocker, never a " +
        "silent pass — see the module header for why this is enforced here rather than left as a convention.",
    );
  }
  return { subject, result: liveStateReconciliationReasons.indeterminate("declared-but-not-verifiable", blocker) };
}

/**
 * What a live-state read reports about one subject, supplied by the caller.
 *
 * `attempted: false` and a present `blocker` together are how a caller who
 * never had the credential to look says so; `attempted: true` with a
 * `blocker` is how a caller who tried and failed mid-read says so. Both
 * become `could-not-verify` — the distinction is for the caller's own
 * record, not for this module's verdict, which treats them identically.
 */
export interface LiveStateObservation<TLive> {
  readonly attempted: boolean;
  /** Required whenever the read did not produce a usable result. */
  readonly blocker?: string;
  /** What was actually found. Absent means live state does not exist — never "was not read". */
  readonly live?: TLive;
  /**
   * When the live artifact was created or last changed, if knowable (ISO
   * 8601). Compared against `declared.declaredAt` as an *instant*, not as a
   * string — see `reconcileLiveState`'s own doc comment for why, and for
   * what a value that cannot be parsed as an instant does instead of
   * silently comparing as equal-or-later.
   */
  readonly liveObservedAt?: string;
}

/** What a plane declares about one subject, supplied by the caller. */
export interface LiveStateDeclarationValue<TDeclared> {
  readonly value: TDeclared;
  /**
   * When this declaration was authored or last changed, if knowable (ISO
   * 8601). See `LiveStateObservation.liveObservedAt` for how this is
   * compared.
   */
  readonly declaredAt?: string;
}

export interface ReconcileLiveStateInput<TDeclared, TLive> {
  readonly subject: string;
  /** Absent means this subject is not declared at all. */
  readonly declared?: LiveStateDeclarationValue<TDeclared>;
  readonly observation: LiveStateObservation<TLive>;
  /** True when the declared and live values agree. Pure; never called when either side is absent or unreadable. */
  readonly agrees: (declared: TDeclared, live: TLive) => boolean;
  /** Optional, subject-specific drift message. Falls back to a generic one. */
  readonly describeDrift?: (declared: TDeclared, live: TLive) => string;
}

/**
 * Parses an ISO 8601 timestamp as an instant (epoch milliseconds), for
 * comparing two timestamps that may legally use different UTC offsets,
 * different literal offset spellings (`+00:00` and `Z` name the same
 * instant), and different fractional-second precision.
 *
 * Returns `undefined` when `value` is not a string `Date.parse` can resolve
 * to a real instant — the caller must treat that as "cannot verify," never
 * as "treat this as equal or later." See `reconcileLiveState`'s own doc
 * comment.
 */
function parseInstant(value: string): number | undefined {
  const instant = Date.parse(value);
  return Number.isNaN(instant) ? undefined : instant;
}

/**
 * Reconciles one subject's declaration against one observation of its live
 * state, and returns exactly one of the three outcomes this module allows.
 *
 * A green run through this function is never evidence on its own — see
 * `validateLiveStateSurfaceDeclaration`'s required `note` field, which is
 * where a plane states that in its own declaration, next to the fields that
 * make this function callable at all.
 *
 * WHY `declaredAt`/`liveObservedAt` ARE COMPARED AS INSTANTS, NOT STRINGS
 * -------------------------------------------------------------------------
 * The doc comments on both fields require only "ISO 8601," which permits
 * UTC offsets other than `Z` and optional fractional seconds. Two valid
 * ISO 8601 values can therefore compare in the wrong direction as strings:
 * `"2026-08-10T09:00:00+02:00"` (07:00 UTC) is lexicographically *greater*
 * than `"2026-08-10T08:00:00Z"` (08:00 UTC) even though it names an earlier
 * instant. This comparison is the sole trigger for the
 * `live-artifact-predates-its-declaration` finding, so a string comparison
 * would make that finding silently fail to fire, or fire when it should
 * not, for any pair of timestamps written with different offsets. This
 * function parses both sides to an instant with `parseInstant` and compares
 * those instead.
 *
 * A timestamp that cannot be parsed as an instant is not treated as "no
 * drift." Comparing an unparseable value as though it sorted last (or
 * first, or equal) would silently manufacture a verdict from data that
 * cannot actually be compared — the exact defect class this whole contract
 * exists to prevent, reproduced one level down. Instead, when either
 * `declaredAt` or `liveObservedAt` is present but not parseable, this
 * function returns `could-not-verify` for the whole subject, with a
 * blocker naming which field and value could not be parsed, rather than
 * silently proceeding as if temporal ordering had been checked and found
 * clean.
 */
export function reconcileLiveState<TDeclared, TLive>(
  input: ReconcileLiveStateInput<TDeclared, TLive>,
): LiveStateSubjectReport {
  const { subject, declared, observation, agrees, describeDrift } = input;

  if (!observation.attempted) {
    return liveStateCouldNotVerify(subject, observation.blocker ?? "");
  }
  if (observation.blocker !== undefined && observation.blocker.trim() !== "") {
    return liveStateCouldNotVerify(subject, observation.blocker);
  }

  if (declared === undefined && observation.live === undefined) {
    throw new Error(
      `reconcileLiveState: subject "${subject}" is neither declared nor observed live — there is nothing to ` +
        "reconcile. This is a caller error, not a finding about the subject: do not call this function for a " +
        "subject with no declaration and no observation.",
    );
  }

  const findings: LiveStateFinding[] = [];

  if (declared === undefined) {
    findings.push({
      kind: "live-but-not-declared",
      subject,
      message: `"${subject}" exists live, but no declaration names it.`,
    });
    return liveStateDrifted(subject, findings);
  }

  if (observation.live === undefined) {
    findings.push({
      kind: "declared-but-not-live",
      subject,
      message: `"${subject}" is declared, but the live read found nothing.`,
    });
    return liveStateDrifted(subject, findings);
  }

  if (!agrees(declared.value, observation.live)) {
    findings.push({
      kind: "live-differs-from-declared",
      subject,
      message: describeDrift?.(declared.value, observation.live) ?? `"${subject}"'s live state does not match its declaration.`,
    });
  }

  if (declared.declaredAt !== undefined && observation.liveObservedAt !== undefined) {
    const declaredInstant = parseInstant(declared.declaredAt);
    const liveInstant = parseInstant(observation.liveObservedAt);

    if (declaredInstant === undefined || liveInstant === undefined) {
      const unparseable = [
        declaredInstant === undefined ? `declaredAt "${declared.declaredAt}"` : undefined,
        liveInstant === undefined ? `liveObservedAt "${observation.liveObservedAt}"` : undefined,
      ].filter((entry): entry is string => entry !== undefined);
      return liveStateCouldNotVerify(
        subject,
        `"${subject}" cannot be checked for live-artifact-predates-its-declaration: ${unparseable.join(" and ")} ` +
          "could not be parsed as an ISO 8601 instant, so temporal ordering cannot be verified.",
      );
    }

    if (liveInstant < declaredInstant) {
      findings.push({
        kind: "live-artifact-predates-its-declaration",
        subject,
        message:
          `"${subject}"'s live artifact (observed ${observation.liveObservedAt}) predates its declaration ` +
          `(${declared.declaredAt}). Agreement here proves nothing about intent: the artifact was already there ` +
          "before whatever wrote the declaration, so the declaration may simply be describing what it found rather " +
          "than what it caused to exist.",
      });
    }
  }

  return findings.length > 0 ? liveStateDrifted(subject, findings) : liveStateVerified(subject);
}

/**
 * The declaration shape from #255: a plane must name the surface that
 * reconciles its declared intent against live state, and must say plainly
 * that a green offline check never means the work runs.
 */
export interface LiveStateSurfaceDeclaration {
  /** Where the live state actually lives, in prose. */
  readonly store: string;
  /** Explicit, never left implicit: can a script read `store` at all? */
  readonly readableByScript: boolean;
  /** The named surface or command that reads it, required when `readableByScript` is `true`. */
  readonly readableBy?: string;
  /** What reconciles it when a script cannot, required when `readableByScript` is `false`. */
  readonly reconciledBy?: string;
  /** Required. Must state that a green offline check is not evidence the work is live. */
  readonly note: string;
}

/**
 * A note satisfies the required caveat when it pairs a "this passed" word
 * with an explicit denial that the pass is evidence. Deliberately narrow and
 * literal, like the routine tier's `validateScheduledSkillDescription` this
 * mirrors: it is not an attempt at general natural-language understanding,
 * it reliably catches the phrasing this repository's own documents already
 * use, and a caller who fails it gets told exactly what is missing rather
 * than having a check silently accept vague reassurance.
 */
const NOTE_STATES_GREEN_IS_NOT_EVIDENCE =
  /\b(green|passing|clean|satisfied)\b[^.]{0,120}\b(is not|isn't|are not|aren't|is no|does not mean|doesn't mean|never means)\b[^.]{0,120}\b(evidence|proof|live|running|deployed)\b/i;

/** Validates one declaration's own shape. Pure and offline — see the module header. */
export function validateLiveStateSurfaceDeclaration(declaration: LiveStateSurfaceDeclaration): readonly Finding[] {
  const findings: Finding[] = [];
  const record = declaration as unknown as Record<string, unknown>;

  const store = record.store;
  if (typeof store !== "string" || store.trim() === "") {
    findings.push({
      rule: "live-state/missing-store",
      severity: "high",
      message: "A liveStateSurface declaration requires a non-empty \"store\" naming where the live state actually lives.",
    });
  }

  const readableByScript = record.readableByScript;
  if (typeof readableByScript !== "boolean") {
    findings.push({
      rule: "live-state/readable-by-script-not-boolean",
      severity: "high",
      message:
        `"readableByScript" must be an explicit boolean, never left implicit. Got ${JSON.stringify(readableByScript)}.`,
    });
  } else if (readableByScript) {
    const readableBy = record.readableBy;
    if (typeof readableBy !== "string" || readableBy.trim() === "") {
      findings.push({
        rule: "live-state/missing-readable-by",
        severity: "high",
        message: "\"readableByScript\" is true but no \"readableBy\" surface or command is named.",
      });
    }
  } else {
    const reconciledBy = record.reconciledBy;
    if (typeof reconciledBy !== "string" || reconciledBy.trim() === "") {
      findings.push({
        rule: "live-state/missing-reconciled-by",
        severity: "high",
        message: "\"readableByScript\" is false but no \"reconciledBy\" surface is named for what reconciles it instead.",
      });
    }
  }

  const note = record.note;
  if (typeof note !== "string" || note.trim() === "") {
    findings.push({
      rule: "live-state/missing-note",
      severity: "high",
      message: "A liveStateSurface declaration requires a \"note\" stating that a green offline check is not evidence the work is live.",
    });
  } else if (!NOTE_STATES_GREEN_IS_NOT_EVIDENCE.test(note)) {
    findings.push({
      rule: "live-state/note-missing-caveat",
      severity: "high",
      message:
        "\"note\" does not read as stating that a green offline check is not evidence the work is live. Say so " +
        "plainly, e.g. \"a green run here is not evidence this is live — only <readableBy/reconciledBy> can say that.\"",
    });
  }

  return findings;
}
