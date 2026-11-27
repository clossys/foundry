/**
 * The readiness ladder as Producer's verbs show it (CP1-AGENTLADDER): each agent's computed rung, read from the
 * generated copy of docs/contracts/agents.rungs.json (`clossys agents check` writes both). `clossys status` prints the
 * installed agents' rungs; `clossys init` prints the install list (the source it, the pack script and the front door
 * read) next to the agents computed at the rung that list needs.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { AGENT_LISTS } from "./agent-lists.generated.js";
import { AGENT_LADDER, AGENT_RUNG_NEEDS, AGENT_RUNGS, AGENT_RUNGS_BY_PACKAGE } from "./agent-rungs.generated.js";

const at = (rung: string | null | undefined): number => (rung ? AGENT_LADDER.indexOf(rung as (typeof AGENT_LADDER)[number]) : -1);

/** The agent packages installed at `workspace` (node_modules/@clossys/<name>), each with its computed rung. */
export function installedRungs(workspace: string): { package: string; rung: string | null }[] {
  const scope = join(workspace, "node_modules", "@clossys");
  if (!existsSync(scope)) return [];
  return readdirSync(scope).sort().map(name => `@clossys/${name}`)
    .filter(name => Object.hasOwn(AGENT_RUNGS_BY_PACKAGE, name))
    .map(name => ({ package: name, rung: AGENT_RUNGS_BY_PACKAGE[name] ?? null }));
}

/** `agent rungs: @clossys/<name> <rung>, ...` for `clossys status`. */
export function installedRungsLine(workspace: string): string {
  const rows = installedRungs(workspace);
  return `agent rungs: ${rows.map(row => `${row.package} ${row.rung ?? "none"}`).join(", ") || "no agent package installed"}`;
}

/** The install list and, next to it, the agents computed at the rung it needs (or higher), for `clossys init`. */
export function installNeedLine(): string {
  const need = AGENT_RUNG_NEEDS.install ?? "packed";
  const computed = Object.entries(AGENT_RUNGS).filter(([, rung]) => at(rung) >= at(need)).map(([id]) => id);
  return `install list: ${AGENT_LISTS.install.join(", ")}; computed at ${need} or higher: ${computed.join(", ") || "none"} (clossys agents check)`;
}
