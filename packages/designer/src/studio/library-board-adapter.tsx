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
import { Button } from '../components/Button.js';
import { LeafCell } from '../blocks/library-board/LeafCell.js';
import { CandidatePromptDialog } from '../blocks/library-board/CandidatePromptDialog.js';
import type { CandidateWorkflow } from '../blocks/library-board/types.js';
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
  // The board record carries display columns only: the roster's `reason` and component candidates stay out.
  const columns = (input.layer === 'components' && input.componentDocuments
    ? componentLibraryColumns(input.sources, input.componentDocuments, rows.map(row => row.id), input.consumerSource).map(({ candidates: _candidates, ...column }) => column)
    : libraryColumns(input.layer, rows.map(row => row.id), rows.flatMap(row => row.candidates.filter(candidate => candidate.members.length > 0 || candidate.fill.sourceAddress).map(candidate => candidate.source)), input.consumerSource)
  ).map(({ reason: _reason, ...column }) => column);
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

import type { BuildCatalogData, CompositeChangeSet, CompositeEngineInput, CompositeResolved } from '../catalog-core/types.js';
import type { CompositeStudioSnapshot } from './types.js';
import { evaluateWhole, previewComponent } from './whole-model.js';
import { isRuntimePending } from './runtime-pending.js';
import { packageSurfacePreview } from './planned-surface-previews.js';
import type { SurfaceSampleState } from './surface-preview-sample-content.js';
/**
 * An adopted package-pointer Section or Frame owns no source for a host preview to build: it previews its real
 * export through the planned-preview samples, keyed by the same export pointer (so host-owned samples such as a
 * Publisher frame apply), and stays unavailable when no sample exists rather than imitating one.
 */
/** A leaf's planned default rendered once, with the sample state it draws; undefined when it has none or it cannot render. */
export function plannedSurfacePreview(planned: CompositeStudioSnapshot['plannedPreviews'], leaf: string): { source: string; fill: string; state: SurfaceSampleState; node: ReactNode } | undefined {
  const row = planned?.previews[leaf];
  if (!row) return undefined;
  let node: ReactNode;
  try { node = row.render(); } catch { return undefined; }
  return node == null ? undefined : { source: row.source, fill: row.fill, state: row.state ?? 'default', node };
}
const DESIGNER_EXPORTS = '@clossys/designer/';
export function adoptedPackagePreview(leaf: string, profile: CompositeResolved | undefined, planned: CompositeStudioSnapshot['plannedPreviews']): { node: ReactNode; state: SurfaceSampleState } | undefined {
  // A non-surface leaf id simply finds no adopted surface fill.
  const document = profile?.surfaces?.fills[leaf as `sections.${string}`]?.document;
  if (!document) return undefined;
  // Several leaves may point at one export (sections.data-grid and sections.data-table share DataTable), so a
  // leaf's own planned row is found by leaf id; a row drawn for another leaf is never borrowed by its export.
  const own = planned?.previews[leaf];
  if (own) {
    // A planned row's render already draws its own sample state; name that state, not the host-sample default.
    try { const node = own.render(); return node == null ? undefined : { node, state: own.state ?? 'default' }; } catch { return undefined; }
  }
  // Without its own row, only host-owned samples (another package's export, such as a Publisher frame) apply by pointer.
  const hosted = Object.values(planned?.previews ?? {}).filter(row => !row.pointer.startsWith(DESIGNER_EXPORTS));
  const samples = Object.fromEntries(hosted.map(row => [row.pointer, row.render]));
  const preview = packageSurfacePreview(document as unknown as Parameters<typeof packageSurfacePreview>[0], samples, planned?.sampleState);
  if (!('render' in preview)) return undefined;
  try { const node = preview.render(); return node == null ? undefined : { node, state: preview.state }; } catch { return undefined; }
}
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
  readonly workflow?: CandidateWorkflow;
}
/** Prepares actual component proposals once against the current whole-library working selection.
 * Surface rows expose selected checked previews and prompts; they gain no component adoption command.
 */
