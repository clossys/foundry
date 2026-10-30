import { Suspense } from 'react';
import { StudioLoading } from '../components/StudioSelection';
import { StudioFrame } from '../components/StudioFrame';
import { CellsWorkspace } from '../components/CellsWorkspace';
export default function HomePage() { return <Suspense fallback={<StudioFrame page={{ title: 'Home' }}><StudioLoading /></StudioFrame>}><CellsWorkspace /></Suspense>; }
