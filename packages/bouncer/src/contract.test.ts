/**
 * The runtime verdict and the three gates, tested against plain values with
 * no filesystem involved — every checker here is pure, so every one of its
 * decisions can be observed directly rather than inferred from an exit code.
 *
 * THE CASE THIS FILE EXISTS FOR
 * ------------------------------
 * "a well-formed session exists while the role behind it was revoked upstream
 * an hour ago" is written out below, as an explicit test, with the session
 * present and valid throughout. A tool that checks for a session passes it.
 * This one does not, and the difference is a comparison against the provider.
 */
import { describe, expect, it } from "vitest";
import { checkAuthorityReconciliation, checkDelegationCeiling, checkProviderContract, evaluateGrant } from "./contract.js";
import type { AdapterMapping, DelegatedActor, Grant, ProviderAssertion, ProviderShape } from "./schema.js";

const AT = "2026-08-22T12:00:00.000Z";

function grant(overrides: Partial<Grant> = {}): Grant {
  return {
    grantId: "grant-1",
    actorId: "actor-1",
    subjectId: "subject-1",
    providerId: "provider-a",
    authority: "records.read",
    grantedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function reachable(overrides: Partial<ProviderAssertion> = {}): ProviderAssertion {
  return {
    providerId: "provider-a",
    reachability: "reachable",
    observedAt: AT,
    backs: [{ actorId: "actor-1", subjectId: "subject-1", authority: "records.read", status: "active", confirmedAt: AT }],
    ...overrides,
  };
}

const unreachable: ProviderAssertion = {
  providerId: "provider-a",
  reachability: "unreachable",
  observedAt: AT,
  unreachableReason: "the provider's identity API did not respond",
};

function actor(overrides: Partial<DelegatedActor> = {}): DelegatedActor {
  return {
    agentIdentityId: "agent-1",
    agentKind: "automation",
    displayName: "Example automation",
    toolScope: ["records.read"],
    monetaryLimitAmount: 250,
    monetaryLimitCurrency: "USD",
    responsibleHumanId: "operator-1",
    validFrom: null,
    validTo: null,
    revokedAt: null,
    ...overrides,
  };
}

function mapping(overrides: Partial<AdapterMapping> = {}): AdapterMapping {
  return {
    adapterId: "adapter-a",
    providerId: "provider-a",
    recognisedEvents: ["membership.created"],
    readsFields: [{ path: "data.id", required: true }],
    ...overrides,
  };
}

function shape(overrides: Partial<ProviderShape> = {}): ProviderShape {
  return {
    providerId: "provider-a",
    declaredAt: AT,
    emittedEvents: ["membership.created"],
    fields: [{ path: "data.id", presence: "always" }],
    ...overrides,
  };
}

describe("evaluateGrant — the ternary", () => {
  it("authorizes only a grant the provider still backs", () => {
    const decision = evaluateGrant(grant(), reachable(), AT);
    expect(decision.verdict).toBe("authorized");
    expect(decision).toMatchObject({ actorId: "actor-1", subjectId: "subject-1", providerId: "provider-a" });
  });

  it("denies a grant the provider reports revoked — the whole adversarial case, with the session intact", () => {
    // The grant carries a session id the entire time. It is well-formed, it is
    // present, and a tool that checks for a session passes here. The provider
    // says the authority behind it is gone, so this does not.
    const live = grant({ sessionId: "sess-still-valid" });
    const provider = reachable({
      backs: [{ actorId: "actor-1", subjectId: "subject-1", authority: "records.read", status: "revoked", confirmedAt: AT }],
    });
    const decision = evaluateGrant(live, provider, AT);
    expect(decision).toMatchObject({ verdict: "denied", reason: "revoked-upstream" });
  });

  it("denies a grant the provider does not back at all", () => {
    expect(evaluateGrant(grant(), reachable({ backs: [] }), AT)).toMatchObject({ verdict: "denied", reason: "not-backed" });
  });

  it("matches on actor, subject AND authority — never on the actor alone", () => {
    const otherSubject = reachable({
      backs: [{ actorId: "actor-1", subjectId: "subject-2", authority: "records.read", status: "active", confirmedAt: AT }],
    });
    expect(evaluateGrant(grant(), otherSubject, AT)).toMatchObject({ verdict: "denied", reason: "not-backed" });

    const otherAuthority = reachable({
      backs: [{ actorId: "actor-1", subjectId: "subject-1", authority: "records.write", status: "active", confirmedAt: AT }],
    });
    expect(evaluateGrant(grant(), otherAuthority, AT)).toMatchObject({ verdict: "denied", reason: "not-backed" });
  });

  it("denies a grant past its own declared expiry, even while the provider still backs it", () => {
    const expired = grant({ expiresAt: "2026-08-20T00:00:00.000Z" });
    expect(evaluateGrant(expired, reachable(), AT)).toMatchObject({ verdict: "denied", reason: "grant-expired" });
  });

  it("reports an unreachable provider as unverifiable, never as a denial and never as a pass", () => {
    const decision = evaluateGrant(grant(), unreachable, AT);
    expect(decision).toMatchObject({ verdict: "unverifiable", reason: "provider-unreachable" });
  });

  it("reports a missing observation as unverifiable rather than convenient", () => {
    expect(evaluateGrant(grant(), undefined, AT)).toMatchObject({ verdict: "unverifiable", reason: "provider-not-observed" });
  });

  it("refuses an observation of a different provider rather than reading it as this one's answer", () => {
    expect(evaluateGrant(grant(), reachable({ providerId: "provider-b" }), AT)).toMatchObject({
      verdict: "unverifiable",
      reason: "provider-mismatch",
    });
  });

  it("reports an unreadable clock as unverifiable, on either side", () => {
    expect(evaluateGrant(grant(), reachable(), "whenever")).toMatchObject({ verdict: "unverifiable", reason: "unreadable-clock" });
    expect(evaluateGrant(grant({ expiresAt: "soon" }), reachable(), AT)).toMatchObject({
      verdict: "unverifiable",
      reason: "unreadable-clock",
    });
  });

  it("settles reachability before anything else, so an outage never produces a denial", () => {
    // An unreachable provider carries no `backs` at all. If reachability were
    // checked after the backing lookup, this would come back "not-backed" — an
    // outage reported as a revocation.
    const expiredDuringOutage = grant({ expiresAt: "2026-08-20T00:00:00.000Z" });
    expect(evaluateGrant(expiredDuringOutage, unreachable, AT)).toMatchObject({ verdict: "unverifiable" });
  });

  it("reports the upstream revocation ahead of a local expiry when both apply", () => {
    const both = grant({ expiresAt: "2026-08-20T00:00:00.000Z" });
    const provider = reachable({
      backs: [{ actorId: "actor-1", subjectId: "subject-1", authority: "records.read", status: "revoked", confirmedAt: AT }],
    });
    expect(evaluateGrant(both, provider, AT)).toMatchObject({ reason: "revoked-upstream" });
  });
});

describe("checkAuthorityReconciliation", () => {
  it("is satisfied when every live grant traces to a provider that still backs it", () => {
    const result = checkAuthorityReconciliation([grant()], [reachable()], AT);
    expect(result.ok).toBe(true);
    expect(result.unreconciledGrantSurface).toBe(0);
    expect(result.unverifiableGrants).toBe(0);
  });

  it("is violated, and counts the surface, when a grant is revoked upstream", () => {
    const provider = reachable({
      backs: [{ actorId: "actor-1", subjectId: "subject-1", authority: "records.read", status: "revoked", confirmedAt: AT }],
    });
    const result = checkAuthorityReconciliation([grant({ sessionId: "sess-still-valid" })], [provider], AT);
    expect(result).toMatchObject({ ok: false, reason: "unreconciled-grants", unreconciledGrantSurface: 1 });
    expect(result.findings[0]).toMatchObject({ kind: "revoked-upstream", actorId: "actor-1", subjectId: "subject-1" });
  });

  it("is indeterminate — not violated — when a provider could not be reached", () => {
    const result = checkAuthorityReconciliation([grant()], [unreachable], AT);
    expect(result).toMatchObject({ ok: false, reason: "provider-unreachable", unverifiableGrants: 1 });
    expect(result.findings).toHaveLength(0);
  });

  it("reports indeterminate over violated when both are present, because the finding list is known to be incomplete", () => {
    const revoked = reachable({
      providerId: "provider-a",
      backs: [{ actorId: "actor-1", subjectId: "subject-1", authority: "records.read", status: "revoked", confirmedAt: AT }],
    });
    const result = checkAuthorityReconciliation(
      [grant(), grant({ grantId: "grant-2", providerId: "provider-b" })],
      [revoked, { ...unreachable, providerId: "provider-b" }],
      AT,
    );
    expect(result.reason).toBe("provider-unreachable");
    // The violation it DID find is still reported, so nothing is hidden — it
    // is the exit code that refuses to call the list complete. Pinned as the
    // actual finding, not merely a count: a refactor that emptied the list
    // while keeping the number would pass a count-only assertion.
    expect(result.unreconciledGrantSurface).toBe(1);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ kind: "revoked-upstream", grantId: "grant-1", actorId: "actor-1", subjectId: "subject-1" });
    // And the blind half is counted separately, so a reader can see that one
    // grant was judged and one was not.
    expect(result.unverifiableGrants).toBe(1);
  });

  it("keeps reporting indeterminate however the mix is ordered, so the answer never depends on input order", () => {
    // The precedence has to come from the reasons themselves, not from
    // whichever grant happened to be evaluated last. Both orderings, one answer.
    const revoked = reachable({
      backs: [{ actorId: "actor-1", subjectId: "subject-1", authority: "records.read", status: "revoked", confirmedAt: AT }],
    });
    const down: ProviderAssertion = { ...unreachable, providerId: "provider-b" };
    const violationFirst = checkAuthorityReconciliation(
      [grant(), grant({ grantId: "grant-2", providerId: "provider-b" })],
      [revoked, down],
      AT,
    );
    const blindFirst = checkAuthorityReconciliation(
      [grant({ grantId: "grant-2", providerId: "provider-b" }), grant()],
      [down, revoked],
      AT,
    );
    expect(violationFirst.reason).toBe("provider-unreachable");
    expect(blindFirst.reason).toBe("provider-unreachable");
    expect(blindFirst.unreconciledGrantSurface).toBe(1);
  });

  it("reports indeterminate over violated for an UNOBSERVED provider too, not only an unreachable one", () => {
    // `provider-not-observed` is the quieter of the two indeterminate reasons
    // and the one most likely to be dropped by mistake, because nothing failed
    // — somebody simply did not supply an observation. It must still beat a
    // real violation found elsewhere in the same run.
    const revoked = reachable({
      backs: [{ actorId: "actor-1", subjectId: "subject-1", authority: "records.read", status: "revoked", confirmedAt: AT }],
    });
    const result = checkAuthorityReconciliation([grant(), grant({ grantId: "grant-2", providerId: "provider-z" })], [revoked], AT);
    expect(result.reason).toBe("provider-not-observed");
    expect(result.unreconciledGrantSurface).toBe(1);
  });

  it("is indeterminate when a grant names a provider nobody observed", () => {
    const result = checkAuthorityReconciliation([grant({ providerId: "provider-z" })], [reachable()], AT);
    expect(result).toMatchObject({ ok: false, reason: "provider-not-observed" });
  });

  it("is indeterminate with nothing to reconcile, and with nothing to reconcile against", () => {
    expect(checkAuthorityReconciliation([], [reachable()], AT)).toMatchObject({ ok: false, reason: "no-grants-provided" });
    expect(checkAuthorityReconciliation([grant()], [], AT)).toMatchObject({ ok: false, reason: "no-provider-assertions-provided" });
  });

  it("is indeterminate when the clock it was handed cannot be ordered", () => {
    expect(checkAuthorityReconciliation([grant()], [reachable()], "whenever")).toMatchObject({ ok: false, reason: "unreadable-clock" });
  });

  it("returns one decision per grant, so a caller can act per grant rather than per run", () => {
    const result = checkAuthorityReconciliation([grant(), grant({ grantId: "grant-2" })], [reachable()], AT);
    expect(result.decisions).toHaveLength(2);
  });
});

