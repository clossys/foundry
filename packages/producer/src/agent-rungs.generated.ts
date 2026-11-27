// Generated from docs/contracts/agents.rungs.json by `clossys agents check`. Do not edit: check:agent-ladder fails when this file
// differs from that render by one byte.

/** The readiness ladder, lowest rung first. */
export const AGENT_LADDER = Object.freeze(["declared","conforming","qualified","packed","looped"] as const);

/** The rung each named list needs (agents.json ladder.needs). */
export const AGENT_RUNG_NEEDS: Readonly<Record<string, string>> = Object.freeze({"install":"packed"});

/** Each agent's computed rung; null is below declared. */
export const AGENT_RUNGS: Readonly<Record<string, string | null>> = Object.freeze({
  "advisor": "declared",
  "architect": "declared",
  "bouncer": "declared",
  "builder": "declared",
  "butler": "declared",
  "controller": "declared",
  "customer": "declared",
  "designer": "declared",
  "director": "declared",
  "giver": "declared",
  "influencer": "declared",
  "inspector": "declared",
  "integrator": "declared",
  "keeper": "declared",
  "launcher": "declared",
  "locksmith": "declared",
  "messenger": "declared",
  "observer": "declared",
  "producer": "conforming",
  "publisher": "declared",
  "starter": "declared",
  "writer": "declared",
});

/** The same rungs by published package name, as a consumer's node_modules/@clossys/ holds them. */
export const AGENT_RUNGS_BY_PACKAGE: Readonly<Record<string, string | null>> = Object.freeze({
  "@clossys/advisor": "declared",
  "@clossys/architect": "declared",
  "@clossys/bouncer": "declared",
  "@clossys/builder": "declared",
  "@clossys/butler": "declared",
  "@clossys/controller": "declared",
  "@clossys/customer": "declared",
  "@clossys/designer": "declared",
  "@clossys/strategist": "declared",
  "@clossys/giver": "declared",
  "@clossys/influencer": "declared",
  "@clossys/inspector": "declared",
  "@clossys/integrator": "declared",
  "@clossys/keeper": "declared",
  "@clossys/launcher": "declared",
  "@clossys/locksmith": "declared",
  "@clossys/messenger": "declared",
  "@clossys/observer": "declared",
  "@clossys/producer": "conforming",
  "@clossys/publisher": "declared",
  "@clossys/starter": "declared",
  "@clossys/writer": "declared",
});
