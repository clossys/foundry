/** Read-only Director handoff. Interpretation and drafting belong to the Writer session. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkWontClaimDrift, loadCatalog, parseCell, type Cell, type StrategyModel } from '@clossys/strategist';
import { listCells, readActive, parseLinkRef, type StoredCell } from '@clossys/strategist/cell-format';
import { loadWriterCatalog } from '../catalog/ia/index.js';
import { WRITER_LAYERS } from '../catalog-core/ids.js';
import { checkVoiceDerivationCoverage, type VoiceDerivationCoverageResult } from '../voice/derivation-coverage.js';
import { checkLocaleCoverage, type LocaleCoverageReport } from '../locale-coverage.js';
import { assertNoSymlinkPath, isObject } from './migrate.js';
import { parseWriterCell, type WriterCell } from './parse.js';

const INPUTS = ['identity.brand.essence', 'identity.brand.personality', 'identity.visual.style', 'identity.verbal.voice', 'focus.segment.core', 'focus.category.stance', 'advantage.proposition.proof'] as const;
export interface DirectorObligation { id: string; ref: string; line: number; key?: string; text: string }
export interface WriterBrief {
  directorInputs: { id: string; version: number; ref: string; source: string; direction: Cell['direction']; because: Cell['because']; watch: Cell['watch'] }[];
  leaves: { layer: string; role: string; ids: string[] }[];
  missingInputs: string[];
  /** Exact native record metadata: directorSources: [{ref, line}]. Cell links must include ref. */
  obligations: DirectorObligation[];
}
export interface WriterDerivationFinding { rule: string; cell?: string; message: string }
export interface WriterDerivationCheck {
  exitCode: 0 | 1 | 2; directorCount: number; writerCount: number;
  counts: { missingDirectorLinks: number; staleDirectorLinks: number; unmappedRules: number };
  findings: WriterDerivationFinding[];
  checks: { voiceDerivation: VoiceDerivationCoverageResult; localeCoverage: LocaleCoverageReport; wontClaim: ReturnType<typeof checkWontClaimDrift> } | null;
  message: string;
}
async function directorSnapshot(root: string): Promise<{ stored: StoredCell[]; cells: Cell[] }> {
  const stored = await readActive(root);
  if (!stored.length) throw new Error('No active Director cells to read');
  const cells = stored.map(cell => {
    const parsed = parseCell(cell.source, cell.path);
    if (!parsed.ok) throw new Error(`${cell.path}: ${parsed.issues.map(i => i.message).join('; ')}`);
    return parsed.value;
  });
  return { stored, cells };
}
function obligationRef(cell: Cell, line: number): string { return `director:${cell.id}@${cell.version}#L${line}`; }
function briefFrom(snapshot: Awaited<ReturnType<typeof directorSnapshot>>): WriterBrief {
  const selected = snapshot.cells.filter(cell => INPUTS.includes(cell.id as typeof INPUTS[number]));
  const catalog = loadWriterCatalog();
  return {
    directorInputs: selected.map(cell => ({ id: cell.id, version: cell.version, ref: `director:${cell.id}@${cell.version}`, source: snapshot.stored.find(s => s.id === cell.id)!.source, direction: cell.direction, because: cell.because, watch: cell.watch })),
    leaves: WRITER_LAYERS.map(layer => ({ layer, role: [...new Set(catalog.slots.filter(s => s.layer === layer).map(s => String(s.contract.recordKind ?? s.contract.kind)))].join(', '), ids: catalog.slots.filter(s => s.layer === layer).map(s => s.id) })),
    missingInputs: INPUTS.filter(id => !selected.some(cell => cell.id === id)),
    obligations: selected.filter(cell => ['identity.brand.personality', 'identity.verbal.voice'].includes(cell.id)).flatMap(cell => cell.direction.map(b => ({ id: obligationRef(cell, b.line), ref: `director:${cell.id}@${cell.version}`, line: b.line, ...(b.key ? { key: b.key } : {}), text: b.text }))),
  };
}
/** Active versions only; full original source and citations remain available in the brief. */
export async function assembleWriterBrief(directorRoot: string): Promise<WriterBrief> {
  return briefFrom(await directorSnapshot(directorRoot));
}

