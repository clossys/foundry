import type { Agent } from './agents';
import type { NativeLeafResolution, NativeSpecimenSDK } from './native-specimen-runtime';

/** Structural ports of the published Designer Studio coverage API. */
export interface NativeCoverageCell {
  agent: string; id: string; kind: string; layer: string; specimen?: string;
  items: readonly unknown[]; axes?: readonly unknown[];
}
export interface NativeDomEvidence {
  agent: string; cell: string; surface: 'row' | 'expanded' | 'linkout'; issues: readonly string[];
  cases: readonly { section: string; item: string; issues: readonly string[]; livePage: boolean }[];
}
export interface RegisteredCoverageSDK {
  collectSpecimenDomEvidence(input: { cell: NativeCoverageCell; root: Element; surface: NativeDomEvidence['surface'] }): NativeDomEvidence;
  validateSpecimenCoverage(input: {
    cells: readonly NativeCoverageCell[]; registry: readonly unknown[];
    registeredCases: (cell: NativeCoverageCell) => { items: readonly unknown[]; axes?: readonly unknown[] } | undefined;
    leafProps: (cell: NativeCoverageCell) => Record<string, unknown> | undefined;
    evidence: readonly NativeDomEvidence[];
  }): { agents: readonly { agent: string; cells: number; expectedCases: number | null; registeredCases: number; renderedCases: number; pass: boolean }[]; findings: readonly { agent: string; cell: string; code: string; item?: string }[] };
}
export interface RegisteredRenderMeasurement {
  agent: Agent; cellId: string; sectionId?: string; surface: NativeDomEvidence['surface'];
  measured: boolean; variantIds: string[]; issues: string[];
}

/** A mounted region and an explicit selected-native registration are both required.
 * HTTP responses and JS definition presence never supply rendered evidence.
 */
export function measureRegisteredSpecimen(input: {
  sdk?: NativeSpecimenSDK; binding: NativeLeafResolution; agent: Agent; cellId: string;
  root: Element; surface: NativeDomEvidence['surface']; nativeRegistered: (id: string) => boolean;
}): RegisteredRenderMeasurement {
  const { sdk, binding, agent, cellId, root, surface } = input;
  const result: RegisteredRenderMeasurement = { agent, cellId, ...(binding.sectionId ? { sectionId: binding.sectionId } : {}), surface, measured: false, variantIds: [], issues: [] };
  const cell = binding.coverageCell;
  if (!sdk?.collectSpecimenDomEvidence || !sdk.validateSpecimenCoverage) result.issues.push('registered-coverage-api-unavailable');
  if (!cell || cell.agent !== agent || cell.id !== cellId) result.issues.push('coverage-cell-provenance-mismatch');
  if (!binding.registered || !binding.sectionId || !input.nativeRegistered(binding.sectionId)) result.issues.push('missing-selected-native-registration');
  if (!root.isConnected) result.issues.push('unmounted-specimen');
  if (result.issues.length || !cell || !sdk?.collectSpecimenDomEvidence || !sdk.validateSpecimenCoverage) return result;
  try {
    const evidence = sdk.collectSpecimenDomEvidence({ cell, root, surface });
    if (evidence.agent !== agent || evidence.cell !== cellId || evidence.surface !== surface) { result.issues.push('dom-evidence-provenance-mismatch'); return result; }
    const report = sdk.validateSpecimenCoverage({ cells: [cell], registry: sdk.studioSpecimenLeaves,
      registeredCases: candidate => candidate === cell ? { items: cell.items, ...(cell.axes ? { axes: cell.axes } : {}) } : undefined,
      leafProps: candidate => candidate === cell ? binding.props : undefined, evidence: [evidence] });
    result.measured = true;
    result.issues.push(...report.findings.filter(finding => finding.agent === agent).map(finding => finding.code));
    const summary = report.agents.filter(summary => summary.agent === agent);
    if (summary.length !== 1 || summary[0]!.cells !== 1 || summary[0]!.expectedCases === null || summary[0]!.registeredCases !== binding.variantIds.length) {
      result.issues.push('registered-case-inventory-unverified'); return result;
    }
    // Preserve the collector's refusal for opaque sandbox frames. The iframe load event is not proof.
    if (!evidence.issues.length) result.variantIds = binding.variantIds.filter(id => evidence.cases.some(proof => proof.section === binding.sectionId && proof.item === id && !proof.issues.length && (agent !== 'publisher' || proof.livePage)));
    if (result.variantIds.length !== summary[0]!.renderedCases) { result.variantIds = []; result.issues.push('rendered-case-accounting-mismatch'); }
    return result;
  } catch { result.issues.push('registered-coverage-measurement-failed'); return result; }
}
