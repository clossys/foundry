import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentCells, CellDetail } from '../../studio/lib/cells-client';
import type { RoleSpecimenResource } from '../../studio/components/AgentSpecimenProvider';

const state = vi.hoisted(() => ({ resource: undefined as RoleSpecimenResource | undefined }));
vi.mock('../../studio/components/AgentSpecimenProvider', () => ({
  useRoleSpecimenResource: () => state.resource,
  latestSpecimenCell: (resource: { state: string; cells?: CellDetail[] }, _index: AgentCells, id: string) => resource.cells?.find(cell => cell.id === id),
  RoleToolsProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock('../../studio/components/StudioSelection', async () => {
  const { createElement } = await import('react');
  return { useStudioUI: () => ({ EmptyState: ({ title }: { title: string }) => createElement('section', { 'data-ds-leaf': 'sections.empty-state' }, title) }) };
});
import { AgentL3Specimen, SpecimenLeafProvider, useAgentSpecimenCoverage, type BoundSpecimenLeaf } from '../../studio/components/AgentL3Specimen';

const cell: CellDetail = { agent: 'publisher', id: 'site.home', title: 'Home', status: 'draft', version: 1, fields: { path: '/' }, content: 'Source is secondary' };
const index: AgentCells = { agent: 'publisher', state: 'ready', cells: [cell] };
const items = [{ id: 'desktop' }, { id: 'tablet' }, { id: 'mobile' }];
function NativeLeaf() {
  return createElement('section', { 'data-ds-leaf': 'sections.specimen-page-viewports', 'data-publication-rendered': 'false' }, 'Not published yet', createElement('code', null, 'clossys publish --target preview'));
}
function binding(overrides: Partial<BoundSpecimenLeaf> = {}): BoundSpecimenLeaf {
  return { presentationReady: true, Component: NativeLeaf, props: { items }, evidence: { sectionId: 'sections.specimen-page-viewports', registered: true, span: 'full', items, variantIds: [], issues: [] }, ...overrides };
}
function render(value: BoundSpecimenLeaf) {
  return renderToStaticMarkup(createElement(SpecimenLeafProvider, { resolve: () => value, children: createElement(AgentL3Specimen, { index, selectedId: cell.id }) }));
}
beforeEach(() => {
  state.resource = { index, cells: { state: 'ready', cells: [cell] }, publication: { state: 'ready', value: { state: 'missing', message: 'Not published yet', command: 'clossys publish --target preview' } } };
});
describe('Publisher bound-leaf empty presentation', () => {
  it('renders the registered native unpublished leaf and command without source or iframe', () => {
    const html = render(binding());
    expect(html).toContain('data-ds-leaf="sections.specimen-page-viewports"');
    expect(html).toContain('Not published yet');
    expect(html).toContain('clossys publish --target preview');
    expect(html).not.toMatch(/<iframe|NEED:|Source is secondary/);
  });
  it('retains unsuccessful publication coverage while the native empty presentation renders', () => {
    function Coverage() {
      const coverage = useAgentSpecimenCoverage(index, cell);
      return createElement('output', null, JSON.stringify({ ready: coverage.ready, complete: coverage.inventoryComplete, variants: coverage.variants.map(variant => variant.renderable) }));
    }
    const html = renderToStaticMarkup(createElement(SpecimenLeafProvider, { resolve: () => binding(), children: createElement(Coverage) }));
    expect(html).toContain('&quot;ready&quot;:false');
    expect(html).toContain('&quot;complete&quot;:false');
    expect(html).toContain('[false,false,false]');
  });
  it.each(['unregistered', 'unvalidated', 'empty-items', 'native-issue', 'wrong-leaf'] as const)('does not substitute an unpublished presentation for a %s native binding', failure => {
    const actual = binding();
    if (failure === 'unregistered') actual.evidence.registered = false;
    if (failure === 'unvalidated') actual.presentationReady = false;
    if (failure === 'empty-items') actual.props.items = [];
    if (failure === 'native-issue') actual.evidence.issues = ['Selected native source is unavailable'];
    if (failure === 'wrong-leaf') actual.evidence.sectionId = 'sections.specimen-example';
    const html = render(actual);
    expect(html).toContain('NEED: registered specimen');
    expect(html).not.toContain('Not published yet');
  });
});
