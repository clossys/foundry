// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentCells, CellDetail } from '../../studio/lib/cells-client';
const { resources, runtime } = vi.hoisted(() => ({ resources: new Map(), runtime: { components: {} as Record<string, unknown> } }));
vi.mock('../../studio/components/StudioSelection', () => ({ useStudioSelection: () => ({ runtime }), useStudioUI: () => ({ EmptyState: () => null }) }));
vi.mock('../../studio/components/AgentSpecimenProvider', () => ({
  useRoleSpecimenResource: (index: AgentCells) => resources.get(index),
  latestSpecimenCell: (resource: { cells: CellDetail[] }, _index: AgentCells, id: string) => resource.cells.find(cell => cell.id === id),
  RoleToolsProvider: ({ children }: { children: ReactNode }) => children,
}));
import { AgentL3Specimen, SpecimenLeafProvider, useAgentSpecimenCoverage, type ResolveSpecimenLeaf } from '../../studio/components/AgentL3Specimen';
import { SemanticContent } from '@clossys/designer/components';

const mount = document.createElement('main'); document.body.append(mount);
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; resources.clear(); });

describe('mounted registered-renderer measurement lifetime', () => {
  it('measures the selected native host and removes proof when its specimen unmounts', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    runtime.components.SemanticContent = SemanticContent;
    const cell: CellDetail = { agent: 'director', id: 'sample.page', title: 'ExampleCo', version: 1, status: 'draft', content: '## Direction\nA useful direction.' };
    const index: AgentCells = { agent: 'director', state: 'ready', cells: [cell] };
    resources.set(index, { cells: { state: 'ready', cells: [cell] } });
    const measure = vi.fn((element: Element) => ({ agent: 'director' as const, cellId: cell.id, sectionId: 'sections.specimen-rich-passage', surface: 'row' as const, measured: true, variantIds: ['source-1'], issues: element.closest('[hidden]') ? ['hidden-specimen'] : element.textContent?.includes('NEED') ? ['unresolved-specimen'] : [] }));
    const resolve: ResolveSpecimenLeaf = () => ({ sourcePlan: { cellId: cell.id, items: [{ id: 'source-1' }], expectedVariantIds: ['source-1'], issues: [] },
      Component: () => createElement('article', { 'data-ds-leaf': 'sections.specimen-rich-passage' }, 'ExampleCo direction.'), props: { items: [{ id: 'source-1' }] },
      evidence: { sectionId: 'sections.specimen-rich-passage', registered: true, span: 'full', items: [{ id: 'source-1' }], variantIds: ['source-1'] }, measure });
    let proof: unknown;
    function Probe() { proof = useAgentSpecimenCoverage(index, cell).rendered; return null; }
    const view = (shown: boolean) => createElement(SpecimenLeafProvider, { resolve, children: [createElement(Probe, { key: 'probe' }), shown ? createElement(AgentL3Specimen, { key: 'leaf', index, selectedId: cell.id }) : null] });
    root = createRoot(mount);
    await act(async () => root!.render(view(true)));
    expect(measure).toHaveBeenCalledTimes(1); expect(measure.mock.calls[0]![0].isConnected).toBe(true);
    expect(proof).toMatchObject({ measured: true, variantIds: ['source-1'] });
    await act(async () => { mount.hidden = true; await new Promise(resolve => queueMicrotask(resolve)); });
    expect(proof).toMatchObject({ issues: ['hidden-specimen'] });
    await act(async () => { mount.hidden = false; await new Promise(resolve => queueMicrotask(resolve)); });
    await act(async () => { mount.querySelector('article')!.textContent = 'NEED: source pending'; await new Promise(resolve => queueMicrotask(resolve)); });
    expect(proof).toMatchObject({ issues: ['unresolved-specimen'] });
    await act(async () => root!.render(view(false)));
    expect(proof).toBeUndefined();
  });
});
