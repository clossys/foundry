// @vitest-environment jsdom
import { createElement, Suspense } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConsumerComponentProvider } from '../../../designer/src/runtime/component-leaf.client';
import { fixtureConsumerComponents } from '../../../designer/src/catalog-core/__fixtures__/surface-consumer-components';
import { StudioAgentIA } from '../../studio/components/StudioAgentIA';
import { DirectorSpecimen } from '../../studio/components/DirectorSpecimen';
import { parseCellsResponse } from '../../studio/lib/cells-client';
import { studioIABands } from '../../studio/lib/studio-ia-body';
import * as StudioMap from '../../studio/generated/studio-map';

// Exercise the actual Studio component and registered Designer card/header sources.
// The existing public Designer selection fixture is runtime-pending; this proves
// rendering and interactions, not a deployed selection or visual acceptance.
vi.mock('../../studio/components/StudioSelection', async () => {
  const { RecordCards } = await import('../../../designer/src/blocks/RecordCards');
  const { SectionHeader } = await import('../../../designer/src/blocks/SectionHeader');
  const { EmptyState } = await import('../../../designer/src/blocks/EmptyState');
  const { Button } = await import('../../../designer/src/components/Button');
  const { Link } = await import('../../../designer/src/components/Link.client');
  const { ContentSection } = await import('../../../designer/src/blocks/ContentSection');
  const { DetailView } = await import('../../../designer/src/blocks/DetailView');
  const { Badge } = await import('../../../designer/src/components/Badge');
  const { RichText } = await import('../../../designer/src/components/RichText');
  return {
    useStudioSelection: () => ({ selection: { leaves: [
      { leaf: 'sections.section-header', source: 'consumer', fill: 'foundry/sections.section-header' },
      { leaf: 'sections.cards', source: 'consumer', fill: 'foundry/sections.cards' },
    ] }, runtime: { surfaces: { SectionHeader, Cards: RecordCards } } }),
    useStudioUI: () => ({ EmptyState, Button, Link, ContentSection, SectionHeader, DetailView, Badge, RichText, Icon: () => null }),
  };
});
vi.mock('../../studio/components/AgentL3Specimen', () => ({
  useAgentSpecimenCoverage: (_index: unknown, cell: { id: string }) => ({ cellId: cell.id, ready: false, variants: [], issues: [] }),
}));
vi.mock('../../studio/lib/director-specimen-resource', () => ({
  useSpecimenCells: (index: { cells: Record<string, unknown>[] }) => ({ state: 'ready', cells: index.cells.map(cell => ({ ...cell, agent: 'director', content: '## Direction\n- Retain the authored strategy.' })) }),
}));
afterEach(cleanup);

function show(id: string, document = false) {
  const index = parseCellsResponse({ agents: [{ agent: 'director', state: 'ready', cells: [{ id, version: 1, status: 'draft', path: `cells/${id}/v1.md`, fields: { title: 'Forged local title' } }], tree: { tree: [{ id: 'context', name: 'Context', children: [{ id: 'context.market', name: 'Market', cells: [id] }] }] } }] })[0]!;
  const onSelect = vi.fn();
  const node = document ? createElement(DirectorSpecimen, { index }) : createElement(StudioAgentIA, { index, indexes: [index], selectedId: id, onSelect });
  const view = render(createElement(ConsumerComponentProvider, { value: fixtureConsumerComponents(), children: createElement(Suspense, { children: node }) }));
  return { ...view, onSelect };
}

describe('Director title in the rendered native Studio card', () => {
  // Run these against the real generated body declaration once Admin supplies it.
  // A missing native port must not be replaced by a test-authored body schema.
  const nativeBodyAvailable = Boolean(studioIABands(StudioMap, 'director').bands);
  it.runIf(nativeBodyAvailable)('renders Market size as a plain heading and retains separate Inspect and content actions', async () => {
    const { container, onSelect } = show('context.market.size');
    const heading = await screen.findByRole('heading', { name: 'Market size' });
    expect(heading.tagName).toBe('H3');
    expect(heading.querySelector('a, button')).toBeNull();
    expect(heading.closest('a, button')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Market size' })).toBeNull();
    expect(container.querySelector('[data-ds-leaf="sections.cards"]')).not.toBeNull();
    const card = heading.closest('li')!;
    const inspect = within(card).getByRole('button', { name: 'Inspect Market size' });
    expect(inspect.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(inspect);
    expect(onSelect).toHaveBeenCalledWith('context.market.size');
    const content = within(card).getByRole('link', { name: 'Open Market size content' });
    expect(content.getAttribute('href')).toBe('/content/director/context.market.size');
    expect(content.getAttribute('target')).toBe('_blank');
    expect(content.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.queryByText('Forged local title')).toBeNull();
    expect(screen.queryByText(/^size$/)).toBeNull();
  });

  it.runIf(nativeBodyAvailable)('renders unavailable title copy as plain heading words without a guessed ID or engine marker', async () => {
    show('context.market.unregistered');
    const heading = await screen.findByRole('heading', { name: 'This card title is not available yet.' });
    expect(heading.textContent).not.toMatch(/NEED|context\.|unregistered/);
    expect(heading.querySelector('a, button')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Forged local title' })).toBeNull();
    const unavailable = screen.getByRole('button', { name: 'This action is not available yet.' });
    expect(unavailable.getAttribute('disabled')).not.toBeNull();
  });

  it.skipIf(nativeBodyAvailable)('exposes the missing native body projection instead of claiming the card rendered', async () => {
    const { container } = show('context.market.size');
    expect(await screen.findByRole('heading', { name: 'NEED: native IA body projection' })).toBeTruthy();
    expect(container.querySelector('[data-ds-leaf="sections.cards"]')).toBeNull();
  });
});

describe('Director title in the rendered strategy document', () => {
  it('renders the Writer title in the actual passage header through native Designer sections', async () => {
    const { container } = show('context.market.size', true);
    const heading = await screen.findByRole('heading', { name: 'Market size' });
    expect(heading.querySelector('a, button')).toBeNull();
    expect(heading.closest('a, button')).toBeNull();
    expect(container.querySelector('[data-ds-leaf="sections.section-header"]')).not.toBeNull();
    expect(screen.queryByText('Forged local title')).toBeNull();
    expect(screen.queryByText(/^size$/)).toBeNull();
  });

  it('renders unavailable passage titles in plain words without a raw leaf fallback', async () => {
    show('context.market.unregistered', true);
    const heading = await screen.findByRole('heading', { name: 'This card title is not available yet.' });
    expect(heading.textContent).not.toMatch(/NEED|context\.|unregistered/);
    expect(heading.querySelector('a, button')).toBeNull();
  });
});
