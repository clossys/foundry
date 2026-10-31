/**
 * PROOF-2 Designer library client: the gallery and leaf detail read Producer's
 * record-store projection over HTTP only (`/api/designer/library[/<leaf>]`).
 * REPLACE with the Publisher content-map projection when it lands.
 */
export type DesignerStatus = 'pinned' | 'missing' | 'failing' | 'stale' | 'unreleased';

export interface DesignerCard {
  slot: string; slug: string; name: string; layer: string; status: DesignerStatus;
  element?: string; version?: number; pinned: boolean; specimen?: string;
}
export interface DesignerSection { id: string; label: string; level: 0 | 1 | 2; cards: DesignerCard[] }
export interface DesignerGallery { state: 'ready' | 'missing'; sections: DesignerSection[]; count: number }
export interface DesignerVersionRow { version: number; hash: string; createdAt: string; reason: string; lineage: string; pinned: boolean; released: boolean; verified: boolean }
export interface DesignerLeaf {
  card: DesignerCard;
  trail: string[];
  statusDetail: string[];
  record?: { kind: string; package: string; license: string; creator: string; reason: string; createdAt: string; hash: string };
  contract: { kind?: string; root?: string; inputs: { name: string; type: string; required: boolean }[]; composes: string[]; copyKeys: string[]; themeVars: string[]; dependencies: string[] };
  lineage: { version: number; mode: string; parent?: number; source?: string }[];
  versions: DesignerVersionRow[];
}

export const DESIGNER_STATUS_LABEL: Record<DesignerStatus, string> = {
  pinned: 'Pinned', missing: 'Missing', failing: 'Failing', stale: 'Stale', unreleased: 'Unreleased',
};

/** The one status mark's Badge variant. */
export const DESIGNER_STATUS_TONE: Record<DesignerStatus, 'secondary' | 'outline' | 'destructive'> = {
  pinned: 'secondary', unreleased: 'outline', stale: 'outline', failing: 'destructive', missing: 'destructive',
};

/** The one specimen URL: Publisher's `/__specimen`, mounted by the Producer server. */
export function specimenHref(card: Pick<DesignerCard, 'specimen' | 'version'>, theme: 'light' | 'dark', width: number): string | undefined {
  if (!card.specimen) return undefined;
  const params = new URLSearchParams({ element: card.specimen, theme, width: String(width) });
  if (card.version) params.set('v', String(card.version));
  return `/__specimen?${params}`;
}

export const designerLeafHref = (slug: string) => `/designer/${encodeURIComponent(slug)}`;

async function request(path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(path, { signal, cache: 'no-store', headers: { Accept: 'application/json' } });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Producer could not load the Designer library (${response.status}).`);
  return response.json();
}

function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

export async function loadDesignerGallery(signal: AbortSignal): Promise<DesignerGallery> {
  const value = await request('/api/designer/library', signal);
  if (!object(value) || !Array.isArray(value.sections) || typeof value.count !== 'number') throw new Error('The Designer library response is invalid.');
  return value as unknown as DesignerGallery;
}

export async function loadDesignerLeaf(slug: string, signal: AbortSignal): Promise<DesignerLeaf | undefined> {
  const value = await request(`/api/designer/library/${encodeURIComponent(slug)}`, signal);
  if (value === undefined) return undefined;
  if (!object(value) || value.state !== 'ready' || !object(value.leaf)) throw new Error('The Designer leaf response is invalid.');
  return value.leaf as unknown as DesignerLeaf;
}
