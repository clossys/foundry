import type { AgentSpecimenCoverage } from './agent-specimen-coverage';
import type { AgentCells } from './cells-client';
import { projectStudioAgentIA } from './studio-agent-ia';

/** Evidence supplied by the same registered renderer model that paints the row. */
export type StudioCoverageEvidence = AgentSpecimenCoverage;
export interface StudioCoverageResult { state: 'pass' | 'fail' | 'empty'; cells: { covered: number; total: number }; variants: { covered: number; total: number; completeScope: boolean }; issues: { cellId?: string; code: string }[] }

/** Strict evidence accounting: a fallback, unknown scope, unregistered binding, undeclared leaf span or missing variant is never 100%. */
export function checkStudioSpecimenCoverage(index: AgentCells, evidence: readonly StudioCoverageEvidence[]): StudioCoverageResult {
  const ia = projectStudioAgentIA(index);
  const cells = ia.groups.flatMap(group => group.collections.flatMap(collection => collection.cells));
  const issues: StudioCoverageResult['issues'] = [];
  let coveredCells = 0, totalVariants = 0, coveredVariants = 0, completeScope = true;
  if (ia.state !== 'ready') { issues.push({ code: 'ia-unavailable' }); completeScope = false; }
  for (const cell of cells) {
    const records = evidence.filter(record => record.cellId === cell.id);
    const record = records[0];
    const fail = (code: string) => issues.push({ cellId: cell.id, code });
    if (records.length !== 1 || !record) { fail('missing-or-duplicate-renderer-evidence'); completeScope = false; continue; }
    const before = issues.length;
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
    let rendered = 0;
    for (const id of ids) {
      const variant = record.variants.find(variant => variant.id === id);
      if (!variant?.renderable) fail('missing-or-unrenderable-variant');
      else if (modelValid) rendered++;
    }
    if (record.variants.some(variant => !ids.includes(variant.id))) fail('variant-outside-inventory');
    coveredVariants += rendered;
    if (before === issues.length) coveredCells++;
  }
  if (evidence.some(record => !cells.some(cell => cell.id === record.cellId))) issues.push({ code: 'evidence-outside-ia' });
  return { state: issues.length ? 'fail' : cells.length ? 'pass' : 'empty', cells: { covered: coveredCells, total: cells.length }, variants: { covered: coveredVariants, total: totalVariants, completeScope }, issues };
}
