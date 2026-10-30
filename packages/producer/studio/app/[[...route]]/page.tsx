import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { StudioFrame } from '../../components/StudioFrame';
import { WorkspaceLoading } from '../../components/CellsWorkspace';
import { studioRouteForSegments } from '../../generated/studio-map';
import { studioViewBindings } from '../../generated/view-bindings';

export default async function StudioPage({ params }: { params: Promise<{ route?: string[] }> }) {
  const { route = [] } = await params;
  const match = studioRouteForSegments(route);
  if (!match) notFound();
  const View = studioViewBindings[match.instanceId];
  if (!View) notFound();
  return <Suspense fallback={<StudioFrame><WorkspaceLoading title={match.label} /></StudioFrame>}><View /></Suspense>;
}
