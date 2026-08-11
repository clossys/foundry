import { describe, expect, it } from "vitest";
import {
  AgentAuthorizationError,
  assertAgentCanCall,
  assertAgentMonetaryAuthority,
  describeAgentLifecycleState,
  isAgentContextActive,
} from "./index.js";
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

describe("agent lifecycle", () => {
  it("accepts a current context and rejects absent, future, expired, revoked, and malformed contexts", () => {
    expect(describeAgentLifecycleState(null, NOW)).toBeNull();
    expect(isAgentContextActive(null, NOW)).toBe(false);
    expect(describeAgentLifecycleState(makeAgent({ validFrom: NOW }), NOW)).toBe("active");
    expect(describeAgentLifecycleState(makeAgent({ validFrom: "2030-06-16T00:00:00.000Z" }), NOW)).toBe("not_yet_active");
    expect(describeAgentLifecycleState(makeAgent({ validTo: NOW }), NOW)).toBe("expired");
    expect(describeAgentLifecycleState(makeAgent({ revokedAt: NOW }), NOW)).toBe("revoked");
    expect(isAgentContextActive(makeAgent({ validFrom: "not-a-date" }), NOW)).toBe(false);
    expect(isAgentContextActive(makeAgent(), "2030-06-15T12:00:00")).toBe(false);
  });
});

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
});
