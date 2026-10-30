import type { AgentCells } from './cells-client';
import type { PublicationPage, PublicationResponse, PreviewEntry } from '../../src/server/publication';

export type { PublicationPage, PublicationResponse } from '../../src/server/publication';
export const PUBLISH_PREVIEW_COMMAND = 'clossys publish --target preview';
export const PUBLISHER_DEVICES = { desktop: { label: 'Desktop', width: 1440, height: 900 }, tablet: { label: 'Tablet', width: 768, height: 1024 }, mobile: { label: 'Mobile', width: 390, height: 844 } } as const;
export type PublisherDevice = keyof typeof PUBLISHER_DEVICES;
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
export function safePreviewUrl(value: unknown): value is string {
  return typeof value === 'string' && /^\/preview\/[a-z][a-z0-9.-]*\/pages\/[a-z][a-z0-9.-]*\.html$/.test(value) && !value.includes('..');
}
/** Keep iframe URLs closed to Producer's emitted-page route. Source stays secondary. */
export function parsePublicationResponse(value: unknown): PublicationResponse {
  if (!object(value)) throw new Error('Producer returned an invalid publication response.');
  if (value.state === 'missing' || value.state === 'error') {
    if (typeof value.message !== 'string' || value.command !== PUBLISH_PREVIEW_COMMAND) throw new Error('Producer returned an invalid publication state.');
    return { state: value.state, message: value.message, command: PUBLISH_PREVIEW_COMMAND };
  }
  if (value.state !== 'ready' || typeof value.publication !== 'string' || !object(value.manifest) || value.manifest.schemaVersion !== 1 || value.manifest.publication !== value.publication || !object(value.manifest.contentMap) || !Array.isArray(value.manifest.contentMap.entries) || !Array.isArray(value.pages) || !Array.isArray(value.publications)) throw new Error('Producer returned an invalid publication descriptor.');
  const ids = new Set<string>();
  for (const page of value.pages) {
    if (!object(page) || typeof page.id !== 'string' || ids.has(page.id) || typeof page.route !== 'string' || !page.route.startsWith('/') || !safePreviewUrl(page.previewUrl) || typeof page.emitted !== 'boolean') throw new Error('Producer returned an invalid published page.');
    ids.add(page.id);
    for (const field of ['cellId', 'title', 'description', 'ogImage', 'lastPublished']) if (page[field] !== undefined && typeof page[field] !== 'string') throw new Error('Producer returned invalid publication metadata.');
    if (page.indexing !== undefined && !['index', 'noindex'].includes(page.indexing) || page.inSitemap !== undefined && typeof page.inSitemap !== 'boolean') throw new Error('Producer returned invalid publication status.');
  }
  return value as PublicationResponse;
}
export async function loadPublication(signal: AbortSignal, publication?: string): Promise<PublicationResponse> {
  const response = await fetch(`/api/publication${publication ? `?publication=${encodeURIComponent(publication)}` : ''}`, { signal, cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Producer could not load the publication (${response.status}).`);
  return parsePublicationResponse(await response.json());
}
export function selectedPublicationId(index: AgentCells, selectedId?: string): string | undefined {
  const meta = index.tree?.meta;
  const publications = object(meta) && Array.isArray(meta.publications) ? meta.publications : [];
  const selected = publications.find((entry: any) => entry.id === selectedId || object(entry.entryIds) && Object.hasOwn(entry.entryIds, selectedId ?? ''));
  return typeof selected?.id === 'string' ? selected.id : publications.length === 1 && typeof publications[0]?.id === 'string' ? publications[0].id : undefined;
}
/** Join actual Publisher cell identities or paths; never guess a page from raw prose. */
export function selectedPublishedPage(index: AgentCells, selectedId: string | undefined, pages: PublicationPage[]): PublicationPage | undefined {
  if (!selectedId) return undefined;
  const selected = index.cells.find(cell => cell.id === selectedId);
  return pages.find(page => page.cellId === selectedId || page.id === selectedId || typeof selected?.fields?.path === 'string' && page.route === selected.fields.path);
}
export interface PublicationTreeNode { id: string; title: string; page?: PublicationPage; children: PublicationTreeNode[] }
export function publicationNavigation(entries: PreviewEntry[], pages: PublicationPage[]): PublicationTreeNode[] {
  const nodes = new Map<string, PublicationTreeNode>();
  for (const entry of entries) {
    if (!entry || typeof entry.id !== 'string' || typeof entry.title !== 'string' || nodes.has(entry.id)) throw new Error('The emitted content map has invalid identities.');
    nodes.set(entry.id, { id: entry.id, title: entry.title, page: pages.find(page => page.id === entry.id), children: [] });
  }
  const roots: PublicationTreeNode[] = [];
  for (const entry of entries) {
    const seen = new Set([entry.id]); let parent = entry.parentId;
    while (parent !== undefined) {
      if (!nodes.has(parent) || seen.has(parent)) throw new Error('The emitted content map has an invalid hierarchy.');
      seen.add(parent); parent = entries.find(entry => entry.id === parent)?.parentId;
    }
    if (entry.parentId) nodes.get(entry.parentId)!.children.push(nodes.get(entry.id)!); else roots.push(nodes.get(entry.id)!);
  }
  return roots;
}
export function publicationStatus(page: PublicationPage) {
  return { route: page.route, indexing: page.indexing ?? 'Not provided', sitemap: page.inSitemap === undefined ? 'Not provided' : page.inSitemap ? 'Included' : 'Excluded', published: page.lastPublished ?? 'Not provided' };
}