describe("checkDelegationCeiling", () => {
  it("is satisfied for a bounded, attributable actor", () => {
    expect(checkDelegationCeiling([actor()])).toMatchObject({ ok: true, actorsChecked: 1 });
  });

  it("finds an actor with no declared ceiling at all — never an unlimited default", () => {
    const { monetaryLimitAmount: _amount, monetaryLimitCurrency: _currency, ...undecided } = actor();
    const result = checkDelegationCeiling([undecided]);
    expect(result).toMatchObject({ ok: false, reason: "unbounded-delegation" });
    expect(result.findings.map((finding) => finding.kind)).toContain("no-declared-ceiling");
  });

  it("finds an explicit null ceiling that nothing declares deliberate", () => {
    const result = checkDelegationCeiling([actor({ monetaryLimitAmount: null, monetaryLimitCurrency: null })]);
    expect(result.findings.map((finding) => finding.kind)).toContain("undeclared-unlimited-ceiling");
  });

  it("accepts an explicit null ceiling once the consumer says out loud that it is deliberate", () => {
    const declared = actor({ monetaryLimitAmount: null, monetaryLimitCurrency: null, unlimitedSpendIsDeclared: true });
    expect(checkDelegationCeiling([declared]).ok).toBe(true);
  });

  it("has no opt-out for an ABSENT ceiling — you cannot declare deliberate a question nobody asked", () => {
    const { monetaryLimitAmount: _amount, monetaryLimitCurrency: _currency, ...undecided } = actor();
    const result = checkDelegationCeiling([{ ...undecided, unlimitedSpendIsDeclared: true }]);
    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.kind)).toContain("no-declared-ceiling");
  });

  it("finds an amount with no currency, and a currency with no amount", () => {
    expect(checkDelegationCeiling([actor({ monetaryLimitCurrency: null })]).findings.map((f) => f.kind)).toContain("ceiling-without-currency");
    expect(
      checkDelegationCeiling([actor({ monetaryLimitAmount: null, monetaryLimitCurrency: "USD", unlimitedSpendIsDeclared: true })]).findings.map(
        (f) => f.kind,
      ),
    ).toContain("currency-without-ceiling");
  });

  it("finds an actor nobody answers for, and one whose bounds were never stated", () => {
    const { responsibleHumanId: _responsible, ...unattributable } = actor();
    expect(checkDelegationCeiling([unattributable]).findings.map((f) => f.kind)).toContain("no-responsible-human");
    expect(checkDelegationCeiling([actor({ responsibleHumanId: "  " })]).findings.map((f) => f.kind)).toContain("no-responsible-human");
    expect(checkDelegationCeiling([actor({ toolScope: [] })]).findings.map((f) => f.kind)).toContain("empty-tool-scope");
    const { toolScope: _scope, ...unscoped } = actor();
    expect(checkDelegationCeiling([unscoped]).findings.map((f) => f.kind)).toContain("empty-tool-scope");
  });

  it("keeps the responsible human and the subject apart in the finding itself", () => {
    const result = checkDelegationCeiling([actor({ toolScope: [], subjectId: "subject-1" })]);
    expect(result.findings[0]).toMatchObject({ responsibleHumanId: "operator-1", subjectId: "subject-1" });
  });

  it("is indeterminate with no actors at all, rather than reporting a clean run over nothing", () => {
    expect(checkDelegationCeiling([])).toMatchObject({ ok: false, reason: "no-actors-provided" });
  });

  it("has no mixed indeterminate-and-violated state to resolve, and this pins why", () => {
    // Gates 1 and 3 each need an explicit precedence rule, because one run of
    // either can be partly blind and partly conclusive. This gate cannot be:
    // its only indeterminate reason is `no-actors-provided`, which requires an
    // empty input, and an empty input can produce no findings. There is
    // nothing to order.
    //
    // So rather than a mixed-case test that could never fail, this pins the
    // structural fact the absence rests on. If a future indeterminate reason is
    // added that CAN coexist with a finding, this breaks, and the precedence
    // question has to be answered deliberately instead of by default.
    const empty = checkDelegationCeiling([]);
    expect(empty.reason).toBe("no-actors-provided");
    expect(empty.findings).toHaveLength(0);
    expect(empty.actorsChecked).toBe(0);

    // And every non-empty input resolves to exactly one of clean or violated —
    // never to an indeterminate reason alongside findings.
    const { monetaryLimitAmount: _amount, monetaryLimitCurrency: _currency, ...undecided } = actor();
    expect(checkDelegationCeiling([actor()]).reason).toBeUndefined();
    expect(checkDelegationCeiling([undecided]).reason).toBe("unbounded-delegation");
    expect(checkDelegationCeiling([actor(), undecided]).reason).toBe("unbounded-delegation");
  });
});

