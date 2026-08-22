/**
 * The runtime verdict, and the three gates that read a whole set of records.
 *
 * THE LOOP THIS CLOSES
 * ---------------------
 * Declared authority is the setpoint. A grant or a denial is the act.
 * Reconciliation against every provider of record is the observation. Drift
 * between the two is the comparison. Revoking or re-asserting is the
 * correction. A package that only answers "may they?" at runtime, and never
 * reconciles, has a setpoint and an act and nothing else — half a loop, and
 * the missing half is the half that notices.
 *
 * THE ADVERSARIAL CASE, STATED ONCE
 * ----------------------------------
 * A weaker tool checks that a session exists. It passes while the role behind
 * that session was revoked upstream an hour ago: the provider says no, the
 * local record says yes, and the session is real and well-formed the entire
 * time. Presence of a session is not currency of a grant. Every function in
 * this file is written so that the only way to reach `authorized` — or a
 * clean gate run — is to have compared against the provider and seen it
 * answer.
 *
 * WHY UNREACHABLE IS NOT A DENIAL
 * --------------------------------
 * `unverifiable` is a third verdict, not a flavour of `denied`, and
 * `checkAuthorityReconciliation` reports an unreachable provider as
 * INDETERMINATE rather than as a violation. The two are different facts and
 * they have different corrections: a denial means revoke, an unverifiable
 * means go and look again. Folding them together in either direction loses
 * something real — fold `unverifiable` into `denied` and every provider
 * outage becomes a mass revocation; fold it into `authorized` and an outage
 * becomes a silent, blanket grant. `cli.ts` maps the third state onto exit
 * `2` for exactly this reason, and never onto `0`.
 *
 * Everything here is pure. No I/O, no clock read, no ambient state: every
 * function that needs the time takes `at` as a parameter rather than calling
 * `Date.now()` itself, so the same inputs always produce the same output and
 * a test can put the clock wherever it needs it. The only file in this
 * package that reads anything off disk is `cli.ts`.
 */

import type {
  AdapterMapping,
  BackedAuthority,
  DelegatedActor,
  Grant,
  ProviderAssertion,
  ProviderShape,
} from "./schema.js";

// ------------------------------------------------------------ runtime verdict

export type AuthorityDenialReason =
  /** The provider of record says this authority was revoked. */
  | "revoked-upstream"
  /** The provider answered, and this authority is not among the ones it backs. */
  | "not-backed"
  /** The consumer's own declared end of this grant has passed. */
  | "grant-expired";

export type AuthorityUnverifiableReason =
  /** The provider could not be reached at all. Not a denial: nothing was learned. */
  | "provider-unreachable"
  /** No observation of this grant's provider was supplied. Not a denial: nothing was looked at. */
  | "provider-not-observed"
  /** The observation supplied belongs to a different provider than the grant names. */
  | "provider-mismatch"
  /** The grant or the observation carries a time this cannot order. */
  | "unreadable-clock";

/**
 * The runtime answer, and the reason it must be a ternary.
 *
 * A boolean here would have to put "I could not find out" on one side or the
 * other, and both sides are wrong — see this file's header. `unverifiable`
 * additionally carries WHICH provider could not be checked, so a caller can
 * decide what to do about an outage at one provider without treating every
 * grant in the system as suspect.
 */
export type AuthorityDecision =
  | { verdict: "authorized"; grantId: string; actorId: string; subjectId: string; providerId: string; confirmedAt: string }
  | { verdict: "denied"; grantId: string; actorId: string; subjectId: string; providerId: string; reason: AuthorityDenialReason }
  | { verdict: "unverifiable"; grantId: string; actorId: string; subjectId: string; providerId: string; reason: AuthorityUnverifiableReason };

function identity(grant: Grant): { grantId: string; actorId: string; subjectId: string; providerId: string } {
  return { grantId: grant.grantId, actorId: grant.actorId, subjectId: grant.subjectId, providerId: grant.providerId };
}

/**
 * A provider backs an authority only when the actor, the subject AND the
 * authority all match. Matching on the actor alone is the near-miss worth
 * naming: an actor who legitimately holds an authority over their own account
 * would then read as holding it over everyone's.
 */
function findBacking(assertion: ProviderAssertion, grant: Grant): BackedAuthority | undefined {
  return (assertion.backs ?? []).find(
    (backed) => backed.actorId === grant.actorId && backed.subjectId === grant.subjectId && backed.authority === grant.authority,
  );
}

