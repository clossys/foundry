import { studioCopy } from './studio-copy';
/**
 * The Producer data a Studio route renders, loaded where the route renders. The browser loads it
 * after hydration; a server render loads it first (`loadStudioSeed`, `loadPageSeed`) and hands it
 * to the client providers as their initial state, so the first paint already holds the page.
 * Server-safe: no hooks and no client-only imports.
 */
import type { StudioPageRecord } from '../generated/studio-map';
import { agentOptionVersions, isLibraryAgent, loadAgentGallery, loadAgentLeaf, type AgentGalleryRecords, type AgentLeafRecords, type LibraryAgent } from './agent-library';
import { stringChanges } from './agent-options';
import type { Agent } from './agents';
import { loadCell, loadCells, type AgentCells } from './cells-client';
import { loadDesignerGallery, loadDesignerLeaf, type DesignerGallery, type DesignerLeaf } from './designer-library';
import { producerUrl } from './producer-url';
import { loadPublication, publisherFrameUrl, safePreviewUrl, type PublicationResponse } from './publisher-preview';
import { loadSlotCensus, type SlotCensusByAgent } from './slot-census-load';
import { loadSlotDetail } from './slot-detail';
import type { SlotDetail } from '../../src/server/slot-detail';
import { studioLeafPages } from './studio-route-map';
import { studioReports, type StudioReport } from './studio-report';
import type { OptionRow } from '../sections/studio-options';
import type { ViewportSpecimen } from '../sections/studio-specimen';

export type Resource<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; value: T };
/** The consumer's brand as its Designer output names it; the mark image is served by Producer. */
export interface StudioBrandInfo { name?: string }
/** One gallery page's record store, as its agent's library endpoint returns it. */
export type StudioGallery = { agent: 'designer'; records: DesignerGallery } | { agent: 'director' | 'writer' | 'publisher'; records: AgentGalleryRecords };
export type LeafRecord = { agent: 'slot'; detail: SlotDetail; publication?: PublicationResponse } | { agent: 'designer'; leaf: DesignerLeaf } | { agent: LibraryAgent; leaf: AgentLeafRecords; previews: ReadonlyMap<number, OptionRow['preview']>; specimens?: readonly ViewportSpecimen[] };

const VIEWPORTS = [375, 768, 1280] as const;
const message = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
const unavailable = () => studioCopy("studio.producer-is-unavailable");

