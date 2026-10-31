import { notFound } from 'next/navigation';
import { StudioPage } from '../../components/StudioPage';
import { resolveStudioRoute, studioRuntimeMap } from '../../lib/studio-route-map';

/** The one generic page: every Studio path renders the Publisher assembly the Studio map resolves it to. */
export default async function Page({ params }: { params: Promise<{ route?: string[] }> }) {
  const { route = [] } = await params;
  // Paths the map can never hold (not a compiled page, not one segment under a leaf gallery) are 404s.
  if (resolveStudioRoute(studioRuntimeMap({}), {}, route).state === 'missing') notFound();
  return <StudioPage segments={route} />;
}
