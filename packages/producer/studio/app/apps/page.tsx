'use client';
import { useStudioUI } from '../../components/StudioSelection';
import { StudioFrame } from '../../components/StudioFrame';
export default function AppsPage() {
  const { EmptyState, SectionFrame, Icon } = useStudioUI();
  return <StudioFrame page={{ title: 'Apps', description: 'Read-only Studio', actions: [{ id: 'home', label: 'Open Home', href: '/', icon: <Icon asset="assets.icon-home" decorative /> }] }}><SectionFrame><EmptyState title="App browsing unavailable" description="App browsing is not available in this Studio draft." /></SectionFrame></StudioFrame>;
}