/** Latest non-retired Writer versions are the review surface, so drafts can be checked before activation. */
export async function checkWriterDerivation(directorRoot: string, writerRoot: string, options: { sourceLocale?: string; locales?: string[] } = {}): Promise<WriterDerivationCheck> {
  const findings: WriterDerivationFinding[] = [];
  let directorCount = 0, writerCount = 0;
  const add = (rule: string, message: string, cell?: string) => findings.push({ rule, ...(cell ? { cell } : {}), message });
  const counts = () => ({ missingDirectorLinks: findings.filter(f => f.rule === 'director-link-missing').length, staleDirectorLinks: findings.filter(f => f.rule === 'director-link-stale').length, unmappedRules: findings.filter(f => f.rule === 'voice-derivation-coverage:missing').length });
  try {
    const snapshot = await directorSnapshot(directorRoot); directorCount = snapshot.cells.length;
    const brief = briefFrom(snapshot);
    for (const id of brief.missingInputs) add('director-input-missing', `No active Director input: ${id}`, id);
    // Validate active pointers independently of the candidate view.
    await readActive(writerRoot);
    await assertNoSymlinkPath(join(writerRoot, 'tree.json'));
    const tree = JSON.parse(await readFile(join(writerRoot, 'tree.json'), 'utf8'));
    const versions = await listCells(writerRoot);
    const latest = new Map<string, WriterCell>();
    for (const stored of versions) {
      const cell = parseWriterCell(stored.source, stored.path);
      if (cell.status === 'active' && tree.active[cell.id] !== cell.version) throw new Error(`${cell.id}@${cell.version}: status disagrees with active pointer`);
      if (!tree.retired?.includes(cell.id) && cell.status !== 'retired' && cell.version > (latest.get(cell.id)?.version ?? 0)) latest.set(cell.id, cell);
    }
    const cells = [...latest.values()]; writerCount = cells.length;
    if (!writerCount) throw new Error('No current Writer cells to check');
    const active = new Map(snapshot.cells.map(cell => [cell.id, cell.version]));
    const obligations = new Map(brief.obligations.map(o => [o.id, o]));
    const mapped: string[] = [];
    for (const cell of cells) {
      const identity = `${cell.id}@${cell.version}`;
      const links = cell.links.map(ref => ({ text: ref, parsed: parseLinkRef(ref)! })).filter(ref => ref.parsed.agent === 'director');
      if (!links.length) add('director-link-missing', 'Writer cell has no Director link', identity);
      for (const { text, parsed } of links) if (active.get(parsed.cell) !== parsed.version) add('director-link-stale', `Director link is absent, retired or stale: ${text}`, identity);
      for (const item of cell.records) {
        const sources = item.record.directorSources;
        if (sources === undefined) continue;
        if (!Array.isArray(sources)) { add('director-source-invalid', 'directorSources must be an array of {ref, line}', identity); continue; }
        for (const source of sources) {
          if (!isObject(source) || typeof source.ref !== 'string' || !Number.isSafeInteger(source.line) || Number(source.line) < 1) { add('director-source-invalid', `Invalid source mapping on record ${String(item.record.id)}`, identity); continue; }
          const id = `${source.ref}#L${source.line}`;
          if (!cell.links.includes(source.ref)) add('director-source-unlinked', `Record source is absent from cell links: ${id}`, identity);
          // Pass the actual declared mapping set, including stale/unknown mappings, to both-direction coverage.
          mapped.push(id);
          if (!obligations.has(id)) add('director-source-stale', `Record source does not identify a current voice or personality Direction line: ${id}`, identity);
        }
      }
    }
    const voiceDerivation = checkVoiceDerivationCoverage([...obligations.keys()], [...new Set(mapped)]);
    for (const id of voiceDerivation.obligationsMissingFromRecord) add('voice-derivation-coverage:missing', `Director rule has no Writer realisation: ${id}`, id);
    for (const id of voiceDerivation.recordRulesNotObliged) add('voice-derivation-coverage:unobliged', `Writer source has no current Director obligation: ${id}`, id);
    if (!voiceDerivation.ok && voiceDerivation.reason !== 'coverage-gap') add('voice-derivation-coverage:cannot-run', voiceDerivation.reason!);
    const manifest = tree.meta?.libraryManifest;
    const sourceLocale = options.sourceLocale ?? manifest?.defaultLocale ?? cells[0]!.locales[0]!;
    const locales = options.locales ?? (Array.isArray(manifest?.locales) ? manifest.locales.map((l: {tag: string}) => l.tag) : [...new Set(cells.flatMap(c => c.locales))]);
    const registries: Record<string, unknown> = {};
    for (const locale of new Set(cells.flatMap(c => c.locales))) {
      const entries = cells.flatMap(c => c.records.filter(r => r.locale === locale && !String(r.record.leaf).startsWith('lexicon.') && typeof r.record.text === 'string').map(r => ({ ...r.record, status: r.record.status === 'approved' || r.record.status === 'retired' ? r.record.status : 'draft' })));
      if (entries.length) registries[locale] = { id: 'writer-cells', locale, revision: cells.map(c => `${c.id}@${c.version}`).join(','), source: { kind: 'consumer', reference: 'writer-cells' }, entries };
    }
    const localeCoverage = checkLocaleCoverage(registries, sourceLocale, locales);
    for (const f of localeCoverage.findings) add(f.rule, f.message, f.entryId);
    const strategy: StrategyModel = { root: directorRoot, catalog: loadCatalog(), tree: { schemaVersion: 1, catalog: 'strategy', archetype: 'default', core: 'archetype', active: Object.fromEntries(snapshot.cells.map(c => [c.id, c.version])) }, cells: snapshot.cells, sessions: [], findings: [], requests: [], files: {}, issues: [] };
    const copy = cells.flatMap(cell => cell.records.filter(r => !String(r.record.leaf).startsWith('lexicon.') && typeof r.record.text === 'string').map(r => ({ path: `${cell.id}@${cell.version}/${r.locale}/${String(r.record.id)}`, content: r.record.text as string })));
    const wontClaim = checkWontClaimDrift(copy, strategy);
    for (const f of wontClaim.findings) add('wont-claim:hit', f.message, f.file);
    for (const reason of wontClaim.indeterminateReasons) add('wont-claim:cannot-run', reason);
    for (const id of wontClaim.unchecked) add('wont-claim:unchecked', `Unquoted prohibition requires owner interpretation: ${id}`, id);
    for (const ignored of wontClaim.ignored) add('wont-claim:ignored', `Copy line ${ignored.line} contains a prohibition ignore marker and was not checked`, ignored.file);
    const cannotRun = !localeCoverage.complete || wontClaim.state === 'indeterminate' || (voiceDerivation.reason !== undefined && voiceDerivation.reason !== 'coverage-gap');
    const exitCode = cannotRun ? 2 : findings.length ? 1 : 0;
    return { exitCode, directorCount, writerCount, counts: counts(), findings, checks: { voiceDerivation, localeCoverage, wontClaim }, message: `${writerCount} Writer cells checked; ${findings.length} findings` };
  } catch (error) {
    add('writer-check:cannot-run', error instanceof Error ? error.message : String(error));
    return { exitCode: 2, directorCount, writerCount, counts: counts(), findings, checks: null, message: 'Writer derivation checks could not run' };
  }
}