describe("checkProviderContract", () => {
  it("is satisfied when the mapping and the declared shape agree in both directions", () => {
    expect(checkProviderContract([mapping()], [shape()])).toMatchObject({ ok: true });
  });

  it("finds a field the adapter reads that the provider no longer declares", () => {
    const result = checkProviderContract([mapping({ readsFields: [{ path: "data.legacy_id", required: true }] })], [shape()]);
    expect(result).toMatchObject({ ok: false, reason: "mapping-drift" });
    expect(result.findings.map((finding) => finding.kind)).toContain("field-not-declared");
  });

  it("finds a required field the provider only sometimes sends — the mapping that works until it does not", () => {
    const sometimes = shape({ fields: [{ path: "data.id", presence: "sometimes" }] });
    const result = checkProviderContract([mapping()], [sometimes]);
    expect(result.findings.map((finding) => finding.kind)).toContain("required-field-not-guaranteed");
  });

  it("accepts an optional field the provider only sometimes sends", () => {
    const sometimes = shape({ fields: [{ path: "data.id", presence: "sometimes" }] });
    expect(checkProviderContract([mapping({ readsFields: [{ path: "data.id", required: false }] })], [sometimes]).ok).toBe(true);
  });

  it("finds an event the adapter recognises that the provider no longer emits", () => {
    const result = checkProviderContract([mapping({ recognisedEvents: ["membership.created", "membership.retired"] })], [shape()]);
    expect(result.findings.map((finding) => finding.kind)).toContain("event-not-emitted");
  });

  it("finds an event the provider emits that the adapter drops in silence", () => {
    const result = checkProviderContract([mapping()], [shape({ emittedEvents: ["membership.created", "membership.deleted"] })]);
    expect(result.findings.map((finding) => finding.kind)).toContain("event-not-mapped");
  });

  it("is indeterminate — not clean — for a mapping whose provider shape was never supplied", () => {
    const result = checkProviderContract([mapping(), mapping({ adapterId: "adapter-b", providerId: "provider-z" })], [shape()]);
    expect(result).toMatchObject({ ok: false, reason: "shape-not-observed" });
  });

  it("reports indeterminate over drift when both are present, and still returns the drift it did find", () => {
    // Gate 3 has the same mixed state gate 1 does, and needs the same
    // precedence: one mapping drifted, another was never compared at all, so
    // the finding list is known to be incomplete. Reporting `1` here would
    // present a partially-blind run as a completed check.
    const drifted = mapping({ readsFields: [{ path: "data.legacy_id", required: true }] });
    const uncompared = mapping({ adapterId: "adapter-b", providerId: "provider-z" });
    const result = checkProviderContract([drifted, uncompared], [shape()]);
    expect(result.reason).toBe("shape-not-observed");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ kind: "field-not-declared", adapterId: "adapter-a", subject: "data.legacy_id" });
  });

  it("keeps that answer whichever order the mappings arrive in", () => {
    const drifted = mapping({ readsFields: [{ path: "data.legacy_id", required: true }] });
    const uncompared = mapping({ adapterId: "adapter-b", providerId: "provider-z" });
    expect(checkProviderContract([uncompared, drifted], [shape()]).reason).toBe("shape-not-observed");
    expect(checkProviderContract([drifted, uncompared], [shape()]).reason).toBe("shape-not-observed");
  });

  it("is indeterminate with nothing to check, and with nothing to check against", () => {
    expect(checkProviderContract([], [shape()])).toMatchObject({ ok: false, reason: "no-mappings-provided" });
    expect(checkProviderContract([mapping()], [])).toMatchObject({ ok: false, reason: "no-shapes-provided" });
  });

  it("names the adapter, the provider and the exact subject on every finding", () => {
    const result = checkProviderContract([mapping({ readsFields: [{ path: "data.legacy_id", required: true }] })], [shape()]);
    expect(result.findings[0]).toMatchObject({ adapterId: "adapter-a", providerId: "provider-a", subject: "data.legacy_id" });
  });
});
