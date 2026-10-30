import { describe, expect, it } from 'vitest';
import { studioPageActions } from '../../studio/generated/studio-map';
import { moduleStates, changeModuleState, selectedModuleSection } from '../../studio/lib/studio-module-host';
import { studioModulePayloads, studioCellContentHref, studioCellChange } from '../../studio/lib/studio-module-data';
import type { AgentCells, CellDetail } from '../../studio/lib/cells-client';

const actions = [
  { id: 'outline', module: { section: 'sections.explorer' }, icon: 'assets.icon-tree', label: 'Outline from manifest', defaultOpen: true },
  { id: 'raw', module: { section: 'sections.content' }, icon: 'assets.icon-document', label: 'Source from manifest', defaultOpen: false },
];
describe('manifest module host', () => {
  it('opens only the manifest Explorer by default on every actual agent page', () => {
    for (const page of ['director', 'designer', 'writer', 'publisher']) {
      const actions = studioPageActions[page]!.filter((action): action is typeof action & { module: { section: string } } => Boolean(action.module));
      const state = moduleStates(actions);
      expect(actions.filter(action => state[action.id]?.open).map(action => action.module.section)).toEqual(['sections.explorer']);
    }
  });
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
    const Explorer = () => null;
    expect(selectedModuleSection(actions[0]!, [], { Explorer }, {})).toMatchObject({ need: { code: 'missing-section', sectionId: 'sections.explorer' } });
    const leaves = [{ leaf: 'sections.explorer', source: 'fallback' as const, fill: 'foundry/sections.explorer' }];
    expect(selectedModuleSection(actions[0]!, leaves, { CellExplorer: Explorer }, {})).toMatchObject({ need: { code: 'missing-selected-export' } });
    expect(selectedModuleSection(actions[0]!, leaves, { Explorer }, {}).component).toBe(Explorer);
  });
  it('projects tree order, truthful details, exact links and read-only source as data', () => {
    const cell: CellDetail = { agent: 'director', id: 'focus.segment.core', title: 'core', version: 2, status: 'draft', content: 'raw fixture', fields: { updated: '2026-10-29', cites: ['finding:study'], links: ['writer:example.page@1', 'finding:unresolved'] } };
    const index: AgentCells = { agent: 'director', state: 'ready', cells: [cell], tree: { tree: [{ id: 'focus', name: 'Focus', children: [{ id: 'segment', name: 'Segment', cells: [cell.id] }] }] } };
    const writer: AgentCells = { agent: 'writer', state: 'ready', cells: [{ id: 'example.page', title: 'page', version: 1, status: 'active', fields: { links: ['director:focus.segment.core@2'] } }] };
    const payloads = studioModulePayloads({ indexes: [index, writer], agent: 'director', selectedId: cell.id, detail: cell, selection: { hash: 'fixture', leaves: [] }, checks: { state: 'ready', results: [] } });
    expect(payloads['sections.explorer']).toMatchObject({ tree: [{ id: 'agent:director', children: [{ id: 'focus', children: [{ id: 'segment', children: [{ id: cell.id }] }] }] }] });
    expect(payloads['sections.content']).toEqual({ state: 'ready', readOnly: true, source: 'raw fixture', id: cell.id, version: 2 });
    expect(payloads['director.inspector']).toMatchObject({ cell: { status: 'draft', version: 2, sources: ['finding:study'], uses: [{ agent: 'writer', id: 'example.page', version: 1 }, { reference: 'finding:unresolved' }], usedBy: [{ agent: 'writer', id: 'example.page' }] } });
  });
  it('uses only native cell content targets and validates real change events', () => {
    expect(studioCellContentHref('director', 'focus.segment.core')).toBe('/content/director/focus.segment.core');
    expect(() => studioCellContentHref('writer', '../../elsewhere')).toThrow();
    expect(studioCellChange({ reload: true, agent: 'writer', id: 'example.page' })).toBe(true);
    expect(studioCellChange({ reload: true, agent: 'unknown', id: 'example.page' })).toBe(false);
  });
});
