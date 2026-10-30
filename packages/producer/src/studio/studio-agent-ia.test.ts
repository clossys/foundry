import { describe, expect, it } from 'vitest';
import type { AgentCells } from '../../studio/lib/cells-client';
import { projectStudioAgentIA, studioIABreadcrumb, studioIAHref } from '../../studio/lib/studio-agent-ia';
import { checkStudioSpecimenCoverage, type StudioCoverageEvidence } from '../../studio/lib/studio-specimen-coverage';

function fixture(agent: AgentCells['agent'] = 'director'): AgentCells {
  return { agent, state: 'ready', cells: ['second', 'first'].map((name, i) => ({ id: `focus.segment.${name}`, title: name, version: i + 1, status: 'draft' })), tree: { tree: [{ id: 'focus', name: 'Focus', children: [{ id: 'segment', name: 'Segment', cells: ['focus.segment.first', 'focus.segment.second'] }] }] } };
}
function evidence(index: AgentCells): StudioCoverageEvidence[] {
  return index.cells.map(cell => ({ cellId: cell.id, ready: true, inventoryComplete: true, boundSectionId: 'sections.specimen-rich-passage', registered: true, span: 'full', itemCount: 2, expectedVariantIds: ['visible', 'hidden'], variants: [{ id: 'visible', renderable: true }, { id: 'hidden', renderable: true }], issues: [] }));
}
describe('shared authored IA and strict specimen coverage', () => {
  it('keeps tree order and gives all four levels hash breadcrumbs', () => {
    const ia = projectStudioAgentIA(fixture());
    expect(ia.groups[0]?.collections[0]?.cells.map(cell => cell.id)).toEqual(['focus.segment.first', 'focus.segment.second']);
    expect(studioIABreadcrumb(ia, 'focus.segment.first').map(item => item.id)).toEqual(['agent:director', 'focus', 'segment', 'focus.segment.first']);
    expect(studioIABreadcrumb(ia, 'segment').at(-1)?.href).toBe(studioIAHref('segment'));
  });
  it('does not invent groups for missing or malformed trees', () => {
    expect(projectStudioAgentIA({ ...fixture(), tree: undefined })).toMatchObject({ state: 'missing', groups: [] });
    expect(projectStudioAgentIA({ ...fixture(), tree: { tree: [{ id: 'focus', cells: ['focus.segment.first'] }] } })).toMatchObject({ state: 'error', groups: [] });
  });
  it.each(['director', 'designer', 'writer', 'publisher'] as const)('counts every hidden variant for %s anonymous unit scope', agent => {
    const index = fixture(agent);
    expect(checkStudioSpecimenCoverage(index, evidence(index))).toMatchObject({ state: 'pass', cells: { covered: 2, total: 2 }, variants: { covered: 4, total: 4, completeScope: true } });
  });
  it.each(['unregistered', 'zero-items', 'missing-hidden-variant', 'unbound', 'pending', 'missing-span', 'invalid-span'] as const)('fails the %s negative control', fault => {
    const index = fixture(); const records = evidence(index); const row = records[0]!;
    if (fault === 'unregistered') row.registered = false;
    if (fault === 'zero-items') row.itemCount = 0;
    if (fault === 'missing-hidden-variant') row.variants.pop();
    if (fault === 'unbound') delete row.boundSectionId;
    if (fault === 'pending') row.ready = false;
    if (fault === 'missing-span') delete row.span;
    if (fault === 'invalid-span') Object.assign(row, { span: 'quarter' });
    const result = checkStudioSpecimenCoverage(index, records);
    expect(result.state).toBe('fail'); expect(result.cells.covered).toBe(1); expect(result.variants.total).toBe(4);
  });
  it.each(['full', 'half', 'third'] as const)('accepts only the declared %s specimen-leaf span without agent inference', span => {
    for (const agent of ['director', 'designer', 'writer', 'publisher'] as const) {
      const index = fixture(agent); const records = evidence(index);
      for (const record of records) record.span = span;
      expect(checkStudioSpecimenCoverage(index, records).state).toBe('pass');
    }
  });
  it.each(['false', 'missing'] as const)('fails and marks unknown source scope for %s completeness evidence', fault => {
    const index = fixture(); const records = evidence(index);
    if (fault === 'false') records[0]!.inventoryComplete = false;
    else Reflect.deleteProperty(records[0]!, 'inventoryComplete');
    expect(checkStudioSpecimenCoverage(index, records)).toMatchObject({ state: 'fail', variants: { total: 4, completeScope: false } });
  });
  it('keeps matching explicit version scope separate from whole-cell coverage', () => {
    const original = fixture(); const cell = original.cells[0]!;
    const scope = { kind: 'version' as const, cellId: cell.id, version: cell.version! };
    const record = { ...evidence(original)[0]!, scope };
    expect(checkStudioSpecimenCoverage(original, [record, evidence(original)[1]!])).toMatchObject({ state: 'fail', variants: { completeScope: false } });
    const scoped: AgentCells = { ...original, cells: [cell], contentScope: scope };
    expect(checkStudioSpecimenCoverage(scoped, [record])).toMatchObject({ state: 'pass', scope, cells: { covered: 1, total: 1 }, variants: { covered: 2, total: 2, completeScope: true }, sources: [{ cellId: cell.id, inventoryComplete: true, scope }] });
    expect(checkStudioSpecimenCoverage(scoped, [{ ...record, scope: { ...scope, version: scope.version + 1 } }])).toMatchObject({ state: 'fail', variants: { completeScope: false } });
  });
  it('fails unknown variant inventory and missing IA instead of reporting 0/0 pass', () => {
    const index = fixture(); const records = evidence(index); records[0]!.expectedVariantIds = [];
    expect(checkStudioSpecimenCoverage(index, records)).toMatchObject({ state: 'fail', variants: { completeScope: false } });
    expect(checkStudioSpecimenCoverage({ ...index, tree: undefined }, [])).toMatchObject({ state: 'fail', variants: { completeScope: false } });
  });
});
