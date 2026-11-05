import type { LayerId, Placement, PlacementNode } from '../catalog-core/types.js';
import type { CanvasArrangement, CompositionBody } from '../catalog-core/body-substrate.js';
import { assertCanvasArrangement } from '../catalog-core/body-substrate.js';
import type { RuntimeContent, RuntimeContentRef, RuntimeDigest, RuntimeJson } from '../catalog-core/runtime-ports.js';
import { isRuntimeDigest, runtimeHash, runtimeSnapshot } from '../catalog-core/runtime-ports.js';
import type { LibraryBoardRecords } from '../blocks/library-board/model.js';
import { assertLibraryBoardRecords } from '../blocks/library-board/model.js';

export const DESIGNER_LAYER_BOARDS_QUERY = Object.freeze({ id: 'designer.layer-boards', version: 1 } as const);
export interface DesignerLayerBoardProjection {
  readonly phase: 'loading' | 'error' | 'ready';
  readonly layer: LayerId;
  readonly consumer: string | null;
  readonly libraryHash: RuntimeDigest | null;
  readonly selectionHash: RuntimeDigest | null;
  readonly session: { readonly id: string; readonly revision: number; readonly status: string; readonly edits: RuntimeJson; readonly history: RuntimeJson };
  readonly activeLeaf: string;
  readonly placements: readonly Placement[];
  readonly slots: readonly { readonly id: string; readonly layer: LayerId }[];
  /** Original provider inventory, reconciled against placements rather than used as authority. */
  readonly boards: readonly { readonly id: string; readonly label: string; readonly leaves: readonly string[] }[];
}
export interface DesignerLayerSectionFill {
  readonly section: `sections.${string}`;
  readonly config?: string;
  readonly content: Readonly<Record<string, RuntimeContentRef>>;
}
export interface DesignerSelectedStateLayout {
  readonly leaf: `layouts.${string}`;
  readonly config: string;
  readonly members?: Readonly<Record<string, string>>;
  readonly slot: string;
}
export interface DesignerRegisteredStateSection {
  readonly sessionId: string;
  readonly fill: DesignerLayerSectionFill;
  readonly content: readonly RuntimeContent[];
  /** Exact canonical selection only; qualification remains the Registry adapter's job. */
  readonly layout?: DesignerSelectedStateLayout;
}
export interface DesignerLayerBoardsInput {
  readonly query: { readonly id: string; readonly version: number };
  readonly projection: DesignerLayerBoardProjection;
  readonly projectionHash: RuntimeDigest;
  readonly records: readonly { readonly sessionId: string; readonly consumer: string; readonly libraryHash: RuntimeDigest; readonly selectionHash: RuntimeDigest; readonly records: LibraryBoardRecords }[];
  /** Already resolved from the selected consumer's existing spacing tokens; no query defaults. */
  readonly arrangement: Extract<CanvasArrangement, { readonly kind: 'grid' | 'lanes' }>;
  readonly stateSections: Readonly<Partial<Record<'loading' | 'error' | 'empty', DesignerRegisteredStateSection>>>;
}
export type DesignerLayerBoardsResult = { readonly status: 'pending'; readonly reason: string } | {
  readonly status: 'materialized';
  readonly query: typeof DESIGNER_LAYER_BOARDS_QUERY;
  readonly sessionId: string;
  readonly projectionHash: RuntimeDigest;
  readonly inputHash: RuntimeDigest;
  readonly materializationHash: RuntimeDigest;
  readonly body: CompositionBody<{ readonly slot: string; readonly index: number }>;
  readonly fills: Readonly<Record<string, readonly DesignerLayerSectionFill[]>>;
  readonly content: readonly RuntimeContent[];
  readonly layout?: DesignerSelectedStateLayout;
};
function closed(value: object, keys: readonly string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new TypeError('Unknown Designer query field');
}
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const leavesOf = (node: PlacementNode): readonly string[] => 'leaves' in node ? node.leaves : node.children.flatMap(leavesOf);

/** Fixed, finite structural query. It neither evaluates candidates nor owns a retained result.
 * Source qualification and the single canonical binding update remain the Registry's responsibility.
 */
