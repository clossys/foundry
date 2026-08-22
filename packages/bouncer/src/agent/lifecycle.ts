import type { AgentLifecycleState, GenericAgentContext } from "./types.js";

type AgentContextLike = GenericAgentContext<string, string, Record<string, unknown>>;

const ISO_INSTANT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (daysInMonth[month - 1] ?? 0);
}

function toInstant(value: Date | string | null | undefined): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.valueOf()) ? null : value;
  }

  if (typeof value !== "string") return null;

  const match = ISO_INSTANT_PATTERN.exec(value);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidCalendarDate(year, month, day)) return null;

  const instant = new Date(value);
  return Number.isNaN(instant.valueOf()) ? null : instant;
}

/** Classifies the lifecycle state of a delegated agent context. */
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

/** Returns true only for an unrevoked context inside a valid, parseable interval. */
export function isAgentContextActive(
  agent: AgentContextLike | null | undefined,
  now: Date | string = new Date(),
): boolean {
  return describeAgentLifecycleState(agent, now) === "active";
}