/**
 * The single-grant runtime verdict: compare ONE live grant against ONE
 * observation of the provider that is supposed to back it.
 *
 * `assertion` is `undefined`-able on purpose. The caller that has no
 * observation to hand must get `unverifiable`, not a convenient `denied` and
 * certainly not an `authorized` — "I have no observation" is the state this
 * whole package exists to stop being reported as one of the other two.
 *
 * Note the ORDER of the checks, which is load-bearing. Reachability is
 * settled before anything else, so a provider that did not answer can never
 * produce a denial derived from its empty backing list. Expiry is checked
 * only once the provider has been seen to still back the grant, so a grant
 * that is both revoked upstream and locally expired reports the upstream
 * revocation — the fact that came from outside, and the one whose correction
 * is not merely local.
 */
export function evaluateGrant(grant: Grant, assertion: ProviderAssertion | undefined, at: string): AuthorityDecision {
  const base = identity(grant);

  if (assertion === undefined) return { verdict: "unverifiable", ...base, reason: "provider-not-observed" };
  if (assertion.providerId !== grant.providerId) return { verdict: "unverifiable", ...base, reason: "provider-mismatch" };
  if (assertion.reachability === "unreachable") return { verdict: "unverifiable", ...base, reason: "provider-unreachable" };

  const backing = findBacking(assertion, grant);
  if (backing === undefined) return { verdict: "denied", ...base, reason: "not-backed" };
  if (backing.status === "revoked") return { verdict: "denied", ...base, reason: "revoked-upstream" };

  const now = Date.parse(at);
  if (Number.isNaN(now)) return { verdict: "unverifiable", ...base, reason: "unreadable-clock" };
  if (grant.expiresAt !== undefined) {
    const expires = Date.parse(grant.expiresAt);
    if (Number.isNaN(expires)) return { verdict: "unverifiable", ...base, reason: "unreadable-clock" };
    if (expires <= now) return { verdict: "denied", ...base, reason: "grant-expired" };
  }

  return { verdict: "authorized", ...base, confirmedAt: backing.confirmedAt };
}

// ------------------------------------------------ gate 1: authority reconciliation

export type ReconciliationFindingKind =
  /** The provider of record says this authority was revoked, and it is still live here. */
  | "revoked-upstream"
  /** The provider answered and does not back this authority at all. */
  | "unbacked-grant"
  /** The grant's own declared end has passed and it is still live here. */
  | "expired-grant";

export interface ReconciliationFinding {
  kind: ReconciliationFindingKind;
  grantId: string;
  /** Who was acting. Never merged with `subjectId`. */
  actorId: string;
  /** Whose behalf they were acting on. Never merged with `actorId`. */
  subjectId: string;
  providerId: string;
  message: string;
}

export type ReconciliationFailureReason =
  /** At least one live grant no provider still backs. The violation this gate exists for. */
  | "unreconciled-grants"
  /** Nothing to reconcile. Not a clean run — a run that examined nothing. */
  | "no-grants-provided"
  /** No provider observations at all. Every grant would be unverifiable. */
  | "no-provider-assertions-provided"
  /** At least one provider could not be reached. Never a pass, and never a violation either. */
  | "provider-unreachable"
  /** At least one grant names a provider nothing observed. */
  | "provider-not-observed"
  /** A time in the records could not be ordered. */
  | "unreadable-clock";

export interface AuthorityReconciliationResult {
  ok: boolean;
  reason?: ReconciliationFailureReason;
  grantsChecked: number;
  providersChecked: number;
  /**
   * THE METRIC: authority live here that no provider still backs. Counted
   * rather than merely listed, because the number is the thing that is
   * supposed to go to zero and stay there.
   */
  unreconciledGrantSurface: number;
  /** Grants whose provider could not be reached or observed — separate from the surface, because nothing was learned about them. */
  unverifiableGrants: number;
  findings: ReconciliationFinding[];
  decisions: AuthorityDecision[];
}

const RECONCILIATION_MESSAGES: Record<ReconciliationFindingKind, string> = {
  "revoked-upstream": "the provider of record reports this authority revoked, and it is still live here",
  "unbacked-grant": "the provider of record answered and does not back this authority at all",
  "expired-grant": "this grant's own declared expiry has passed and it is still live here",
};