export function compositeLibraryBoard(input: PreparedCompositeLibraryBoardInput, preparation?: { readonly currentSelectionOnly: true }): {
  readonly records: LibraryBoardRecords;
  readonly previews: LibraryBoardPreviewPort;
} {
  const evaluated = evaluateWhole(input.input, input.snapshot, input.contracts), profile = evaluated.profile;
  const consumer = input.input.library.source.id, leaves = input.board.leaves.map(leaf => leaf.id);
  const documents = input.input.catalog.components.fills.filter(doc => leaves.includes(doc.$extensions['com.clossys.fill'].slot));
  const proposals = documents.map(doc => ({ doc, meta: doc.$extensions['com.clossys.fill'], result: !preparation?.currentSelectionOnly ? previewComponent(input.input, doc.$extensions['com.clossys.fill'].slot, doc.$extensions['com.clossys.fill'].source, input.changes) : undefined }));
  const surfaceDocuments = [...(input.input.catalog.surfaces?.fills ?? []), ...(input.input.library.surfaces?.fills ?? [])].filter(doc => leaves.includes(doc.$extensions['com.clossys.fill'].slot));
  const columns = (input.layer === 'components'
    ? componentLibraryColumns(input.sources, documents, leaves, consumer).map(({ candidates: _candidates, ...column }) => column)
    : libraryColumns(input.layer, leaves, surfaceDocuments.map(doc => doc.$extensions['com.clossys.fill'].source), consumer)
  ).map(({ reason: _reason, ...column }) => column);
  const identity = (leaf: string, source: string): LibraryPreviewIdentity | undefined => input.sourceHashes[source] ? { leaf, source, selectionHash: profile.selectionHash, sourceHash: input.sourceHashes[source]! } : undefined;
  // A Section or Frame may be selected by the host's runtime manifest alone, as the canvas has always read it.
  const runtimeFill = (leaf: string) => input.layer === 'components' ? undefined : input.snapshot.runtime?.manifest.fills.find(fill => fill.leaf === leaf);
  const surfaceFill = (leaf: string) => Object.values(profile.surfaces?.fills ?? {}).find(fill => fill.document.$extensions['com.clossys.fill'].slot === leaf);
  const selectedSource = (leaf: string): string | null => input.layer === 'components' ? profile.components.components[leaf]?.descriptor.source ?? null : surfaceFill(leaf)?.document.$extensions['com.clossys.fill'].source ?? runtimeFill(leaf)?.library ?? null;
  // Studio selection stays stricter than engine adoption: a runtime-pending candidate is not selectable here.
  const blocking = (finding: { code: string; severity: string; message: string }) => finding.severity === 'error' || isRuntimePending(finding);
  const allowed = (proposal: typeof proposals[number]) => proposal.meta.status !== 'draft' && proposal.result?.available && !proposal.result.findings.some(blocking);
  // A proposal that only awaits runtime qualification still renders its checked static specimen in edit mode.
  // Display only: `allowed` (selection and adoption) is unchanged, so the tile stays unselectable.
  const staticSpecimen = (proposal: typeof proposals[number]) => proposal.meta.status !== 'draft' && !!proposal.result?.available
    && proposal.result.findings.some(isRuntimePending) && !proposal.result.findings.some(finding => finding.severity === 'error');
  // Choosing stays strict: a blocking finding withholds the current component selection from being usable.
  const selectedAvailable = (leaf: string) => !!profile.components.components[leaf] && !profile.check.findings.some(finding => (finding.subject === leaf || finding.subject.startsWith(leaf + '.')) && blocking(finding));
  // The current selection previews as the canvas always has, an adopted copy (a consumer draft) and a leaf with
  // blocking findings included: previewing qualifies nothing, and findings stay on the check badges and in the
  // inspector. A Section or Frame previews only once the host evaluates surfaces: with valid runtime ports, or,
  // without them, explicit surface options (an adopted package-pointer leaf previews its own export).
  const surfacesEvaluated = evaluated.runtime ? evaluated.runtime.status === 'valid' : input.snapshot.surfaceOptions !== undefined;
  const selectedPreviewable = (leaf: string, source: string) => selectedSource(leaf) === source && (input.layer === 'components' || surfacesEvaluated);
  // A Section or Frame leaf nobody chose shows its planned default in the view table, labelled as planned. It is
  // previewed, never adopted: it adds nothing to the profile, the runtime manifest or the chosen count, the host
  // preview is not asked, and an unrenderable sample or a host that does not digest its source leaves the plain
  // not-chosen cell.
  const planned = new Map(input.layer === 'components' || input.mode !== 'view' ? [] : leaves.flatMap(leaf => {
    const row = selectedSource(leaf) ? undefined : plannedSurfacePreview(input.snapshot.plannedPreviews, leaf);
    return row && identity(leaf, row.source) ? [[leaf, row] as const] : [];
  }));
  // A candidate the engine cannot materialize (a blocked source, say) reports why as an error, so its check badge
  // and reason show; it was never usable.
  const unavailableFindings = (result: typeof proposals[number]['result']) => result && !result.available ? [{ code: 'CANDIDATE_UNAVAILABLE', severity: 'error' as const, message: result.error }] : undefined;
  const records: LibraryBoardRecords = {
    columns: { version: 1, items: columns }, controls: { version: 1, mode: input.mode, canSave: input.canSave, pending: input.pending },
    rows: { version: 1, layer: input.layer, boardId: input.board.id, label: input.board.label, items: leaves.map(leaf => {
      const selected = selectedSource(leaf), plannedRow = planned.get(leaf);
      // The Section draws a planned row through its preview cell; the planned source is shown, not selected.
      if (plannedRow) return { id: leaf, label: leaf, scope: 'slot', selectedSource: plannedRow.source, selectedPreview: identity(leaf, plannedRow.source)!, candidates: [], prompt: input.prompt(leaf, false) };
      return { id: leaf, label: leaf, scope: 'slot', selectedSource: selected,
        ...(selected && selectedPreviewable(leaf, selected) ? { selectedPreview: identity(leaf, selected) } : {}),
        candidates: input.layer === 'components' ? proposals.filter(proposal => proposal.meta.slot === leaf && columns.some(column => column.source === proposal.meta.source)).map(proposal => ({ source: proposal.meta.source, usable: !!allowed(proposal) || preparation?.currentSelectionOnly === true && input.mode === 'view' && proposal.meta.source === selected && selectedAvailable(leaf), ...((allowed(proposal) || input.mode === 'edit' && staticSpecimen(proposal) || preparation?.currentSelectionOnly === true && input.mode === 'view' && proposal.meta.source === selected && selectedAvailable(leaf)) ? { previewIdentity: identity(leaf, proposal.meta.source) } : {}), findings: (unavailableFindings(proposal.result) ?? proposal.result?.findings ?? (proposal.meta.source === selected ? profile.check.findings.filter(finding => finding.subject === leaf || finding.subject.startsWith(leaf + '.')) : [{ code: 'CANDIDATE_EVALUATION_NOT_REQUESTED', severity: 'notice' as const, message: 'Alternative candidate evaluation has not been requested' }])).map(({ code, severity, message }) => ({ code, severity, message })), provenance: libraryItemProvenance(input.sources, proposal.meta) })) : [],
        prompt: input.prompt(leaf, false), ...(selected === consumer ? { refreshPrompt: input.prompt(leaf, true) } : {}) };
    }) },
  };
  const previews: LibraryBoardPreviewPort = { selectionHash: profile.selectionHash, sourceHashes: input.sourceHashes, render(value) {
    if (value.selectionHash !== profile.selectionHash || value.sourceHash !== input.sourceHashes[value.source] || !leaves.includes(value.leaf)) return undefined;
    const plannedRow = planned.get(value.leaf);
    if (plannedRow) return plannedRow.source === value.source ? <LeafCell data-studio-planned={plannedRow.fill} data-sample-state={plannedRow.state} previewState="planned" preview={plannedRow.node}
      status={input.labels.plannedPreview ?? 'Planned default, not adopted'} actions={<CandidatePromptDialog trigger={<Button variant="ghost" size="sm">{input.labels.board.askAgent}</Button>} data={input.prompt(value.leaf, false)} labels={input.labels} workflow={input.workflow} />} /> : undefined;
    let prepared: CompositeResolved | undefined;
    if (input.mode === 'view') { if (selectedPreviewable(value.leaf, value.source)) prepared = profile; }
    else if (input.layer === 'components') { const proposal = proposals.find(proposal => proposal.meta.slot === value.leaf && proposal.meta.source === value.source); if (proposal && (allowed(proposal) || staticSpecimen(proposal)) && proposal.result?.available) prepared = proposal.result.profile; }
    else if (selectedPreviewable(value.leaf, value.source)) prepared = profile;
    if (!prepared) return undefined;
    // The host's own preview comes first; an adopted package-pointer Section or Frame then previews its real export.
    // A host preview that throws shows the unavailable cell; its findings remain in the inspector, and no sample is fabricated.
    let node: ReactNode, sampleState: SurfaceSampleState | undefined;
    try { node = input.snapshot.preview?.(value.leaf, prepared); } catch { node = undefined; }
    if (node == null && input.layer !== 'components') { const adopted = adoptedPackagePreview(value.leaf, prepared, input.snapshot.plannedPreviews); node = adopted?.node; sampleState = adopted?.state; }
    return <CandidateCell labels={input.labels} preview={node} sampleState={sampleState} />;
  } };
  // Read-only: records and previews only. No command maps to a library change.
  return { records, previews };
}
