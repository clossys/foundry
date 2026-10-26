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
import { checkCounts } from '../../studio/runtime-pending.js';

function compositeInput(): PreparedCompositeLibraryBoardInput {
  const input = componentIntegration(), doc = structuredClone(input.catalog.components.fills[0]!);
  const meta = doc.$extensions['com.clossys.fill'];
  meta.source = 'shadcn@aria'; meta.id = 'shadcn@aria/components.button'; meta.status = 'built';
  for (const candidate of Object.values(doc.components)) candidate.source = 'shadcn@aria';
  input.catalog = { ...input.catalog, components: { ...input.catalog.components, fills: [doc] } };
  return { layer: 'components', board: { id: 'components/actions', label: 'Component actions', leaves: [{ id: 'components.button' }] }, input, changes: { baseHash: libraryHash(input.library), changes: [] }, contracts: loadBuildCatalog(), snapshot: { library: input.library, preview: vi.fn(() => <button>Static specimen</button>) }, sources: input.catalog.values.sources, sourceHashes: { 'shadcn@aria': runtimeHash(doc) }, mode: 'edit', canSave: true, pending: false, labels,
    prompt: leaf => ({ consumer: input.library.source.id, board: { id: 'components/actions', label: 'Component actions' }, slot: { id: leaf, label: leaf }, variants: [], tokens: [], siblings: [], returnStep: labels.board.returnStep }) };
}
const unqualifiedInput = () => { const input = compositeInput(); return { ...input, input: { ...input.input, componentOptions: undefined } }; };

it('vf13: an edit tile awaiting runtime qualification renders its static specimen, not the unavailable line', () => {
  const prepared = compositeLibraryBoard(unqualifiedInput()), candidate = prepared.records.rows.items[0]!.candidates[0]!;
  // The fixture really is runtime-pending only: every error is a pending code, and selection stays refused.
  expect(checkCounts(candidate.findings)).toEqual(expect.objectContaining({ errors: 0 }));
  expect(checkCounts(candidate.findings).pending).toBeGreaterThan(0);
  expect(candidate.usable).toBe(false);
  render(<LibraryBoardSection records={prepared.records} previews={prepared.previews} labels={labels} onCommand={vi.fn()} />);
  expect(screen.getByText('Static specimen')).toBeInTheDocument();
  expect(screen.queryByText(labels.previewUnavailable)).toBeNull();
  expect(screen.getByRole('radio', { name: labels.useSource('shadcn@aria', 'components.button') })).toBeDisabled();
});

it('vf13: a runtime-pending tile shows the neutral pending line and never a bare "!" error badge', () => {
  const prepared = compositeLibraryBoard(unqualifiedInput());
  const { container } = render(<LibraryBoardSection records={prepared.records} previews={prepared.previews} labels={labels} onCommand={vi.fn()} />);
  expect(container.querySelector('[data-studio-runtime-pending]')).not.toBeNull();
  for (const badge of container.querySelectorAll('[data-badge], .badge, span')) expect(badge.textContent?.trim()).not.toBe('!');
  expect(container.querySelector('[data-error-reason]')).toBeNull();
});

it('vf13: a real error keeps its glyph and accessible name with visible text, not a bare "!"', () => {
  const input = compositeInput(), prepared = compositeLibraryBoard(input);
  const row = prepared.records.rows.items[0]!, candidate = row.candidates[0]!;
  const broken = { ...prepared.records, rows: { ...prepared.records.rows, items: [{ ...row, candidates: [{ ...candidate, findings: [{ code: 'C7', severity: 'error', message: 'Strict source evidence missing' }] }] }] } };
  const { container } = render(<LibraryBoardSection records={broken} previews={prepared.previews} labels={labels} onCommand={vi.fn()} />);
  const trigger = screen.getByRole('button', { name: labels.checkSummary(1, 0) });
  expect(trigger.textContent).toContain(labels.checkSummary(1, 0));
  expect(container.querySelector('[data-studio-runtime-pending]')).toBeNull();
});

it('vf13: edit and view leaf labels share one treatment: mono id, regular weight, human label above', () => {
  const prepared = compositeLibraryBoard(compositeInput());
  const human = { ...prepared.records, rows: { ...prepared.records.rows, items: prepared.records.rows.items.map(row => ({ ...row, label: 'Button' })) } };
  const edit = render(<LibraryBoardSection records={human} previews={prepared.previews} labels={labels} onCommand={vi.fn()} />);
  const header = edit.container.querySelector('th[scope="row"]')!;
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

it('vf13: a studio candidate whose errors are all runtime-pending shows the neutral line, not an error badge', async () => {
  const { RadioGroup } = await import('../../components/RadioGroup.js');
  const { CandidateChoice } = await import('../../studio/CandidateChoice.js');
  const { buildCandidates } = await import('../../studio/model.js');
  const { smallCatalog, emptyLibrary } = await import('../../studio/__fixtures__/studio.js');
  const { OBSERVATIONS_UNAVAILABLE } = await import('../../catalog-core/check-components.js');
  const library = emptyLibrary(), base = buildCandidates({ catalog: smallCatalog, library, working: library, slotId: 'tokens.surface-color', scope: 'slot', target: 'tokens.surface-color' })[0]!;
  const findings = [{ code: 'K2' as const, rule: 'r', severity: 'notice' as const, subject: 's', message: OBSERVATIONS_UNAVAILABLE }];
  const { container, unmount } = render(<RadioGroup label="Choices"><CandidateChoice candidate={{ ...base, findings, errors: 0, notices: 1 }} target="leaf" labels={labels} /></RadioGroup>);
  expect(container.querySelector('[data-studio-runtime-pending]')).not.toBeNull();
  expect(screen.queryByRole('button', { name: labels.checkSummary(0, 1) })).toBeNull();
  expect(container.querySelector('[data-error-reason]')).toBeNull();
  unmount();
  // Pending notices never hide a real error or inflate the notice count.
  const mixed = [{ code: 'K3' as const, rule: 'r', severity: 'error' as const, subject: 's', message: 'Token read tokens.x does not resolve' }, ...findings, { ...findings[0]!, code: 'K5' as const }];
  render(<RadioGroup label="Choices"><CandidateChoice candidate={{ ...base, findings: mixed, errors: 1, notices: 2 }} target="leaf" labels={labels} /></RadioGroup>);
  expect(screen.getByRole('button', { name: labels.checkSummary(1, 0) })).toBeInTheDocument();
});
