import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { WholeStudioProvider, useWholeStudio, useDesignerPreparedLibraryBoards, type DesignerPreparedLibraryBoardOptions } from './WholeStudioProvider.js';
import { useStudioSession } from './StudioProvider.js';
import { adopt, smallCatalog, labels } from './__fixtures__/studio.js';
import { deriveDesignerLayerBoardsV1, DESIGNER_LAYER_BOARDS_QUERY } from './designer-layer-boards.js';
import { runtimeHash } from '../catalog-core/runtime-ports.js';
import { loadBuildCatalog } from '../catalog-core/index.js';
import type { CompositeStudioAdapter, CompositeStudioLabels } from './types.js';

afterEach(cleanup);
/** Bounded real catalog with SYNTHETIC consumer/test controller inputs; no runtime qualification claim. */
function fixture() {
  const { source, adoptedAt, ...values } = adopt(adopt(), 'assets.icon-search', 'lucide');
  const library = { source, adoptedAt, values, components: { fills: [], files: [] } };
  const load = vi.fn(async () => ({ library }));
  const save = vi.fn(async () => ({ ok: false as const, reason: 'unavailable' as const }));
  const adapter: CompositeStudioAdapter = { kind: 'composite', catalog: { values: smallCatalog, components: { slots: [], fills: [] } }, contracts: loadBuildCatalog(), load, save };
  const wholeLabels: CompositeStudioLabels = { ...labels, whole: { signoff: 'SYNTHETIC', proposed: 'SYNTHETIC', contract: 'SYNTHETIC', contentSlots: 'SYNTHETIC', configurations: 'SYNTHETIC', unresolved: 'SYNTHETIC', unassessed: 'SYNTHETIC' } };
  return { adapter, wholeLabels, load, save };
}
type Observed = { whole: NonNullable<ReturnType<typeof useWholeStudio>>; values: ReturnType<typeof useStudioSession>; prepared: ReturnType<typeof useDesignerPreparedLibraryBoards> };

it('exposes original records without source hashes and preserves one session across Tokens, Assets and Tokens', async () => {
  const f = fixture(); let observed!: Observed;
  const options: DesignerPreparedLibraryBoardOptions = { workflow: { returnStep: 'SYNTHETIC original host return' }, board: () => ({ mode: 'view', canSave: false, pending: false }) };
  function Probe() { observed = { whole: useWholeStudio()!, values: useStudioSession(), prepared: useDesignerPreparedLibraryBoards(options) }; return <output>{observed.prepared.status}</output>; }
  render(<WholeStudioProvider adapter={f.adapter} labels={f.wholeLabels}><Probe /></WholeStudioProvider>);
  await screen.findByText('prepared');
  const session = observed.whole.session, identity = observed.prepared.projection.session.id;
  const originals = { edit: session!.edit, flush: session!.flush, undo: session!.undo, redo: session!.redo, retry: session!.retry };
  const check = (layer: 'tokens' | 'assets') => {
    const prepared = observed.prepared; expect(prepared.status).toBe('prepared');
    if (prepared.status !== 'prepared') throw new Error('Expected mounted records');
    expect(prepared.projection.layer).toBe(layer);
    expect(prepared.records.map(value => value.records.rows.items.map(row => row.id))).toEqual(observed.values.boards.map(board => board.rows.filter(row => row.scope === 'slot').map(row => row.id)));
    expect(prepared.records.every(value => value.sessionId === identity && value.libraryHash === prepared.projection.libraryHash && value.selectionHash === prepared.projection.selectionHash)).toBe(true);
    expect(prepared.records.flatMap(value => value.records.rows.items).every(row => row.prompt.returnStep === options.workflow!.returnStep)).toBe(true);
    expect(prepared.boards.some(board => board.previews.status === 'pending' && board.previews.code === 'SOURCE_HASH_ASSOCIATION_UNAVAILABLE')).toBe(true);
    const result = deriveDesignerLayerBoardsV1({ query: DESIGNER_LAYER_BOARDS_QUERY, projection: prepared.projection, projectionHash: prepared.projectionHash, records: prepared.records,
      arrangement: { kind: 'lanes', groupKey: 'domain', gap: { x: 12, y: 8 }, laneGap: 20 }, stateSections: {} });
    expect(result.status).toBe('materialized');
    expect(observed.whole.session).toBe(session); expect(observed.whole.snapshot?.runtime).toBeUndefined();
    expect(observed.whole.sessionState?.edits).toEqual([]);
  };
  check('tokens');
  await act(async () => { await observed.whole.setLayer('assets'); }); check('assets');
  await act(async () => { await observed.whole.setLayer('tokens'); }); check('tokens');
  expect({ edit: session!.edit, flush: session!.flush, undo: session!.undo, redo: session!.redo, retry: session!.retry }).toEqual(originals);
  expect(f.load).toHaveBeenCalledOnce(); expect(f.save).not.toHaveBeenCalled();
});

