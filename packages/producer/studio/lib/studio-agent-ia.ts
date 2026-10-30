import { cellHierarchy, type AgentCells, type CellNode, type CellSummary } from './cells-client';
import { cellContentTarget } from './cell-content';
import { AGENT_LABELS } from './agents';

export interface StudioIACollection { id: string; label: string; cells: CellSummary[] }
export interface StudioIAGroup { id: string; label: string; collections: StudioIACollection[] }
export interface StudioIAOutline { id: string; label: string; href: string; children?: StudioIAOutline[]; contentTarget?: ReturnType<typeof cellContentTarget>; version?: number; externalAction?: { href: string; label: string } }
export interface StudioAgentIA { id: string; label: string; state: 'ready' | 'missing' | 'error'; groups: StudioIAGroup[]; tree: StudioIAOutline[]; error?: string }
export const studioIAAnchor = (id: string) => `studio-ia-${id}`;
export const studioIAHref = (id: string) => `#${encodeURIComponent(studioIAAnchor(id))}`;

/** Preserve the authored IA. Missing or malformed group levels never become invented headings. */
export function projectStudioAgentIA(index: AgentCells): StudioAgentIA {
  const root = { id: `agent:${index.agent}`, label: AGENT_LABELS[index.agent] };
  if (index.state !== 'ready' || !Array.isArray(index.tree?.tree)) return { ...root, state: index.state === 'error' ? 'error' : 'missing', groups: [], tree: [], error: index.error };
  try {
    const nodes = cellHierarchy(index.cells, index.tree);
    const groups = nodes.map(node => {
      if (!node.group) throw new Error('The authored IA has no L1 grouping.');
      return { id: node.id, label: node.title, collections: node.children.map(section => {
        if (!section.group || section.children.some(cell => cell.group || cell.children.length)) throw new Error('The authored IA has no L2/L3 grouping.');
        return { id: section.id, label: section.title, cells: section.children };
      }) };
    });
    const outline = (nodes: CellNode[]): StudioIAOutline[] => nodes.map(node => ({ id: node.id, label: node.title, href: studioIAHref(node.id), ...(node.group ? { children: outline(node.children) } : { version: node.version, contentTarget: cellContentTarget(index.agent, node.id, { version: node.version }), externalAction: { href: cellContentTarget(index.agent, node.id, { version: node.version }).href, label: `Open ${node.title} content` } }) }));
    return { ...root, state: 'ready', groups, tree: [{ ...root, href: studioIAHref(root.id), children: outline(nodes) }] };
  } catch (error) { return { ...root, state: 'error', groups: [], tree: [], error: error instanceof Error ? error.message : String(error) }; }
}
export function studioIABreadcrumb(ia: StudioAgentIA, id?: string): { id: string; label: string; href: string }[] {
  const root = { id: ia.id, label: ia.label, href: studioIAHref(ia.id) };
  for (const group of ia.groups) {
    const first = { id: group.id, label: group.label, href: studioIAHref(group.id) };
    if (id === group.id) return [root, first];
    for (const collection of group.collections) {
      const second = { id: collection.id, label: collection.label, href: studioIAHref(collection.id) };
      if (id === collection.id) return [root, first, second];
      const cell = collection.cells.find(cell => cell.id === id);
      if (cell) return [root, first, second, { id: cell.id, label: cell.title, href: studioIAHref(cell.id) }];
    }
  }
  return [root];
}
