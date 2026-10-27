import type { BuildCatalogData, CompositeResolved } from '../catalog-core/types.js';
import type { LibraryBoardPreviewPort } from '../blocks/library-board/LibraryBoardSection.js';
import type { LibraryBoardRecords } from '../blocks/library-board/model.js';
import type { CandidatePromptData } from './candidate-prompt.js';
import { activeCandidateSource } from './candidate-display.js';
import { valueLibraryBoardRecords, valueLibraryBoardPreviews, compositeLibraryBoard, type PreparedLibraryBoardInput, type PreparedCompositeLibraryBoardInput } from './library-board-adapter.js';
import type { MatrixBoard, MatrixRow } from './matrix-model.js';
import type { StudioCandidateWorkflow, StudioLabels } from './types.js';

interface PromptContext {
  readonly workflow?: StudioCandidateWorkflow;
  readonly returnStep: string;
}
export interface ValueBoardPromptInput extends PromptContext {
  readonly board: MatrixBoard;
  readonly row: MatrixRow;
  readonly consumer: string;
  readonly contextTokens: CandidatePromptData['tokens'];
  readonly variants?: Readonly<Record<string, readonly string[]>>;
}
/** The existing value Board prompt, including its selected-sibling and refresh semantics. */
export function valueBoardPrompt(input: ValueBoardPromptInput, current = false): CandidatePromptData {
  const { board, row, consumer, contextTokens, variants, workflow } = input;
  const active = row.candidates.find(candidate => candidate.selected);
  return { consumer, board: { id: board.id, label: board.label }, slot: { id: row.id, label: row.label },
    variants: variants?.[row.id] ?? [...new Set(row.candidates.flatMap(candidate => candidate.members.map(member => member.id)))],
    ...(workflow?.guidelines?.[row.id] ? { guidelines: workflow.guidelines[row.id] } : {}),
    tokens: contextTokens,
    siblings: board.rows.filter(row => row.scope === 'slot').flatMap(row => { const source = activeCandidateSource(row.candidates); return source ? [{ id: row.id, source }] : []; }),
    ...(current && active ? { currentCandidate: { id: active.fill.id, source: active.source, variants: active.members.map(member => member.id) } } : {}),
    returnStep: workflow?.returnStep ?? input.returnStep };
}

export interface CompositeBoardPromptInput extends PromptContext {
  readonly board: { readonly id: string; readonly label: string; readonly leaves: readonly { readonly id: string }[] };
  readonly leaf: string;
  readonly consumer: string;
  readonly slots: BuildCatalogData['slots'];
  readonly profile?: CompositeResolved;
}
/** The existing contract Board prompt; selected components alone supply sibling/refresh data. */
export function compositeBoardPrompt(input: CompositeBoardPromptInput, refresh = false): CandidatePromptData {
  const { board, leaf, consumer, profile, workflow } = input;
  const contract = input.slots.find(slot => slot.id === leaf)?.contract;
  return { consumer, board: { id: board.id, label: board.label }, slot: { id: leaf, label: leaf },
    variants: contract && 'members' in contract && contract.members.mode === 'closed' ? contract.members.names.map(name => `${leaf}.${name}`) : [],
    ...(workflow?.guidelines?.[leaf] ? { guidelines: workflow.guidelines[leaf] } : {}),
    tokens: Object.entries(profile?.values.members ?? {}).filter(([, member]) => member.slot.startsWith('tokens.')).map(([id, member]) => ({ id, value: member.css.light })),
    siblings: board.leaves.flatMap(leaf => { const selected = profile?.components.components[leaf.id]; return selected ? [{ id: leaf.id, source: selected.descriptor.source }] : []; }),
    ...(refresh && profile?.components.components[leaf] ? { currentCandidate: { id: leaf, source: profile.components.components[leaf]!.descriptor.source, variants: [] } } : {}),
    returnStep: workflow?.returnStep ?? input.returnStep };
}

export type PreparedBoardPreviews =
  | { readonly status: 'available'; readonly port: LibraryBoardPreviewPort }
  | { readonly status: 'pending'; readonly code: 'SOURCE_HASH_ASSOCIATION_UNAVAILABLE'; readonly sources: readonly string[] };