/**
 * GATE 1 — every live grant traces to a provider that still backs it.
 *
 * The adversarial case this is built against, restated at the place it is
 * decided: a well-formed session exists for an actor whose role was revoked
 * upstream an hour ago. Nothing local has changed, so nothing local can
 * notice. Only a comparison against the provider can, and only if the
 * comparison is allowed to say "I could not reach it" as its own answer
 * instead of quietly returning the local view.
 *
 * The three states:
 *
 *   ok           — at least one grant, at least one provider, every provider
 *                  reachable, every grant backed and unexpired.
 *   violated     — `"unreconciled-grants"`, with one finding per grant. This
 *                  is the only reason that maps to exit `1`.
 *   indeterminate— everything else: nothing to check, nothing to check it
 *                  against, a provider that did not answer, a provider nobody
 *                  observed, or a clock that could not be read.
 *
 * INDETERMINATE WINS OVER VIOLATED, deliberately. A run in which SOME grants
 * were found unreconciled and SOME providers were unreachable reports the
 * unreachability: the set of violations is known to be incomplete, and a
 * caller who is handed "1 — here are the findings" reasonably reads it as
 * "and there are no others". There are.
 */
export function checkAuthorityReconciliation(
  grants: readonly Grant[],
  assertions: readonly ProviderAssertion[],
  at: string,
): AuthorityReconciliationResult {
  const empty = { grantsChecked: grants.length, providersChecked: assertions.length, unreconciledGrantSurface: 0, unverifiableGrants: 0, findings: [], decisions: [] };
  if (grants.length === 0) return { ok: false, reason: "no-grants-provided", ...empty };
  if (assertions.length === 0) return { ok: false, reason: "no-provider-assertions-provided", ...empty };

  const byProvider = new Map<string, ProviderAssertion>();
  for (const assertion of assertions) byProvider.set(assertion.providerId, assertion);

  const findings: ReconciliationFinding[] = [];
  const decisions: AuthorityDecision[] = [];
  const unverifiableReasons = new Set<AuthorityUnverifiableReason>();

  for (const grant of grants) {
    const decision = evaluateGrant(grant, byProvider.get(grant.providerId), at);
    decisions.push(decision);
    if (decision.verdict === "unverifiable") {
      unverifiableReasons.add(decision.reason);
      continue;
    }
    if (decision.verdict === "denied") {
      const kind: ReconciliationFindingKind =
        decision.reason === "revoked-upstream" ? "revoked-upstream" : decision.reason === "not-backed" ? "unbacked-grant" : "expired-grant";
      findings.push({
        kind,
        grantId: grant.grantId,
        actorId: grant.actorId,
        subjectId: grant.subjectId,
        providerId: grant.providerId,
        message: RECONCILIATION_MESSAGES[kind],
      });
    }
  }

  const unverifiableGrants = decisions.filter((decision) => decision.verdict === "unverifiable").length;
  const result = {
    grantsChecked: grants.length,
    providersChecked: assertions.length,
    unreconciledGrantSurface: findings.length,
    unverifiableGrants,
    findings,
    decisions,
  };

  if (unverifiableReasons.size > 0) {
    // Indeterminate beats violated: see this function's own doc comment.
    const reason: ReconciliationFailureReason = unverifiableReasons.has("provider-unreachable")
      ? "provider-unreachable"
      : unverifiableReasons.has("unreadable-clock")
        ? "unreadable-clock"
        : "provider-not-observed";
    return { ok: false, reason, ...result };
  }
  if (findings.length > 0) return { ok: false, reason: "unreconciled-grants", ...result };
  return { ok: true, ...result };
}

// ------------------------------------------------------ gate 2: delegation ceiling

export type DelegationFindingKind =
  /** No `monetaryLimitAmount` field at all: nobody decided. Never read as unlimited. */
  | "no-declared-ceiling"
  /** An explicit `null` ceiling with no explicit statement that it is deliberate. */
  | "undeclared-unlimited-ceiling"
  /** A ceiling amount with no currency: a number nobody can compare a spend against. */
  | "ceiling-without-currency"
  /** A currency with no ceiling amount: a unit with nothing to measure. */
  | "currency-without-ceiling"
  /** No responsible human: an actor nobody answers for. */
  | "no-responsible-human"
  /** No tool scope at all: an actor whose bounds were never stated. */
  | "empty-tool-scope";

export interface DelegationFinding {
  kind: DelegationFindingKind;
  agentIdentityId: string;
  /** Who answers for this actor, when there is anybody. Never merged with `subjectId`. */
  responsibleHumanId?: string;
  /** Whose behalf the actor acts on, when the consumer declared one. Never merged with `responsibleHumanId`. */
  subjectId?: string;
  message: string;
}

export type DelegationFailureReason = "unbounded-delegation" | "no-actors-provided";

