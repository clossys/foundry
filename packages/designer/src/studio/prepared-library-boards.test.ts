import { expect, it, vi } from 'vitest';
import { runtimeHash } from '../catalog-core/runtime-ports.js';
import { applyLibraryChange, libraryHash, loadBuildCatalog, resolve } from '../catalog-core/index.js';
import { adoptedComponentIntegration, componentIntegration } from '../catalog-core/__fixtures__/component-integration.js';
import { assertLibraryBoardRecords } from '../blocks/library-board/model.js';
import { emptyChanges } from './model.js';
import { matrixBoards, matrixRows } from './matrix-model.js';
import { adopt, smallCatalog, labels } from './__fixtures__/studio.js';
import { valueBoardPrompt, compositeBoardPrompt, prepareValueLibraryBoard, prepareCompositeLibraryBoard } from './prepared-library-boards.js';
import { compositeLibraryBoard } from './library-board-adapter.js';
import * as wholeModel from './whole-model.js';

/** Source associations below are explicit SYNTHETIC test inputs, never production provenance. */
function valueInput() {
  const library = adopt();
  const rows = matrixRows({ catalog: smallCatalog, library, working: library, changes: emptyChanges(library), expanded: new Set(), evaluateRows: new Set() });
  const board = matrixBoards({ catalog: smallCatalog, library, working: library }, rows).find(board => board.leaves.includes('themes.background'))!;
  return { layer: 'themes' as const, board, sources: smallCatalog.sources, consumerSource: library.source.id,
    selectionHash: runtimeHash('SYNTHETIC-selected-library'), mode: 'view' as const, canSave: false, pending: false, labels,
    contextTokens: [{ id: 'themes.background.default', value: 'var(--synthetic)' }] };
}

it('keeps checked records, original prompts and caller controls usable while source association is pending', () => {
  const input = valueInput(), before = runtimeHash(input.board);
  const prepared = prepareValueLibraryBoard(input);
  assertLibraryBoardRecords(prepared.records);
  expect(prepared.records.rows.items.map(row => row.id)).toEqual(input.board.rows.filter(row => row.scope === 'slot').map(row => row.id));
  expect(prepared.records.rows.items.find(row => row.id === 'themes.background')?.selectedSource).toBe(input.consumerSource);
  expect(prepared.records.controls).toEqual({ version: 1, mode: 'view', canSave: false, pending: false });
  expect(prepared.previews).toEqual({ status: 'pending', code: 'SOURCE_HASH_ASSOCIATION_UNAVAILABLE', sources: [input.consumerSource] });
  expect(prepared.records.rows.items.every(row => !row.selectedPreview && row.candidates.every(candidate => !candidate.previewIdentity))).toBe(true);
  expect(runtimeHash(input.board)).toBe(before);
});

it('uses explicit source association for live previews and rejects stale selection, source and unknown leaf', () => {
  const input = valueInput(), sourceHashes = { [input.consumerSource]: runtimeHash('SYNTHETIC-source-owned-closure') };
  const prepared = prepareValueLibraryBoard({ ...input, sourceHashes });
  expect(prepared.previews.status).toBe('available');
  if (prepared.previews.status !== 'available') throw new Error('Expected test association');
  const identity = prepared.records.rows.items.find(row => row.id === 'themes.background')!.selectedPreview!;
  expect(identity.sourceHash).toBe(sourceHashes[input.consumerSource]);
  expect(prepared.previews.port.sourceHashes).toBe(sourceHashes);
  expect(prepared.previews.port.render(identity)).toBeDefined();
  expect(prepared.previews.port.render({ ...identity, selectionHash: runtimeHash('SYNTHETIC-stale') })).toBeUndefined();
  expect(prepared.previews.port.render({ ...identity, sourceHash: runtimeHash('SYNTHETIC-other-source') })).toBeUndefined();
  expect(prepared.previews.port.render({ ...identity, leaf: 'tokens.absent' })).toBeUndefined();
});

