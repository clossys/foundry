import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { StudioFrame } from '../../components/StudioFrame';
import { WorkspaceLoading } from '../../components/CellsWorkspace';
import { studioRouteForSegments } from '../../generated/studio-map';
import { studioViewBindings } from '../../generated/view-bindings';
import { proofRouteForSegments } from '../../lib/proof-routes';
import DesignerView from '../../views/DesignerView';
import DesignerLeafView from '../../views/DesignerLeafView';

export default async function StudioPage({ params }: { params: Promise<{ route?: string[] }> }) {
  const { route = [] } = await params;
  // PROOF-2: the Designer library paths resolve here first. REPLACE with the Publisher projection.
  const proof = proofRouteForSegments(route);
  if (proof?.view === 'designer-gallery') return <DesignerView />;
  if (proof?.view === 'designer-leaf') return <DesignerLeafView slug={proof.slug} />;
  const match = studioRouteForSegments(route);
  if (!match) notFound();
  const View = studioViewBindings[match.instanceId];
  if (!View) notFound();
  return <Suspense fallback={<StudioFrame><WorkspaceLoading title={match.label} /></StudioFrame>}><View /></Suspense>;
}
