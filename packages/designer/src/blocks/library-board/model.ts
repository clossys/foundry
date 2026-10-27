import type { LayerId } from '../../catalog-core/types.js';
import type { LibraryColumn, LibraryItemProvenance } from '../../catalog-core/library-roster.js';
import { assertRuntimeSnapshot } from '../../catalog-core/runtime-ports.js';
import type { CandidatePromptData } from './candidate-prompt.js';
export interface LibraryPreviewIdentity { readonly leaf: string; readonly source: string; readonly selectionHash: string; readonly sourceHash: string }
export interface LibraryBoardCandidate {
  readonly source: string;
  readonly usable: boolean;
  readonly previewIdentity?: LibraryPreviewIdentity;
  readonly findings: readonly { readonly code: string; readonly severity: 'error' | 'notice' | 'warning'; readonly message: string }[];
  readonly provenance: LibraryItemProvenance;
}
export interface LibraryBoardRow {
  readonly id: string; readonly label: string; readonly scope: 'slot';
  readonly selectedSource: string | null;
  readonly selectedPreview?: LibraryPreviewIdentity;
  readonly candidates: readonly LibraryBoardCandidate[];
  readonly prompt: CandidatePromptData;
  readonly refreshPrompt?: CandidatePromptData;
}
export interface LibraryBoardRecords {
  readonly columns: { readonly version: 1; readonly items: readonly LibraryColumn[] };
  readonly rows: { readonly version: 1; readonly layer: LayerId; readonly boardId: string; readonly label: string; readonly items: readonly LibraryBoardRow[] };
  readonly controls: { readonly version: 1; readonly mode: 'view' | 'edit'; readonly canSave: boolean; readonly pending: boolean };
}
export type LibraryBoardCommand = { readonly version: 1; readonly command: 'board-edit' | 'board-done'; readonly boardId: string } | { readonly version: 1; readonly command: 'use-source' | 'reveal'; readonly boardId: string; readonly leafId: string; readonly source: string };
const record = (value: unknown, keys: readonly string[], required: readonly string[] = keys): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Library board record required');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !keys.includes(key)) || required.some(key => !Object.hasOwn(row, key))) throw new TypeError('Unknown or missing library board field');
  return row;
};
const text = (value: unknown) => { if (typeof value !== 'string' || !value.trim()) throw new TypeError('Library board identifier required'); };
export function assertLibraryPreviewIdentity(value: unknown): asserts value is LibraryPreviewIdentity { const row = record(value, ['leaf','source','selectionHash','sourceHash']); for (const field of Object.values(row)) text(field); }
/** Closed serializable content records never carry JSX, render callbacks or executable names. */
export function assertLibraryBoardRecords(value: unknown): asserts value is LibraryBoardRecords {
  assertRuntimeSnapshot(value);
  const top = record(value, ['columns','rows','controls']);
  const columns = record(top.columns, ['version','items']), rows = record(top.rows, ['version','layer','boardId','label','items']), controls = record(top.controls, ['version','mode','canSave','pending']);
  if (columns.version !== 1 || rows.version !== 1 || controls.version !== 1 || !['view','edit'].includes(String(controls.mode)) || typeof controls.canSave !== 'boolean' || typeof controls.pending !== 'boolean' || !['tokens','assets','components','sections','frames'].includes(String(rows.layer))) throw new TypeError('Unsupported library board record version or mode');
  text(rows.boardId); text(rows.label);
  if (!Array.isArray(columns.items) || !Array.isArray(rows.items)) throw new TypeError('Library board items required');
  const sources = new Set<string>();
  for (const column of columns.items) { const row = record(column, ['id','label','role','license','restriction','source','referenceOnly'], ['id','label','role','license','source','referenceOnly']); text(row.id); text(row.label); text(row.source); text(row.license); if (!['consumer','reference','candidate-source'].includes(String(row.role)) || typeof row.referenceOnly !== 'boolean' || row.restriction !== undefined && typeof row.restriction !== 'string') throw new TypeError('Invalid library column'); if (sources.has(String(row.source))) throw new TypeError('Duplicate library board source'); sources.add(String(row.source)); }
  const ids = new Set<string>();
  for (const item of rows.items) {
    const row = record(item, ['id','label','scope','selectedSource','selectedPreview','candidates','prompt','refreshPrompt'], ['id','label','scope','selectedSource','candidates','prompt']); text(row.id); text(row.label);
    if (ids.has(String(row.id)) || row.scope !== 'slot' || row.selectedSource !== null && typeof row.selectedSource !== 'string' || !Array.isArray(row.candidates)) throw new TypeError('Invalid library board row'); ids.add(String(row.id));
    if (row.selectedPreview) { assertLibraryPreviewIdentity(row.selectedPreview); if (row.selectedPreview.leaf !== row.id) throw new TypeError('Selected preview identity mismatch'); }
    assertPrompt(row.prompt); if (row.refreshPrompt) assertPrompt(row.refreshPrompt);
    const candidateSources = new Set<string>();
    for (const value of row.candidates) {
      const candidate = record(value, ['source','usable','previewIdentity','findings','provenance'], ['source','usable','findings','provenance']); text(candidate.source);
      if (candidateSources.has(String(candidate.source))) throw new TypeError('Duplicate row candidate'); candidateSources.add(String(candidate.source));
      const provenance = record(candidate.provenance, ['source','layer','fill','sourceLicense','sourceRecordPin'], ['source','layer','fill']);
      if (provenance.source !== candidate.source || !provenance.fill || typeof provenance.fill !== 'object' || (provenance.fill as {slot?:unknown}).slot !== row.id) throw new TypeError('Candidate provenance mismatch');
      if (typeof candidate.usable !== 'boolean' || !Array.isArray(candidate.findings)) throw new TypeError('Invalid checked candidate');
      if (candidate.previewIdentity) { assertLibraryPreviewIdentity(candidate.previewIdentity); if (candidate.previewIdentity.leaf !== row.id || candidate.previewIdentity.source !== candidate.source) throw new TypeError('Candidate preview identity mismatch'); }
      for (const finding of candidate.findings) { const f = record(finding, ['code','severity','message']); text(f.code); text(f.message); if (f.severity !== 'error' && f.severity !== 'notice' && f.severity !== 'warning') throw new TypeError('Invalid finding'); }
    }
  }
  assertRuntimeSnapshot(top);
}
function assertPrompt(value: unknown): void {
  const prompt = record(value, ['consumer','board','slot','variants','guidelines','tokens','siblings','currentCandidate','returnStep'], ['consumer','board','slot','variants','tokens','siblings','returnStep']);
  text(prompt.consumer); text(prompt.returnStep);
  for (const key of ['board','slot']) { const item = record(prompt[key], ['id','label']); text(item.id); text(item.label); }
  for (const key of ['variants','guidelines']) if (prompt[key] !== undefined) { if (!Array.isArray(prompt[key])) throw new TypeError('Prompt list required'); for (const item of prompt[key]) text(item); }
  for (const key of ['tokens','siblings']) { if (!Array.isArray(prompt[key])) throw new TypeError('Prompt records required'); for (const value of prompt[key]) { const item = record(value, key === 'tokens' ? ['id','value'] : ['id','source']); for (const field of Object.values(item)) if (typeof field !== 'string') throw new TypeError('Prompt text required'); } }
  if (prompt.currentCandidate) { const item = record(prompt.currentCandidate, ['id','source','variants']); text(item.id); text(item.source); if (!Array.isArray(item.variants)) throw new TypeError('Current variants required'); for (const value of item.variants) text(value); }
}
export function assertLibraryBoardCommand(value: unknown): asserts value is LibraryBoardCommand {
  if (!value || typeof value !== 'object') throw new TypeError('Library board command required');
  const name = (value as {command?:unknown}).command;
  const row = record(value, name === 'board-edit' || name === 'board-done' ? ['version','command','boardId'] : ['version','command','boardId','leafId','source']);
  if (row.version !== 1 || !['board-edit','board-done','use-source','reveal'].includes(String(name))) throw new TypeError('Unknown library board command');
  for (const [key, field] of Object.entries(row)) if (key !== 'version') text(field);
}
