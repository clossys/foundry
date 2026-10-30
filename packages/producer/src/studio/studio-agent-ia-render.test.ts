import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AgentCells } from '../../studio/lib/cells-client';
vi.mock('../../studio/generated/studio-map', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), studioPageBodies: Object.fromEntries(['publisher', 'writer'].map(agent => [agent, { template: 'ia-scroll', bands: { L0: 'sections.section-header', L1: 'sections.section-header', L2: 'sections.cards' } }])) }));
vi.mock('../../studio/components/StudioSelection', async () => {
  const blocks = await import('@clossys/designer/blocks');
  const components = await import('@clossys/designer/components');
  const { RecordCards } = await import('../../../designer/src/blocks/RecordCards');
  return {
    useStudioSelection: () => ({ selection: { leaves: ['sections.cards', 'sections.section-header'].map(leaf => ({ leaf, fill: `foundry/${leaf}`, source: 'fallback' })) }, runtime: { surfaces: { Cards: RecordCards, SectionHeader: blocks.SectionHeader } } }),
    useStudioUI: () => ({ EmptyState: blocks.EmptyState, Link: components.Link, Icon: () => null }),
  };
});
vi.mock('../../studio/components/AgentL3Specimen', () => ({
  AgentL3Specimen: ({ selectedId }: { selectedId: string }) => createElement('section', { 'data-ds-leaf': 'sections.specimen-copy-in-context', 'data-source-cell': selectedId }, `Native copy ${selectedId}`),
  useAgentSpecimenCoverage: (_index: unknown, cell: { id: string }) => ({ cellId: cell.id, ready: false, registered: false, itemCount: 0, expectedVariantIds: [`${cell.id}:desktop`, `${cell.id}:mobile`], variants: [], issues: ['No selected specimen resolver'] }),
}));
import { StudioAgentIA } from '../../studio/components/StudioAgentIA';

describe('selected native IA partial render', () => {
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

  it('mounts one Writer leaf per authored cell in the selected Cards body with native metadata and linkouts', () => {
    const index: AgentCells = { agent: 'writer', state: 'ready', cells: ['headline', 'passage'].map(name => ({ id: `copy.${name}`, title: name, version: 2, status: 'active' })), tree: { tree: [{ id: 'copy', name: 'Copy', children: [{ id: 'copy.site', name: 'Site', cells: ['copy.passage', 'copy.headline'] }] }] } };
    const html = renderToStaticMarkup(createElement(StudioAgentIA, { index, indexes: [index], selectedId: 'copy.headline', onSelect: () => undefined }));
    expect(html.match(/data-record-body=""/g)).toHaveLength(2);
    expect(html.match(/data-ds-leaf="sections.specimen-copy-in-context"/g)).toHaveLength(2);
    expect(html).toContain('Native copy copy.passage');
    expect(html).toContain('Native copy copy.headline');
    expect(html.indexOf('data-record-id="copy.passage"')).toBeLessThan(html.indexOf('data-record-id="copy.headline"'));
    expect(html).toContain('data-record-id="copy.headline" data-selected="true"');
    expect(html.match(/href="\/content\/writer\/copy\.(?:headline|passage)"/g)).toHaveLength(2);
    expect(html).toContain('v2');
    expect(html).not.toContain('NEED: sections.cards full specimen-body');
    expect(html).not.toMatch(/<p[^>]*><section|contenteditable|data-studio-source/i);
  });
});
