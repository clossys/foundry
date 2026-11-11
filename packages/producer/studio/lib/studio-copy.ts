import { createCopyResolver } from '@clossys/writer/resolve';
import registry from '../generated/studio-copy.json';

// Studio previews the projected copy; editorial approval is the owner's pin (pin = approval, records/writer-copy.ts).
const resolve = createCopyResolver(registry, { target: 'preview' });

/** The Writer's source locale for Studio copy (the pinned candidates' first locale): the document's `lang`. */
export const studioLocale: string = registry.locale;

/** Audience copy comes only from the pinned Writer slots projected with the assembly. */
export function studioCopy(id: string, values?: Readonly<Record<string, string | number | boolean>>): string {
  const result = resolve({ id, locale: studioLocale, ...(values ? { values } : {}) });
  if (!result) throw new Error(`Studio copy is unresolved: ${id}`);
  return result.text;
}

/** A failure whose message is Writer copy: the only error text Studio shows. */
export class StudioCopyError extends Error {
  constructor(id: string, values?: Readonly<Record<string, string | number | boolean>>) { super(studioCopy(id, values)); this.name = 'StudioCopyError'; }
}

/** The Writer text of a failure: a `StudioCopyError`'s message, any other failure's Writer fallback. Never a thrown message. */
export function errorText(error: unknown, fallback: string): string {
  return error instanceof StudioCopyError ? error.message : fallback;
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
