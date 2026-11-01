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
