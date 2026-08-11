import type { AgentLifecycleState, GenericAgentContext } from "./types.js";

type AgentContextLike = GenericAgentContext<string, string, Record<string, unknown>>;

function toInstant(value: Date | string | null | undefined): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.valueOf()) ? null : value;
  }

  if (typeof value !== "string") return null;

  const instant = new Date(value);
  return Number.isNaN(instant.valueOf()) ? null : instant;
}

export function describeAgentLifecycleState(
  agent: AgentContextLike | null | undefined,
  now: Date | string = new Date(),
): AgentLifecycleState | null {
  if (agent === null || agent === undefined) return null;

  if (agent.revokedAt !== null) return "revoked";

  const currentTime = toInstant(now);
  if (currentTime === null) return "expired";

  if (agent.validFrom !== null) {
    const validFrom = toInstant(agent.validFrom);
    if (validFrom === null || currentTime < validFrom) return "not_yet_active";
  }

  if (agent.validTo !== null) {
    const validTo = toInstant(agent.validTo);
    if (validTo === null || currentTime >= validTo) return "expired";
  }

  return "active";
}

export function isAgentContextActive(agent: AgentContextLike | null | undefined, now: Date | string = new Date()): boolean {
  return describeAgentLifecycleState(agent, now) === "active";
}
