import { Suspense } from 'react';
import { EmptyState, SectionFrame } from '@clossys/designer/blocks';
import { StudioFrame } from '../components/StudioFrame';
import { CellsWorkspace } from '../components/CellsWorkspace';
export default function HomePage() { return <Suspense fallback={<StudioFrame page={{ title: 'Home' }}><SectionFrame><EmptyState role="status" title="Loading Studio…" /></SectionFrame></StudioFrame>}><CellsWorkspace /></Suspense>; }
