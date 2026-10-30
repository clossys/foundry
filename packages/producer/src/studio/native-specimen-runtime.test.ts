import { describe, expect, it, vi } from 'vitest';
import type { CompositeResolved } from '@clossys/designer/catalog';
import type { CellDetail } from '../../studio/lib/cells-client';
import type { AgentSpecimenPlan } from '../../studio/lib/agent-specimen-data';
import { nativeSpecimenSDK, nativeSpecimenRegistered, nativeSpecimenContext, bindNativeAgentSpecimen, bindNativeDesignerSpecimen, type NativeSpecimenContext, type NativeSpecimenSDK } from '../../studio/lib/native-specimen-runtime';

// Anonymous boundary controls: these are not an assertion of consumer native adoption.
const leaf = 'sections.specimen-example';
function fixture() {
  const profile = { components: { components: {} }, values: { members: {} }, surfaces: { fills: { [leaf]: { descriptorHash: 'selected-revision' } } } } as unknown as CompositeResolved;
  const renderContent = vi.fn(() => 'selected native renderer');
  const runtime = { components: {}, surfaces: {}, tree: {}, disclosure: {} };
  const context: NativeSpecimenContext = { profile, selectedComponents: runtime.components, surfaces: { [leaf]: { descriptorHash: 'selected-revision', renderContent } } };
  const items = [{ id: 'actual-1', label: 'One', value: { passage: 'Complete passage' } }];
  const sdk: NativeSpecimenSDK = {
    emittedDesignerSpecimenContext: vi.fn(() => context), bindNativeSpecimenContext: vi.fn(value => value), projectAgentSpecimenPlan: vi.fn(),
    bindAgentSpecimenPlan: vi.fn(() => ({ sectionId: leaf, registered: true, items, variantIds: ['actual-1'], cell: { axes: [{ id: 'source-axis' }] }, issues: [] })),
    studioSpecimenLeaves: [{ id: leaf, span: 'full' }], SPECIMEN_KIND_MAP: [{ kind: 'component', layer: 'components', specimen: leaf }, { kind: 'color', layer: 'tokens', specimen: leaf }, { kind: 'spacing', layer: 'tokens', specimen: leaf }],
    resolveSpecimenLeafBinding: vi.fn(() => ({ leaf: { id: leaf, span: 'third' } })), enumerateRegisteredDesignerSpecimenCases: vi.fn(() => ({ items })),
  };
  const plan: AgentSpecimenPlan = { cellId: 'sample.page', items: [{ id: 'actual-1', kind: 'director', title: 'Direction', value: 'Complete passage' }], expectedVariantIds: ['actual-1'], issues: [] };
  const props = { sdk, context, agent: 'director', plan, expanded: false, need: vi.fn(), labels: { showAllVariants: (count: number) => `Show all ${count} variants` } };
  return { profile, context, runtime, sdk, props, items, renderContent };
}
describe('published native specimen runtime boundary', () => {
  it('requires exact public SDK capabilities instead of guessed aliases', () => {
    const { sdk } = fixture(); expect(nativeSpecimenSDK(sdk as unknown as Record<string, unknown>)).toBe(sdk);
    expect(nativeSpecimenSDK({ createSpecimenContext: () => {}, leaves: [] })).toBeUndefined();
    expect(nativeSpecimenSDK({ ...sdk, bindAgentSpecimenPlan: undefined })).toBeUndefined();
  });
  it('requires a selected descriptor-matched executable registration', () => {
    const { context } = fixture(); expect(nativeSpecimenRegistered(context, leaf)).toBe(true);
    expect(nativeSpecimenRegistered(context, 'sections.specimen-unselected')).toBe(false);
    expect(nativeSpecimenRegistered({ ...context, surfaces: { [leaf]: { descriptorHash: 'stale', renderContent: () => null } } }, leaf)).toBe(false);
    expect(nativeSpecimenRegistered({ ...context, surfaces: { [leaf]: { descriptorHash: 'selected-revision' } } }, leaf)).toBe(false);
  });
  it('uses SDK context construction and exact emitted component identity', () => {
    const { sdk, profile, runtime, context } = fixture(); expect(nativeSpecimenContext(sdk, profile, runtime).context).toBe(context);
    expect(sdk.bindNativeSpecimenContext).toHaveBeenCalledWith(context, runtime.components);
    expect(nativeSpecimenContext(undefined, profile, runtime).issues.length).toBeGreaterThan(0);
    expect(nativeSpecimenContext({ ...sdk, emittedDesignerSpecimenContext: () => ({ ...context, selectedComponents: {} }) }, profile, runtime).context).toBeUndefined();
  });
  it('dispatches whole native items only to the selected renderer and passes native axes', () => {
    const { props, items, renderContent, sdk } = fixture(); props.plan.axes = [{ id: 'string', label: 'String', values: [{ id: 'actual-1', label: 'Source string' }] }];
    const result = bindNativeAgentSpecimen(props);
    expect(result.registered).toBe(true); expect(result.props.items).toBe(items); expect(result.Component).toBe(renderContent);
    expect(result.props.axes).toEqual([{ id: 'source-axis' }]);
    expect(sdk.bindAgentSpecimenPlan).toHaveBeenCalledWith(expect.objectContaining({ plan: props.plan, axes: props.plan.axes, nativeRegistered: expect.any(Function) }));
    expect(result.span).toBe('full');
  });
  it('preserves native refusals and never promotes definition presence to registration', () => {
    const { props, sdk, context } = fixture();
    const missing = bindNativeAgentSpecimen({ ...props, context: { ...context, surfaces: {} } }); expect(missing.registered).toBe(false); expect(missing.Component).toBeUndefined();
    const refused = bindNativeAgentSpecimen({ ...props, sdk: { ...sdk, bindAgentSpecimenPlan: () => ({ registered: false, items: [], variantIds: [], issues: ['Native source failure.'] }) } });
    expect(refused.registered).toBe(false); expect(refused.issues).toContain('Native source failure.');
  });
  it('accepts a native unpublished presentation independently of variants but never without the selected executable registration', () => {
    const { props, sdk, items, context } = fixture();
    const unpublished = { ...sdk, bindAgentSpecimenPlan: () => ({ sectionId: leaf, registered: true, presentationReady: true, items, variantIds: [], issues: [] }) };
    const result = bindNativeAgentSpecimen({ ...props, sdk: unpublished });
    expect(result).toMatchObject({ registered: true, presentationReady: true, variantIds: [] });
    expect(bindNativeAgentSpecimen({ ...props, sdk: unpublished, context: { ...context, surfaces: {} } })).toMatchObject({ registered: false, presentationReady: false });
    expect(bindNativeAgentSpecimen({ ...props, sdk: { ...unpublished, bindAgentSpecimenPlan: () => ({ sectionId: leaf, registered: false, presentationReady: true, items, variantIds: [], issues: ['Native validation failed'] }) } })).toMatchObject({ registered: false, presentationReady: false });
  });
  it('enumerates full Designer source cases through the official registry', () => {
    const { props, context, sdk } = fixture();
    (context.profile.components.components as Record<string, unknown>)['components.button'] = {};
    const cell = { agent: 'designer', id: 'components.button', fields: {}, content: '' } as CellDetail;
    const result = bindNativeDesignerSpecimen({ ...props, cell });
    expect(sdk.resolveSpecimenLeafBinding).toHaveBeenCalledWith({ kind: 'component', layer: 'components' }, sdk.studioSpecimenLeaves);
    expect(result.sourcePlan?.expectedVariantIds).toEqual(['actual-1']); expect(result.registered).toBe(true);
  });
  it('refuses ambiguous kinds, unselected sources, unknown kinds and wrong-agent cells', () => {
    const { props, context } = fixture();
    (context.profile.values.members as Record<string, unknown>)['tokens.example.member'] = { slot: 'tokens.example' };
    const cell = { agent: 'designer', id: 'tokens.example', fields: {}, content: '' } as CellDetail;
    expect(bindNativeDesignerSpecimen({ ...props, cell }).issues.join()).toContain('unambiguous');
    expect(bindNativeDesignerSpecimen({ ...props, cell: { ...cell, id: 'tokens.unselected' } }).registered).toBe(false);
    expect(bindNativeDesignerSpecimen({ ...props, cell: { ...cell, agent: 'writer' } }).registered).toBe(false);
    const sdk = { ...props.sdk, resolveSpecimenLeafBinding: () => ({ error: 'unbound-specimen' }) };
    expect(bindNativeDesignerSpecimen({ ...props, sdk, cell: { ...cell, fields: { kind: 'unknown' } } }).issues).toContain('unbound-specimen');
  });
});
