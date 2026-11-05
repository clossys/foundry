import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { StudioPage } from './StudioPage';
import { StudioDocument } from './StudioDocument';
import { StudioProviders, THEME_INIT_SCRIPT } from './StudioProviders';
import { studioDocument, studioLeaves, studioPages } from '../generated/studio-map';
import { studioCopy } from '../lib/studio-copy';
import { studioLanding } from '../lib/studio-route-map';
import { loadPageSeed, loadStudioSeed } from '../lib/studio-seed';

/**
 * Studio's assembly module for the routes Publisher installs into `app/` (`publish --install
 * --next`). An installed route names only the page id, and for a leaf its slug; this module turns
 * that into the served segments the generic StudioPage assembles (frame + sections from the map).
 * The installed root layout mounts `PublishedDocument` and serves `publishedMetadata`; the
 * installed state files mount the renderer's `PublishedState`.
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

/** The document's metadata: its words are Writer keys, its icons the brand assets the projection names. */
export const publishedMetadata: Metadata = { title: studioCopy('studio.studio'), description: studioCopy('studio.browse-your-agent-cells'), icons: { ...studioDocument.icons } };

/**
 * The publication's document around every installed route: the theme script that runs before
 * paint, the projected stylesheets (the consumer's Designer globals, which load after Studio's
 * stock component layer, so the consumer's brand is what renders) and the providers over the
 * shared Producer data the server loads first, so the first paint is the page.
 */
export async function PublishedDocument({ children }: { children: ReactNode }) {
  const seed = await loadStudioSeed();
  const head = <>
    <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
    {studioDocument.stylesheets.map(sheet => <link key={sheet.href} rel="stylesheet" href={sheet.href} precedence={sheet.precedence} />)}
  </>;
  return <StudioDocument head={head}><StudioProviders {...(seed ? { seed } : {})}>{children}</StudioProviders></StudioDocument>;
}
