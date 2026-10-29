import { parseDocument, serializeScalar, parseLinkRef, parseConfirmRef, isoDate } from '@clossys/strategist/cell-format';

export type JsonRecord = Record<string, unknown>;
export interface CellRecord { locale: string; record: JsonRecord; bindings: JsonRecord[] }
export interface WriterCell {
  id: string; version: number; status: 'draft' | 'active' | 'retired'; updated: string;
  links: string[]; confirmed?: string; note?: string; locales: string[]; surface?: string;
  records: CellRecord[];
}
export const WRITER_CELL_ID = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$(?![\s\S])/;
const localePattern = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;
const object = (value: unknown): value is JsonRecord => value !== null && typeof value === 'object' && !Array.isArray(value);
const stringList = (value: unknown): value is string[] => Array.isArray(value) && value.every(v => typeof v === 'string');

/** First two semantic context segments determine the permanent section id. */
export function writerCellId(context: string): string {
  const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const segments = context.split('.').slice(0, 2).map(kebab);
  if (segments.length === 1) segments.push('root');
  const id = segments.join('.');
  if (!WRITER_CELL_ID.test(id)) throw new Error('Context cannot produce a Writer cell id');
  return id;
}

export function parseWriterCell(source: string, path?: string): WriterCell {
  const parsed = parseDocument(source);
  if (!parsed.ok) throw new Error(parsed.issues.map(i => `${path ?? 'cell'}:${i.line}: ${i.message}`).join('\n'));
  const { fields: f, fieldLines } = parsed.value;
  const body = [...parsed.value.body];
  if (body.at(-1)?.text === '') body.pop();
  function fail(message: string, line = 1): never { throw new Error(`${path ?? 'cell'}:${line}: ${message}`); }
  for (const key of Object.keys(f)) if (!['id','version','status','updated','links','confirmed','note','locales','surface'].includes(key)) fail(`Unknown frontmatter key ${key}`, fieldLines[key]);
  if (typeof f.id !== 'string' || !WRITER_CELL_ID.test(f.id)) fail('Expected a permanent two-segment Writer cell id');
  if (typeof f.version !== 'number' || !Number.isSafeInteger(f.version) || f.version < 1) fail('Expected positive version');
  if (!['draft','active','retired'].includes(String(f.status))) fail('Expected draft, active or retired status');
  if (!isoDate(f.updated)) fail('Expected valid updated date');
  if (!stringList(f.links) || f.links.some(x => !parseLinkRef(x))) fail('Expected valid cell links');
  if (!stringList(f.locales) || !f.locales.length || f.locales.some(l => !localePattern.test(l)) || new Set(f.locales).size !== f.locales.length) fail('Expected unique locale tags');
  if (f.confirmed !== undefined && (typeof f.confirmed !== 'string' || !parseConfirmRef(f.confirmed))) fail('Invalid confirmation');
  if (f.status === 'active' && f.confirmed === undefined) fail('Active cell requires confirmation');
  if (typeof f.confirmed === 'string' && f.confirmed.startsWith('migration:') && f.version !== 1) fail('Migration confirmation is only allowed on v1');
  for (const key of ['surface','note']) if (f[key] !== undefined && typeof f[key] !== 'string') fail(`${key} must be a string`);
  if (path) {
    const match = /(?:^|\/)cells\/([^/]+)\/v([1-9]\d*)\.md$/.exec(path.replace(/\\/g, '/'));
    if (!match || match[1] !== f.id || Number(match[2]) !== f.version) fail('Cell path/id/version mismatch');
  }
  const records: CellRecord[] = []; const seenLocales: string[] = [];
  let locale: string | undefined; let i = 0;
  while (i < body.length) {
    const row = body[i]!;
    if (row.text === '') { i++; continue; }
    if (row.text.startsWith('## ')) {
      locale = row.text.slice(3);
      if (!(f.locales as string[]).includes(locale) || seenLocales.includes(locale)) fail('Unknown or repeated locale section', row.line);
      seenLocales.push(locale); i++; continue;
    }
    if (!locale || !row.text.startsWith('### ') || !row.text.slice(4)) fail('Expected locale or record heading', row.line);
    const context = row.text.slice(4); i++;
    const metadata = body[i++];
    const match = metadata && /^<!-- (.+) -->$/.exec(metadata.text);
    if (!match) fail('Expected one-line JSON record metadata', metadata?.line ?? row.line);
    let meta: unknown;
    try { meta = JSON.parse(match![1]!); } catch { fail('Invalid record metadata JSON', metadata!.line); }
    if (!object(meta) || typeof meta.id !== 'string' || Object.hasOwn(meta, 'text') || Object.hasOwn(meta, 'context')) fail('Expected non-text record metadata with id', metadata!.line);
    const bindings = meta.bindings ?? [];
    if (!Array.isArray(bindings) || bindings.some(b => !object(b) || Object.hasOwn(b, 'recordId'))) fail('Invalid record bindings', metadata!.line);
    const record: JsonRecord = { ...meta, context }; delete record.bindings;
    const lines: string[] = [];
    while (i < body.length && !/^#{2,3} /.test(body[i]!.text)) lines.push(body[i++]!.text);
    // The grammar has one separator blank line, independent of blank lines in text.
    if (lines.at(-1) === '') lines.pop();
    const content = lines.join('\n');
    if (lines[0] === '```json') {
      if (lines.at(-1) !== '```') fail('Unclosed textless record JSON block', row.line);
      let value: unknown;
      try { value = JSON.parse(lines.slice(1, -1).join('\n')); } catch { fail('Invalid textless record JSON', row.line); }
      if (!object(value) || Object.hasOwn(value, 'text') || value.id !== record.id || value.context !== context) fail('Textless JSON record disagrees with heading or metadata', row.line);
      records.push({ locale, record: value, bindings: bindings as JsonRecord[] });
    } else {
      record.text = content.split('\n').map(line => line.startsWith('\\') ? line.slice(1) : line).join('\n');
      records.push({ locale, record, bindings: bindings as JsonRecord[] });
    }
  }
  if (seenLocales.join('\0') !== (f.locales as string[]).join('\0')) fail('Locale sections must match frontmatter order');
  return { id: f.id as string, version: f.version as number, status: f.status as WriterCell['status'], updated: f.updated as string, links: f.links as string[], locales: f.locales as string[], ...(f.confirmed !== undefined ? { confirmed: f.confirmed as string } : {}), ...(f.note !== undefined ? { note: f.note as string } : {}), ...(f.surface !== undefined ? { surface: f.surface as string } : {}), records };
}

export function serializeWriterCell(cell: WriterCell): string {
  const scalar = (key: string, value: string | number) => `${key}: ${serializeScalar(value)}`;
  const lines = ['---', scalar('id',cell.id), scalar('version',cell.version), scalar('status',cell.status),scalar('updated',cell.updated), `links: [${cell.links.map(serializeScalar).join(', ')}]`];
  if (cell.confirmed !== undefined) lines.push(scalar('confirmed',cell.confirmed));
  if (cell.note !== undefined) lines.push(scalar('note',cell.note));
  lines.push(`locales: [${cell.locales.map(serializeScalar).join(', ')}]`);
  if (cell.surface !== undefined) lines.push(scalar('surface',cell.surface));
  lines.push('---','');
  for (const locale of cell.locales) {
    lines.push(`## ${locale}`);
    for (const item of cell.records.filter(r => r.locale === locale)) {
      const {text, context, ...metadata} = item.record;
      lines.push(`### ${String(context)}`, `<!-- ${JSON.stringify({...metadata, bindings:item.bindings})} -->`);
      if (typeof text === 'string') lines.push(...text.split('\n').map(line => /^(#|<!--|\\|```json)/.test(line) ? `\\${line}` : line));
      else lines.push('```json', JSON.stringify(item.record, null, 2), '```');
      lines.push('');
    }
  }
  // The final separator blank line is meaningful to the record-text grammar.
  const source = lines.join('\n') + '\n';
  parseWriterCell(source);
  return source;
}
