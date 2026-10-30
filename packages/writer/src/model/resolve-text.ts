import type { PassageRef, WriterRecord } from './types.js';

export interface WriterReferenceText { text: string; issues: string[] }
/** Native local-reference wording shared by checks and specimen projection; no locale fallback. */
export function resolveWriterReferenceText(ref: PassageRef, records: readonly WriterRecord[]): WriterReferenceText {
  const byId = new Map(records.map(record => [record.id, record]));
  const issues: string[] = [];
  const failure = (marker: string): string => { issues.push(marker); return `[${marker}]`; };
  const resolve = (value: PassageRef, ancestors: ReadonlySet<string>): string => {
    if (!value || typeof value !== 'object' || typeof value.id !== 'string') return failure('invalid-ref');
    const target = byId.get(value.id);
    if (!target) return failure(`unresolved:${value.id}`);
    if (ancestors.has(target.id)) return failure(`cycle:${target.id}`);
    const seen = new Set([...ancestors, target.id]);
    if (value.ref === 'string' && 'text' in target && typeof target.text === 'string') return target.text;
    if (value.ref === 'term' && 'kind' in target && target.kind === 'term' && typeof target.term === 'string') return target.term;
    if (value.ref === 'pattern' && 'parts' in target && target.parts && typeof target.parts === 'object') {
      const keys = value.part === undefined ? Object.keys(target.parts).sort() : [value.part];
      return keys.map(key => {
        const part = target.parts[key];
        if (!part) return failure(`unresolved:${value.id}.${key}`);
        if ('text' in part && typeof part.text === 'string') return part.text;
        if ('ref' in part && part.ref?.kind === 'string') return resolve({ ref: 'string', id: part.ref.id }, seen);
        return failure(`invalid-ref:pattern:${value.id}.${key}`);
      }).join('\n');
    }
    return failure(`invalid-ref:${value.ref}:${value.id}`);
  };
  return { text: resolve(ref, new Set()), issues };
}
/** Compatibility text form for native checks; unresolved references retain their diagnostic marker. */
export function resolveWriterRefText(ref: PassageRef, records: readonly WriterRecord[]): string {
  return resolveWriterReferenceText(ref, records).text;
}
