import { redirect } from 'next/navigation';
import { StudioPage } from './StudioPage';
import { studioLeaves, studioPages } from '../generated/studio-map';
import { studioLanding } from '../lib/studio-route-map';
import { loadPageSeed } from '../lib/studio-seed';

/**
 * Studio's assembly module for the routes Publisher installs into `app/` (`publish --install
 * --next`). An installed route names only the page id, and for a leaf its slug; this module turns
 * that into the served segments the generic StudioPage assembles (frame + sections from the map).
 */
const pageById = new Map(studioPages.map(page => [page.id, page]));
const segmentsOf = (path: string) => path.split('/').filter(Boolean);

/** The installed page, rendered on the server over the data it shows so the first paint is the page. */
export async function PublishedPage({ page, slug }: { page: string; slug?: string }) {
  const record = pageById.get(page);
  if (!record) throw new Error(`Studio has no installed page ${page}`);
  // A record with group tabs opens on its first tab: Publisher's projected landing for the record.
  const landing = slug === undefined ? studioLanding(record.id) : undefined;
  if (landing && landing !== record.path) redirect(landing);
  const spec = slug === undefined ? record : record.leaf;
  const seed = spec ? await loadPageSeed(spec, slug) : undefined;
  return <StudioPage segments={[...segmentsOf(record.path), ...(slug === undefined ? [] : [slug])]} {...(seed ? { seed } : {})} />;
}

/** Whether a tab serves a leaf: the content map's expansion lists every one. */
export async function publishedLeaf(page: string, slug: string): Promise<boolean> {
  return studioLeaves.some(leaf => leaf.page === page && leaf.slug === slug);
}
