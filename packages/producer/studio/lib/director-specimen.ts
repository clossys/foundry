import { parseDocument, tokenizeBody, type BodyLine } from '@clossys/strategist/cell-format';
import { cellHierarchy, type AgentCells, type CellDetail, type CellNode, type CellSummary } from './cells-client';

export function specimenTitle(cell: CellSummary): string {
  return typeof cell.fields?.title === 'string' && cell.fields.title.trim() ? cell.fields.title : cell.id.split('.').at(-1)!;
}

export interface DirectorSection { title: string; value: string }
export interface DirectorProjection { sections: DirectorSection[]; issues: string[] }

/** Native document/token boundaries select passages; original lines supply all their Markdown. */
export function directorProjection(source: string): DirectorProjection {
  const projection: DirectorProjection = { sections: [], issues: [] };
  const text = source.replace(/^\uFEFF/, '');
  let body: BodyLine[];
  if (text.startsWith('---\n') || text.startsWith('---\r\n') || text === '---') {
    const document = parseDocument(text);
    if (!document.ok) {
      projection.issues.push(...document.issues.map(issue => `Director ${issue.path}, line ${issue.line}: ${issue.message}`));
      return projection;
    }
    body = document.value.body;
  } else body = text.split(/\r?\n/).map((text, position) => ({ text, line: position + 1 }));

  // Code is passage content, never a section boundary (including fenced heading examples).
  // The shared native tokenizer only recognizes JSON fences, so shield other fences too.
  let fence: { marker: string; length: number; line: number } | undefined;
  const structural: BodyLine[] = [];
  for (const row of body) {
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(row.text);
      if (close && close[1]![0] === fence.marker && close[1]!.length >= fence.length) fence = undefined;
      structural.push({ ...row, text: '' });
      continue;
    }
    const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(row.text);
    if (!open || open[1]![0] === '`' && open[2]!.includes('`')) { structural.push(row); continue; }
    fence = { marker: open[1]![0]!, length: open[1]!.length, line: row.line };
    structural.push({ ...row, text: '' });
  }
  if (fence) projection.issues.push(`Director body, line ${fence.line}: Expected closing code fence.`);
  const tokens = tokenizeBody(structural);
  if (!tokens.ok) {
    projection.issues.push(...tokens.issues.map(issue => `Director ${issue.path}, line ${issue.line}: ${issue.message}`));
    return projection;
  }
  const headings = tokens.value.filter(token => token.type === 'heading' && token.depth === 2);
  for (let position = 0; position < headings.length; position++) {
    const heading = headings[position]!;
    if (!['Direction', 'Because', 'Watch'].includes(heading.text)) continue;
    const end = headings[position + 1]?.line ?? Infinity;
    const lines = body.filter(row => row.line > heading.line && row.line < end).map(row => row.text);
    // Remove section separators only: indentation and Markdown hard breaks are meaningful.
    while (lines.length && !lines[0]!.trim()) lines.shift();
    while (lines.length && !lines.at(-1)!.trim()) lines.pop();
    if (!lines.length) projection.issues.push(`Director ${heading.text}, line ${heading.line}: A declared Director passage has no supported semantic content.`);
    else projection.sections.push({ title: heading.text, value: lines.join('\n') });
  }
  return projection;
}

/** Compatibility projection for consumers that need only the source passages. */
export function directorSections(source: string): DirectorSection[] { return directorProjection(source).sections; }

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
