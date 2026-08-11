import { AgentAuthorizationError } from "./error.js";
import { describeAgentLifecycleState } from "./lifecycle.js";
import type { GenericAgentContext } from "./types.js";

export function assertAgentCanCall<
  TToolId extends string,
  TKind extends string,
  TMeta extends Record<string, unknown>,
>(
  agent: GenericAgentContext<TToolId, TKind, TMeta> | null | undefined,
  toolId: TToolId,
  now: Date | string = new Date(),
): asserts agent is GenericAgentContext<TToolId, TKind, TMeta> {
  if (agent === null || agent === undefined) {
    throw new AgentAuthorizationError(
      "agent_revoked",
      "<missing>",
      toolId,
      "The agent context is missing.",
    );
  }

  const state = describeAgentLifecycleState(agent, now);
  if (state === "revoked") {
    throw new AgentAuthorizationError("agent_revoked", agent.agentIdentityId, toolId);
  }
  if (state === "not_yet_active") {
    throw new AgentAuthorizationError("agent_not_yet_active", agent.agentIdentityId, toolId);
  }
  if (state !== "active") {
    throw new AgentAuthorizationError("agent_expired", agent.agentIdentityId, toolId);
  }

  if (!Array.isArray(agent.toolScope) || !agent.toolScope.includes(toolId)) {
    throw new AgentAuthorizationError("tool_not_in_scope", agent.agentIdentityId, toolId);
  }
}

export function assertAgentMonetaryAuthority<
  TToolId extends string,
  TKind extends string,
  TMeta extends Record<string, unknown>,
>(
  agent: GenericAgentContext<TToolId, TKind, TMeta> | null | undefined,
  amount: number,
  currency: string,
  toolId: TToolId,
  now: Date | string = new Date(),
): void {
  assertAgentCanCall(agent, toolId, now);

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
    throw new TypeError("amount must be a finite, non-negative number");
  }

  if (agent.monetaryLimitAmount === null) return;

  if (
    typeof currency !== "string" ||
    currency.length === 0 ||
    typeof agent.monetaryLimitAmount !== "number" ||
    !Number.isFinite(agent.monetaryLimitAmount) ||
    agent.monetaryLimitAmount < 0 ||
    typeof agent.monetaryLimitCurrency !== "string" ||
    agent.monetaryLimitCurrency.length === 0 ||
    agent.monetaryLimitCurrency.toUpperCase() !== currency.toUpperCase() ||
    amount > agent.monetaryLimitAmount
  ) {
    throw new AgentAuthorizationError(
      "monetary_limit_exceeded",
      agent.agentIdentityId,
      toolId,
    );
  }
}
