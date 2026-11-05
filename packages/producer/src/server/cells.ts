import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { AGENT_PACKAGES, resolveAgent, type AgentKind } from "../agents.js";

export const AGENT_KINDS = Object.keys(AGENT_PACKAGES) as AgentKind[];
export const CELL_ID = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){1,2}$(?![\s\S])/;
const modules = new Map<string, Promise<any>>();
/** Resolve through the scaffold mapping, then load the package's shipped Node API. */
export function agentModule(agent: AgentKind, relativeFile: string): Promise<any> {
  const selected = resolveAgent(agent);
  const url = pathToFileURL(join(selected.packageRoot, "dist", relativeFile)).href;
  let loaded = modules.get(url);
  if (!loaded) { loaded = import(url); modules.set(url, loaded); }
  return loaded;
}

export function agentRoot(root: string, agent: AgentKind): string { return join(root, "clossys", "agents", agent); }
