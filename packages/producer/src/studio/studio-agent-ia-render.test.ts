import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AgentCells } from '../../studio/lib/cells-client';
vi.mock('../../studio/generated/studio-map', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), studioPageBodies: Object.fromEntries(['publisher', 'designer'].map(agent => [agent, { template: 'ia-scroll', bands: { L0: 'sections.section-header', L1: 'sections.section-header', L2: 'sections.cards' } }])) }));
vi.mock('../../studio/components/StudioSelection', async () => {
  const blocks = await import('@clossys/designer/blocks');
  const components = await import('@clossys/designer/components');
  return {
    useStudioSelection: () => ({ selection: { leaves: ['sections.cards', 'sections.section-header'].map(leaf => ({ leaf, fill: `foundry/${leaf}`, source: 'fallback' })) }, runtime: { surfaces: { Cards: blocks.RecordCards, SectionHeader: blocks.SectionHeader } } }),
    useStudioUI: () => ({ EmptyState: blocks.EmptyState, Link: components.Link, Icon: () => null }),
  };
});
vi.mock('../../studio/components/AgentL3Specimen', () => ({ useAgentSpecimenCoverage: (_index: unknown, cell: { id: string }) => ({ cellId: cell.id, ready: false, registered: false, itemCount: 0, expectedVariantIds: [`${cell.id}:desktop`, `${cell.id}:mobile`], variants: [], issues: ['No selected specimen resolver'] }) }));
import { StudioAgentIA } from '../../studio/components/StudioAgentIA';

describe('selected native IA partial render', () => {
  it('renders native Designer layers and both authored group levels in a single page of selected Cards', () => {
    const index: AgentCells = { agent: 'designer', state: 'ready', cells: [{ id: 'tokens.radius', title: 'radius', version: 2, status: 'active' }, { id: 'assets.icon-check', title: 'check', version: 3, status: 'active' }], tree: { tree: [{ id: 'tokens/shape', name: 'Shape', children: [{ id: 'tokens/shape-corners', name: 'Corners', cells: ['tokens.radius'] }] }, { id: 'assets/icons', name: 'Icons', children: [{ id: 'assets/icons-actions', name: 'Actions', cells: ['assets.icon-check'] }] }] }, designerLayers: [{ id: 'tokens', label: 'native tokens', groups: ['tokens/shape'] }, { id: 'assets', label: 'native assets', groups: ['assets/icons'] }] };
    const html = renderToStaticMarkup(createElement(StudioAgentIA, { index, indexes: [index], onSelect: () => undefined }));
    expect(html).not.toContain('Authored cell hierarchy unavailable');
    expect(html).toContain('native tokens');
    expect(html).toContain('native assets');
    expect(html).toContain('Shape');
    expect(html).toContain('Corners');
    expect(html).toContain('Actions');
    expect(html.match(/data-ds-leaf="sections.cards"/g)).toHaveLength(2);
    expect(html.indexOf('studio-ia-tokens.radius')).toBeLessThan(html.indexOf('studio-ia-assets.icon-check'));
    expect(html).toContain('v2');
    expect(html).toContain('v3');
  });
  it('renders every authored L3 in official Cards grid with plain NEED text, safe linkouts and no raw source', () => {
    const index: AgentCells = { agent: 'publisher', state: 'ready', cells: ['one', 'two'].map(name => ({ id: `sample.${name}`, title: name, version: 1, status: 'draft' })), tree: { tree: [{ id: 'sample', name: 'Sample', children: [{ id: 'sample.pages', name: 'Pages', cells: ['sample.two', 'sample.one'] }] }] } };
    const html = renderToStaticMarkup(createElement(StudioAgentIA, { index, indexes: [index], selectedId: 'sample.two', onSelect: () => undefined }));
    expect(html).toContain('data-ds-leaf="sections.cards"');
    expect(html).toContain('data-layout="grid"');
    expect(html.indexOf('studio-ia-sample.two')).toBeLessThan(html.indexOf('studio-ia-sample.one'));
    expect(html.match(/href="\/content\/publisher\/sample\.(?:one|two)"/g)).toHaveLength(2);
    expect(html.match(/rel="noopener noreferrer"/g)).toHaveLength(2);
    expect(html).toContain('inventory incomplete');
    expect(html).toContain('NEED: sections.cards full specimen-body');
    expect(html).not.toMatch(/contenteditable|data-studio-source|---\ntitle:/i);
  });
});
