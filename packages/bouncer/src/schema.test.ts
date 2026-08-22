/**
 * The record families, and the three shape decisions that carry the most
 * weight:
 *
 *   1. A provider observation's `reachability` is a field, not an inference
 *      from an empty backing list. Both halves are enforced in both
 *      directions, so a record whose two halves disagree never validates.
 *   2. A delegated actor's ABSENT spend ceiling survives validation as
 *      absent, rather than arriving at the gate as an indistinguishable
 *      `null`.
 *   3. Actor and subject are separate required fields everywhere both appear.
 *
 * Every value below is a placeholder. There is no role vocabulary, no
 * provider, no currency and no ceiling of this workspace's own anywhere in
 * this package — the consumer authors all of them.
 */
import { describe, expect, it } from "vitest";
import {
  isDelegatedActor,
  isGrant,
  isProviderAssertion,
  validateAdapterMappings,
  validateDelegatedActors,
  validateGrants,
  validateProviderAssertions,
  validateProviderShapes,
} from "./schema.js";

const grant = {
  grantId: "grant-1",
  actorId: "actor-1",
  subjectId: "subject-1",
  providerId: "provider-a",
  authority: "records.read",
  grantedAt: "2026-08-01T00:00:00.000Z",
};

const actor = {
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
};

describe("validateGrants", () => {
  it("accepts a well-formed grant and keeps actor and subject as separate fields", () => {
    const result = validateGrants([grant]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]?.actorId).toBe("actor-1");
    expect(result.value[0]?.subjectId).toBe("subject-1");
  });

  it("refuses a grant missing either identifier — one is never derived from the other", () => {
    const { actorId: _actorId, ...noActor } = grant;
    const { subjectId: _subjectId, ...noSubject } = grant;
    expect(validateGrants([noActor]).ok).toBe(false);
    expect(validateGrants([noSubject]).ok).toBe(false);
  });

  it("refuses a grant whose timestamps cannot be ordered", () => {
    expect(validateGrants([{ ...grant, grantedAt: "recently" }]).ok).toBe(false);
    expect(validateGrants([{ ...grant, expiresAt: "soon" }]).ok).toBe(false);
  });

  it("accepts a sessionId without ever making it load-bearing", () => {
    const result = validateGrants([{ ...grant, sessionId: "sess-1" }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]?.sessionId).toBe("sess-1");
  });

  it("reports the failing field's own path, not just that the record failed", () => {
    const result = validateGrants([grant, { ...grant, authority: 7 }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.path).toBe("grants[1].authority");
  });

  it("refuses a non-array outright", () => {
    expect(validateGrants({ grants: [grant] }).ok).toBe(false);
  });
});

describe("validateProviderAssertions", () => {
  it("accepts a reachable observation with an empty backing list — an empty answer is still an answer", () => {
    const result = validateProviderAssertions([
      { providerId: "provider-a", reachability: "reachable", observedAt: "2026-08-22T00:00:00.000Z", backs: [] },
    ]);
    expect(result.ok).toBe(true);
  });

  it("refuses a reachable observation with no backing list at all — that is silence dressed as an answer", () => {
    const result = validateProviderAssertions([
      { providerId: "provider-a", reachability: "reachable", observedAt: "2026-08-22T00:00:00.000Z" },
    ]);
    expect(result.ok).toBe(false);
  });

  it("requires a reason on an unreachable observation, because a decline with no reason is not reportable", () => {
    expect(
      validateProviderAssertions([{ providerId: "provider-a", reachability: "unreachable", observedAt: "2026-08-22T00:00:00.000Z" }]).ok,
    ).toBe(false);
    expect(
      validateProviderAssertions([
        { providerId: "provider-a", reachability: "unreachable", observedAt: "2026-08-22T00:00:00.000Z", unreachableReason: "timeout" },
      ]).ok,
    ).toBe(true);
  });

  it("refuses a record whose two halves disagree, in both directions", () => {
    expect(
      validateProviderAssertions([
        {
          providerId: "provider-a",
          reachability: "unreachable",
          observedAt: "2026-08-22T00:00:00.000Z",
          unreachableReason: "timeout",
          backs: [],
        },
      ]).ok,
    ).toBe(false);
    expect(
      validateProviderAssertions([
        {
          providerId: "provider-a",
          reachability: "reachable",
          observedAt: "2026-08-22T00:00:00.000Z",
          backs: [],
          unreachableReason: "timeout",
        },
      ]).ok,
    ).toBe(false);
  });

  it("refuses an unknown reachability rather than treating it as either", () => {
    expect(
      validateProviderAssertions([{ providerId: "provider-a", reachability: "degraded", observedAt: "2026-08-22T00:00:00.000Z" }]).ok,
    ).toBe(false);
  });

  it("requires a backed authority to name actor, subject and authority all three", () => {
    const backed = {
      actorId: "actor-1",
      subjectId: "subject-1",
      authority: "records.read",
      status: "active",
      confirmedAt: "2026-08-22T00:00:00.000Z",
    };
    const base = { providerId: "provider-a", reachability: "reachable" as const, observedAt: "2026-08-22T00:00:00.000Z" };
    expect(validateProviderAssertions([{ ...base, backs: [backed] }]).ok).toBe(true);
    const { subjectId: _subjectId, ...noSubject } = backed;
    expect(validateProviderAssertions([{ ...base, backs: [noSubject] }]).ok).toBe(false);
    expect(validateProviderAssertions([{ ...base, backs: [{ ...backed, status: "maybe" }] }]).ok).toBe(false);
  });
});