/** An association is supplied by the source owner. This helper neither derives hashes nor certifies provenance. */
interface SourceAssociation { readonly sourceHashes?: Readonly<Record<string, string>> }
function associatedHashes(sources: readonly string[], association: SourceAssociation): { hashes: Readonly<Record<string, string>>; missing: string[] } {
  const missing = [...new Set(sources)].filter(source => !Object.hasOwn(association.sourceHashes ?? {}, source) || typeof association.sourceHashes?.[source] !== 'string' || !association.sourceHashes[source]!.trim());
  // A partially associated board must not advertise previews it cannot supply as a whole.
  return { hashes: missing.length ? {} : association.sourceHashes ?? {}, missing };
}
export interface PreparedValueBoardOptions extends Omit<PreparedLibraryBoardInput, 'prompt' | 'sourceHashes'>, SourceAssociation {
  readonly labels: StudioLabels;
  readonly workflow?: StudioCandidateWorkflow;
  readonly contextTokens: CandidatePromptData['tokens'];
  readonly variants?: Readonly<Record<string, readonly string[]>>;
}
/** Records remain usable without preview associations. All persistence controls stay caller-owned. */
export function prepareValueLibraryBoard(input: PreparedValueBoardOptions): { readonly records: LibraryBoardRecords; readonly previews: PreparedBoardPreviews } {
  const association = associatedHashes(input.board.rows.filter(row => row.scope === 'slot').flatMap(row => row.candidates.filter(candidate => candidate.previewable && (input.mode === 'edit' || candidate.selected)).map(candidate => candidate.source)), input);
  const prepared: PreparedLibraryBoardInput = { ...input, sourceHashes: association.hashes,
    prompt: (row, current) => valueBoardPrompt({ board: input.board, row, consumer: input.consumerSource, contextTokens: input.contextTokens, variants: input.variants, workflow: input.workflow, returnStep: input.labels.board.returnStep }, current) };
  const records = valueLibraryBoardRecords(prepared);
  return { records, previews: association.missing.length
    ? { status: 'pending', code: 'SOURCE_HASH_ASSOCIATION_UNAVAILABLE', sources: association.missing }
    : { status: 'available', port: valueLibraryBoardPreviews(prepared, input.labels) } };
}

export interface PreparedCompositeBoardOptions extends Omit<PreparedCompositeLibraryBoardInput, 'prompt' | 'sourceHashes'>, SourceAssociation {
  readonly workflow?: StudioCandidateWorkflow;
  readonly profile: CompositeResolved;
}
/** Reuses the current composite adapter; it does not mint runtime ports or qualifying evidence. */
export function prepareCompositeLibraryBoard(input: PreparedCompositeBoardOptions): { readonly records: LibraryBoardRecords; readonly previews: PreparedBoardPreviews; readonly changeFor: ReturnType<typeof compositeLibraryBoard>['changeFor'] } {
  const leaves = new Set(input.board.leaves.map(leaf => leaf.id));
  const candidates = input.layer === 'components'
    ? input.input.catalog.components.fills.filter(doc => leaves.has(doc.$extensions['com.clossys.fill'].slot)).map(doc => doc.$extensions['com.clossys.fill'].source)
    : [...(input.input.catalog.surfaces?.fills ?? []), ...(input.input.library.surfaces?.fills ?? [])].filter(doc => leaves.has(doc.$extensions['com.clossys.fill'].slot)).map(doc => doc.$extensions['com.clossys.fill'].source);
  const selectedSources = input.layer === 'components'
    ? [...leaves].flatMap(leaf => input.profile.components.components[leaf] ? [input.profile.components.components[leaf]!.descriptor.source] : [])
    : [...Object.values(input.profile.surfaces?.fills ?? {}).filter(fill => leaves.has(fill.document.$extensions['com.clossys.fill'].slot)).map(fill => fill.document.$extensions['com.clossys.fill'].source),
      ...(input.snapshot.runtime?.manifest.fills ?? []).filter(fill => leaves.has(fill.leaf) && !input.profile.surfaces?.fills[fill.leaf as `sections.${string}`]).map(fill => fill.library)];
  const association = associatedHashes(input.mode === 'edit' ? [...selectedSources, ...candidates] : selectedSources, input);
  const prepared = compositeLibraryBoard({ ...input, sourceHashes: association.hashes, workflow: input.workflow,
    prompt: (leaf, refresh) => compositeBoardPrompt({ board: input.board, leaf, consumer: input.input.library.source.id, slots: input.contracts.slots, profile: input.profile, workflow: input.workflow, returnStep: input.labels.board.returnStep }, refresh) }, input.mode === 'view' ? { currentSelectionOnly: true } : undefined);
  return { records: prepared.records, changeFor: prepared.changeFor, previews: association.missing.length
    ? { status: 'pending', code: 'SOURCE_HASH_ASSOCIATION_UNAVAILABLE', sources: association.missing }
    : { status: 'available', port: prepared.previews } };
}
