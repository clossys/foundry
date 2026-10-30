import type { CompositeResolved } from '@clossys/designer/catalog';

export const STUDIO_NEEDED_LEAVES = [
  'frames.app-shell', 'sections.band', 'sections.section-header', 'sections.content', 'sections.article', 'sections.empty-state',
  'components.badge', 'components.icon', 'components.link', 'components.navigation-tree', 'components.disclosure',
] as const;

export interface StudioSelectionLeaf {
  leaf: string;
  source: 'consumer' | 'fallback' | 'foundry' | 'unavailable';
  fill?: string;
  hash?: string;
  message?: string;
}
export interface StudioSelection {
  hash: string;
  runtimeUrl?: string;
  profileUrl?: string;
  css?: string;
  cssHash?: string;
  message?: string;
  leaves: StudioSelectionLeaf[];
}

export function parseSelectionResponse(value: unknown): StudioSelection {
  const selection = (value as { selection?: unknown } | null)?.selection;
  if (!selection || typeof selection !== 'object') throw new Error('Producer did not supply a Designer selection.');
  const row = selection as Record<string, unknown>;
  if (typeof row.hash !== 'string' || row.runtimeUrl !== undefined && (!/^sha256:[a-f0-9]{64}$/.test(row.hash)
    || typeof row.runtimeUrl !== 'string' || !row.runtimeUrl.startsWith('/api/selection/runtime.js?')
    || typeof row.css !== 'string' || !row.css.trim() || typeof row.cssHash !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(row.cssHash))
    || row.message !== undefined && typeof row.message !== 'string' || !Array.isArray(row.leaves)) throw new Error('Producer supplied an invalid Designer selection.');
  if (row.profileUrl !== undefined) {
    if (typeof row.profileUrl !== 'string' || !row.profileUrl.startsWith('/') || row.profileUrl.startsWith('//')) throw new Error('Producer supplied an invalid Designer profile URL.');
    const profileUrl = new URL(row.profileUrl, 'http://studio.invalid');
    if (profileUrl.origin !== 'http://studio.invalid' || profileUrl.pathname !== '/api/selection/profile' || profileUrl.hash
      || profileUrl.searchParams.size !== 1 || profileUrl.searchParams.get('hash') !== row.hash) throw new Error('Producer supplied an invalid Designer profile URL.');
  }
  const leaves = row.leaves as StudioSelectionLeaf[];
  if (leaves.some(leaf => !leaf || typeof leaf.leaf !== 'string' || !['consumer', 'fallback', 'foundry', 'unavailable'].includes(leaf.source)
    || leaf.fill !== undefined && typeof leaf.fill !== 'string' || leaf.message !== undefined && typeof leaf.message !== 'string')
    || new Set(leaves.map(leaf => leaf.leaf)).size !== leaves.length
    || row.runtimeUrl !== undefined && STUDIO_NEEDED_LEAVES.some(leaf => !leaves.some(row => row.leaf === leaf))) throw new Error('Producer supplied incomplete Designer selection provenance.');
  return { hash: row.hash, runtimeUrl: row.runtimeUrl as string | undefined, profileUrl: row.profileUrl as string | undefined, css: row.css as string | undefined, cssHash: row.cssHash as string | undefined, leaves, ...(typeof row.message === 'string' ? { message: row.message } : {}) };
}

/** The profile and executable module must come from the same compiler resolution. */
export async function loadSelectionProfile(selection: StudioSelection, signal: AbortSignal): Promise<CompositeResolved | undefined> {
  if (!selection.profileUrl) return undefined;
  const response = await fetch(selection.profileUrl, { signal, cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Producer could not load the selected Designer profile (${response.status}).`);
  const profile: unknown = await response.json();
  if (!profile || typeof profile !== 'object' || !('selectionHash' in profile) || profile.selectionHash !== selection.hash
    || !('values' in profile) || !profile.values || typeof profile.values !== 'object'
    || !('components' in profile) || !profile.components || typeof profile.components !== 'object') throw new Error('Producer supplied a stale or invalid Designer profile.');
  return profile as CompositeResolved;
}

export async function verifySelectionCss(selection: StudioSelection): Promise<void> {
  if (!selection.css || !selection.cssHash) throw new Error('The selected Designer stylesheet is missing.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(selection.css));
  const hash = `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
  if (hash !== selection.cssHash) throw new Error('The selected Designer stylesheet hash is invalid.');
}

export async function loadSelection(signal: AbortSignal): Promise<StudioSelection> {
  const response = await fetch('/api/config', { signal, cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Producer could not load the Designer selection (${response.status}).`);
  return parseSelectionResponse(await response.json());
}
