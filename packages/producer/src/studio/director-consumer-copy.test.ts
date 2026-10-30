import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCellsResponse, parseCellResponse, type AgentCells } from '../../studio/lib/cells-client';
import { projectStudioAgentIA, studioIABreadcrumb } from '../../studio/lib/studio-agent-ia';
import { studioModulePayloads } from '../../studio/lib/studio-module-data';
import { directorDocument, specimenTitle } from '../../studio/lib/director-specimen';
import { createDirectorCopyBindings } from '../../studio/lib/director-copy-bindings';

const id = 'context.market.size';
const cell = (id: string) => ({ id, version: 1, status: 'draft', path: `cells/${id}/v1.md`, fields: { title: 'Untrusted transport title' } });
function transport(ids = [id]) {
  return { agents: [{ agent: 'director', state: 'ready', cells: ids.map(cell), tree: { tree: [{ id: 'context', name: 'Context', children: [{ id: 'context.market', name: 'Market', cells: ids }] }] } }] };
}
function inspector(index: AgentCells) {
  const detail = parseCellResponse({ agent: 'director', state: 'ready', cell: { ...cell(id), source: '## Direction\n- Retain the authored strategy.' } }, 'director', id);
  return studioModulePayloads({ indexes: [index], agent: 'director', selectedId: id, detail, selection: { hash: 'public-test', leaves: [] }, checks: { state: 'ready', results: [] } });
}

describe('Director copy in the Studio consumer', () => {
  it('carries the Writer heading through HTTP parsing, IA, breadcrumb, document and inspector', () => {
    const index = parseCellsResponse(transport())[0]!;
    const parsed = index.cells[0]!;
    expect(parsed.title).toBe('Market size');
    expect(parsed.directorLabel).toMatchObject({ state: 'bound', text: 'Market size', role: 'heading', provenance: { kind: 'writer-copy', status: 'draft', activation: 'none', binding: { sourceCellId: id, role: 'heading' } } });
    expect(parsed.directorInspectAction).toMatchObject({ text: 'Inspect Market size', role: 'action', status: 'draft', activation: 'none', binding: { cellId: 'director.action.inspectCell', kind: 'CopyRef', role: 'action' } });
    expect(parsed.fields).toEqual({ title: 'Untrusted transport title' });
    const ia = projectStudioAgentIA(index);
    expect(ia.groups[0]!.collections[0]!.cells[0]!.title).toBe('Market size');
    expect(ia.tree[0]!.children![0]!.children![0]!.children![0]!.label).toBe('Market size');
    expect(studioIABreadcrumb(ia, id).at(-1)!.label).toBe('Market size');
    expect(directorDocument(index)[0]!.children[0]!.children[0]!.title).toBe('Market size');
    expect(inspector(index)['director.inspector']).toMatchObject({ state: 'ready', cell: { id, title: 'Market size' } });
  });

  it('uses Writer headings for all 57 catalog cells through the actual transport and IA', () => {
    const catalog: { id: string }[] = JSON.parse(readFileSync(new URL('../../../strategist/src/catalog/cells/strategy.json', import.meta.url), 'utf8'));
    const index = parseCellsResponse(transport(catalog.map(cell => cell.id)))[0]!;
    const projected = projectStudioAgentIA(index).groups[0]!.collections[0]!.cells;
    expect(projected).toHaveLength(57);
    for (const cell of projected) {
      expect(cell.directorLabel, cell.id).toMatchObject({ state: 'bound', role: 'heading', provenance: { kind: 'writer-copy', status: 'draft', activation: 'none', binding: { sourceCellId: cell.id, role: 'heading' } } });
      expect(cell.title, cell.id).not.toBe(cell.id);
      expect(cell.title, cell.id).not.toBe(cell.id.split('.').at(-1));
      expect(cell.title, cell.id).not.toBe('Untrusted transport title');
    }
  });

  it('normalizes direct index inputs and uses plain missing words for unknown cells', () => {
    const unknown = 'context.market.unregistered';
    const index = parseCellsResponse(transport([unknown]))[0]!;
    const direct = { ...index, cells: [{ ...index.cells[0]!, title: unknown, fields: { title: 'Fabricated card title' } }] };
    const projected = projectStudioAgentIA(direct).groups[0]!.collections[0]!.cells[0]!;
    expect(projected.directorLabel).toMatchObject({ state: 'need', code: 'cell-title-unavailable' });
    expect(projected.directorInspectAction).toBeUndefined();
    expect(projected.title).toMatch(/not available yet/);
    expect(projected.title).not.toMatch(/NEED|unregistered|context\.|Fabricated/);
    expect(specimenTitle(projected)).toBe(projected.title);
  });

  it('keeps production approval unavailable and never revives a field or ID fallback', () => {
    const production = createDirectorCopyBindings();
    expect(specimenTitle({ id, title: 'size', fields: { title: 'Local fallback' } }, production)).toBe('This card title is not available yet.');
    expect(specimenTitle({ id, title: 'size', fields: { title: 'Local fallback' } })).toBe('Market size');
  });

  it('leaves other agents on their existing authored title transport', () => {
    const response = { agents: [{ agent: 'writer', state: 'ready', cells: [{ ...cell('copy.example'), fields: { title: 'Writer-authored page' } }] }] };
    expect(parseCellsResponse(response)[0]!.cells[0]!.title).toBe('Writer-authored page');
  });
});
