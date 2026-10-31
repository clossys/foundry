/**
 * PROOF-2 route table: the two Designer library paths Studio serves before the
 * generated map. REPLACE with the Publisher content-map projection when it lands.
 */
export type ProofRoute = { view: 'designer-gallery' } | { view: 'designer-leaf'; slug: string };

const SLUG = /^[a-z0-9][a-z0-9.-]*$/;

export function proofRouteForSegments(segments: readonly string[]): ProofRoute | undefined {
  if (segments.length === 1 && segments[0] === 'designer') return { view: 'designer-gallery' };
  if (segments.length === 2 && segments[0] === 'designer' && SLUG.test(segments[1]!)) return { view: 'designer-leaf', slug: segments[1]! };
  return undefined;
}

/** The Studio page the proof routes belong to, for navigation and breadcrumbs. */
export const PROOF_PAGE_ID = 'designer';
