// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { LibraryBoardSection } from './LibraryBoardSection.js';
import { LeafLabel } from './LeafCell.js';
import { compositeLibraryBoard, type PreparedCompositeLibraryBoardInput } from '../../studio/library-board-adapter.js';
import { labels } from '../../studio/__fixtures__/studio.js';
import { runtimeHash } from '../../catalog-core/runtime-ports.js';
import { componentIntegration } from '../../catalog-core/__fixtures__/component-integration.js';
import { loadBuildCatalog, libraryHash } from '../../catalog-core/index.js';

function compositeInput(): PreparedCompositeLibraryBoardInput {
  const input = componentIntegration(), doc = structuredClone(input.catalog.components.fills[0]!);
  const meta = doc.$extensions['com.clossys.fill'];
  meta.source = 'shadcn@aria'; meta.id = 'shadcn@aria/components.button'; meta.status = 'built';
  for (const candidate of Object.values(doc.components)) candidate.source = 'shadcn@aria';
  input.catalog = { ...input.catalog, components: { ...input.catalog.components, fills: [doc] } };
  return { layer: 'components', board: { id: 'components/actions', label: 'Component actions', leaves: [{ id: 'components.button' }] }, input, changes: { baseHash: libraryHash(input.library), changes: [] }, contracts: loadBuildCatalog(), snapshot: { library: input.library, preview: vi.fn(() => <button>Static specimen</button>) }, sources: input.catalog.values.sources, sourceHashes: { 'shadcn@aria': runtimeHash(doc) }, mode: 'edit', canSave: true, pending: false, labels,
    prompt: leaf => ({ consumer: input.library.source.id, board: { id: 'components/actions', label: 'Component actions' }, slot: { id: leaf, label: leaf }, variants: [], tokens: [], siblings: [], returnStep: labels.board.returnStep }) };
}

// DESIGNER-RO: the three edit-tile pins (static specimen on a runtime-pending tile, its neutral pending line, and
// a real error's glyph) were deleted with the edit-mode choice Matrix they described (inventory rows 2-3).

// DESIGNER-RO (converted): an edit-mode record now renders the read-only view, so its label must equal the view's.
it('vf13: edit and view leaf labels share one treatment: mono id, regular weight, human label above', () => {
  const prepared = compositeLibraryBoard(compositeInput());
  const human = { ...prepared.records, rows: { ...prepared.records.rows, items: prepared.records.rows.items.map(row => ({ ...row, label: 'Button' })) } };
  const edit = render(<LibraryBoardSection records={human} previews={prepared.previews} labels={labels} onCommand={vi.fn()} />);
  const header = edit.container.querySelector('[role="rowheader"]')!;
  const editLabel = header.querySelector('[data-leaf-label]')!;
  expect(editLabel).not.toBeNull();
  expect(editLabel.className).toContain('font-normal');
  expect(within(header as HTMLElement).getByText('Button')).toBeInTheDocument();
  expect(header.querySelector('[data-leaf-id]')!.className).toContain('font-mono');
  expect(header.querySelector('[data-leaf-id]')!.textContent).toBe('components.button');
  edit.unmount();
  const view = render(<LibraryBoardSection records={{ ...human, controls: { ...human.controls, mode: 'view' } }} previews={prepared.previews} labels={labels} onCommand={vi.fn()} />);
  const viewLabel = view.container.querySelector('[data-leaf-label]')!;
  expect(viewLabel.outerHTML).toBe(editLabel.outerHTML);
});

it('vf13: a leaf whose label is its id renders the id once, mono', () => {
  const { container } = render(<LeafLabel id="components.button" label="components.button" />);
  expect(container.querySelectorAll('[data-leaf-id]')).toHaveLength(1);
  expect(container.textContent).toBe('components.button');
  expect(container.querySelector('[data-leaf-id]')!.className).toContain('font-mono');
});
// DESIGNER-RO: the studio CandidateChoice pending-line pin was deleted with CandidateChoice (inventory row 4).
