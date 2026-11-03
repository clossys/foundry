import { studioCopy } from './studio-copy';
/**
 * The Producer data a Studio route renders, loaded where the route renders. The browser loads it
 * after hydration; a server render loads it first (`loadStudioSeed`, `loadPageSeed`) and hands it
 * to the client providers as their initial state, so the first paint already holds the page.
 * Server-safe: no hooks and no client-only imports.
 */
import type { StudioAssemblySpec } from '../generated/studio-map';
import { loadCells, type AgentCells } from './cells-client';
import { producerUrl } from './producer-url';
import { loadPublication, type PublicationResponse } from './publisher-preview';
import { loadSlotCensus, type SlotCensusByAgent } from './slot-census-load';
import { loadSlotDetail } from './slot-detail';
import type { SlotDetail } from '../../src/server/slot-detail';
import type { SlotGallerySection } from '../../src/server/slot-gallery';
import { studioReports, type StudioReport } from './studio-report';

export type Resource<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; value: T };
/** The consumer's brand as its Designer output names it; the mark image is served by Producer. */
export interface StudioBrandInfo { name?: string }
/** One agent's slots as Producer's slot gallery returns them: IA sections, each with its slot cards. */
export interface SlotGroupsRecord { sections: readonly SlotGallerySection[]; count: number }
/** A leaf's record: the slot detail and, beside it, the publication that may have emitted it. */
export interface LeafRecord { detail: SlotDetail; publication?: PublicationResponse }

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

/** One agent's slot gallery: the agent is record data (the page's loader input), never a branch. */
export async function loadSlotGroups(agent: string, signal: AbortSignal): Promise<SlotGroupsRecord> {
  const response = await fetch(producerUrl(`/api/slots/${encodeURIComponent(agent)}`), { signal, cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(studioCopy("studio.the-library-could-not-load"));
  const value = await response.json() as { state?: unknown; sections?: unknown; count?: unknown };
  if (value.state !== 'ready' || !Array.isArray(value.sections)) throw new Error(studioCopy("studio.the-library-could-not-load"));
  return { sections: value.sections as SlotGallerySection[], count: typeof value.count === 'number' ? value.count : 0 };
}

export async function loadLeaf(agent: string, slug: string, signal: AbortSignal): Promise<LeafRecord | undefined> {
  const detail = await loadSlotDetail(agent, slug, signal);
  if (!detail) return undefined;
  // Any slot may be a page the publication emitted; the detail shows that page when it is.
  const publication = await loadPublication(signal).catch(() => undefined);
  return { detail, ...(publication ? { publication } : {}) };
}

/** Settles a load into the resource its consumer renders. */
async function settle<T>(load: Promise<T>, fallback: string): Promise<Resource<T>> {
  try { return { state: 'ready', value: await load }; }
  catch (error) { return { state: 'error', message: message(error, fallback) }; }
}

/** What every Studio route shares: the providers' resources. */
export interface StudioSeed { cells: Resource<AgentCells[]>; reports: Resource<StudioReport[]>; brand: StudioBrandInfo; census: SlotCensusByAgent }
/** What one route adds: its leaf record, or its page's slot groups. */
export interface StudioPageSeed {
  leaf?: { agent: string; slug: string; record: Resource<LeafRecord | undefined> };
  groups?: { agent: string; record: Resource<SlotGroupsRecord> };
}

/** Only a render inside Producer has a record store to ask; elsewhere the browser loads as before. */
const hasProducer = () => typeof window === 'undefined' && Boolean(process.env.CLOSSYS_PRODUCER_ORIGIN);

export async function loadStudioSeed(signal: AbortSignal = new AbortController().signal): Promise<StudioSeed | undefined> {
  if (!hasProducer()) return undefined;
  const [cells, reports, brand, census] = await Promise.all([
    settle(loadCells(signal), unavailable()),
    settle(loadReports(signal), unavailable()),
    loadBrand(signal).catch((): StudioBrandInfo => ({})),
    loadSlotCensus(signal),
  ]);
  return { cells, reports, brand, census };
}

/** The data a page record's loader reads, by the record's own loader input (`data.agent`). */
export async function loadPageSeed(spec: StudioAssemblySpec, slug: string | undefined, signal: AbortSignal = new AbortController().signal): Promise<StudioPageSeed | undefined> {
  if (!hasProducer()) return undefined;
  const agent = spec.data.agent;
  if (!agent) return {};
  if (slug !== undefined) return { leaf: { agent, slug, record: await settle(loadLeaf(agent, slug, signal), studioCopy("studio.this-leaf-could-not-load")) } };
  return { groups: { agent, record: await settle(loadSlotGroups(agent, signal), studioCopy("studio.the-library-could-not-load")) } };
}
