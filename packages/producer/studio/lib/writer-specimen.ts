import type { CellDetail } from './cells-client';

export type CopyRole = 'headline' | 'body' | 'cta' | 'nav' | 'error' | 'empty' | 'unknown';
export interface WriterCopy { id: string; context: string; locale: string; text?: string; role: CopyRole; record: Record<string, unknown> }
export interface WriterProjection { locales: string[]; records: WriterCopy[]; tone: string[]; banned: string[]; gaps: string[] }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
export function copyRole(record: Record<string, unknown>): CopyRole {
  const explicit = typeof record.role === 'string' ? record.role : '';
  const context = `${explicit} ${String(record.leaf ?? '')} ${String(record.context ?? '')}`.toLowerCase();
  if (/(?:^|[.\s-])(?:error|errors)(?:$|[.\s-])/.test(context)) return 'error';
  if (/(?:^|[.\s-])(?:empty|no-results)(?:$|[.\s-])/.test(context)) return 'empty';
  if (/(?:^|[.\s-])(?:nav|navigation)(?:$|[.\s-])/.test(context)) return 'nav';
  if (/(?:^|[.\s-])(?:cta|action|actions|button)(?:$|[.\s-])/.test(context)) return 'cta';
  if (/(?:^|[.\s-])(?:headline|heading|title|titles)(?:$|[.\s-])/.test(context)) return 'headline';
  if (/(?:^|[.\s-])(?:body|description|paragraph|paragraphs|passage|passages|narrative|narratives)(?:$|[.\s-])/.test(context)) return 'body';
  return 'unknown';
}
export function localeDirection(locale: string): 'rtl' | 'ltr' { return /^(?:ar|fa|he|ur|ps|dv|yi)(?:-|$)/i.test(locale) ? 'rtl' : 'ltr'; }

/** Browser projection of the Writer cell profile, including older Rationale/Fill envelopes. */
export function writerProjection(cell: CellDetail): WriterProjection {
  const projection: WriterProjection = { locales: strings(cell.fields?.locales), records: [], tone: [], banned: [], gaps: [] };
  const add = (record: unknown, locale: string) => {
    if (!object(record)) return;
    if (object(record.rules)) projection.tone.push(...strings(record.rules.tone));
    if (Array.isArray(record.glossary)) projection.banned.push(...record.glossary.filter(object).filter(term => term.status === 'forbidden').map(term => String(term.term ?? '')).filter(Boolean));
    projection.tone.push(...strings(record.tone)); projection.banned.push(...strings(record.bannedWords));
    if (typeof record.id !== 'string' || !record.id.trim() || typeof record.context !== 'string' || !record.context.trim()) { projection.gaps.push('Writer record identity or context unavailable.'); return; }
    if (!projection.locales.includes(locale)) projection.locales.push(locale);
    projection.records.push({ id: record.id, context: record.context, locale, role: copyRole(record), ...(typeof record.text === 'string' ? { text: record.text } : {}), record });
  };
  const envelope = (value: unknown, defaultLocale = 'und') => {
    if (Array.isArray(value)) { for (const record of value) add(record, defaultLocale); return; }
    if (!object(value)) return;
    const locale = typeof value.locale === 'string' ? value.locale : defaultLocale;
    if (Array.isArray(value.records)) for (const record of value.records) add(record, locale);
    else add(value, locale);
    if (object(value.locales)) for (const [tag, content] of Object.entries(value.locales)) {
      if (!projection.locales.includes(tag)) projection.locales.push(tag);
      if (object(content) && Array.isArray(content.records)) for (const record of content.records) add(record, tag);
    }
  };
  if (cell.native?.agent === 'writer') {
    projection.locales = [...cell.native.locales];
    for (const entry of cell.native.records) add(entry.record, entry.locale);
    projection.tone = [...new Set(projection.tone)]; projection.banned = [...new Set(projection.banned)];
    return projection;
  }
  const body = cell.content.replace(/^\uFEFF/, '').replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
  // Canonical profile: locale heading, context heading, metadata, then produced text.
  const lines = body.split(/\r?\n/);
  let locale: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const row = lines[i]!;
    if (/^## [A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(row)) { locale = row.slice(3); if (!projection.locales.includes(locale)) projection.locales.push(locale); continue; }
    if (!locale || !row.startsWith('### ')) continue;
    const context = row.slice(4);
    const metadata = /^<!-- (.+) -->$/.exec(lines[i + 1] ?? '');
    if (!metadata) { projection.gaps.push(`Record metadata unavailable: ${context}`); continue; }
    let record: unknown;
    try { record = JSON.parse(metadata[1]!); } catch { projection.gaps.push(`Record metadata invalid: ${context}`); continue; }
    if (!object(record)) continue;
    i += 2;
    const content: string[] = [];
    while (i < lines.length && !/^#{2,3} /.test(lines[i]!)) content.push(lines[i++]!);
    i--;
    if (content.at(-1) === '') content.pop();
    // Split's terminal newline is distinct from the profile's record separator.
    if (content.at(-1) === '' && i === lines.length - 1) content.pop();
    if (content[0] === '```json') {
      try { add(JSON.parse(content.slice(1, content.lastIndexOf('```')).join('\n')), locale); } catch { projection.gaps.push(`Record value invalid: ${context}`); }
    } else add({ ...record, context, text: content.map(line => line.startsWith('\\') ? line.slice(1) : line).join('\n') }, locale);
  }
  if (!projection.records.length) {
    // Older fills put produced records in a JSON block beneath Fill; Rationale never enters a specimen.
    const fill = /(?:^|\n)## Fill\s*\n([\s\S]*?)(?=\n## |$)/.exec(body)?.[1];
    const json = fill && /```json\s*\n([\s\S]*?)\n```/.exec(fill)?.[1];
    if (json) try { envelope(JSON.parse(json), projection.locales[0]); } catch { projection.gaps.push('Writer Fill JSON is invalid.'); }
  }
  projection.tone = [...new Set(projection.tone)]; projection.banned = [...new Set(projection.banned)];
  if (!projection.locales.length) projection.gaps.push('Configured locales unavailable.');
  return projection;
}
