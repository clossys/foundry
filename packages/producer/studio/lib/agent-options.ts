/**
 * What an agent option changes against the active version: the record's markdown split into
 * heading blocks, each block compared by heading. Writer and Director options show only the
 * strings they change, so the owner reads the difference, not the whole record twice.
 */
import type { OptionPreview } from '../sections/studio-options';
import { stripFrontMatter } from './studio-text';

const LIMIT = 240;
const clip = (text: string) => text.length > LIMIT ? `${text.slice(0, LIMIT - 1).trimEnd()}…` : text;

/** Heading -> block text, in document order; text before the first heading sits under "Intro". */
export function headingBlocks(source: string): Map<string, string> {
  const blocks = new Map<string, string[]>();
  let key = 'Intro';
  for (const line of stripFrontMatter(source).split('\n')) {
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) { key = heading[1]!; if (!blocks.has(key)) blocks.set(key, []); continue; }
    if (!blocks.has(key)) blocks.set(key, []);
    blocks.get(key)!.push(line);
  }
  return new Map([...blocks].map(([name, lines]) => [name, lines.join('\n').replace(/\s+/g, ' ').trim()] as const).filter(([, text]) => text));
}

/** The option's strings against the base: changed, added and removed blocks only; every block when there is no base. */
export function stringChanges(option: string, base?: string): OptionPreview {
  const next = headingBlocks(option);
  if (base === undefined) return { kind: 'strings', rows: [...next].map(([key, text]) => ({ key, text: clip(text), change: 'added' as const })) };
  const previous = headingBlocks(base);
  const rows: { key: string; text: string; change: 'added' | 'changed' | 'removed' }[] = [];
  for (const [key, text] of next) {
    const before = previous.get(key);
    if (before === undefined) rows.push({ key, text: clip(text), change: 'added' });
    else if (before !== text) rows.push({ key, text: clip(text), change: 'changed' });
  }
  for (const [key, text] of previous) if (!next.has(key)) rows.push({ key, text: clip(text), change: 'removed' });
  return rows.length ? { kind: 'strings', rows } : { kind: 'note', text: 'This version changes no strings against the active version.' };
}
