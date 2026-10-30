import type { AgentSpecimenCoverage } from './agent-specimen-coverage';
import type { AgentCells, CellContentScope } from './cells-client';
import { projectStudioAgentIA } from './studio-agent-ia';

/** Inventory/binding evidence plus a separate mounted registered-renderer measurement. */
export type StudioCoverageEvidence = AgentSpecimenCoverage;
export interface StudioCoverageResult { state: 'pass' | 'fail' | 'empty'; cells: { covered: number; total: number }; variants: { covered: number; total: number; completeScope: boolean }; issues: { cellId?: string; code: string }[]; scope?: CellContentScope; sources: { cellId: string; inventoryComplete: boolean; scope?: CellContentScope }[] }

/** Strict evidence accounting: a fallback, unknown scope, unregistered binding, undeclared leaf span or missing variant is never 100%. */
export function checkStudioSpecimenCoverage(index: AgentCells, evidence: readonly StudioCoverageEvidence[]): StudioCoverageResult {
  const scope = index.contentScope;
  const ia = scope ? undefined : projectStudioAgentIA(index);
  const cells = scope ? index.cells.filter(cell => cell.id === scope.cellId) : ia!.groups.flatMap(group => group.collections.flatMap(collection => collection.cells));
  const sources: StudioCoverageResult['sources'] = [];
  const issues: StudioCoverageResult['issues'] = [];
  let coveredCells = 0, totalVariants = 0, coveredVariants = 0, completeScope = true;
  if (ia && ia.state !== 'ready') { issues.push({ code: 'ia-unavailable' }); completeScope = false; }
  if (scope && (!['cell', 'version'].includes(scope.kind) || index.state !== 'ready' || cells.length !== 1 || scope.kind === 'version' && (!Number.isSafeInteger(scope.version) || scope.version < 1 || cells[0]?.version !== scope.version))) { issues.push({ code: 'explicit-scope-unavailable' }); completeScope = false; }
  for (const cell of cells) {
    const records = evidence.filter(record => record.cellId === cell.id);
    const record = records[0];
    const fail = (code: string) => issues.push({ cellId: cell.id, code });
    if (records.length !== 1 || !record) { fail('missing-or-duplicate-renderer-evidence'); completeScope = false; continue; }
    const before = issues.length;
    sources.push({ cellId: cell.id, inventoryComplete: record.inventoryComplete === true, ...(record.scope ? { scope: record.scope } : {}) });
    if (record.inventoryComplete !== true) { fail('incomplete-source-inventory'); completeScope = false; }
    if (record.scope && (!['cell', 'version'].includes(record.scope.kind) || record.scope.cellId !== cell.id || record.scope.kind === 'version' && (!Number.isSafeInteger(record.scope.version) || record.scope.version < 1))) { fail('invalid-source-scope'); completeScope = false; }
    if (scope && (record.scope?.kind !== scope.kind || record.scope.cellId !== scope.cellId || scope.kind === 'version' && (record.scope.kind !== 'version' || record.scope.version !== scope.version)) || !scope && record.scope?.kind === 'version') { fail('source-scope-does-not-cover-inventory'); completeScope = false; }
    if (!record.ready) fail('renderer-not-ready');
    if (!record.registered || !/^sections\.specimen-[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(record.boundSectionId ?? '')) fail('missing-registered-specimen-binding');
    if (!['full', 'half', 'third'].includes(record.span ?? '')) fail('missing-or-invalid-leaf-span');
    if (!Number.isInteger(record.itemCount) || record.itemCount < 1) fail('empty-specimen-items');
    if (record.issues.length) fail('renderer-model-issues');
    const expected = record.expectedVariantIds;
    if (!expected?.length || new Set(expected).size !== expected.length) { fail('missing-variant-inventory'); completeScope = false; }
    const ids = expected ?? [];
    totalVariants += ids.length;
    if (new Set(record.variants.map(variant => variant.id)).size !== record.variants.length) fail('duplicate-variant');
    const modelValid = before === issues.length;
    const proof = record.rendered;
    const proofValid = proof?.measured === true && proof.agent === index.agent && proof.cellId === cell.id && proof.sectionId === record.boundSectionId && proof.issues.every(code => code === 'missing-rendered-case' || code === 'missing-live-emitted-page') && new Set(proof.variantIds).size === proof.variantIds.length && proof.variantIds.every(id => ids.includes(id));
    if (!proofValid) fail('missing-or-invalid-rendered-evidence');
    let rendered = 0;
    for (const id of ids) {
      const variant = record.variants.find(variant => variant.id === id);
      if (!variant?.renderable) fail('missing-or-unrenderable-variant');
      else if (!proofValid || !proof!.variantIds.includes(id)) fail('missing-rendered-variant');
      else if (modelValid) rendered++;
    }
    if (record.variants.some(variant => !ids.includes(variant.id))) fail('variant-outside-inventory');
    coveredVariants += rendered;
    if (before === issues.length) coveredCells++;
  }
  if (evidence.some(record => !cells.some(cell => cell.id === record.cellId))) issues.push({ code: 'evidence-outside-ia' });
  if (!cells.length) { issues.push({ code: 'missing-native-inventory' }); completeScope = false; }
  return { state: issues.length ? 'fail' : 'pass', ...(scope ? { scope } : {}), sources, cells: { covered: coveredCells, total: cells.length }, variants: { covered: coveredVariants, total: totalVariants, completeScope }, issues };
}