export function deriveDesignerLayerBoardsV1(value: DesignerLayerBoardsInput): DesignerLayerBoardsResult {
  const input = runtimeSnapshot(value);
  closed(input, ['query','projection','projectionHash','records','arrangement','stateSections']);
  closed(input.query, ['id','version']);
  if (input.query.id !== DESIGNER_LAYER_BOARDS_QUERY.id || input.query.version !== DESIGNER_LAYER_BOARDS_QUERY.version) throw new TypeError('Unsupported Designer body query version');
  const p = input.projection;
  closed(p, ['phase','layer','consumer','libraryHash','selectionHash','session','activeLeaf','placements','slots','boards']);
  closed(p.session, ['id','revision','status','edits','history']);
  if (!['themes','assets','components','sections','frames'].includes(p.layer) || !['loading','error','ready'].includes(p.phase) || !text(p.session.id) || !Number.isSafeInteger(p.session.revision) || p.session.revision < 0) throw new TypeError('Original Designer provider projection required');
  if (!isRuntimeDigest(input.projectionHash) || input.projectionHash !== runtimeHash(p)) throw new TypeError('Stale Designer provider projection hash');
  const materialize = (data: { body: CompositionBody<{ slot: string; index: number }>; fills: Readonly<Record<string, readonly DesignerLayerSectionFill[]>>; content: readonly RuntimeContent[]; layout?: DesignerSelectedStateLayout }): DesignerLayerBoardsResult => runtimeSnapshot({ status: 'materialized' as const, query: DESIGNER_LAYER_BOARDS_QUERY, sessionId: p.session.id, projectionHash: input.projectionHash, inputHash: runtimeHash(input), materializationHash: runtimeHash(data), ...data });
  const state = (phase: 'loading' | 'error' | 'empty'): DesignerLayerBoardsResult => {
    const selected = input.stateSections[phase];
    if (!selected) return { status: 'pending', reason: `Registered Designer ${phase} Section unavailable` };
    closed(selected, ['sessionId','fill','content','layout']);
    if (selected.sessionId !== p.session.id) throw new TypeError('Designer state Section belongs to a different original session');
    const leaf = phase === 'loading' ? 'sections.notices' : phase === 'error' ? 'sections.error-state' : 'sections.empty-state';
    if (selected.fill.section !== leaf) throw new TypeError('Designer state must use its registered Section');
    const layout = selected.layout;
    if (!layout || !text(layout.config) || !text(layout.slot) || !['layouts.stack','layouts.split','layouts.sidebar-content','layouts.bento'].includes(layout.leaf)) return { status: 'pending', reason: 'Actual selected Designer state flow Layout unavailable' };
    closed(layout, ['leaf','config','members','slot']);
    closed(selected.fill, ['section','config','content']);
    const references = Object.values(selected.fill.content);
    if (!references.length || !references.every(reference => selected.content.some(content => content.reference.ref === reference.ref && content.reference.kind === reference.kind && content.hash === runtimeHash(content.value)))) return { status: 'pending', reason: 'Registered Designer state content unavailable or stale' };
    const names = selected.content.map(content => JSON.stringify(content.reference));
    if (new Set(names).size !== names.length || selected.content.length !== references.length) throw new TypeError('Designer state content must cover exact registered refs');
    return materialize({ body: { kind: 'flow', source: { kind: 'derived', query: DESIGNER_LAYER_BOARDS_QUERY }, sections: [{ slot: layout.slot, index: 0 }] }, fills: { [layout.slot]: [selected.fill] }, content: selected.content, layout });
  };
  if (p.phase !== 'ready') return state(p.phase);
  if (!text(p.consumer) || !isRuntimeDigest(p.libraryHash) || !isRuntimeDigest(p.selectionHash)) return { status: 'pending', reason: 'Current Designer consumer/library/selection identity unavailable' };
  const placements = p.placements.filter(placement => placement.layer === p.layer);
  if (placements.length !== p.placements.length || placements.length > 1) throw new TypeError('Designer projection must name the actual active placement layer');
  const inventory = placements.flatMap(placement => placement.nodes.flatMap(domain => ('children' in domain ? domain.children : [domain]).map(group => ({ id: `${p.layer}/${group.id}`, label: group.label, domain: domain.id, leaves: leavesOf(group) }))));
  const ids = inventory.map(board => board.id), leaves = inventory.flatMap(board => board.leaves);
  if (new Set(ids).size !== ids.length || new Set(leaves).size !== leaves.length) throw new TypeError('Duplicate Designer placement board or leaf');
  const slots = p.slots.filter(slot => slot.layer === p.layer).map(slot => slot.id);
  if (slots.length !== p.slots.length || slots.length !== leaves.length || new Set(slots).size !== slots.length || leaves.some(leaf => !slots.includes(leaf))) throw new TypeError('Designer placement inventory differs from actual slot contracts');
  if (runtimeHash(p.boards) !== runtimeHash(inventory.map(({ domain: _domain, ...board }) => board))) throw new TypeError('Designer provider boards differ from actual placements');
  if (!inventory.length) return state('empty');
  if (input.records.length !== inventory.length) return { status: 'pending', reason: 'Checked original Designer board records unavailable' };
  const byId = new Map<string, LibraryBoardRecords>();
  for (const prepared of input.records) {
    closed(prepared, ['sessionId','consumer','libraryHash','selectionHash','records']);
    if (prepared.sessionId !== p.session.id || prepared.consumer !== p.consumer || prepared.libraryHash !== p.libraryHash || prepared.selectionHash !== p.selectionHash) throw new TypeError('Stale or foreign Designer board record identity');
    const record = prepared.records;
    assertLibraryBoardRecords(record);
    const board = inventory.find(board => board.id === record.rows.boardId);
    if (!board || byId.has(board.id) || record.rows.layer !== p.layer || record.rows.label !== board.label || runtimeHash(record.rows.items.map(row => row.id)) !== runtimeHash(board.leaves)) throw new TypeError('Designer checked rows differ from actual placement board');
    for (const row of record.rows.items) {
      if (row.prompt.consumer !== p.consumer || row.prompt.board.id !== board.id || row.refreshPrompt && (row.refreshPrompt.consumer !== p.consumer || row.refreshPrompt.board.id !== board.id)) throw new TypeError('Designer prompt differs from original consumer/board');
      for (const identity of [row.selectedPreview, ...row.candidates.map(candidate => candidate.previewIdentity)]) if (identity && identity.selectionHash !== p.selectionHash) throw new TypeError('Designer checked preview belongs to a stale selection');
    }
    byId.set(board.id, record);
  }
  if (input.arrangement.kind !== 'grid' && input.arrangement.kind !== 'lanes' || input.arrangement.kind === 'lanes' && input.arrangement.groupKey !== 'domain') throw new TypeError('Designer query requires grid or actual domain lanes');
  const boards = inventory.map((board, index) => ({ id: board.id, section: { slot: 'sections.comparison', index }, groups: { domain: board.domain } }));
  assertCanvasArrangement(boards, input.arrangement);
  const content: RuntimeContent[] = [];
  const fills = inventory.map(board => {
    const records = byId.get(board.id)!;
    const refs = Object.fromEntries((['columns','rows','controls'] as const).map(part => {
      const reference = { kind: 'records' as const, ref: `designer.layer-boards/${encodeURIComponent(board.id)}/${part}` };
      const value = runtimeSnapshot(records[part]) as unknown as RuntimeJson;
      content.push({ reference, value, hash: runtimeHash(value) });
      return [part, reference];
    }));
    return { section: 'sections.comparison' as const, config: 'library-board', content: refs };
  });
  return materialize({ body: { kind: 'canvas', source: { kind: 'derived', query: DESIGNER_LAYER_BOARDS_QUERY }, boards, arrangement: input.arrangement, collapseBelow: 'md' }, fills: { 'sections.comparison': fills }, content });
}

export { createWholeStudioInitialSession, checkWholeStudioInitialSession, wholeStudioCatalogHash } from './initial-session.js';
export type { WholeStudioInitialSession, WholeStudioInitialSnapshot } from './initial-session.js';
