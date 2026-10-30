import type { AgentKind } from '../agents.js';
import { AGENT_KINDS } from './cells.js';
import { agentSpecimenInventory } from './native-specimen-inventory.js';

/** Read-only source accounting. Selected registration and mounted DOM are browser evidence. */
export async function specimenCoverage(root: string, agent?: AgentKind) {
  const agents = await Promise.all((agent ? [agent] : AGENT_KINDS).map(async current => {
    const source = await agentSpecimenInventory(root, current);
    const total = source.state === 'ready' ? source.index.cells.length : null;
    const available = source.index.cells.filter(cell => source.cells.some(version => version.id === cell.id && version.version === cell.version && version.status === cell.status)).length;
    return {
      agent: current, pass: false as const,
      nativeInventory: { state: source.state, completeScope: source.sourceComplete, cells: { available, total }, storedVersions: source.cells.length, provenance: source.provenance },
      bindings: { state: 'unmeasured' as const, cells: { covered: null, total } },
      variants: { state: 'unmeasured' as const, covered: null, total: null, completeScope: false },
      rendered: { state: 'unmeasured' as const, cells: { covered: null, total } },
      issues: [...source.issues, 'Selected native registration and rendered variants require the mounted Studio coverage API.'],
    };
  }));
  // Omit cell content, native profile values and filesystem paths from diagnostics.
  return { state: 'incomplete' as const, pass: false as const, agents };
}
