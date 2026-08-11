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

describe("describeAgentLifecycleState", () => {
  it("returns null for an absent context", () => {
    expect(describeAgentLifecycleState(null, NOW)).toBeNull();
    expect(isAgentContextActive(null, NOW)).toBe(false);
  });

  it("reports active contexts, including exactly at validFrom", () => {
    const agent = makeAgent({ validFrom: NOW });
    expect(describeAgentLifecycleState(agent, new Date(NOW))).toBe("active");
    expect(isAgentContextActive(agent, NOW)).toBe(true);
  });

  it("reports a context as not yet active before validFrom", () => {
    const agent = makeAgent({ validFrom: "2030-06-16T00:00:00.000Z" });
    expect(describeAgentLifecycleState(agent, NOW)).toBe("not_yet_active");
    expect(isAgentContextActive(agent, NOW)).toBe(false);
  });

  it("reports a context as expired at validTo", () => {
    const agent = makeAgent({ validTo: NOW });
    expect(describeAgentLifecycleState(agent, NOW)).toBe("expired");
    expect(isAgentContextActive(agent, NOW)).toBe(false);
  });

  it("treats any revocation record as revoked", () => {
    const agent = makeAgent({ revokedAt: "2030-06-20T00:00:00.000Z", revokedReason: "withdrawn" });
    expect(describeAgentLifecycleState(agent, NOW)).toBe("revoked");
    expect(isAgentContextActive(agent, NOW)).toBe(false);
  });

  it("fails closed when an active interval cannot be interpreted", () => {
    const malformedStart = makeAgent({ validFrom: "not-a-date" });
    const malformedEnd = makeAgent({ validTo: "not-a-date" });
    expect(describeAgentLifecycleState(malformedStart, NOW)).toBe("not_yet_active");
    expect(describeAgentLifecycleState(malformedEnd, NOW)).toBe("expired");
    expect(isAgentContextActive(makeAgent(), "not-a-date")).toBe(false);
  });

  it("rejects permissively parseable and timezone-free lifecycle strings", () => {
    expect(describeAgentLifecycleState(makeAgent({ validFrom: "0" }), NOW)).toBe("not_yet_active");
    expect(describeAgentLifecycleState(makeAgent({ validTo: "0" }), NOW)).toBe("expired");
    expect(isAgentContextActive(makeAgent(), "2030-06-15T12:00:00")).toBe(false);
    expect(isAgentContextActive(makeAgent({ validFrom: "2030-02-30T00:00:00Z" }), NOW)).toBe(false);
  });
});

describe("assertAgentCanCall", () => {
  it("permits an active context with the requested tool in scope", () => {
    expect(() => assertAgentCanCall(makeAgent(), "records.read", NOW)).not.toThrow();
  });

  it("rejects an absent context", () => {
    expectAuthorizationFailure(
      () => assertAgentCanCall(null, "records.read", NOW),
      "agent_revoked",
    );
  });

  it("rejects a context without a usable agent identity", () => {
    expectAuthorizationFailure(
      () => assertAgentCanCall(makeAgent({ agentIdentityId: "" }), "records.read", NOW),
      "agent_revoked",
    );
    expectAuthorizationFailure(
      () => assertAgentCanCall(makeAgent({ agentIdentityId: undefined as never }), "records.read", NOW),
      "agent_revoked",
    );
  });

  it("uses stable error reasons for lifecycle denials", () => {
    expectAuthorizationFailure(() => assertAgentCanCall(makeAgent({ revokedAt: NOW }), "records.read", NOW), "agent_revoked");
    expectAuthorizationFailure(
      () => assertAgentCanCall(makeAgent({ validFrom: "2030-06-16T00:00:00.000Z" }), "records.read", NOW),
      "agent_not_yet_active",
    );
    expectAuthorizationFailure(() => assertAgentCanCall(makeAgent({ validTo: NOW }), "records.read", NOW), "agent_expired");
  });

  it("rejects a tool outside the context scope", () => {
    expectAuthorizationFailure(
      () => assertAgentCanCall(makeAgent({ toolScope: ["records.read"] }), "payments.create", NOW),
      "tool_not_in_scope",
    );
  });
});

describe("assertAgentMonetaryAuthority", () => {
  it("permits an in-scope amount at or below the authorized amount", () => {
    expect(() => assertAgentMonetaryAuthority(makeAgent(), 250, "USD", "payments.create")).not.toThrow();
    expect(() => assertAgentMonetaryAuthority(makeAgent(), 0, "USD", "payments.create")).not.toThrow();
  });

  it("treats an absent configured limit as unlimited", () => {
    expect(() => assertAgentMonetaryAuthority(
      makeAgent({ monetaryLimitAmount: null, monetaryLimitCurrency: null }),
      1,
      "USD",
      "payments.create",
    )).not.toThrow();
  });

  it("always enforces lifecycle and tool scope, including for unlimited authority", () => {
    const unlimited = { monetaryLimitAmount: null, monetaryLimitCurrency: null } as const;
    expectAuthorizationFailure(
      () => assertAgentMonetaryAuthority(
        makeAgent({ ...unlimited, revokedAt: NOW }),
        1,
        "USD",
        "payments.create",
        NOW,
      ),
      "agent_revoked",
    );
    expectAuthorizationFailure(
      () => assertAgentMonetaryAuthority(
        makeAgent({ ...unlimited, toolScope: ["records.read"] }),
        1,
        "USD",
        "payments.create",
        NOW,
      ),
      "tool_not_in_scope",
    );
  });

  it("rejects an exceeded, malformed, or currency-mismatched monetary authority", () => {
    expectAuthorizationFailure(() => assertAgentMonetaryAuthority(makeAgent(), 250.01, "USD", "payments.create"), "monetary_limit_exceeded");
    expectAuthorizationFailure(() => assertAgentMonetaryAuthority(makeAgent(), 1, "EUR", "payments.create"), "monetary_limit_exceeded");
    expectAuthorizationFailure(
      () => assertAgentMonetaryAuthority(makeAgent({ monetaryLimitAmount: Number.NaN }), 1, "USD", "payments.create"),
      "monetary_limit_exceeded",
    );
  });

  it("matches currency case-insensitively", () => {
    expect(() => assertAgentMonetaryAuthority(makeAgent(), 1, "usd", "payments.create"))
      .not.toThrow();
  });

  it("rejects an invalid or negative requested amount as a caller error", () => {
    expect(() => assertAgentMonetaryAuthority(makeAgent(), -1, "USD", "payments.create")).toThrow(TypeError);
    expect(() => assertAgentMonetaryAuthority(makeAgent(), Number.NaN, "USD", "payments.create")).toThrow(TypeError);
    expect(() => assertAgentMonetaryAuthority(makeAgent(), Number.POSITIVE_INFINITY, "USD", "payments.create")).toThrow(TypeError);
  });
});
