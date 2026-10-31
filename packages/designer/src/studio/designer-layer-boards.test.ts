// @vitest-environment node
import { expect, it } from 'vitest';
import { build } from 'esbuild';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBuildCatalog } from '../catalog-core/index.js';
import { runtimeHash } from '../catalog-core/runtime-ports.js';
import type { LayerId, PlacementNode } from '../catalog-core/types.js';
import { deriveDesignerLayerBoardsV1, DESIGNER_LAYER_BOARDS_QUERY, type DesignerLayerBoardsInput } from './designer-layer-boards.js';

const leaves = (node: PlacementNode): string[] => 'leaves' in node ? [...node.leaves] : node.children.flatMap(leaves);
/** SYNTHETIC records contain no usable candidates; inventory is the actual shipped five-layer catalog. */
function fixture(layer: LayerId): DesignerLayerBoardsInput {
  const catalog = loadBuildCatalog(), placement = catalog.placements.find(value => value.layer === layer)!;
  const boards = placement.nodes.flatMap(domain => ('children' in domain ? domain.children : [domain]).map(group => ({ id: `${layer}/${group.id}`, label: group.label, leaves: leaves(group) })));
  const libraryHash = runtimeHash({ library: 'SYNTHETIC' }), selectionHash = runtimeHash({ selection: 'SYNTHETIC' });
  const projection = { phase: 'ready' as const, layer, consumer: 'SYNTHETIC', libraryHash, selectionHash, session: { id: 'SYNTHETIC-session', revision: 1, status: 'saved', edits: [], history: null }, activeLeaf: boards[0]?.leaves[0] ?? '', placements: [placement], slots: catalog.slots.filter(slot => slot.layer === layer).map(({ id, layer }) => ({ id, layer })), boards };
  return { query: DESIGNER_LAYER_BOARDS_QUERY, projection, projectionHash: runtimeHash(projection), arrangement: { kind: 'lanes', groupKey: 'domain', gap: { x: 12, y: 8 }, laneGap: 20 }, stateSections: {}, records: boards.map(board => ({ sessionId: projection.session.id, consumer: projection.consumer, libraryHash, selectionHash, records: { columns: { version: 1, items: [] }, controls: { version: 1, mode: 'view', canSave: false, pending: false }, rows: { version: 1, layer, boardId: board.id, label: board.label, items: board.leaves.map(id => ({ id, label: id, scope: 'slot', selectedSource: null, candidates: [], prompt: { consumer: projection.consumer, board: { id: board.id, label: board.label }, slot: { id, label: id }, variants: [], tokens: [], siblings: [], returnStep: 'SYNTHETIC-return' } })) } } })) };
}
it.each(['themes','assets','components','sections','frames'] as const)('designer.layer-boards v1 materializes actual %s placement inventory', layer => {
  const input = fixture(layer), before = runtimeHash(input);
  const result = deriveDesignerLayerBoardsV1(input);
  expect(result.status).toBe('materialized');
  if (result.status !== 'materialized' || result.body.kind !== 'canvas') throw new Error('Expected ready canvas materialization');
  expect(result.body.boards.map(board => board.id)).toEqual(input.projection.boards.map(board => board.id));
  const domains = input.projection.placements[0]!.nodes.flatMap(domain => ('children' in domain ? domain.children : [domain]).map(() => domain.id));
  expect(result.body.boards.map(board => board.groups?.domain)).toEqual(domains);
  expect(result.body.boards.map(board => board.section)).toEqual(input.projection.boards.map((_, index) => ({ slot: 'sections.comparison', index })));
  expect(result.body.source).toEqual({ kind: 'derived', query: DESIGNER_LAYER_BOARDS_QUERY });
  expect(result.body.collapseBelow).toBe('md');
  expect(runtimeHash(input)).toBe(before);
  expect(result.fills['sections.comparison']).toHaveLength(input.records.length);
});
function ready(input: DesignerLayerBoardsInput) {
  const result = deriveDesignerLayerBoardsV1(input); expect(result.status).toBe('materialized');
  if (result.status !== 'materialized') throw new Error(result.reason);
  return result;
}
it('library change seals current identity while preserving stable board refs and domain groups', () => {
  const input = fixture('components'), before = ready(input), libraryHash = runtimeHash({ library: 'SYNTHETIC-next' });
  const projection = { ...input.projection, libraryHash };
  expect(() => deriveDesignerLayerBoardsV1({ ...input, projection, projectionHash: runtimeHash(projection) })).toThrow(/record identity/);
  const after = ready({ ...input, projection, projectionHash: runtimeHash(projection), records: input.records.map(record => ({ ...record, libraryHash })) });
  expect(after.body).toEqual(before.body); expect(after.fills).toEqual(before.fills); expect(after.inputHash).not.toBe(before.inputHash);
  expect(after.materializationHash).toBe(before.materializationHash);
});
it('lanes to grid retains exactly the same board IDs, rows and checked selection', () => {
  const input = fixture('assets'), before = ready(input), after = ready({ ...input, arrangement: { kind: 'grid', columns: 2, gap: input.arrangement.gap } });
  expect(after.body.kind).toBe('canvas'); expect(before.body.kind).toBe('canvas');
  if (after.body.kind !== 'canvas' || before.body.kind !== 'canvas') return;
  expect(after.body.boards).toEqual(before.body.boards); expect(after.fills).toEqual(before.fills); expect(after.content).toEqual(before.content);
  expect(after.materializationHash).not.toBe(before.materializationHash);
});
it('refuses unknown query versions, stale projection hashes, foreign rows and caller-authored inventory', () => {
  const input = fixture('themes');
  expect(DESIGNER_LAYER_BOARDS_QUERY).toEqual({ id: 'designer.layer-boards', version: 1 });
  expect(() => deriveDesignerLayerBoardsV1({ ...input, query: { id: 'designer.layer-boards', version: 2 } })).toThrow(/version/);
  expect(() => deriveDesignerLayerBoardsV1({ ...input, query: { id: 'host-query', version: 1 } })).toThrow(/version/);
  expect(() => deriveDesignerLayerBoardsV1({ ...input, projectionHash: runtimeHash('stale') })).toThrow(/projection hash/);
  const projection = { ...input.projection, boards: [...input.projection.boards].reverse() };
  expect(() => deriveDesignerLayerBoardsV1({ ...input, projection, projectionHash: runtimeHash(projection) })).toThrow(/actual placements/);
  expect(() => deriveDesignerLayerBoardsV1({ ...input, records: input.records.map((record,index) => index ? record : { ...record, sessionId: 'foreign-session' }) })).toThrow(/record identity/);
  expect(() => deriveDesignerLayerBoardsV1({ ...input, x: 5 } as DesignerLayerBoardsInput)).toThrow(/field/);
  expect(() => deriveDesignerLayerBoardsV1({ ...input, render: () => null } as DesignerLayerBoardsInput)).toThrow(/snapshot/);
});
it('keeps missing ready identity and missing actual checked records pending without invented boards', () => {
  const input = fixture('themes'), projection = { ...input.projection, libraryHash: null };
  expect(deriveDesignerLayerBoardsV1({ ...input, projection, projectionHash: runtimeHash(projection) })).toEqual({ status: 'pending', reason: expect.stringMatching(/identity/) });
  expect(deriveDesignerLayerBoardsV1({ ...input, records: [] })).toEqual({ status: 'pending', reason: expect.stringMatching(/records/) });
});
function stateFixture(phase: 'loading' | 'error' | 'empty'): DesignerLayerBoardsInput {
  const input = fixture('themes');
  const projection = { ...input.projection, phase: phase === 'empty' ? 'ready' as const : phase, ...(phase === 'empty' ? { placements: [], slots: [], boards: [] } : {}) };
  const section = phase === 'loading' ? 'sections.notices' as const : phase === 'error' ? 'sections.error-state' as const : 'sections.empty-state' as const;
  const reference = { kind: phase === 'loading' ? 'records' as const : phase === 'error' ? 'copy' as const : 'action' as const, ref: `SYNTHETIC/${phase}` };
  const value = phase === 'loading' ? [{ id: 'SYNTHETIC-loading', tone: 'info', message: 'Loading original library' }] : phase === 'error' ? 'SYNTHETIC-load-error' : { label: 'SYNTHETIC-return', command: 'SYNTHETIC-navigation' };
  return { ...input, projection, projectionHash: runtimeHash(projection), records: [], stateSections: { [phase]: { sessionId: projection.session.id, fill: { section, content: { [phase === 'loading' ? 'notices' : phase === 'error' ? 'code' : 'actions']: reference } }, content: [{ reference, value, hash: runtimeHash(value) }], layout: { leaf: 'layouts.stack', config: 'stack.workspace', members: { align: 'start', measure: 'full' }, slot: 'body' } } } };
}
it.each(['loading','error','empty'] as const)('%s uses a real registered flow Section and exact selected Layout under the original session', phase => {
  const input = stateFixture(phase), result = ready(input);
  const selected = input.stateSections[phase]!;
  const slot = loadBuildCatalog().slots.find(slot => slot.id === selected.fill.section)!;
  expect(slot.contract.kind === 'section' && slot.contract.substrates?.includes('flow')).toBe(true);
  if (slot.contract.kind === 'section') for (const [name, reference] of Object.entries(selected.fill.content)) expect(slot.contract.slots.some(slot => slot.name === name && slot.type === reference.kind)).toBe(true);
  expect(result.body).toEqual({ kind: 'flow', source: { kind: 'derived', query: DESIGNER_LAYER_BOARDS_QUERY }, sections: [{ slot: 'body', index: 0 }] });
  expect(result.fills).toEqual({ body: [selected.fill] }); expect(result.layout).toEqual(selected.layout); expect(result.content).toEqual(selected.content); expect(result.sessionId).toBe(input.projection.session.id);
  expect('boards' in result.body).toBe(false);
});
it('state output without actual selected Layout or content stays pending and foreign-session state refs refuse', () => {
  const input = stateFixture('loading'), state = input.stateSections.loading!;
  expect(deriveDesignerLayerBoardsV1({ ...input, stateSections: {} }).status).toBe('pending');
  expect(deriveDesignerLayerBoardsV1({ ...input, stateSections: { loading: { ...state, layout: undefined } } }).status).toBe('pending');
  expect(deriveDesignerLayerBoardsV1({ ...input, stateSections: { loading: { ...state, content: [] } } }).status).toBe('pending');
  expect(deriveDesignerLayerBoardsV1({ ...input, stateSections: { loading: { ...state, content: state.content.map(content => ({ ...content, hash: runtimeHash('stale') })) } } }).status).toBe('pending');
  expect(() => deriveDesignerLayerBoardsV1({ ...input, stateSections: { loading: { ...state, sessionId: 'foreign-original-session' } } })).toThrow(/different original session/);
});
it('binds original Edit revision and operations into query input identity without retaining another store', () => {
  const input = fixture('themes'), first = ready(input);
  const projection = { ...input.projection, session: { ...input.projection.session, revision: 2, edits: [{ leaf: input.projection.activeLeaf, operationsHash: runtimeHash('SYNTHETIC-edit') }] } };
  const next = ready({ ...input, projection, projectionHash: runtimeHash(projection) });
  expect(next.inputHash).not.toBe(first.inputHash); expect(next.materializationHash).toBe(first.materializationHash);
  expect(ready(input)).toEqual(first);
});
it('public query browser closure contains only finite query/model utilities and no runtime UI entry', async () => {
  const path = resolvePath(dirname(fileURLToPath(import.meta.url)), 'designer-layer-boards.ts');
  const bundle = await build({ entryPoints: [path], bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true, treeShaking: false });
  const inputs = Object.keys(bundle.metafile!.inputs);
  expect(inputs.length).toBeGreaterThan(1);
  expect(inputs.filter(path => /(?:node_modules\/(?:react|react-dom|react-aria-components)|\/components\/|\/frames\/|\/studio\/(?!designer-layer-boards\.ts$)|\/blocks\/(?!library-board\/(?:model|candidate-prompt)\.ts$))/.test(path))).toEqual([]);
  expect(bundle.metafile!.outputs).not.toEqual({});
});
it('state-only provider closure cannot reach an old Studio page or canvas implementation', async () => {
  const path = resolvePath(dirname(fileURLToPath(import.meta.url)), 'WholeStudioProvider.tsx');
  const bundle = await build({ entryPoints: [path], bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true, treeShaking: false });
  expect(Object.keys(bundle.metafile!.inputs).filter(path => /\/studio\/(?:WholeStudio|Studio|DesignerPage)\.tsx$/.test(path))).toEqual([]);
});
