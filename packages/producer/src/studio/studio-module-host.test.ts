import { describe, expect, it } from 'vitest';
import { moduleStates, changeModuleState, selectedModuleSection } from '../../studio/lib/studio-module-host';
import { studioModulePayloads, appendStudioActivity } from '../../studio/lib/studio-module-data';
import type { AgentCells, CellDetail } from '../../studio/lib/cells-client';

const actions = [
  { id: 'outline', module: 'sections.cell-explorer', icon: 'assets.icon-tree', label: 'Outline from manifest', defaultOpen: true },
  { id: 'raw', module: 'sections.source-view', icon: 'assets.icon-document', label: 'Source from manifest', defaultOpen: false },
];
describe('manifest module host', () => {
  it('takes initial open state from the manifest and keeps collapse independent of action toggles', () => {
    let state = moduleStates(actions);
    expect(state).toEqual({ outline: { open: true, collapsed: false }, raw: { open: false, collapsed: false } });
    state = changeModuleState(state, 'outline', 'collapse');
    state = changeModuleState(state, 'raw', 'toggle');
    expect(state.outline).toEqual({ open: true, collapsed: true });
    expect(state.raw).toEqual({ open: true, collapsed: false });
    expect(() => changeModuleState(state, 'not-in-manifest', 'toggle')).toThrow();
  });
  it('requires actual selected registered sections and never substitutes a different section', () => {
    const CellExplorer = () => null;
    expect(selectedModuleSection(actions[0]!, [], { CellExplorer }, {})).toMatchObject({ need: { code: 'missing-section', sectionId: 'sections.cell-explorer' } });
    const leaves = [{ leaf: 'sections.cell-explorer', source: 'fallback' as const, fill: 'foundry/sections.cell-explorer' }];
    expect(selectedModuleSection(actions[0]!, leaves, { Explorer: CellExplorer }, {})).toMatchObject({ need: { code: 'missing-selected-export' } });
    expect(selectedModuleSection(actions[0]!, leaves, { CellExplorer }, {}).component).toBe(CellExplorer);
  });
  it('projects tree order, truthful details, exact links and read-only source as data', () => {
    const cell: CellDetail = { agent: 'director', id: 'focus.segment.core', title: 'core', version: 2, status: 'draft', content: 'raw fixture', fields: { updated: '2026-10-29', cites: ['finding:study'], links: ['writer:example.page@1', 'finding:unresolved'] } };
    const index: AgentCells = { agent: 'director', state: 'ready', cells: [cell], tree: { tree: [{ id: 'focus', name: 'Focus', children: [{ id: 'segment', name: 'Segment', cells: [cell.id] }] }] } };
    const writer: AgentCells = { agent: 'writer', state: 'ready', cells: [{ id: 'example.page', title: 'page', version: 1, status: 'active', fields: { links: ['director:focus.segment.core@2'] } }] };
    const payloads = studioModulePayloads({ indexes: [index, writer], agent: 'director', selectedId: cell.id, detail: cell, selection: { hash: 'fixture', leaves: [] }, activity: [], connected: true, checks: { state: 'ready', results: [] } });
    expect(payloads['sections.cell-explorer']).toMatchObject({ tree: [{ id: 'focus', children: [{ id: 'segment', children: [{ id: cell.id }] }] }] });
    expect(payloads['sections.source-view']).toEqual({ state: 'ready', readOnly: true, source: 'raw fixture', id: cell.id, version: 2 });
    expect(payloads['sections.cell-details']).toMatchObject({ cell: { status: 'draft', version: 2, sources: ['finding:study'], uses: [{ agent: 'writer', id: 'example.page', version: 1 }, { reference: 'finding:unresolved' }], usedBy: [{ agent: 'writer', id: 'example.page' }] } });
  });
  it('records only received SSE events with an explicit receipt timestamp', () => {
    expect(appendStudioActivity([], { kind: 'change', agent: 'writer', id: 'example.page', receivedAt: '2026-10-30T00:00:00Z' })).toEqual([{ kind: 'change', agent: 'writer', id: 'example.page', receivedAt: '2026-10-30T00:00:00Z' }]);
  });
});