export async function loadReports(signal: AbortSignal): Promise<StudioReport[]> {
  const response = await fetch(producerUrl('/api/config'), { signal, cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(studioCopy("studio.producer-could-not-load-its-configuration", { value0: String(response.status) }));
  const config = await response.json() as Record<string, unknown>;
  // Only the report fields leave this function; the session token is never retained.
  return studioReports({ selection: config.selection, theme: config.theme, compilation: config.compilation });
}

export async function loadBrand(signal: AbortSignal): Promise<StudioBrandInfo> {
  const response = await fetch(producerUrl('/api/brand'), { signal, cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!response.ok) return {};
  const value = await response.json() as Record<string, unknown>;
  return typeof value.name === 'string' && value.name.trim() ? { name: value.name.trim() } : {};
}

export async function loadGallery(agent: string, signal: AbortSignal): Promise<StudioGallery> {
  if (agent === 'designer') return { agent, records: await loadDesignerGallery(signal) };
  if (isLibraryAgent(agent)) return { agent, records: await loadAgentGallery(agent, signal) };
  throw new Error(studioCopy("studio.studio-has-no-library-for", { value0: String(agent) }));
}

export async function loadLeaf(agent: string, slug: string, signal: AbortSignal): Promise<LeafRecord | undefined> {
  const detail = await loadSlotDetail(agent, slug, signal);
  if (detail !== undefined) {
    if (!detail) return undefined;
    const publication = detail.agent === 'publisher' && detail.kind === 'page' ? await loadPublication(signal).catch(() => undefined) : undefined;
    return { agent: 'slot', detail, publication };
  }
  if (agent === 'designer') { const leaf = await loadDesignerLeaf(slug, signal); return leaf && { agent, leaf }; }
  if (!isLibraryAgent(agent)) return undefined;
  const leaf = await loadAgentLeaf(agent, slug, signal);
  if (!leaf) return undefined;
  // Each option shows the strings it changes against the active version.
  const previews = new Map<number, OptionRow['preview']>();
  const options = agentOptionVersions(leaf);
  if (options.length && agent !== 'publisher') {
    const active = leaf.history.find(row => row.active);
    const read = (version: number) => loadCell(agent as Agent, leaf.card.id, signal, version).then(cell => cell.content, () => undefined);
    const base = active ? await read(active.version) : undefined;
    for (const option of options) {
      const content = await read(option.version);
      if (content !== undefined) previews.set(option.version, stringChanges(content, base));
    }
  }
  if (agent !== 'publisher') return { agent, leaf, previews };
  // A Publisher page's specimen is the page itself, as its last install emitted it.
  const publication = await loadPublication(signal).catch(() => undefined);
  const page = publication?.state === 'ready' ? publication.pages.find(row => row.cellId === leaf.card.id) : undefined;
  const specimens = page && page.emitted && safePreviewUrl(page.previewUrl) ? VIEWPORTS.map(viewport => ({ viewport, light: publisherFrameUrl(page, viewport, 'light'), dark: publisherFrameUrl(page, viewport, 'dark') })) : [];
  return { agent, leaf, previews, specimens };
}

/** Settles a load into the resource its consumer renders. */
async function settle<T>(load: Promise<T>, fallback: string): Promise<Resource<T>> {
  try { return { state: 'ready', value: await load }; }
  catch (error) { return { state: 'error', message: message(error, fallback) }; }
}

/** What every Studio route shares: the providers' resources and each gallery page's records. */
export interface StudioSeed {
  cells: Resource<AgentCells[]>; reports: Resource<StudioReport[]>; brand: StudioBrandInfo;
  galleries: Record<string, Resource<StudioGallery>>; census: SlotCensusByAgent;
}
/** What one route adds: its leaf record, or its gallery's publication. */
export interface StudioPageSeed {
  leaf?: { agent: string; slug: string; record: Resource<LeafRecord | undefined> };
  publication?: Resource<PublicationResponse>;
}

/** Only a render inside Producer has a record store to ask; elsewhere the browser loads as before. */
const hasProducer = () => typeof window === 'undefined' && Boolean(process.env.CLOSSYS_PRODUCER_ORIGIN);

export async function loadStudioSeed(signal: AbortSignal = new AbortController().signal): Promise<StudioSeed | undefined> {
  if (!hasProducer()) return undefined;
  const [cells, reports, brand, census, ...galleries] = await Promise.all([
    settle(loadCells(signal), unavailable()),
    settle(loadReports(signal), unavailable()),
    loadBrand(signal).catch((): StudioBrandInfo => ({})),
    loadSlotCensus(signal),
    ...studioLeafPages.map(page => settle(loadGallery(page.leaf!.data.agent ?? page.id, signal), studioCopy("studio.the-library-could-not-load")).then(value => [page.id, value] as const)),
  ]);
  return { cells, reports, brand, census, galleries: Object.fromEntries(galleries) };
}

export async function loadPageSeed(page: StudioPageRecord, slug: string | undefined, signal: AbortSignal = new AbortController().signal): Promise<StudioPageSeed | undefined> {
  if (!hasProducer()) return undefined;
  if (slug !== undefined) {
    const agent = page.leaf?.data.agent ?? page.id;
    return { leaf: { agent, slug, record: await settle(loadLeaf(agent, slug, signal), studioCopy("studio.this-leaf-could-not-load")) } };
  }
  if (page.data.loader !== 'gallery') return {};
  // The gallery renders from its records (seeded with the layout); each card's full preview is
  // progressive and stays a client load, so a large record store never holds back the first paint.
  if (!page.sectionIds.includes('sections.studio.publications')) return {};
  return { publication: await settle(loadPublication(signal), studioCopy("studio.the-publication-could-not-load")) };
}