it('never substitutes a fill hash when one source association is absent or empty', () => {
  const input = valueInput(), selected = input.board.rows.find(row => row.scope === 'slot')!;
  const alternate = { ...selected.candidates[0]!, source: 'SYNTHETIC-other', selected: false };
  const board = { ...input.board, rows: input.board.rows.map(row => row === selected ? { ...row, candidates: [...row.candidates, alternate] } : row) };
  for (const sourceHashes of [{ [input.consumerSource]: runtimeHash('SYNTHETIC-present') }, { [input.consumerSource]: runtimeHash('SYNTHETIC-present'), 'SYNTHETIC-other': '' }]) {
    const prepared = prepareValueLibraryBoard({ ...input, mode: 'edit', board, sourceHashes });
    expect(prepared.previews).toEqual({ status: 'pending', code: 'SOURCE_HASH_ASSOCIATION_UNAVAILABLE', sources: ['SYNTHETIC-other'] });
    expect(prepared.records.rows.items.every(row => !row.selectedPreview && row.candidates.every(candidate => !candidate.previewIdentity))).toBe(true);
  }
});

it('retains exact value prompt variants, selected siblings, workflow and current candidate identity', () => {
  const input = valueInput(), row = input.board.rows.find(row => row.id === 'themes.background')!;
  const workflow = { guidelines: { [row.id]: ['SYNTHETIC original guideline'] }, returnStep: 'SYNTHETIC host return step' };
  const context = { board: input.board, row, consumer: input.consumerSource, contextTokens: input.contextTokens, variants: { [row.id]: ['SYNTHETIC-explicit-member'] }, workflow, returnStep: labels.board.returnStep };
  const ordinary = valueBoardPrompt(context), refresh = valueBoardPrompt(context, true);
  expect(ordinary).toEqual({ consumer: input.consumerSource, board: { id: input.board.id, label: input.board.label }, slot: { id: row.id, label: row.label }, variants: ['SYNTHETIC-explicit-member'], guidelines: workflow.guidelines[row.id], tokens: input.contextTokens,
    siblings: [{ id: row.id, source: input.consumerSource }], returnStep: workflow.returnStep });
  const candidate = row.candidates.find(candidate => candidate.selected)!;
  expect(refresh).toEqual({ ...ordinary, currentCandidate: { id: candidate.fill.id, source: candidate.source, variants: candidate.members.map(member => member.id) } });
  const fallback = valueBoardPrompt({ ...context, workflow: undefined, variants: undefined });
  expect(fallback.variants).toEqual([...new Set(row.candidates.flatMap(candidate => candidate.members.map(member => member.id)))]);
  expect(fallback.returnStep).toBe(labels.board.returnStep);
  expect(fallback.guidelines).toBeUndefined();
});

it('preserves contract prompt token context, registered variants and selected component refresh semantics', () => {
  const input = adoptedComponentIntegration(), profile = resolve(input), slots = loadBuildCatalog().slots;
  const board = { id: 'components/SYNTHETIC-board', label: 'SYNTHETIC board', leaves: [{ id: 'components.button' }] };
  const context = { board, leaf: 'components.button', consumer: input.library.source.id, slots, profile, returnStep: labels.board.returnStep };
  const prompt = compositeBoardPrompt(context, true), selected = profile.components.components['components.button']!;
  expect(prompt.siblings).toEqual([{ id: 'components.button', source: selected.descriptor.source }]);
  expect(prompt.currentCandidate).toEqual({ id: 'components.button', source: selected.descriptor.source, variants: [] });
  expect(prompt.tokens).toEqual(Object.entries(profile.values.members).filter(([, member]) => member.slot.startsWith('themes.')).map(([id, member]) => ({ id, value: member.css.light })));
  const missing = compositeBoardPrompt({ ...context, leaf: 'sections.empty-state', profile: undefined }, true);
  expect(missing.currentCandidate).toBeUndefined(); expect(missing.tokens).toEqual([]); expect(missing.siblings).toEqual([]);
});

it('keeps composite records available with a named pending preview and preserves read-only input identity', () => {
  const input = adoptedComponentIntegration(), profile = resolve(input), contracts = loadBuildCatalog();
  const before = runtimeHash(input.library);
  const prepared = prepareCompositeLibraryBoard({ layer: 'components', board: { id: 'components/SYNTHETIC-board', label: 'SYNTHETIC board', leaves: [{ id: 'components.button' }] }, input, profile, contracts,
    snapshot: { library: input.library, componentOptions: input.componentOptions }, changes: { baseHash: before, changes: [] }, sources: input.catalog.values.sources, labels, mode: 'view', canSave: false, pending: true });
  assertLibraryBoardRecords(prepared.records);
  expect(prepared.previews).toMatchObject({ status: 'pending', code: 'SOURCE_HASH_ASSOCIATION_UNAVAILABLE' });
  expect(prepared.records.rows.items.map(row => row.id)).toEqual(['components.button']);
  expect(prepared.records.controls).toEqual({ version: 1, mode: 'view', canSave: false, pending: true });
  // DESIGNER-RO (converted): a prepared board exposes no change port at all (row 16), not one that answers undefined.
  expect('changeFor' in prepared).toBe(false);
  expect(runtimeHash(input.library)).toBe(before);
});

