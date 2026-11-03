import { StudioPage } from './StudioPage';
import { studioPages } from '../generated/studio-map';
import { loadPageSeed } from '../lib/studio-seed';

/**
 * Studio's assembly module for the routes Publisher installs into `app/` (`publish --install
 * --next`). An installed route names only the page id, and for a leaf its slug; this module turns
 * that into the served segments the generic StudioPage assembles (frame + sections from the map).
 */
const LEAF_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const pageById = new Map(studioPages.map(page => [page.id, page]));
const segmentsOf = (path: string) => path.split('/').filter(Boolean);

/** The installed page, rendered on the server over the data it shows so the first paint is the page. */
export async function PublishedPage({ page, slug }: { page: string; slug?: string }) {
  const record = pageById.get(page);
  if (!record) throw new Error(`Studio has no installed page ${page}`);
  const seed = await loadPageSeed(record, slug);
  return <StudioPage segments={[...segmentsOf(record.path), ...(slug === undefined ? [] : [slug])]} {...(seed ? { seed } : {})} />;
}

/** Whether the gallery's record store holds a leaf, asked of Producer's library API at request time. */
export async function publishedLeaf(page: string, slug: string): Promise<boolean> {
  const record = pageById.get(page);
  if (!record?.leaf || !LEAF_SLUG.test(slug)) return false;
  const origin = process.env.CLOSSYS_PRODUCER_ORIGIN;
  // Outside Producer there is no record store to ask; the client resolves the leaf against the map.
  if (!origin) return true;
  const agent = record.leaf.data.agent ?? record.id;
  const response = await fetch(`${origin}/api/${agent === 'designer' ? 'designer' : `agents/${encodeURIComponent(agent)}`}/library`, { cache: 'no-store', headers: { Accept: 'application/json' } });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error('Producer could not load the library');
  const gallery = await response.json() as { sections?: readonly { cards?: readonly { slug?: unknown }[] }[] };
  return (gallery.sections ?? []).some(section => (section.cards ?? []).some(card => card.slug === slug));
}
