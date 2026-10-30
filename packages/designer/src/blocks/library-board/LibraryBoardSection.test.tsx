// @vitest-environment jsdom
import { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { LibraryBoardSection, type LibraryBoardSectionProps } from './LibraryBoardSection.js';
import { assertLibraryBoardRecords, assertLibraryBoardCommand } from './model.js';
import { FrameStage, frameSectionRefKey } from '../../frames/FrameStage.js';
import { buildCandidates } from '../../studio/model.js';
import { valueLibraryBoardRecords, valueLibraryBoardPreviews, compositeLibraryBoard, type PreparedLibraryBoardInput, type PreparedCompositeLibraryBoardInput } from '../../studio/library-board-adapter.js';
import { labels, smallCatalog, emptyLibrary, adopt } from '../../studio/__fixtures__/studio.js';
import { resolve } from '../../catalog-core/api.js';
import { runtimeHash } from '../../catalog-core/runtime-ports.js';
import { componentIntegration } from '../../catalog-core/__fixtures__/component-integration.js';
import { syntheticSurface } from '../../catalog-core/__fixtures__/surface-engine/synthetic.js';
import { loadBuildCatalog, loadComponentRegistry, importFoundryComponents, libraryHash, applyLibraryChange } from '../../catalog-core/index.js';
function input(selected = true): PreparedLibraryBoardInput {
  const library = selected ? adopt(emptyLibrary(), 'assets.icon-search', 'lucide') : emptyLibrary();
  const candidates = buildCandidates({ catalog: smallCatalog, library, working: library, slotId: 'assets.icon-search', scope: 'slot', target: 'assets.icon-search' });
  return { layer: 'assets', board: { id: 'assets/icons', label: 'Icons', leaves: ['assets.icon-search'], rows: [{ id: 'assets.icon-search', label: 'Search', scope: 'slot', target: 'assets.icon-search', leaves: ['assets.icon-search'], depth: 0, emphasized: false, basket: 'leaf', candidates }] },
    sources: smallCatalog.sources, consumerSource: library.source.id, selectionHash: resolve({ catalog: smallCatalog, library }).selectionHash,
    sourceHashes: Object.fromEntries(candidates.map(candidate => [candidate.source, runtimeHash(candidate.fill)])), mode: 'view', canSave: true, pending: false,
    prompt: row => ({ consumer: library.source.id, board: { id: 'assets/icons', label: 'Icons' }, slot: { id: row.id, label: row.label }, variants: candidates[0]?.members.map(member => member.id) ?? [], tokens: [], siblings: [], returnStep: labels.board.returnStep }) };
}
function props(): LibraryBoardSectionProps { const i = input(); return { records: valueLibraryBoardRecords(i), previews: valueLibraryBoardPreviews(i, labels), labels, onCommand: vi.fn() }; }
it('renders actual checked library board in flow', () => {
  const value = props(); render(<LibraryBoardSection {...value} />);
  expect(screen.getByRole('region', { name: 'Icons' })).toBeInTheDocument();
  expect(screen.getByRole('row', { name: /Search/ })).toBeInTheDocument();
  expect(screen.queryByRole('radio')).toBeNull();
  expect(screen.getByRole('grid')).toBeInTheDocument();
  expect(screen.queryByText(labels.previewUnavailable)).toBeNull();
});
// DESIGNER-RO (converted): a record whose controls say edit still renders the read-only view in the canvas and
// through the narrow fallback; the board has no gear, so there is no edit mode to enter or retain.
it('renders actual checked library board in canvas, read-only through fallback', async () => {
  let resize: () => void = () => {}, width = 1200;
  vi.stubGlobal('ResizeObserver', class { constructor(fn: () => void) { resize = fn; } observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function() { return (this as HTMLElement).hasAttribute('data-frame-stage') ? width : 500; });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(500);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(240);
  const value = props(), ref = { slot: 'sections.comparison', index: 0 };
  const onCommand = vi.fn();
  function Harness() { const [mode] = useState<'view'|'edit'>('edit'); return <FrameStage aria-label="Boards" body={{ kind: 'canvas', source: { kind: 'derived', query: { id: 'designer.layer-boards', version: 1 } }, boards: [{ id: 'assets/icons', section: ref, groups: { domain: 'assets' } }], arrangement: { kind: 'lanes', groupKey: 'domain', gap: { x: 12, y: 8 }, laneGap: 20 }, collapseBelow: 'tokens.breakpoint.tablet' }} contract={{ accepts: ['canvas','flow'], scroll: 'region' }} collapseBelowPx={768} camera={{ viewport: { x: 0, y: 0, zoom: 1 }, onViewportChange: () => {}, minZoom: .12, maxZoom: 2, fitPadding: 0 }} sectionNodes={{ [frameSectionRefKey(ref)]: { label: 'Library board', node: <LibraryBoardSection {...value} records={{ ...value.records, controls: { ...value.records.controls, mode } }} onCommand={onCommand} /> } }} />; }
  const view = render(<Harness />); expect(screen.getByRole('list', { name: 'Boards' })).toHaveAttribute('data-frame-stage-layout','lanes');
  expect(screen.queryByRole('button', { name: labels.board.changeSelection })).toBeNull();
  const board = screen.getByRole('region', { name: 'Icons' });
  expect(board).toHaveAttribute('data-board-mode', 'view');
  width = 300; act(() => resize()); expect(screen.getByRole('region', { name: 'Icons' })).toBe(board); expect(board).toHaveAttribute('data-board-mode', 'view');
  expect(screen.queryByRole('radio')).toBeNull(); expect(onCommand).not.toHaveBeenCalled();
  view.unmount(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
// DESIGNER-RO (converted from the use-source radio pin): an unchosen row, even in an edit-mode record that can
// save, offers no source choice. Selecting the row emits reveal only; the stale-preview guards are unchanged.
it('renders an unchosen row with no source choice, reveals on select, and guards stale source/selection previews', async () => {
  const i = input(false), value = { ...props(), records: valueLibraryBoardRecords(i), previews: valueLibraryBoardPreviews(i, labels) }; const onCommand = vi.fn();
  const edit = { ...value.records, controls: { ...value.records.controls, mode: 'edit' as const, canSave: true } };
  const view = render(<LibraryBoardSection {...value} records={edit} onCommand={onCommand} />);
  expect(screen.queryByRole('radio')).toBeNull();
  expect(screen.queryByRole('button', { name: labels.board.choose })).toBeNull();
  fireEvent.click(screen.getByRole('row', { name: /Search/ }));
  expect(onCommand.mock.calls).toEqual([[{ version: 1, command: 'reveal', boardId: 'assets/icons', leafId: 'assets.icon-search' }]]);
  view.rerender(<LibraryBoardSection {...props()} previews={{ ...props().previews, selectionHash: 'stale-selection' }} />);
  expect(screen.getByText(labels.previewUnavailable)).toBeInTheDocument();
  view.rerender(<LibraryBoardSection {...props()} previews={{ ...props().previews, sourceHashes: {} }} />);
  expect(screen.getByText(labels.previewUnavailable)).toBeInTheDocument();
});
// DESIGNER-RO (converted): the prompt is reached from the unchosen row's Ask agent (the edit-mode Create is gone).
it('uses the original candidate prompt and host refresh keeps candidates pending', async () => {
  const i = input(false), value = { ...props(), records: valueLibraryBoardRecords(i), previews: valueLibraryBoardPreviews(i, labels) }, checkCandidates = vi.fn().mockResolvedValue({ status: 'checked', candidates: [{ id: 'new', slot: 'assets.icon-search', label: 'New candidate', source: 'example', variants: [] }] });
  render(<LibraryBoardSection {...value} workflow={{ returnStep: labels.board.returnStep, checkCandidates }} />);
  await userEvent.click(screen.getByRole('button', { name: labels.board.askAgent }));
  expect(screen.getByRole('dialog').querySelector('code')).toHaveTextContent('assets.icon-search');
  await userEvent.click(screen.getByRole('button', { name: labels.board.checkCandidates }));
  expect(await screen.findByText(/New candidate/)).toBeVisible();
  expect(within(screen.getByRole('dialog')).queryByRole('radio')).toBeNull();
});
it('rejects raw nodes, unknown fields, wrong preview leaf and unknown commands', () => {
  const value = props();
  expect(() => assertLibraryBoardRecords({ ...value.records, body: <div /> })).toThrow(/snapshot|field/);
  expect(() => assertLibraryBoardRecords({ ...value.records, controls: { ...value.records.controls, mode: 'graph' } })).toThrow(/mode/);
  expect(() => assertLibraryBoardCommand({ version: 1, command: 'persist-anything', boardId: 'assets/icons', leafId: 'x', source: 'y' })).toThrow(/command/);
  // DESIGNER-RO: the write commands are gone; reveal is the only command.
  expect(() => assertLibraryBoardCommand({ version: 1, command: 'use-source', boardId: 'assets/icons', leafId: 'x', source: 'y' })).toThrow(/command/);
  expect(() => assertLibraryBoardCommand({ version: 1, command: 'board-edit', boardId: 'assets/icons' })).toThrow();
  expect(() => assertLibraryBoardCommand({ version: 1, command: 'reveal', boardId: 'assets/icons', leafId: 'x', source: 'y' })).not.toThrow();
  expect(() => assertLibraryBoardRecords({ ...value.records, rows: { ...value.records.rows, items: [{ ...value.records.rows.items[0], candidates: [{ ...value.records.rows.items[0]!.candidates[0], previewIdentity: { leaf: 'wrong', source: 'lucide', selectionHash: 's', sourceHash: 'h' } }] }] } })).toThrow(/identity/);
});

// DESIGNER-RO (converted): the C7 candidate's preview stays unavailable; there is no radio left to disable.
it('keeps C7 errors unavailable without changing checked provider semantics', () => {
  const original = input(false), i = { ...original, mode: 'edit' as const, board: { ...original.board, rows: original.board.rows.map(row => ({ ...row, candidates: row.candidates.map(candidate => candidate.source !== 'lucide' ? candidate : { ...candidate, usable: false, findings: [...candidate.findings, { code: 'C7' as const, severity: 'error' as const, subject: row.id, message: 'Strict source evidence missing' }] }) })) } };
  const records = valueLibraryBoardRecords(i), previews = valueLibraryBoardPreviews(i, labels);
  const candidate = records.rows.items[0]!.candidates.find(candidate => candidate.source === 'lucide')!;
  expect(previews.render(candidate.previewIdentity!)).toBeUndefined();
  render(<LibraryBoardSection records={records} previews={previews} labels={labels} onCommand={vi.fn()} />);
  expect(screen.queryByRole('radio')).toBeNull();
});

it('dispatches only explicit library-board configuration while preserving Matrix grid and sides', async () => {
  const { Matrix, LIBRARY_BOARD_CONFIG } = await import('../index.js');
  expect(LIBRARY_BOARD_CONFIG).toEqual({ id: 'library-board', members: ['arrangement.library-board'], props: { arrangement: 'library-board' } });
  const view = render(<Matrix {...LIBRARY_BOARD_CONFIG.props} {...props()} />);
  expect(screen.getByRole('region', { name: 'Icons' })).toBeInTheDocument();
  view.rerender(<Matrix arrangement="grid" aria-label="Legacy grid" columns={[{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]} rows={[{ id: 'r', label: 'Row', cells: { a: { type: 'text', text: 'Original grid' }, b: { type: 'text', text: 'Original second column' } } }, { id: 's', label: 'Second row', cells: { a: { type: 'text', text: 'Second row A' }, b: { type: 'text', text: 'Second row B' } } }]} />);
  expect(screen.getByRole('table', { name: 'Legacy grid' })).toHaveTextContent('Original grid');
  view.rerender(<Matrix sides={[{ id: 'first', heading: 'First', points: ['one','two'] }, { id: 'second', heading: 'Second', points: ['three','four'] }]} />);
  expect(screen.getByRole('heading', { name: 'First' })).toBeInTheDocument();
});

/** Explicit SYNTHETIC evidence corpus, never a real source qualification claim.
 * Only this fixture rebinds test-kit to the roster's shadcn@aria seat and draft to built; the
 * original engine still checks all implementation evidence independently.
 */
function compositeInput(): PreparedCompositeLibraryBoardInput {
  const input = componentIntegration(), doc = structuredClone(input.catalog.components.fills[0]!);
  const meta = doc.$extensions['com.clossys.fill'];
  meta.source = 'shadcn@aria'; meta.id = 'shadcn@aria/components.button'; meta.status = 'built';
  for (const candidate of Object.values(doc.components)) candidate.source = 'shadcn@aria';
  input.catalog = { ...input.catalog, components: { ...input.catalog.components, fills: [doc] } };
  return { layer: 'components', board: { id: 'components/actions', label: 'Component actions', leaves: [{ id: 'components.button' }] }, input, changes: { baseHash: libraryHash(input.library), changes: [] }, contracts: loadBuildCatalog(), snapshot: { library: input.library, preview: vi.fn(() => <button>Checked live preview</button>) }, sources: input.catalog.values.sources, sourceHashes: { 'shadcn@aria': runtimeHash(doc) }, mode: 'edit', canSave: true, pending: false, labels,
    prompt: leaf => ({ consumer: input.library.source.id, board: { id: 'components/actions', label: 'Component actions' }, slot: { id: leaf, label: leaf }, variants: [], tokens: [], siblings: [], returnStep: labels.board.returnStep }) };
}
it('SYNTHETIC composite proposals retain real engine checks, exact provenance and original change shape', () => {
  const input = compositeInput(), prepared = compositeLibraryBoard(input), candidate = prepared.records.rows.items[0]!.candidates[0]!;
  expect(candidate.usable).toBe(true);
  expect(candidate.provenance).toEqual(expect.objectContaining({ source: 'shadcn@aria', layer: 'components', fill: input.input.catalog.components.fills[0]!.$extensions['com.clossys.fill'] }));
  expect(prepared.records.columns.items[0]).toEqual(expect.objectContaining({ label: 'shadcn/ui (React Aria)', license: 'MIT', referenceOnly: false }));
  // DESIGNER-RO (converted): the checked preview still renders through the port; the adapter has no changeFor.
  render(<>{prepared.previews.render(candidate.previewIdentity!)}</>);
  expect(screen.getByRole('button', { name: 'Checked live preview' })).toBeInTheDocument();
  expect('changeFor' in prepared).toBe(false);
  expect(prepared.previews.render({ ...candidate.previewIdentity!, selectionHash: 'stale' })).toBeUndefined();
  expect(prepared.previews.render({ ...candidate.previewIdentity!, sourceHash: 'stale' })).toBeUndefined();
});
// DESIGNER-RO (converted): no proposal produces an adoption command, because the adapter has none at all.
it('SYNTHETIC composite save, pending, draft and unqualified proposals never produce an adoption command', () => {
  const input = compositeInput();
  for (const prepared of [compositeLibraryBoard(input), compositeLibraryBoard({ ...input, canSave: false }), compositeLibraryBoard({ ...input, pending: true })]) expect('changeFor' in prepared).toBe(false);
  const draft = structuredClone(input.input.catalog.components.fills[0]!); draft.$extensions['com.clossys.fill'].status = 'draft';
  const drafted = compositeLibraryBoard({ ...input, input: { ...input.input, catalog: { ...input.input.catalog, components: { ...input.input.catalog.components, fills: [draft] } } } });
  expect(drafted.records.rows.items[0]!.candidates[0]!.usable).toBe(false);
  expect('changeFor' in drafted).toBe(false);
  const unqualified = compositeLibraryBoard({ ...input, input: { ...input.input, componentOptions: undefined } });
  expect(unqualified.records.rows.items[0]!.candidates[0]!.usable).toBe(false);
  expect('changeFor' in unqualified).toBe(false);
});
it('retains actual registered component draft provenance and does not infer qualification from a source column', () => {
  const input = compositeInput(), registry = loadComponentRegistry();
  const documents = importFoundryComponents().fills.filter(doc => doc.$extensions['com.clossys.fill'].slot === 'components.native-action');
  expect(documents).toHaveLength(1);
  expect(documents[0]!.$extensions['com.clossys.fill']).toEqual(expect.objectContaining({ source: 'foundry', status: 'draft', evidence: [] }));
  const prepared = compositeLibraryBoard({ ...input, board: { ...input.board, leaves: [{ id: 'components.native-action' }] }, input: { ...input.input, catalog: { ...input.input.catalog, components: { slots: registry.slots, fills: documents } } }, sourceHashes: Object.fromEntries(documents.map(doc => [doc.$extensions['com.clossys.fill'].source, runtimeHash(doc)])) });
  expect(prepared.records.rows.items[0]!.candidates.length).toBeGreaterThan(0);
  for (const candidate of prepared.records.rows.items[0]!.candidates) {
    expect(candidate.provenance.fill).toEqual(documents.find(doc => doc.$extensions['com.clossys.fill'].source === candidate.source)!.$extensions['com.clossys.fill']);
    expect(candidate.usable).toBe(false); expect(candidate.previewIdentity).toBeUndefined();
  }
});
it.each(['sections','frames'] as const)('keeps actual %s surface-engine state inspectable without promoting draft runtime qualification', layer => {
  const fixture = syntheticSurface({ layer }), input = fixture.input, leaf = `${layer}.synthetic`;
  input.library = applyLibraryChange(input.catalog, input.library, { baseHash: libraryHash(input.library), changes: [{ portion: 'surfaces', change: { op: 'adopt', slot: leaf as 'sections.synthetic' | 'frames.synthetic', source: 'synthetic' } }], surfaceBundles: [fixture.bundle] }, { componentOptions: input.componentOptions, surfaceOptions: input.surfaceOptions! });
  const template = compositeInput(), prepared = compositeLibraryBoard({ ...template, layer, input, snapshot: { library: input.library, preview: vi.fn(() => <p>Must remain unavailable</p>) }, changes: { baseHash: libraryHash(input.library), changes: [] }, board: { id: `${layer}/synthetic`, label: 'Surface group', leaves: [{ id: leaf }] }, sources: [...input.catalog.values.sources, input.library.source], sourceHashes: { [input.library.source.id]: runtimeHash(fixture.bundle.document) } });
  expect(prepared.records.rows.items[0]!.selectedSource).toBe(input.library.source.id);
  expect(prepared.records.rows.items[0]!.selectedPreview).toBeUndefined();
  expect(prepared.records.rows.items[0]!.candidates).toEqual([]);
  expect('changeFor' in prepared).toBe(false);
  render(<LibraryBoardSection records={prepared.records} previews={prepared.previews} labels={labels} onCommand={vi.fn()} />);
  expect(screen.getByRole('region', { name: 'Surface group' })).toHaveTextContent(labels.previewUnavailable);
  expect(screen.queryByText('Must remain unavailable')).toBeNull();
  expect(screen.queryByRole('radio')).toBeNull();
});
