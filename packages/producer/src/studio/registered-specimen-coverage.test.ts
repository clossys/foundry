import { describe, expect, it, vi } from 'vitest';
import { measureRegisteredSpecimen, type NativeDomEvidence } from '../../studio/lib/registered-specimen-coverage';
import type { NativeLeafResolution, NativeSpecimenSDK } from '../../studio/lib/native-specimen-runtime';

/** Anonymous API boundary controls; they do not claim a consumer's native registration. */
function fixture(agent = 'director') {
  const sectionId = 'sections.specimen-rich-passage';
  const items = [{ id: 'sample:one', label: 'One', value: { passage: 'ExampleCo direction.' } }];
  const cell = { agent, id: 'sample.page', kind: 'passage', layer: agent, items };
  const binding: NativeLeafResolution = { coverageCell: cell, sectionId, registered: true, span: 'full', items, variantIds: ['sample:one'], props: { items }, issues: [] };
  const evidence: NativeDomEvidence = { agent, cell: cell.id, surface: 'row', issues: [], cases: [{ section: sectionId, item: 'sample:one', issues: [], livePage: agent !== 'publisher' }] };
  const collect = vi.fn(() => evidence);
  const validate = vi.fn(() => ({ agents: [{ agent, cells: 1, expectedCases: 1, registeredCases: 1, renderedCases: agent === 'publisher' ? 0 : 1, pass: agent !== 'publisher' }], findings: [] }));
  const sdk = { collectSpecimenDomEvidence: collect, validateSpecimenCoverage: validate, studioSpecimenLeaves: [{ id: sectionId }] } as unknown as NativeSpecimenSDK;
  const input = { sdk, binding, agent: agent as 'director', cellId: cell.id, root: { isConnected: true } as Element, surface: 'row' as const, nativeRegistered: vi.fn(() => true) };
  return { input, collect, validate, evidence };
}
describe('published registered coverage API bridge', () => {
  it('passes the actual mounted root, source projection, leaf props and registry to the published API', () => {
    const { input, collect, validate } = fixture();
    expect(measureRegisteredSpecimen(input)).toMatchObject({ measured: true, variantIds: ['sample:one'], issues: [] });
    expect(collect).toHaveBeenCalledWith({ cell: input.binding.coverageCell, root: input.root, surface: 'row' });
    const request = validate.mock.calls[0]![0] as unknown as Parameters<NonNullable<NativeSpecimenSDK['validateSpecimenCoverage']>>[0];
    expect(request.registry).toBe(input.sdk.studioSpecimenLeaves);
    expect(request.registeredCases(input.binding.coverageCell!)).toEqual({ items: input.binding.coverageCell!.items });
    expect(request.leafProps(input.binding.coverageCell!)).toBe(input.binding.props);
    expect(input.nativeRegistered).toHaveBeenCalledWith(input.binding.sectionId);
  });
  it.each(['missing-api', 'unmounted', 'wrong-agent', 'wrong-cell', 'unregistered', 'native-refusal'] as const)('fails %s before collection', fault => {
    const { input, collect } = fixture();
    if (fault === 'missing-api') input.sdk = { ...input.sdk, validateSpecimenCoverage: undefined };
    if (fault === 'unmounted') input.root = { isConnected: false } as Element;
    if (fault === 'wrong-agent') input.binding.coverageCell!.agent = 'writer';
    if (fault === 'wrong-cell') input.binding.coverageCell!.id = 'sample.other';
    if (fault === 'unregistered') input.binding.registered = false;
    if (fault === 'native-refusal') input.nativeRegistered.mockReturnValue(false);
    expect(measureRegisteredSpecimen(input)).toMatchObject({ measured: false, variantIds: [] });
    expect(collect).not.toHaveBeenCalled();
  });
  it('never promotes an opaque Publisher frame or HTTP success to rendered coverage', () => {
    const { input, evidence } = fixture('publisher');
    evidence.issues = ['unverified-specimen-viewport'];
    expect(measureRegisteredSpecimen(input)).toMatchObject({ measured: true, variantIds: [] });
    expect(measureRegisteredSpecimen({ ...input, root: { isConnected: true, status: 200 } as unknown as Element }).variantIds).toEqual([]);
  });
  it('keeps a native unpublished empty state at zero emitted-page coverage', () => {
    const { input } = fixture('publisher');
    expect(measureRegisteredSpecimen(input)).toMatchObject({ measured: true, variantIds: [] });
  });
  it('rejects a collector response for another cell and contains SDK failures', () => {
    const { input, collect, evidence } = fixture();
    evidence.cell = 'sample.other';
    expect(measureRegisteredSpecimen(input).issues).toContain('dom-evidence-provenance-mismatch');
    collect.mockImplementation(() => { throw new Error('Collector refused.'); });
    expect(measureRegisteredSpecimen(input)).toMatchObject({ measured: false, variantIds: [], issues: ['registered-coverage-measurement-failed'] });
  });
});
