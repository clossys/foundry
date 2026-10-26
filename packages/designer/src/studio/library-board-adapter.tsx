import type { ReactNode } from 'react';
import { libraryColumns, libraryItemProvenance, componentLibraryColumns } from '../catalog-core/library-roster.js';
import type { LayerId, Source } from '../catalog-core/types.js';
import type { ComponentCandidateDocument } from '../catalog-core/resolve-components.js';
import type { LibraryBoardRecords, LibraryPreviewIdentity } from '../blocks/library-board/model.js';
import type { LibraryBoardPreviewPort } from '../blocks/library-board/LibraryBoardSection.js';
import type { CandidatePromptData } from './candidate-prompt.js';
import type { MatrixBoard, MatrixRow } from './matrix-model.js';
import type { Candidate } from './model.js';
import { CandidateCell } from './CandidateCell.js';
import type { StudioLabels } from './types.js';
import { activeCandidateSource } from './candidate-display.js';
export interface PreparedLibraryBoardInput {
  readonly layer: LayerId; readonly board: MatrixBoard; readonly sources: readonly Source[]; readonly consumerSource: string;
  readonly selectionHash: string; readonly sourceHashes: Readonly<Record<string, string>>;
  readonly mode: 'view' | 'edit'; readonly canSave: boolean; readonly pending: boolean;
  readonly prompt: (row: MatrixRow, refresh: boolean) => CandidatePromptData;
  readonly componentDocuments?: readonly ComponentCandidateDocument[];
}
/** Projects the actual checked value-engine rows; selection and persistence stay in the provider. */
export function valueLibraryBoardRecords(input: PreparedLibraryBoardInput): LibraryBoardRecords {
  const rows = input.board.rows.filter(row => row.scope === 'slot');
  const identity = (leaf: string, candidate: Candidate): LibraryPreviewIdentity | undefined => candidate.previewable && input.sourceHashes[candidate.source] ? { leaf, source: candidate.source, selectionHash: input.selectionHash, sourceHash: input.sourceHashes[candidate.source]! } : undefined;
  const columns = input.layer === 'components' && input.componentDocuments
    ? componentLibraryColumns(input.sources, input.componentDocuments, rows.map(row => row.id), input.consumerSource).map(({ candidates: _candidates, ...column }) => column)
    : libraryColumns(input.layer, rows.map(row => row.id), rows.flatMap(row => row.candidates.filter(candidate => candidate.members.length > 0 || candidate.fill.sourceAddress).map(candidate => candidate.source)), input.consumerSource);
  return { columns: { version: 1, items: columns }, rows: { version: 1, layer: input.layer, boardId: input.board.id, label: input.board.label, items: rows.map(row => {
    const selected = row.candidates.find(candidate => candidate.selected);
    return { id: row.id, label: row.label, scope: 'slot', selectedSource: activeCandidateSource(row.candidates), ...(selected ? { selectedPreview: identity(row.id, selected) } : {}),
      candidates: row.candidates.filter(candidate => columns.some(column => column.source === candidate.source)).map(candidate => ({ source: candidate.source, usable: candidate.usable, previewIdentity: identity(row.id, candidate), findings: candidate.findings.map(({ code, severity, message }) => ({ code, severity, message })), provenance: libraryItemProvenance(input.sources, candidate.fill) })), prompt: input.prompt(row, false), ...(selected?.source === input.consumerSource ? { refreshPrompt: input.prompt(row, true) } : {}) };
  }) }, controls: { version: 1, mode: input.mode, canSave: input.canSave, pending: input.pending } };
}
/** Original checked CandidateCell renderer, bound to one exact prepared working selection and closure. */
export function valueLibraryBoardPreviews(input: PreparedLibraryBoardInput, labels: StudioLabels): LibraryBoardPreviewPort {
  const candidates = new Map(input.board.rows.flatMap(row => row.candidates.map(candidate => [JSON.stringify([row.id,candidate.source]), candidate] as const)));
  return { selectionHash: input.selectionHash, sourceHashes: input.sourceHashes, render(identity): ReactNode {
    if (identity.selectionHash !== input.selectionHash || identity.sourceHash !== input.sourceHashes[identity.source]) return undefined;
    const candidate = candidates.get(JSON.stringify([identity.leaf,identity.source]));
    if (!candidate?.previewable || input.mode === 'view' && !candidate.selected || candidate.findings.some(finding => finding.code === 'C7' && finding.severity === 'error')) return undefined;
    return <CandidateCell candidate={candidate} labels={labels} />;
  } };
}

