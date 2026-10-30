import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AgentCells } from '../../studio/lib/cells-client';
import type { AgentSpecimenCoverage } from '../../studio/lib/agent-specimen-coverage';
vi.mock('../../studio/components/StudioSelection', async () => {
  const blocks = await import('@clossys/designer/blocks');
  const components = await import('@clossys/designer/components');
  return {
    useStudioSelection: () => ({ selection: { leaves: ['sections.cards', 'sections.section-header'].map(leaf => ({ leaf, fill: `foundry/${leaf}`, source: 'fallback' })) }, runtime: { surfaces: { Cards: blocks.RecordCards, SectionHeader: blocks.SectionHeader } } }),
    useStudioUI: () => ({ ContentSection: blocks.ContentSection, EmptyState: blocks.EmptyState, Link: components.Link, Icon: () => null }),
  };
});
import { DirectorAgentIA, directorMountedCoverage } from '../../studio/components/DirectorAgentIA';

const model = (): AgentSpecimenCoverage => ({ cellId: 'focus.segment.core', ready: true, inventoryComplete: true, boundSectionId: 'sections.specimen-rich-passage', registered: true, span: 'full', itemCount: 2, expectedVariantIds: ['direction#v1', 'because#v1'], variants: [{ id: 'direction#v1', renderable: true }, { id: 'because#v1', renderable: true }], issues: [] });
const evidence = () => ({ issues: [] as string[], cases: model().expectedVariantIds.map(item => ({ item, section: 'sections.specimen-rich-passage', issues: [] as string[] })) });

describe('Director mounted native passage coverage', () => {
  it('requires actual mounted native evidence and retains source span and identities', () => {
    expect(directorMountedCoverage(model()).ready).toBe(false);
    const measured = directorMountedCoverage(model(), evidence());
    expect(measured.ready).toBe(true);
    expect(measured.span).toBe('full');
    expect(measured.expectedVariantIds).toEqual(model().expectedVariantIds);
    expect(measured.variants.every(variant => variant.renderable)).toBe(true);
  });
  it('refuses missing, duplicate, wrong-section and empty rendered cases', () => {
    const full = evidence();
    for (const cases of [[], full.cases.slice(1), [...full.cases, full.cases[0]!], full.cases.map(item => ({ ...item, section: 'sections.specimen-copy-in-context' }))]) {
      expect(directorMountedCoverage(model(), { issues: [], cases }).ready).toBe(false);
    }
  });
  it('preserves native source or DOM refusals even when every identity is present', () => {
    expect(directorMountedCoverage({ ...model(), ready: false, issues: ['Unqualified source.'] }, evidence()).issues).toContain('Unqualified source.');
    expect(directorMountedCoverage(model(), { ...evidence(), issues: ['source-leak'] }).ready).toBe(false);
    const cases = evidence().cases.map(item => ({ ...item, issues: ['hidden-specimen'] }));
    expect(directorMountedCoverage(model(), { issues: [], cases }).ready).toBe(false);
  });
});

describe('Director visible collection hierarchy', () => {
  it('renders authored L2 names as selected native headings with unique stable anchors', () => {
    const index: AgentCells = { agent: 'director', state: 'ready', cells: [], tree: { tree: [{ id: 'focus', name: 'Focus', children: [{ id: 'focus.segment', name: 'Segment', cells: [] }] }, { id: 'advantage', name: 'Advantage', children: [{ id: 'advantage.proposition', name: 'Proposition', cells: [] }] }] } };
    const html = renderToStaticMarkup(createElement(DirectorAgentIA, { index, indexes: [index], onSelect: () => undefined }));
    for (const [id, title] of [['focus.segment', 'Segment'], ['advantage.proposition', 'Proposition']]) {
      expect(html).toContain(`data-studio-ia-node="${id}"`);
      expect(html).toContain(`>${title}</h4>`);
      expect(html.match(new RegExp(`id="studio-ia-${id.replaceAll('.', '\\.') }"`, 'g'))).toHaveLength(1);
    }
    expect(html).toContain('data-ds-leaf="sections.cards"');
  });
});
