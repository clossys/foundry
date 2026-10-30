import { Suspense } from 'react';
import { EmptyState, SectionFrame } from '@clossys/designer/blocks';
import { StudioFrame } from '../../../components/StudioFrame';
import { notFound } from 'next/navigation';
import { CellsWorkspace } from '../../../components/CellsWorkspace';
import { AGENT_LABELS, isAgent } from '../../../lib/agents';

export function generateStaticParams() { return ['director', 'designer', 'writer', 'publisher'].map(agent => ({ agent })); }
export default async function AgentPage({ params }: { params: Promise<{ agent: string }> }) {
  const { agent } = await params;
  if (!isAgent(agent)) notFound();
  return <Suspense fallback={<StudioFrame page={{ title: AGENT_LABELS[agent] }}><SectionFrame><EmptyState role="status" title="Loading Studio…" /></SectionFrame></StudioFrame>}><CellsWorkspace agent={agent} /></Suspense>;
}