/** Local SYNTHETIC fixture follows the existing library-board test normalization.
 * Both roster metadata and contained source are rebound before adoption; no production roster changes.
 */
function normalizedComponentInput() {
  const input = componentIntegration(), doc = structuredClone(input.catalog.components.fills[0]!);
  const meta = doc.$extensions['com.clossys.fill'];
  meta.source = 'shadcn@aria'; meta.id = 'shadcn@aria/components.button'; meta.status = 'built';
  for (const candidate of Object.values(doc.components)) candidate.source = 'shadcn@aria';
  input.catalog = { ...input.catalog, components: { ...input.catalog.components, fills: [doc] } };
  input.library = applyLibraryChange(input.catalog, input.library, { baseHash: libraryHash(input.library), changes: [{ portion: 'components', change: { op: 'adopt', slot: 'components.button', source: 'shadcn@aria' } }] });
  return input;
}

it('does not evaluate alternative proposals in view mode and evaluates them only on edit demand', () => {
  const input = normalizedComponentInput(), profile = resolve(input), contracts = loadBuildCatalog();
  const preview = vi.spyOn(wholeModel, 'previewComponent');
  const options = { layer: 'components' as const, board: { id: 'components/SYNTHETIC-board', label: 'SYNTHETIC board', leaves: [{ id: 'components.button' }] }, input, profile, contracts,
    snapshot: { library: input.library, componentOptions: input.componentOptions }, changes: { baseHash: runtimeHash(input.library), changes: [] }, sources: input.catalog.values.sources, labels, canSave: false, pending: false };
  try {
    const view = prepareCompositeLibraryBoard({ ...options, mode: 'view' });
    expect(preview).not.toHaveBeenCalled();
    expect(view.records.rows.items[0]!.candidates).toHaveLength(input.catalog.components.fills.length);
    expect(view.records.rows.items[0]!.candidates.every(candidate => candidate.provenance.fill.slot === 'components.button')).toBe(true);
    expect(view.records.rows.items[0]!.candidates[0]).toMatchObject({ source: 'shadcn@aria', usable: false, findings: [{ code: 'CANDIDATE_EVALUATION_NOT_REQUESTED', severity: 'notice' }] });
    expect(view.records.rows.items[0]!.candidates[0]!.previewIdentity).toBeUndefined();
    const edit = prepareCompositeLibraryBoard({ ...options, mode: 'edit' });
    expect(preview).toHaveBeenCalledTimes(input.catalog.components.fills.length);
    expect(edit.records.rows.items[0]!.candidates.map(candidate => candidate.provenance)).toEqual(view.records.rows.items[0]!.candidates.map(candidate => candidate.provenance));
    preview.mockClear();
    // A real stale observation produces known K5/K6 findings; absence of options alone need not.
    const componentOptions = structuredClone(input.componentOptions!);
    componentOptions.evidence!.observations['components.button']!.sourceHash = 'SYNTHETIC-stale-source-hash';
    const blockedInput = { ...options.input, componentOptions };
    const legacy = compositeLibraryBoard({ ...options, input: blockedInput, mode: 'view', sourceHashes: {}, prompt: () => compositeBoardPrompt({ board: options.board, leaf: 'components.button', consumer: input.library.source.id, slots: contracts.slots, profile, returnStep: labels.board.returnStep }) });
    expect(preview).toHaveBeenCalledTimes(input.catalog.components.fills.length);
    const blocked = legacy.records.rows.items[0]!.candidates[0]!;
    expect(blocked.usable).toBe(false); expect(blocked.previewIdentity).toBeUndefined();
    expect(blocked.findings).toContainEqual({ code: 'K5', severity: 'error', message: 'Accessibility evidence is stale for source or consumer tokens' });
    expect(blocked.findings).toContainEqual({ code: 'K6', severity: 'error', message: 'Contrast evidence is stale for source or consumer tokens' });
    // DESIGNER-RO (converted): a blocked candidate has no change port to refuse (row 16).
    expect('changeFor' in legacy).toBe(false);
  } finally { preview.mockRestore(); }
});