import type { BuildCatalogData, CompositeChangeSet, CompositeEngineInput, CompositeLibraryOperation, CompositeResolved } from '../catalog-core/types.js';
import type { CompositeStudioSnapshot } from './types.js';
import type { LibraryBoardCommand } from '../blocks/library-board/model.js';
import { evaluateWhole, previewComponent } from './whole-model.js';
export interface PreparedCompositeLibraryBoardInput {
  readonly layer: 'components' | 'sections' | 'frames';
  readonly board: { readonly id: string; readonly label: string; readonly leaves: readonly { readonly id: string }[] };
  readonly input: CompositeEngineInput;
  readonly changes: CompositeChangeSet;
  readonly contracts: BuildCatalogData;
  readonly snapshot: CompositeStudioSnapshot;
  readonly sources: readonly Source[];
  readonly sourceHashes: Readonly<Record<string, string>>;
  readonly mode: 'view' | 'edit'; readonly canSave: boolean; readonly pending: boolean;
  readonly prompt: (leaf: string, refresh: boolean) => CandidatePromptData;
  readonly labels: StudioLabels;
}
/** Prepares actual component proposals once against the current whole-library working selection.
 * Surface rows expose selected checked previews and prompts; they gain no component adoption command.
 */
export function compositeLibraryBoard(input: PreparedCompositeLibraryBoardInput, preparation?: { readonly currentSelectionOnly: true }): {
  readonly records: LibraryBoardRecords;
  readonly previews: LibraryBoardPreviewPort;
  readonly changeFor: (command: LibraryBoardCommand) => readonly CompositeLibraryOperation[] | undefined;
} {
  const evaluated = evaluateWhole(input.input, input.snapshot, input.contracts), profile = evaluated.profile;
  const consumer = input.input.library.source.id, leaves = input.board.leaves.map(leaf => leaf.id);
  const documents = input.input.catalog.components.fills.filter(doc => leaves.includes(doc.$extensions['com.clossys.fill'].slot));
  const proposals = documents.map(doc => ({ doc, meta: doc.$extensions['com.clossys.fill'], result: !preparation?.currentSelectionOnly ? previewComponent(input.input, doc.$extensions['com.clossys.fill'].slot, doc.$extensions['com.clossys.fill'].source, input.changes) : undefined }));
  const surfaceDocuments = [...(input.input.catalog.surfaces?.fills ?? []), ...(input.input.library.surfaces?.fills ?? [])].filter(doc => leaves.includes(doc.$extensions['com.clossys.fill'].slot));
  const columns = input.layer === 'components'
    ? componentLibraryColumns(input.sources, documents, leaves, consumer).map(({ candidates: _candidates, ...column }) => column)
    : libraryColumns(input.layer, leaves, surfaceDocuments.map(doc => doc.$extensions['com.clossys.fill'].source), consumer);
  const identity = (leaf: string, source: string): LibraryPreviewIdentity | undefined => input.sourceHashes[source] ? { leaf, source, selectionHash: profile.selectionHash, sourceHash: input.sourceHashes[source]! } : undefined;
  const selectedSource = (leaf: string): string | null => input.layer === 'components' ? profile.components.components[leaf]?.descriptor.source ?? null : Object.values(profile.surfaces?.fills ?? {}).find(fill => fill.document.$extensions['com.clossys.fill'].slot === leaf)?.document.$extensions['com.clossys.fill'].source ?? null;
  const allowed = (proposal: typeof proposals[number]) => proposal.meta.status !== 'draft' && proposal.result?.available && !proposal.result.findings.some(finding => finding.severity === 'error');
  const selectedAvailable = (leaf: string) => input.layer === 'components'
    ? !!profile.components.components[leaf] && !input.input.library.components.fills.some(doc => doc.$extensions['com.clossys.fill'].slot === leaf && doc.$extensions['com.clossys.fill'].status === 'draft') && !profile.check.findings.some(finding => (finding.subject === leaf || finding.subject.startsWith(leaf + '.')) && finding.severity === 'error')
    : evaluated.runtime?.status === 'valid' && !!Object.values(profile.surfaces?.fills ?? {}).find(fill => fill.document.$extensions['com.clossys.fill'].slot === leaf && fill.document.$extensions['com.clossys.fill'].status !== 'draft') && !profile.check.findings.some(finding => (finding.subject === leaf || finding.subject.startsWith(leaf + '.')) && finding.severity === 'error');
  const records: LibraryBoardRecords = {
    columns: { version: 1, items: columns }, controls: { version: 1, mode: input.mode, canSave: input.canSave, pending: input.pending },
    rows: { version: 1, layer: input.layer, boardId: input.board.id, label: input.board.label, items: leaves.map(leaf => {
      const selected = selectedSource(leaf);
      return { id: leaf, label: leaf, scope: 'slot', selectedSource: selected,
        ...(selected && selectedAvailable(leaf) ? { selectedPreview: identity(leaf, selected) } : {}),
        candidates: input.layer === 'components' ? proposals.filter(proposal => proposal.meta.slot === leaf && columns.some(column => column.source === proposal.meta.source)).map(proposal => ({ source: proposal.meta.source, usable: !!allowed(proposal) || preparation?.currentSelectionOnly === true && input.mode === 'view' && proposal.meta.source === selected && selectedAvailable(leaf), ...((allowed(proposal) || preparation?.currentSelectionOnly === true && input.mode === 'view' && proposal.meta.source === selected && selectedAvailable(leaf)) ? { previewIdentity: identity(leaf, proposal.meta.source) } : {}), findings: (proposal.result?.findings ?? (proposal.meta.source === selected ? profile.check.findings.filter(finding => finding.subject === leaf || finding.subject.startsWith(leaf + '.')) : [{ code: 'CANDIDATE_EVALUATION_NOT_REQUESTED', severity: 'notice' as const, message: 'Alternative candidate evaluation has not been requested' }])).map(({ code, severity, message }) => ({ code, severity, message })), provenance: libraryItemProvenance(input.sources, proposal.meta) })) : [],
        prompt: input.prompt(leaf, false), ...(selected === consumer ? { refreshPrompt: input.prompt(leaf, true) } : {}) };
    }) },
  };
  const previews: LibraryBoardPreviewPort = { selectionHash: profile.selectionHash, sourceHashes: input.sourceHashes, render(value) {
    if (value.selectionHash !== profile.selectionHash || value.sourceHash !== input.sourceHashes[value.source] || !leaves.includes(value.leaf)) return undefined;
    let prepared: CompositeResolved | undefined;
    if (input.mode === 'view') { if (selectedSource(value.leaf) === value.source && selectedAvailable(value.leaf)) prepared = profile; }
    else if (input.layer === 'components') { const proposal = proposals.find(proposal => proposal.meta.slot === value.leaf && proposal.meta.source === value.source); if (proposal && allowed(proposal) && proposal.result?.available) prepared = proposal.result.profile; }
    else if (selectedSource(value.leaf) === value.source && selectedAvailable(value.leaf)) prepared = profile;
    if (!prepared) return undefined;
    return <CandidateCell labels={input.labels} preview={input.snapshot.preview?.(value.leaf, prepared)} />;
  } };
  return { records, previews, changeFor(command) {
    if (input.layer !== 'components' || command.command !== 'use-source' || command.boardId !== input.board.id || !input.canSave || input.pending) return undefined;
    const proposal = proposals.find(proposal => proposal.meta.slot === command.leafId && proposal.meta.source === command.source);
    return proposal && allowed(proposal) && proposal.result?.available ? [proposal.result.change] : undefined;
  } };
}
