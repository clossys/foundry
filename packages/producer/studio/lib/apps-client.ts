import type { ContentMap, ContentMapBreadcrumb, ContentMapCommandGroup, ContentMapNavigation } from '@clossys/publisher/content-map';

export interface StudioPublication {
  id: string;
  title: string;
  format: string;
  source: 'cells' | 'content-map';
  map: ContentMap;
  entryId?: string;
  target?: { appDirectory?: string; entryId?: string; path?: string; devServerUrl?: string };
  navigation?: ContentMapNavigation;
  commands: readonly ContentMapCommandGroup[];
  breadcrumbs: Record<string, readonly ContentMapBreadcrumb[]>;
}
export interface StudioApps { state: 'ready' | 'missing' | 'error'; publications: StudioPublication[]; message?: string }
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

/** Publisher validates consumer maps on the server; this adapter checks the HTTP envelope. */
export function parseAppsResponse(value: unknown): StudioApps {
  if (!object(value) || !['ready', 'missing', 'error'].includes(String(value.state)) || !Array.isArray(value.publications)) throw new Error('The app publication response is invalid.');
  const ids = new Set<string>();
  for (const publication of value.publications) {
    if (!object(publication) || typeof publication.id !== 'string' || !publication.id || ids.has(publication.id) || typeof publication.title !== 'string' || typeof publication.format !== 'string' || !['cells', 'content-map'].includes(String(publication.source)) || !object(publication.map) || publication.map.publicationId !== publication.id || !Array.isArray(publication.map.entries) || !Array.isArray(publication.commands) || !object(publication.breadcrumbs)) throw new Error('An app publication in the response is invalid.');
    const target = publication.target;
    if (target !== undefined && (!object(target) || ['appDirectory', 'entryId', 'path', 'devServerUrl'].some(key => target[key] !== undefined && typeof target[key] !== 'string'))) throw new Error('An app publication target in the response is invalid.');
    ids.add(publication.id);
  }
  if (value.state !== 'ready' && value.publications.length) throw new Error('Unavailable app publications must not expose partial maps.');
  return value as unknown as StudioApps;
}
export async function loadApps(signal: AbortSignal): Promise<StudioApps> {
  const response = await fetch('/api/apps', { signal, cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Producer could not load app publications (${response.status}).`);
  return parseAppsResponse(await response.json());
}
