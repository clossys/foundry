/**
 * `AgentAuthorizationError` — the shape a denial takes when it leaves this
 * package.
 *
 * A denial has to carry three things a caller cannot re-derive after the
 * fact: WHICH actor, WHICH tool, and WHY, as a stable code rather than as
 * prose. The reason codes are a closed set precisely so a consumer can branch
 * on them and record them; a message string that happens to read differently
 * between versions is not something anyone can build on.
 */
import { describe, expect, it } from "vitest";
import { AgentAuthorizationError } from "./index.js";
import type { AgentAuthorizationFailureReason } from "./index.js";

const REASONS: readonly AgentAuthorizationFailureReason[] = [
  "agent_revoked",
  "agent_not_yet_active",
  "agent_expired",
  "tool_not_in_scope",
  "monetary_limit_exceeded",
];

describe("AgentAuthorizationError", () => {
  it("is a real Error, so an existing catch site and stack trace keep working", () => {
    const error = new AgentAuthorizationError("agent_revoked", "agent-example", "records.read");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AgentAuthorizationError");
    expect(typeof error.stack).toBe("string");
  });

  it("carries a distinct default message for every reason in the closed set", () => {
    const messages = REASONS.map((reason) => new AgentAuthorizationError(reason, "agent-example", "records.read").message);
    expect(messages.every((message) => message.length > 0)).toBe(true);
    expect(new Set(messages).size).toBe(REASONS.length);
  });

  it("keeps the actor and the tool as separate identifiers, never merged into one", () => {
    const error = new AgentAuthorizationError("tool_not_in_scope", "agent-example", "payments.create");
    expect(error.agentIdentityId).toBe("agent-example");
    expect(error.toolId).toBe("payments.create");
  });

  it("accepts a null tool, for a denial that is about the actor rather than about one call", () => {
    const error = new AgentAuthorizationError("agent_expired", "agent-example", null);
    expect(error.toolId).toBeNull();
  });

  it("lets a caller override the message without losing the machine-readable reason", () => {
    const error = new AgentAuthorizationError("agent_revoked", "<missing>", "records.read", "The agent context is missing.");
    expect(error.message).toBe("The agent context is missing.");
    expect(error.reason).toBe("agent_revoked");
  });
});
