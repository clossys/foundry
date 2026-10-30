import { Suspense } from 'react';
import { CellsWorkspace } from '../components/CellsWorkspace';
export default function HomePage() { return <Suspense fallback={<p role="status">Loading Studio…</p>}><CellsWorkspace /></Suspense>; }