export interface DelegationCeilingResult {
  ok: boolean;
  reason?: DelegationFailureReason;
  actorsChecked: number;
  findings: DelegationFinding[];
}

/**
 * GATE 2 — a machine actor with no declared spend ceiling is a finding, never
 * an unlimited default.
 *
 * The donor's runtime guard, `assertAgentMonetaryAuthority` in `./agent`,
 * reads `monetaryLimitAmount === null` as UNLIMITED amount authority and
 * proceeds. That is a defensible runtime behaviour and this gate does not ask
 * it to change: at the moment of a call there is nothing useful to do with a
 * number nobody declared except refuse every actor that has none, which would
 * strand actors that legitimately have no monetary surface at all.
 *
 * It is also precisely the state that must not survive review unnoticed, and
 * review is where this gate runs. So the two disagree on purpose, at
 * different times, about different questions. The runtime asks "may this call
 * proceed?"; the gate asks "did anybody ever decide what this actor may
 * spend?" — and treats silence as a finding rather than as consent.
 *
 * The three distinguishable states of `monetaryLimitAmount` and what each
 * produces:
 *
 *   a number  — a declared ceiling. Clean (given a currency to read it in).
 *   `null`    — "this actor has no monetary surface". A finding UNLESS the
 *               record also carries `unlimitedSpendIsDeclared: true`, which is
 *               the consumer saying so out loud rather than by omission.
 *   absent    — nobody decided. Always a finding; there is no opt-out for
 *               having never been asked the question.
 */
export function checkDelegationCeiling(actors: readonly DelegatedActor[]): DelegationCeilingResult {
  if (actors.length === 0) return { ok: false, reason: "no-actors-provided", actorsChecked: 0, findings: [] };

  const findings: DelegationFinding[] = [];
  const note = (actor: DelegatedActor, kind: DelegationFindingKind, message: string): void => {
    findings.push({
      kind,
      agentIdentityId: actor.agentIdentityId,
      message,
      ...(actor.responsibleHumanId ? { responsibleHumanId: actor.responsibleHumanId } : {}),
      ...(actor.subjectId === undefined ? {} : { subjectId: actor.subjectId }),
    });
  };

  for (const actor of actors) {
    const hasCeilingField = Object.hasOwn(actor, "monetaryLimitAmount");
    const ceiling = actor.monetaryLimitAmount;
    const currency = actor.monetaryLimitCurrency;

    if (!hasCeilingField || ceiling === undefined) {
      note(actor, "no-declared-ceiling", "no monetaryLimitAmount was declared at all — an undecided ceiling is not an unlimited one");
    } else if (ceiling === null && actor.unlimitedSpendIsDeclared !== true) {
      note(
        actor,
        "undeclared-unlimited-ceiling",
        "monetaryLimitAmount is null, which the runtime reads as unlimited, and nothing declares that this is deliberate",
      );
    } else if (typeof ceiling === "number" && (currency === null || currency === undefined || currency.trim().length === 0)) {
      note(actor, "ceiling-without-currency", "a ceiling amount was declared with no currency to read it in");
    }

    if (typeof ceiling !== "number" && typeof currency === "string" && currency.trim().length > 0) {
      note(actor, "currency-without-ceiling", "a currency was declared with no ceiling amount to measure against it");
    }

    if (typeof actor.responsibleHumanId !== "string" || actor.responsibleHumanId.trim().length === 0) {
      note(actor, "no-responsible-human", "no responsible human is named — this actor's authority answers to nobody");
    }

    if (!Array.isArray(actor.toolScope) || actor.toolScope.length === 0) {
      note(actor, "empty-tool-scope", "the tool scope is empty — nothing was ever stated about what this actor may do");
    }
  }

  if (findings.length > 0) return { ok: false, reason: "unbounded-delegation", actorsChecked: actors.length, findings };
  return { ok: true, actorsChecked: actors.length, findings };
}

// ------------------------------------------------------ gate 3: provider contract

export type ProviderContractFindingKind =
  /** The adapter reads a field the provider no longer declares at all. */
  | "field-not-declared"
  /** The adapter treats a field as required that the provider only declares "sometimes". */
  | "required-field-not-guaranteed"
  /** The adapter recognises an event name the provider no longer emits. */
  | "event-not-emitted"
  /** The provider emits an event the adapter does not recognise — dropped in silence. */
  | "event-not-mapped";

export interface ProviderContractFinding {
  kind: ProviderContractFindingKind;
  adapterId: string;
  providerId: string;
  /** The field path or event name this finding is about. */
  subject: string;
  message: string;
}

