// The named agent lists of docs/contracts/agents.json, for the repository's own scripts. Packages read
// their generated copy instead (scripts/check-agents-definition.mjs GENERATED). A missing list throws:
// there is no fallback list.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const AGENTS = JSON.parse(readFileSync(fileURLToPath(new URL("../../docs/contracts/agents.json", import.meta.url)), "utf8"));

/** The members of the named list, in order, frozen. Throws when agents.json has no such list. */
export function agentList(name) {
  const list = AGENTS.lists?.[name];
  if (!Array.isArray(list?.members)) throw new Error(`docs/contracts/agents.json has no agent list named ${name}`);
  return Object.freeze([...list.members]);
}