it('does not infer omitted controller state, and exposes pending original loading/error states', async () => {
  const f = fixture(); let observed!: ReturnType<typeof useDesignerPreparedLibraryBoards>;
  function Probe() { observed = useDesignerPreparedLibraryBoards({ board: () => undefined }); return <output>{observed.status === 'pending' ? observed.code : observed.status}</output>; }
  render(<WholeStudioProvider adapter={f.adapter} labels={f.wholeLabels}><Probe /></WholeStudioProvider>);
  expect(screen.getByText('DESIGNER_PROVIDER_UNAVAILABLE')).toBeVisible();
  await screen.findByText('BOARD_CONTROLS_UNAVAILABLE');
  expect(observed).toMatchObject({ status: 'pending', boards: expect.arrayContaining([expect.any(String)]) });
  cleanup();
  render(<WholeStudioProvider adapter={{ ...f.adapter, load: async () => { throw new Error('SYNTHETIC failed load'); } }} labels={f.wholeLabels}><Probe /></WholeStudioProvider>);
  await waitFor(() => expect(observed.projection.phase).toBe('error'));
  expect(observed).toMatchObject({ status: 'pending', code: 'DESIGNER_PROVIDER_UNAVAILABLE', boards: [] });
});

it('keeps failed original edits and history on the same session, with stale preview identities rejected', async () => {
  const f = fixture(); let observed!: Observed;
  const sourceHashes = { example: runtimeHash('SYNTHETIC source owner association') };
  const options: DesignerPreparedLibraryBoardOptions = { board: () => ({ mode: 'view', canSave: false, pending: false, sourceHashes }) };
  function Probe() { observed = { whole: useWholeStudio()!, values: useStudioSession(), prepared: useDesignerPreparedLibraryBoards(options) }; return <output>{observed.prepared.status}:{observed.whole.sessionState?.status}</output>; }
  render(<WholeStudioProvider adapter={f.adapter} labels={f.wholeLabels}><Probe /></WholeStudioProvider>);
  await screen.findByText('prepared:saved');
  const session = observed.whole.session, before = observed.prepared;
  if (before.status !== 'prepared') throw new Error('Expected original records');
  const initialBoard = before.boards.find(board => board.records.rows.items.some(row => row.selectedPreview))!;
  const initialIdentity = initialBoard.records.rows.items.find(row => row.selectedPreview)!.selectedPreview!;
  act(() => observed.whole.edit('tokens.surface-color', [{ portion: 'values', change: { op: 'remove', slot: 'tokens.surface-color' } }]));
  await screen.findByText('prepared:not-saved');
  const edits = observed.whole.sessionState!.edits;
  const committed = session!.getSnapshot().committed;
  expect(edits).toHaveLength(1);
  expect(edits[0]).toMatchObject({ leaf: 'tokens.surface-color', status: 'failed', failure: { ok: false, reason: 'unavailable' } });
  expect(observed.whole.sessionState!.historyFailure).toBeUndefined();
  expect(f.save).toHaveBeenCalledOnce();
  const next = observed.prepared;
  if (next.status !== 'prepared') throw new Error('Expected edited original records');
  const updatedBoard = next.boards.find(board => board.records.rows.boardId === initialBoard.records.rows.boardId)!;
  expect(next.projection.selectionHash).not.toBe(before.projection.selectionHash);
  expect(updatedBoard.previews.status).toBe('available');
  if (updatedBoard.previews.status === 'available') expect(updatedBoard.previews.port.render(initialIdentity)).toBeUndefined();
  let moved: boolean | undefined;
  await act(async () => { moved = await observed.whole.setLayer('assets'); });
  expect(moved).toBe(false); expect(observed.whole.layer).toBe('tokens');
  expect(observed.whole.session).toBe(session); expect(observed.whole.sessionState!.edits).toEqual(edits);
  expect(observed.whole.sessionState!.canUndo).toBe(true);
  expect(observed.whole.sessionState!.historyFailure).toBeUndefined();
  expect(f.save).toHaveBeenCalledOnce();
  act(() => session!.undo());
  await screen.findByText('prepared:saved');
  expect(observed.whole.session).toBe(session);
  expect(observed.whole.sessionState!.edits).toEqual([]);
  expect(session!.getSnapshot().committed).toBe(committed);
  expect(observed.whole.sessionState!.historyFailure).toBeUndefined();
  expect(observed.whole.sessionState!.canUndo).toBe(false);
  expect(observed.whole.sessionState!.canRedo).toBe(false);
  expect(observed.prepared.projection.selectionHash).toBe(before.projection.selectionHash);
  expect(f.save).toHaveBeenCalledOnce();
});