describe("validateDelegatedActors", () => {
  it("accepts a bounded actor", () => {
    expect(validateDelegatedActors([actor]).ok).toBe(true);
  });

  it("keeps an ABSENT ceiling absent rather than collapsing it to null", () => {
    const { monetaryLimitAmount: _amount, monetaryLimitCurrency: _currency, ...unbounded } = actor;
    const result = validateDelegatedActors([unbounded]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The distinction the gate turns on: `in` is false, not "the value is null".
    expect("monetaryLimitAmount" in (result.value[0] as object)).toBe(false);
    expect(result.value[0]?.monetaryLimitAmount).toBeUndefined();
  });

  it("keeps an explicit null ceiling as null, distinct from absent", () => {
    const result = validateDelegatedActors([{ ...actor, monetaryLimitAmount: null, monetaryLimitCurrency: null }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("monetaryLimitAmount" in (result.value[0] as object)).toBe(true);
    expect(result.value[0]?.monetaryLimitAmount).toBeNull();
  });

  it("refuses a negative ceiling and an unreadable one, rather than clamping either", () => {
    expect(validateDelegatedActors([{ ...actor, monetaryLimitAmount: -1 }]).ok).toBe(false);
    expect(validateDelegatedActors([{ ...actor, monetaryLimitAmount: "unlimited" }]).ok).toBe(false);
  });

  it("refuses a non-boolean unlimitedSpendIsDeclared — an opt-out has to be said, not implied", () => {
    expect(validateDelegatedActors([{ ...actor, unlimitedSpendIsDeclared: "yes" }]).ok).toBe(false);
    expect(validateDelegatedActors([{ ...actor, unlimitedSpendIsDeclared: true }]).ok).toBe(true);
  });

  it("keeps the responsible human and the subject as separate optional-and-required fields", () => {
    const result = validateDelegatedActors([{ ...actor, subjectId: "subject-1" }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]?.responsibleHumanId).toBe("operator-1");
    expect(result.value[0]?.subjectId).toBe("subject-1");
  });

  it("refuses an unreadable validity interval rather than treating it as open", () => {
    expect(validateDelegatedActors([{ ...actor, validTo: "eventually" }]).ok).toBe(false);
  });

  it("accepts an under-declared actor so the gate can name what is missing, instead of dying as a parse error", () => {
    const { responsibleHumanId: _responsible, toolScope: _scope, ...underDeclared } = actor;
    const result = validateDelegatedActors([underDeclared]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]?.responsibleHumanId).toBeUndefined();
    expect(result.value[0]?.toolScope).toBeUndefined();
  });

  it("still refuses a responsible human or a tool scope that is present and unreadable", () => {
    expect(validateDelegatedActors([{ ...actor, responsibleHumanId: "  " }]).ok).toBe(false);
    expect(validateDelegatedActors([{ ...actor, toolScope: "records.read" }]).ok).toBe(false);
    expect(validateDelegatedActors([{ ...actor, toolScope: [""] }]).ok).toBe(false);
  });
});

describe("validateAdapterMappings and validateProviderShapes", () => {
  it("accepts a well-formed pair", () => {
    expect(
      validateAdapterMappings([
        {
          adapterId: "adapter-a",
          providerId: "provider-a",
          recognisedEvents: ["membership.created"],
          readsFields: [{ path: "data.id", required: true }],
        },
      ]).ok,
    ).toBe(true);
    expect(
      validateProviderShapes([
        {
          providerId: "provider-a",
          declaredAt: "2026-08-22T00:00:00.000Z",
          emittedEvents: ["membership.created"],
          fields: [{ path: "data.id", presence: "always" }],
        },
      ]).ok,
    ).toBe(true);
  });

  it("refuses a mapped field with no explicit required flag — a default here would decide the finding", () => {
    expect(
      validateAdapterMappings([
        { adapterId: "adapter-a", providerId: "provider-a", recognisedEvents: [], readsFields: [{ path: "data.id" }] },
      ]).ok,
    ).toBe(false);
  });

  it("refuses an unknown field presence rather than assuming it is always sent", () => {
    expect(
      validateProviderShapes([
        {
          providerId: "provider-a",
          declaredAt: "2026-08-22T00:00:00.000Z",
          emittedEvents: [],
          fields: [{ path: "data.id", presence: "usually" }],
        },
      ]).ok,
    ).toBe(false);
  });
});

describe("the type guards", () => {
  it("answer the same question the validators do, one record at a time", () => {
    expect(isGrant(grant)).toBe(true);
    expect(isGrant({ ...grant, subjectId: "" })).toBe(false);
    expect(isDelegatedActor(actor)).toBe(true);
    expect(isDelegatedActor({})).toBe(false);
    expect(isProviderAssertion({ providerId: "p", reachability: "reachable", observedAt: "2026-08-22T00:00:00.000Z", backs: [] })).toBe(true);
    expect(isProviderAssertion(null)).toBe(false);
  });
});
