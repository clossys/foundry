import { cellHierarchy, type AgentCells, type CellDetail, type CellNode, type CellSummary } from './cells-client';

export function specimenTitle(cell: CellSummary): string {
  return typeof cell.fields?.title === 'string' && cell.fields.title.trim() ? cell.fields.title : cell.id.split('.').at(-1)!;
}

/** Only the semantic strategy sections enter the document; source stays in Source. */
export function directorSections(source: string): { title: string; value: string }[] {
  const body = source.replace(/^\uFEFF/, '').replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
  const sections: { title: string; value: string }[] = [];
  let current: { title: string; lines: string[] } | undefined;
  let fenced = false;
  const flush = () => { if (current?.lines.some(line => line.trim())) sections.push({ title: current.title, value: current.lines.join('\n').trim() }); current = undefined; };
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    if (/^#{1,6}\s/.test(line)) {
      flush();
      const title = line.replace(/^#+\s*/, '').trim();
      if (['Direction', 'Because', 'Watch'].includes(title)) current = { title, lines: [] };
    } else if (current && /^\s*(?:[-*]\s|$)/.test(line)) current.lines.push(line);
  }
  flush();
  return sections;
}

export interface DirectorChapter { id: string; title: string; depth: number; cell?: CellSummary; children: DirectorChapter[] }
export function directorDocument(index: AgentCells): DirectorChapter[] {
  function project(nodes: CellNode[], depth: number): DirectorChapter[] {
    return nodes.flatMap(node => {
      const children = project(node.children, depth + 1);
      if (!node.group && node.status !== 'active' && node.status !== 'draft') return children;
      return [{ id: node.id, title: node.group ? node.title : specimenTitle(node), depth, ...(node.group ? {} : { cell: node }), children }];
    });
  }
  return project(cellHierarchy(index.cells, index.tree), 0);
}
export function directorPassages(chapters: DirectorChapter[]): CellSummary[] { return chapters.flatMap(chapter => [...(chapter.cell ? [chapter.cell] : []), ...directorPassages(chapter.children)]); }

export function evidenceReferences(cell: CellDetail): string[] {
  const refs = cell.fields?.cites;
  return Array.isArray(refs) ? refs.filter((ref): ref is string => typeof ref === 'string') : [];
}
/** Evidence references remain references; only real cell references become outline links. */
export function evidenceHref(ref: string): string | undefined {
  const match = /^(?:(director|designer|writer|publisher):)?([a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){1,2})@([1-9]\d*)$/.exec(ref);
  return match ? `?agent=${match[1] ?? 'director'}&cell=${encodeURIComponent(match[2]!)}&version=${match[3]}` : /^https?:\/\//.test(ref) ? ref : undefined;
}

/** A cell's active and latest draft remain separate passages in version order. */
export function directorVersions(cells: readonly CellDetail[], id: string): CellDetail[] {
  return cells.filter(cell => cell.id === id && (cell.status === 'active' || cell.status === 'draft')).sort((left, right) => (left.version ?? 0) - (right.version ?? 0));
}
export function directorVersionedPassages(index: AgentCells, cells: readonly CellDetail[]): CellDetail[] {
  return directorPassages(directorDocument(index)).flatMap(cell => directorVersions(cells, cell.id));
}
