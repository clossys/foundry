/** Presentation names only. Package resolution belongs to Producer's agents module. */
export const AGENTS = ['director', 'designer', 'writer', 'publisher'] as const;
export type Agent = typeof AGENTS[number];
export const AGENT_LABELS: Record<Agent, string> = { director: 'Director', designer: 'Designer', writer: 'Writer', publisher: 'Publisher' };
export function isAgent(value: string): value is Agent { return AGENTS.some(agent => agent === value); }
