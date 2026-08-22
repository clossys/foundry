/**
 * `assertAgentCanCall` and `assertAgentMonetaryAuthority` — the runtime half
 * of "is what they are doing still inside what they were granted?" for a
 * delegated machine actor.
 *
 * Note what the last case pins, because it is the reason this package ships a
 * `delegation-ceiling` gate at all: a `monetaryLimitAmount` of `null` is
 * accepted here as UNLIMITED amount authority. That is a defensible runtime
 * behaviour — the runtime cannot invent a number the operator never declared,
 * and refusing every call would strand actors that legitimately have no
 * monetary surface. It is also exactly the state that must never survive a
 * review unnoticed, which is a different question from the one this file
 * answers and is asked instead by `checkDelegationCeiling` in `../contract.ts`
 * and by `bouncer-check delegation-ceiling`.
 */
import { describe, expect, it } from "vitest";
import { AgentAuthorizationError, assertAgentCanCall, assertAgentMonetaryAuthority } from "./index.js";
import type { AgentAuthorizationFailureReason, GenericAgentContext } from "./index.js";

type ToolId = "records.read" | "payments.create";

const NOW = "2030-06-15T12:00:00.000Z";

function makeAgent(overrides: Partial<GenericAgentContext<ToolId, "automation">> = {}): GenericAgentContext<ToolId, "automation"> {
  return {
    agentIdentityId: "agent-example",
    agentKind: "automation",
    displayName: "Example automation",
    modelProvider: "example-provider",
    modelId: "example-model",
    modelVersion: "1",
    systemPromptHash: "sha256:example",
    toolScope: ["records.read", "payments.create"],
    monetaryLimitAmount: 250,
    monetaryLimitCurrency: "USD",
    responsibleHumanId: "operator-example",
    validFrom: "2000-01-01T00:00:00.000Z",
    validTo: "2100-01-01T00:00:00.000Z",
    revokedAt: null,
    revokedReason: null,
    ...overrides,
  };
}

function expectAuthorizationFailure(callback: () => void, reason: AgentAuthorizationFailureReason): void {
  try {
    callback();
    throw new Error("Expected an AgentAuthorizationError");
  } catch (error) {
    expect(error).toBeInstanceOf(AgentAuthorizationError);
    expect((error as AgentAuthorizationError).reason).toBe(reason);
  }
}

describe("agent authorization", () => {
  it("allows only a current agent whose requested tool is in scope", () => {
    expect(() => assertAgentCanCall(makeAgent(), "records.read", NOW)).not.toThrow();
    expectAuthorizationFailure(() => assertAgentCanCall(null, "records.read", NOW), "agent_revoked");
    expectAuthorizationFailure(() => assertAgentCanCall(makeAgent({ revokedAt: NOW }), "records.read", NOW), "agent_revoked");
    expectAuthorizationFailure(
      () => assertAgentCanCall(makeAgent({ toolScope: ["records.read"] }), "payments.create", NOW),
      "tool_not_in_scope",
    );
  });

  it("enforces lifecycle and tool scope before an unlimited or limited monetary assertion", () => {
    expect(() => assertAgentMonetaryAuthority(makeAgent(), 250, "USD", "payments.create", NOW)).not.toThrow();
    expect(() => assertAgentMonetaryAuthority(
      makeAgent({ monetaryLimitAmount: null, monetaryLimitCurrency: null }),
      1,
      "USD",
      "payments.create",
      NOW,
    )).not.toThrow();

    const unlimited = { monetaryLimitAmount: null, monetaryLimitCurrency: null } as const;
    expectAuthorizationFailure(
      () => assertAgentMonetaryAuthority(makeAgent({ ...unlimited, revokedAt: NOW }), 1, "USD", "payments.create", NOW),
      "agent_revoked",
    );
    expectAuthorizationFailure(
      () => assertAgentMonetaryAuthority(makeAgent({ ...unlimited, toolScope: ["records.read"] }), 1, "USD", "payments.create", NOW),
      "tool_not_in_scope",
    );
    expectAuthorizationFailure(
      () => assertAgentMonetaryAuthority(makeAgent(), 250.01, "USD", "payments.create", NOW),
      "monetary_limit_exceeded",
    );
    expectAuthorizationFailure(
      () => assertAgentMonetaryAuthority(makeAgent(), 1, "EUR", "payments.create", NOW),
      "monetary_limit_exceeded",
    );
  });

  it("rejects a malformed requested amount as a caller error, not as a denial", () => {
    // A `TypeError` and an `AgentAuthorizationError` are deliberately
    // different: "you asked me something I cannot evaluate" is not the same
    // answer as "the actor may not do this", and collapsing them would let a
    // programming mistake be logged as a policy decision.
    expect(() => assertAgentMonetaryAuthority(makeAgent(), Number.NaN, "USD", "payments.create", NOW)).toThrow(TypeError);
    expect(() => assertAgentMonetaryAuthority(makeAgent(), -1, "USD", "payments.create", NOW)).toThrow(TypeError);
  });

  it("names the actor and the tool on every denial, so a record can say who was refused what", () => {
    try {
      assertAgentCanCall(makeAgent({ revokedAt: NOW }), "records.read", NOW);
      throw new Error("Expected an AgentAuthorizationError");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentAuthorizationError);
      expect((error as AgentAuthorizationError).agentIdentityId).toBe("agent-example");
      expect((error as AgentAuthorizationError).toolId).toBe("records.read");
    }
  });
});
