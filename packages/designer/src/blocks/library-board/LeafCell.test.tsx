// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LibraryBoardSection } from './LibraryBoardSection.js';
import { BOARD_SURFACE_CLASS, BoardHeader, LeafCell, LeafLabel } from './LeafCell.js';
import { buildCandidates } from '../../studio/model.js';
import { valueLibraryBoardRecords, valueLibraryBoardPreviews, type PreparedLibraryBoardInput } from '../../studio/library-board-adapter.js';
import { labels, smallCatalog, emptyLibrary } from '../../studio/__fixtures__/studio.js';
import { resolve } from '../../catalog-core/api.js';
import { runtimeHash } from '../../catalog-core/runtime-ports.js';

/*
 * Visual pass (VF-1) pins for the shared board anatomy: the board plate is the
 * raised surface (never the canvas ground), the leaf cell centres its slots on
 * one line, the gear is the square small icon control and a leaf label that is
 * still an id is set in the mono face.
 */
function input(label: string): PreparedLibraryBoardInput {
  const library = emptyLibrary();
  const candidates = buildCandidates({ catalog: smallCatalog, library, working: library, slotId: 'assets.icon-search', scope: 'slot', target: 'assets.icon-search' });
  return { layer: 'assets', board: { id: 'assets/icons', label: 'Icons', leaves: ['assets.icon-search'], rows: [{ id: 'assets.icon-search', label, scope: 'slot', target: 'assets.icon-search', leaves: ['assets.icon-search'], depth: 0, emphasized: false, basket: 'leaf', candidates }] },
    sources: smallCatalog.sources, consumerSource: library.source.id, selectionHash: resolve({ catalog: smallCatalog, library }).selectionHash,
    sourceHashes: Object.fromEntries(candidates.map(candidate => [candidate.source, runtimeHash(candidate.fill)])), mode: 'view', canSave: true, pending: false,
    prompt: row => ({ consumer: library.source.id, board: { id: 'assets/icons', label: 'Icons' }, slot: { id: row.id, label: row.label }, variants: [], tokens: [], siblings: [], returnStep: labels.board.returnStep }) };
}

describe('board anatomy visual pass (VF-1)', () => {
  it('draws the library board on the raised surface with the hairline, not the canvas ground (components-05, sf-06)', () => {
    const i = input('Search');
    render(<LibraryBoardSection records={valueLibraryBoardRecords(i)} previews={valueLibraryBoardPreviews(i, labels)} labels={labels} onCommand={vi.fn()} />);
    const board = screen.getByRole('region', { name: 'Icons' });
    expect(board.className).toBe(BOARD_SURFACE_CLASS);
    expect(board).toHaveClass('bg-surface-raised', 'border-line-base');
    expect(board).not.toHaveClass('bg-surface-base');
  });

  it('centres the leaf cell slots on one line (components-07)', () => {
    const { container } = render(<LeafCell previewState="not-chosen" status="Not chosen" actions={<button type="button">Choose</button>} />);
    const cell = container.querySelector('[data-candidate-cell]');
    expect(cell).toHaveClass('flex', 'items-center');
    expect(cell).not.toHaveClass('items-start');
  });

  it('makes the gear the square small icon control (components-08, sf-09)', () => {
    render(<BoardHeader id="h" title="Icons" editing={false} labels={labels.board} onEdit={() => {}} onDone={() => {}} />);
    const gear = screen.getByRole('button', { name: labels.board.changeSelection });
    expect(gear).toHaveClass('icon-control-sm', 'rounded-control');
    expect(gear).not.toHaveClass('rounded-pill');
    expect(gear.textContent).toBe('');
  });

  it('sets a leaf label that is still its id in the mono face, and leaves a human label alone (components-09)', () => {
    const view = render(<LeafLabel id="tokens.color-ramp" label="tokens.color-ramp" />);
    expect(screen.getByText('tokens.color-ramp')).toHaveClass('font-mono', 'tabular-nums');
    view.rerender(<LeafLabel id="tokens.color-ramp" label="Colour ramp" />);
    expect(screen.getByText('Colour ramp')).not.toHaveClass('font-mono');
    // vf13 (r2 sf-11 / components-09): the human label leads and the id stays underneath in the mono face.
    expect(view.container.querySelector('[data-leaf-id]')).toHaveTextContent('tokens.color-ramp');
    expect(view.container.querySelector('[data-leaf-id]')).toHaveClass('font-mono', 'text-ink-secondary');
  });

  it('renders an id-labelled board row in the mono face', () => {
    const i = input('assets.icon-search');
    render(<LibraryBoardSection records={valueLibraryBoardRecords(i)} previews={valueLibraryBoardPreviews(i, labels)} labels={labels} onCommand={vi.fn()} />);
    expect(screen.getByText('assets.icon-search', { selector: '[data-leaf-id]' })).toHaveClass('font-mono');
  });
});

/*
 * Capture hooks (vf35): stable, product-neutral attributes a screenshot harness reads
 * instead of matching copy. Each names the decision the cell or control already made.
 */
describe('board capture hooks (vf35)', () => {
  it('marks every leaf cell with the preview state its caller decided', () => {
    for (const state of ['live', 'planned', 'unavailable', 'not-chosen'] as const) {
      const { container, unmount } = render(<LeafCell previewState={state} />);
      expect(container.querySelector('[data-candidate-cell]')).toHaveAttribute('data-preview-state', state);
      unmount();
    }
  });

  it('names the ground a leaf specimen is drawn on, matching the plate fill it actually renders', () => {
    const { container } = render(<LeafCell previewState="live" preview={<span>specimen</span>} />);
    const cell = container.querySelector<HTMLElement>('[data-candidate-cell]')!;
    expect(cell).toHaveAttribute('data-ground', 'sunken');
    expect(cell).toHaveClass(`bg-surface-${cell.dataset.ground}`);
  });

  it('gives the board gear and its Done button one edit-mode control hook', () => {
    const view = render(<BoardHeader id="h" title="Icons" editing={false} labels={labels.board} onEdit={() => {}} onDone={() => {}} />);
    expect(screen.getByRole('button', { name: labels.board.changeSelection })).toHaveAttribute('data-studio-control', 'edit-mode');
    view.rerender(<BoardHeader id="h" title="Icons" editing labels={labels.board} onEdit={() => {}} onDone={() => {}} />);
    expect(screen.getByRole('button', { name: labels.board.done })).toHaveAttribute('data-studio-control', 'edit-mode');
  });

  it('marks an unchosen library board leaf as not chosen', () => {
    const i = input('Search');
    const { container } = render(<LibraryBoardSection records={valueLibraryBoardRecords(i)} previews={valueLibraryBoardPreviews(i, labels)} labels={labels} onCommand={vi.fn()} />);
    const cell = container.querySelector('[data-candidate-cell]');
    expect(cell).toHaveTextContent(labels.board.notChosen);
    expect(cell).toHaveAttribute('data-preview-state', 'not-chosen');
  });
});
