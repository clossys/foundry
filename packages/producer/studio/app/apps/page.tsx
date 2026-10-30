'use client';
import { EmptyState, SectionFrame } from '@clossys/designer/blocks';
import { StudioFrame } from '../../components/StudioFrame';
export default function AppsPage() {
  return <StudioFrame page={{ title: 'Apps', description: 'Read-only Studio' }}><SectionFrame><EmptyState title="No apps connected" description="App browsing is not available in this Studio draft." /></SectionFrame></StudioFrame>;
}
