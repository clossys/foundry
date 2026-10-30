'use client';
import { EmptyState, SectionFrame } from '@clossys/designer/blocks';
import { Icon } from '@clossys/designer/components';
import { Home } from '@clossys/designer/icons';
import { StudioFrame } from '../../components/StudioFrame';
export default function AppsPage() {
  return <StudioFrame page={{ title: 'Apps', description: 'Read-only Studio', actions: [{ id: 'home', label: 'Open Home', href: '/', icon: <Icon glyph={Home} decorative /> }] }}><SectionFrame><EmptyState title="App browsing unavailable" description="App browsing is not available in this Studio draft." /></SectionFrame></StudioFrame>;
}
