import { producerUrl } from './producer-url';
import { studioCopy, StudioCopyError } from './studio-copy';
import type { PublicationPage, PublicationResponse as ProducerPublicationResponse, PreviewEntry } from '../../src/server/publication';

export type { PublicationPage } from '../../src/server/publication';
/** The publication as Studio holds it: a not-ready state keeps no Producer `message` (a terminal diagnostic Studio never shows). */
export type PublicationResponse = Extract<ProducerPublicationResponse, { state: 'ready' }> | { state: 'missing' | 'error'; command: typeof PUBLISH_PREVIEW_COMMAND };
export const PUBLISH_PREVIEW_COMMAND = 'clossys publish --install --page <page id>';
export const PUBLISHER_DEVICES = { desktop: { label: studioCopy("studio.desktop"), width: 1440, height: 900 }, tablet: { label: studioCopy("studio.tablet"), width: 768, height: 1024 }, mobile: { label: studioCopy("studio.mobile"), width: 390, height: 844 } } as const;
export type PublisherDevice = keyof typeof PUBLISHER_DEVICES;
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
export function safePreviewUrl(value: unknown): value is string {
  return typeof value === 'string' && /^\/preview\/[a-z][a-z0-9.-]*\/pages\/[a-z][a-z0-9.-]*\.html$/.test(value) && !value.includes('..');
}
export function safeFrameUrl(value: unknown): value is string {
  return typeof value === 'string' && /^\/preview\/[a-z][a-z0-9.-]*\/frame\/[a-z][a-z0-9.-]*\.html$/.test(value) && !value.includes('..');
}
/**
 * The frame route Producer declares for an emitted page: the page at `viewport` CSS px with its own
 * theme CSS, scaled to the card and sized to its content (the same frame page `/__specimen` serves).
 */
export function publisherFrameUrl(page: Pick<PublicationPage, 'frameUrl'>, viewport: 375 | 768 | 1280, theme: 'light' | 'dark'): string {
  if (!safeFrameUrl(page.frameUrl)) throw new StudioCopyError("studio.not-a-producer-preview-url");
  return `${page.frameUrl}?${new URLSearchParams({ theme, width: String(viewport) })}`;
}
/** Keep iframe URLs closed to Producer's emitted-page route. Source stays secondary. */
export function parsePublicationResponse(value: unknown): PublicationResponse {
  if (!object(value)) throw new StudioCopyError("studio.producer-returned-an-invalid-publication-response");
  if (value.state === 'missing' || value.state === 'error') {
    // The state's Producer `message` is a terminal diagnostic; Studio never reads or shows it.
    if (value.command !== PUBLISH_PREVIEW_COMMAND) throw new StudioCopyError("studio.producer-returned-an-invalid-publication-state");
    return { state: value.state, command: PUBLISH_PREVIEW_COMMAND };
  }
  if (value.state !== 'ready' || typeof value.publication !== 'string' || !object(value.manifest) || value.manifest.schemaVersion !== 1 || value.manifest.publication !== value.publication || !object(value.manifest.contentMap) || !Array.isArray(value.manifest.contentMap.entries) || !Array.isArray(value.pages) || !Array.isArray(value.publications)) throw new StudioCopyError("studio.producer-returned-an-invalid-publication-descriptor");
  const ids = new Set<string>();
  for (const page of value.pages) {
    if (!object(page) || typeof page.id !== 'string' || ids.has(page.id) || typeof page.route !== 'string' || !page.route.startsWith('/') || !safePreviewUrl(page.previewUrl) || !safeFrameUrl(page.frameUrl) || typeof page.emitted !== 'boolean') throw new StudioCopyError("studio.producer-returned-an-invalid-published-page");
    ids.add(page.id);
    for (const field of ['cellId', 'title', 'description', 'ogImage', 'lastPublished']) if (page[field] !== undefined && typeof page[field] !== 'string') throw new StudioCopyError("studio.producer-returned-invalid-publication-metadata");
    if (page.indexing !== undefined && !['index', 'noindex'].includes(page.indexing) || page.inSitemap !== undefined && typeof page.inSitemap !== 'boolean') throw new StudioCopyError("studio.producer-returned-invalid-publication-status");
  }
  return value as PublicationResponse;
}
export async function loadPublication(signal: AbortSignal, publication?: string): Promise<PublicationResponse> {
  const response = await fetch(producerUrl(`/api/publication${publication ? `?publication=${encodeURIComponent(publication)}` : ''}`), { signal, cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new StudioCopyError("studio.producer-could-not-load-the-publication", { value0: String(response.status) });
  return parsePublicationResponse(await response.json());
}
export interface PublicationTreeNode { id: string; title: string; page?: PublicationPage; children: PublicationTreeNode[] }
export function publicationNavigation(entries: PreviewEntry[], pages: PublicationPage[]): PublicationTreeNode[] {
  const nodes = new Map<string, PublicationTreeNode>();
  for (const entry of entries) {
    if (!entry || typeof entry.id !== 'string' || typeof entry.title !== 'string' || nodes.has(entry.id)) throw new StudioCopyError("studio.the-emitted-content-map-has-invalid-identities");
    nodes.set(entry.id, { id: entry.id, title: entry.title, page: pages.find(page => page.id === entry.id), children: [] });
  }
  const roots: PublicationTreeNode[] = [];
  for (const entry of entries) {
    const seen = new Set([entry.id]); let parent = entry.parentId;
    while (parent !== undefined) {
      if (!nodes.has(parent) || seen.has(parent)) throw new StudioCopyError("studio.the-emitted-content-map-has-an-invalid");
      seen.add(parent); parent = entries.find(entry => entry.id === parent)?.parentId;
    }
    if (entry.parentId) nodes.get(entry.parentId)!.children.push(nodes.get(entry.id)!); else roots.push(nodes.get(entry.id)!);
  }
  return roots;
}
export function publicationStatus(page: PublicationPage) {
  return { route: page.route, indexing: page.indexing ?? studioCopy("studio.not-provided"), sitemap: page.inSitemap === undefined ? studioCopy("studio.not-provided") : page.inSitemap ? studioCopy("studio.included") : studioCopy("studio.excluded"), published: page.lastPublished ?? studioCopy("studio.not-provided") };
}

/** The site's root: the route pack's deployment origin when the publication carries one (SITE-ROUTE),
 * otherwise the local preview; the public origin is set at release promotion. */
export function siteRoot(publication: object): { root: string; rootNote: string } {
  const origin = (publication as { origin?: unknown }).origin;
  if (typeof origin === 'string' && /^https?:\/\/[^/]+\/?$/.test(origin)) return { root: origin.replace(/\/$/, ''), rootNote: studioCopy("studio.from-the-route-pack-origin") };
  return { root: studioCopy("studio.local-preview"), rootNote: studioCopy("studio.clossys-com-is-set-at-release-promotion") };
}
