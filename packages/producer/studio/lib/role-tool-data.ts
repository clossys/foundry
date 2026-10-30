import type { AgentCells, CellDetail } from './cells-client';
import { localeDirection, writerProjection, type WriterProjection } from './writer-specimen';

export type RoleDirection = 'ltr' | 'rtl';
export interface RoleLocale { id: string; direction: RoleDirection }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Prefer the real Writer manifest; a declared but untranslated locale remains selectable. */
export function writerRoleLocales(index: AgentCells, projection?: WriterProjection): { locales: RoleLocale[]; preferred?: string } {
  const meta = index.tree?.meta;
  const manifest = object(meta) && object(meta.libraryManifest) ? meta.libraryManifest : undefined;
  const declared = Array.isArray(manifest?.locales) ? manifest.locales.flatMap(value => {
    if (!object(value) || typeof value.tag !== 'string' || value.state === 'retired') return [];
    return [{ id: value.tag, direction: value.dir === 'rtl' || value.dir === 'ltr' ? value.dir : localeDirection(value.tag) } as RoleLocale];
  }) : [];
  const locales = declared.length ? declared : (projection?.locales ?? []).map(id => ({ id, direction: localeDirection(id) }));
  const unique = [...new Map(locales.map(locale => [locale.id, locale])).values()];
  const preferred = typeof manifest?.defaultLocale === 'string' && unique.some(locale => locale.id === manifest.defaultLocale) ? manifest.defaultLocale : unique[0]?.id;
  return { locales: unique, ...(preferred ? { preferred } : {}) };
}

/** Module visibility is absent from this projection so opening a tool cannot reset copy. */
export function writerRoleView(index: AgentCells, cell: CellDetail | undefined, requestedLocale?: string, direction?: RoleDirection) {
  const projection = cell ? writerProjection(cell) : undefined;
  const configured = writerRoleLocales(index, projection);
  const selectedLocale = requestedLocale && configured.locales.some(locale => locale.id === requestedLocale) ? requestedLocale : configured.preferred;
  const selectedDirection = direction ?? configured.locales.find(locale => locale.id === selectedLocale)?.direction;
  const comparisonLocales = [...configured.locales].sort((left, right) => Number(right.id === selectedLocale) - Number(left.id === selectedLocale));
  return { projection, locales: configured.locales, selectedLocale, selectedDirection, comparisonLocales };
}

export function writerRoleVoice(cells: readonly CellDetail[]) {
  const projections = cells.map(writerProjection);
  return { tone: [...new Set(projections.flatMap(projection => projection.tone))], bannedWords: [...new Set(projections.flatMap(projection => projection.banned))] };
}
