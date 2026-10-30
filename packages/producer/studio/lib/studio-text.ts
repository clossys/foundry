import type { CellSummary } from './cells-client';

/** Readable label for an identity segment: "accent-color" becomes "Accent color". */
export function humanize(value: string): string {
  const last = value.split('.').at(-1) ?? value;
  // camelCase/PascalCase names ("RightPanel") read as words; acronyms stay intact.
  const words = last.replace(/[-_]+/g, ' ').replace(/([a-z0-9])([A-Z])(?=[a-z])/g, (_, a: string, b: string) => `${a} ${b.toLowerCase()}`).trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : value;
}

/** A cell's display title. Authored titles win; identities are humanized, never shown raw. */
export function cellTitle(cell: Pick<CellSummary, 'id' | 'fields'>): string {
  const title = cell.fields?.title;
  return typeof title === 'string' && title.trim() ? title : humanize(cell.id);
}

const IDENTITY = /\b(?:(?:director|designer|writer|publisher):)?([a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){1,2})(?:@([1-9]\d*))?/g;
const LAYER_PREFIX = /^(?:assets|components|sections|foundations|context|page|plan|specimen|surface|system|tokens|frames)\./;

export interface PresentedText { text: string; citations: string[]; ownerInput: boolean }

/**
 * Present authored prose for reading. Evidence brackets become citation counts,
 * owner placeholders become an explicit flag, and cell identities become their
 * titles. The source itself is never changed; the Source module still shows it.
 */
export function presentText(value: string, titles: ReadonlyMap<string, string> = new Map()): PresentedText {
  const citations: string[] = [];
  let ownerInput = false;
  let text = value.replace(/\s*\[(fact:[^\]]*)\]/gi, (_, group: string) => {
    for (const entry of group.split(',')) {
      const name = entry.trim().replace(/^fact:/i, '');
      if (name && !citations.includes(name)) citations.push(name);
    }
    return '';
  });
  // Evidence lines arrive as `fact:<name> is <kind> from <source>: claim (finding:<name>)`;
  // the claim is the text, the fact and finding names become citations.
  const cite = (name: string) => { if (name && !citations.includes(name)) citations.push(name); return ''; };
  text = text.replace(/^\s*fact:([\w.-]+)\s+is\s+[^:]{1,80}?:\s*/i, (_, name: string) => cite(name));
  text = text.replace(/\s*\((?:finding|fact):([\w.-]+)\)/gi, (_, name: string) => cite(name));
  text = text.replace(/TODO-OWNER/g, () => { ownerInput = true; return 'awaiting owner input'; });
  // Request identifiers are bookkeeping; readers see what they refer to.
  text = text.replace(/\b(?:REQ|req)-\d{1,6}\b/g, 'the open request');
  text = text.replace(IDENTITY, (match, id: string, version?: string) => {
    const known = titles.get(id);
    if (!known && !LAYER_PREFIX.test(id)) return match;
    const label = known ?? humanize(id);
    return version ? `${label} v${version}` : label;
  });
  return { text: text.replace(/[ \t]{2,}/g, ' ').trim(), citations, ownerInput };
}

/** Title lookup for every cell an agent index carries. */
export function titleMap(cells: readonly Pick<CellSummary, 'id' | 'fields'>[]): Map<string, string> {
  return new Map(cells.map(cell => [cell.id, cellTitle(cell)]));
}

/** Strip a markdown front matter block. */
export function stripFrontMatter(source: string): string {
  return source.replace(/^﻿/, '').replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
}

/** Bullet or prose lines of one `## Heading` section, without list markers or fenced blocks. */
export function sectionBullets(source: string, heading: string): string[] {
  const lines: string[] = [];
  let inside = false;
  let fenced = false;
  for (const line of stripFrontMatter(source).split(/\r?\n/)) {
    if (/^##\s/.test(line)) { inside = line.replace(/^##\s+/, '').trim() === heading; fenced = false; continue; }
    if (!inside) continue;
    if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
    const text = line.replace(/^\s*[-*]\s+/, '').trim();
    if (!fenced && text) lines.push(text);
  }
  return lines;
}