export type ProviderContractFailureReason =
  | "mapping-drift"
  | "no-mappings-provided"
  | "no-shapes-provided"
  /** A mapping names a provider whose declared shape was not supplied. Nothing to compare against. */
  | "shape-not-observed";

export interface ProviderContractResult {
  ok: boolean;
  reason?: ProviderContractFailureReason;
  mappingsChecked: number;
  shapesChecked: number;
  findings: ProviderContractFinding[];
}

/**
 * GATE 3 — the adapter's mapping still matches the provider's declared shape.
 *
 * An adapter is a set of assumptions about a shape this workspace does not
 * own and cannot version. When the provider moves, nothing in the adapter
 * fails: it goes on reading a field that is no longer sent, gets `undefined`,
 * and reports the event as unmappable — or, worse, stops recognising an event
 * the provider now emits and drops it silently. Both failures look exactly
 * like a quiet day.
 *
 * Both directions are checked, because the two silences are different:
 *
 *   adapter → provider  a field read or an event recognised that the provider
 *                       no longer declares. The adapter is reading air.
 *   provider → adapter  an event the provider declares and the adapter does
 *                       not recognise. The provider is talking to nobody.
 *
 * `"required-field-not-guaranteed"` is the subtler one and is the reason
 * `presence` exists at all: a field that is still declared, but only
 * `"sometimes"`, against an adapter that fails without it, is a mapping that
 * works until the first payload that omits it.
 *
 * A mapping whose provider shape was not supplied is INDETERMINATE, never
 * clean. An adapter nobody transcribed a shape for is the one most likely to
 * have drifted, and reporting it as passing is the specific fail-open this
 * package refuses.
 */
export function checkProviderContract(
  mappings: readonly AdapterMapping[],
  shapes: readonly ProviderShape[],
): ProviderContractResult {
  if (mappings.length === 0) return { ok: false, reason: "no-mappings-provided", mappingsChecked: 0, shapesChecked: shapes.length, findings: [] };
  if (shapes.length === 0) return { ok: false, reason: "no-shapes-provided", mappingsChecked: mappings.length, shapesChecked: 0, findings: [] };

  const byProvider = new Map<string, ProviderShape>();
  for (const shape of shapes) byProvider.set(shape.providerId, shape);

  const findings: ProviderContractFinding[] = [];
  let unobservedShape = false;

  for (const mapping of mappings) {
    const shape = byProvider.get(mapping.providerId);
    if (shape === undefined) {
      unobservedShape = true;
      continue;
    }
    const declaredFields = new Map(shape.fields.map((field) => [field.path, field]));
    const emitted = new Set(shape.emittedEvents);
    const recognised = new Set(mapping.recognisedEvents);

    for (const field of mapping.readsFields) {
      const declared = declaredFields.get(field.path);
      if (declared === undefined) {
        findings.push({
          kind: "field-not-declared",
          adapterId: mapping.adapterId,
          providerId: mapping.providerId,
          subject: field.path,
          message: "the adapter reads this field and the provider's declared shape no longer contains it",
        });
        continue;
      }
      if (field.required && declared.presence === "sometimes") {
        findings.push({
          kind: "required-field-not-guaranteed",
          adapterId: mapping.adapterId,
          providerId: mapping.providerId,
          subject: field.path,
          message: "the adapter requires this field and the provider only declares it as sometimes present",
        });
      }
    }

    for (const event of recognised) {
      if (!emitted.has(event)) {
        findings.push({
          kind: "event-not-emitted",
          adapterId: mapping.adapterId,
          providerId: mapping.providerId,
          subject: event,
          message: "the adapter recognises this event and the provider no longer declares that it emits it",
        });
      }
    }

    for (const event of emitted) {
      if (!recognised.has(event)) {
        findings.push({
          kind: "event-not-mapped",
          adapterId: mapping.adapterId,
          providerId: mapping.providerId,
          subject: event,
          message: "the provider declares this event and the adapter does not recognise it — it is being dropped in silence",
        });
      }
    }
  }

  const counts = { mappingsChecked: mappings.length, shapesChecked: shapes.length };
  // Same precedence as gate 1: an incomplete comparison is reported as
  // incomplete, never as a complete list of violations.
  if (unobservedShape) return { ok: false, reason: "shape-not-observed", ...counts, findings };
  if (findings.length > 0) return { ok: false, reason: "mapping-drift", ...counts, findings };
  return { ok: true, ...counts, findings };
}
