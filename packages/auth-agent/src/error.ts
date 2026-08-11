import type { AgentAuthorizationFailureReason } from "./types.js";

const MESSAGES: Record<AgentAuthorizationFailureReason, string> = {
  agent_revoked: "The agent context has been revoked.",
  agent_not_yet_active: "The agent context is not active yet.",
  agent_expired: "The agent context has expired.",
  tool_not_in_scope: "The requested tool is not in the agent context's scope.",
  monetary_limit_exceeded: "The requested monetary authority exceeds the agent context's limit.",
};

export class AgentAuthorizationError extends Error {
  readonly reason: AgentAuthorizationFailureReason;
  readonly agentIdentityId: string;
  readonly toolId: string | null;

  constructor(
    reason: AgentAuthorizationFailureReason,
    agentIdentityId: string,
    toolId: string | null,
    message: string = MESSAGES[reason],
  ) {
    super(message);
    this.name = "AgentAuthorizationError";
    this.reason = reason;
    this.agentIdentityId = agentIdentityId;
    this.toolId = toolId;
  }
}
