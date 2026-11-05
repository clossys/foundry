import { createCopyResolver } from '@clossys/writer/resolve';
import registry from '../generated/studio-copy.json';

// Studio previews the migrated source; a slot pin does not create editorial approval.
const resolve = createCopyResolver(registry, { target: 'preview' });

/** Audience copy comes only from the pinned Writer slots projected with the assembly. */
export function studioCopy(id: string, values?: Readonly<Record<string, string | number | boolean>>): string {
  const result = resolve({ id, locale: 'en', ...(values ? { values } : {}) });
  if (!result) throw new Error(`Studio copy is unresolved: ${id}`);
  return result.text;
}

/** A server row's text: plain data, or a Writer copy reference (`{ copy, values }`) Studio resolves. */
export type CopyText = string | { readonly copy: string; readonly values?: Readonly<Record<string, string | number>> };

const isRef = (value: unknown): value is Exclude<CopyText, string> =>
  !!value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { copy?: unknown }).copy === 'string'
  && Object.keys(value).every(key => key === 'copy' || key === 'values');

/** One server text: a string is data and passes through; a copy reference resolves through the Writer. */
export function copyText(text: CopyText): string {
  return typeof text === 'string' ? text : studioCopy(text.copy, text.values);
}

/** Resolve every copy reference inside a server payload (rows, tables, cells), leaving data untouched. */
export function resolveCopy<T>(value: T): T {
  if (isRef(value)) return copyText(value) as T;
  if (Array.isArray(value)) return value.map(item => resolveCopy(item)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveCopy(item)])) as T;
  return value;
}
