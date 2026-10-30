import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AgentCells } from '../../studio/lib/cells-client';
vi.mock('../../studio/generated/studio-map', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), studioPageBodies: { publisher: { template: 'ia-scroll', bands: { L0: 'sections.section-header', L1: 'sections.section-header', L2: 'sections.cards' } } } }));
vi.mock('../../studio/components/StudioSelection', async () => {
  const blocks = await import('@clossys/designer/blocks');
  const components = await import('@clossys/designer/components');
  return {
    useStudioSelection: () => ({ selection: { leaves: ['sections.cards', 'sections.section-header'].map(leaf => ({ leaf, fill: `foundry/${leaf}`, source: 'fallback' })) }, runtime: { surfaces: { Cards: blocks.RecordCards, SectionHeader: blocks.SectionHeader } } }),
    useStudioUI: () => ({ EmptyState: blocks.EmptyState, Link: components.Link, Icon: () => null }),
  };
});
vi.mock('../../studio/components/AgentL3Specimen', () => ({
  AgentL3Specimen: ({ selectedId }: { selectedId: string }) => createElement('section', { 'data-ds-leaf': 'sections.specimen-page-viewports' }, `Bound specimen ${selectedId}`),
  useAgentSpecimenCoverage: (_index: unknown, cell: { id: string }) => ({ cellId: cell.id, ready: false, registered: false, itemCount: 0, expectedVariantIds: [`${cell.id}:desktop`, `${cell.id}:mobile`], variants: [], issues: ['No selected specimen resolver'] }),
}));
import { StudioAgentIA } from '../../studio/components/StudioAgentIA';

describe('selected native IA specimen body', () => {
  it('mounts every authored L3 bound specimen in official Cards with safe linkouts and no raw source', () => {
    const index: AgentCells = { agent: 'publisher', state: 'ready', cells: ['one', 'two'].map(name => ({ id: `sample.${name}`, title: name, version: 1, status: 'draft' })), tree: { tree: [{ id: 'sample', name: 'Sample', children: [{ id: 'sample.pages', name: 'Pages', cells: ['sample.two', 'sample.one'] }] }] } };
    const html = renderToStaticMarkup(createElement(StudioAgentIA, { index, indexes: [index], selectedId: 'sample.two', onSelect: () => undefined }));
    expect(html).toContain('data-ds-leaf="sections.cards"');
    expect(html).toContain('data-layout="grid"');
    expect(html.indexOf('studio-ia-sample.two')).toBeLessThan(html.indexOf('studio-ia-sample.one'));
    expect(html.match(/href="\/content\/publisher\/sample\.(?:one|two)"/g)).toHaveLength(2);
    expect(html.match(/rel="noopener noreferrer"/g)).toHaveLength(2);
    expect(html).toContain('inventory incomplete');
    expect(html).toContain('Bound specimen sample.two');
    expect(html).toContain('Bound specimen sample.one');
    expect(html.match(/data-ds-leaf="sections.specimen-page-viewports"/g)).toHaveLength(2);
    expect(html).toContain('data-record-id="sample.two" data-selected="true"');
    expect(html).not.toContain('NEED: sections.cards full specimen-body');
    expect(html).not.toMatch(/contenteditable|data-studio-source|---\ntitle:/i);
  });
});
