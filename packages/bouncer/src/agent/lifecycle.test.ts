/**
 * The delegated actor's lifecycle: the four states a machine actor's
 * authority can be in, and the fact that every one of them is derived from
 * the actor's own declared interval rather than from whether a caller is
 * currently holding a context object.
 *
 * A context a caller HAS is not a context that is CURRENT. Several cases
 * below hand `describeAgentLifecycleState` a well-formed context and still
 * expect a non-`"active"` answer, because that is the shape of the defect
 * this package exists to catch one level up: presence is not currency.
 *
 * The fixture is inlined here rather than imported from a shared module on
 * purpose. A fixture file under `src/` is a source file: it would compile
 * into `dist/`, ship, and eventually be depended on by somebody. Every value
 * in it is a placeholder — no real actor, tool, model or ceiling of this
 * workspace's own appears anywhere in this package.
 */
import { describe, expect, it } from "vitest";
import { describeAgentLifecycleState, isAgentContextActive } from "./index.js";
import type { GenericAgentContext } from "./index.js";

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

  it("treats an unreadable clock as expired rather than as active", () => {
    // The clock is an input like any other. A `now` this cannot read is not a
    // reason to let a delegated actor proceed — it is a reason to stop.
    expect(describeAgentLifecycleState(makeAgent(), "whenever")).toBe("expired");
    expect(describeAgentLifecycleState(makeAgent(), new Date(Number.NaN))).toBe("expired");
  });

  it("reports revoked ahead of every other state, including an interval that has not opened yet", () => {
    const revokedAndFuture = makeAgent({ revokedAt: NOW, validFrom: "2099-01-01T00:00:00.000Z" });
    expect(describeAgentLifecycleState(revokedAndFuture, NOW)).toBe("revoked");
  });
});
