import { studioAgents } from '../generated/studio-map';

/** Agent presentation is projected from the Studio publication. */
export type Agent = typeof studioAgents[number]['id'];
export const AGENTS = studioAgents.map(agent => agent.id);
export const AGENT_LABELS = Object.fromEntries(studioAgents.map(agent => [agent.id, agent.label])) as Record<Agent, string>;
export function isAgent(value: string): value is Agent { return AGENTS.some(agent => agent === value); }
