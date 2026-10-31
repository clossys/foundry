/**
 * PROOF-2 route table: the agent library paths Studio serves before the generated map.
 * `/designer[/<leaf>]` keeps its FM-2 views; `/director`, `/writer` and `/publisher`
 * share the agent gallery and detail templates. REPLACE with the Publisher
 * content-map projection when it lands.
 */
import { isLibraryAgent, type LibraryAgent } from './agent-library';

export type ProofRoute =
  | { view: 'designer-gallery' } | { view: 'designer-leaf'; slug: string }
  | { view: 'agent-gallery'; agent: LibraryAgent } | { view: 'agent-leaf'; agent: LibraryAgent; slug: string };

const SLUG = /^[a-z0-9][a-z0-9.-]*$/;

export function proofRouteForSegments(segments: readonly string[]): ProofRoute | undefined {
  const [agent, slug] = segments;
  if (!agent || segments.length > 2 || (slug !== undefined && !SLUG.test(slug))) return undefined;
  if (agent === 'designer') return slug === undefined ? { view: 'designer-gallery' } : { view: 'designer-leaf', slug };
  if (!isLibraryAgent(agent)) return undefined;
  return slug === undefined ? { view: 'agent-gallery', agent } : { view: 'agent-leaf', agent, slug };
}

/**
 * The library route for a Studio page id: every agent page now lives at `/<agent>`. The shared
 * header resolves breadcrumb and navigation hrefs through this one function, so no crumb still
 * points at the projection's legacy `/agents/<agent>` path.
 */
export function libraryRouteHref(pageId: string): string | undefined {
  return pageId === 'designer' || isLibraryAgent(pageId) ? `/${pageId}` : undefined;
}

/** The Studio page the Designer proof routes belong to, for navigation and breadcrumbs. */
export const PROOF_PAGE_ID = 'designer';
