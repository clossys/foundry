import type { ComponentType, ReactNode } from 'react';
import type { CompositeResolved } from '@clossys/designer/catalog';
import type { StudioRuntimeModule } from './selection-runtime';
import type { CellDetail } from './cells-client';
import type { AgentSpecimenPlan } from './agent-specimen-data';
import type { SpecimenCardSpan } from './agent-specimen-coverage';

export interface NativeSurfaceBinding { descriptorHash: string; renderContent?: (props: Record<string, unknown>) => ReactNode }
export interface NativeSpecimenContext {
  profile: CompositeResolved;
  surfaces?: Record<string, NativeSurfaceBinding>;
  selectedComponents?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface NativeSpecimenDefinition { id: string; span?: SpecimenCardSpan; validate?(props: Record<string, unknown>): readonly { leaf: string; reason: string }[] }
export interface NativeSpecimenSDK {
  emittedDesignerSpecimenContext(profile: CompositeResolved, runtime: StudioRuntimeModule): NativeSpecimenContext;
  bindNativeSpecimenContext(context: NativeSpecimenContext, ports: Record<string, unknown>): NativeSpecimenContext | { leaf: string; reason: string };
  projectAgentSpecimenPlan(input: Record<string, unknown>): unknown;
  bindAgentSpecimenPlan(input: Record<string, unknown>): { sectionId?: string; registered: boolean; items: unknown[]; variantIds: string[]; cell?: { axes?: unknown[] }; issues: string[] };
  studioSpecimenLeaves: readonly NativeSpecimenDefinition[];
  SPECIMEN_KIND_MAP?: readonly { kind: string; layer?: string; specimen: string }[];
  resolveSpecimenLeafBinding?(cell: Record<string, unknown>, registry: readonly NativeSpecimenDefinition[]): { leaf: NativeSpecimenDefinition } | { error: string };
  enumerateRegisteredDesignerSpecimenCases?(input: Record<string, unknown>): { items: Record<string, unknown>[]; axes?: unknown[] } | undefined;
}
/** Probe exact published SDK names; a similarly named private function is not a capability. */
export function nativeSpecimenSDK(namespace: Record<string, unknown>): NativeSpecimenSDK | undefined {
  if (!['emittedDesignerSpecimenContext', 'bindNativeSpecimenContext', 'projectAgentSpecimenPlan', 'bindAgentSpecimenPlan'].every(name => typeof namespace[name] === 'function') || !Array.isArray(namespace.studioSpecimenLeaves)) return undefined;
  return namespace as unknown as NativeSpecimenSDK;
}
/** A JS leaf definition alone never establishes a selected native registration. */
export function nativeSpecimenRegistered(context: NativeSpecimenContext, id: string): boolean {
  const selected = (context.profile.surfaces?.fills as Record<string, { descriptorHash?: string }> | undefined)?.[id];
  const bound = context.surfaces?.[id];
  return !!selected?.descriptorHash && selected.descriptorHash === bound?.descriptorHash && typeof bound.renderContent === 'function';
}
export function nativeSpecimenContext(sdk: NativeSpecimenSDK | undefined, profile: CompositeResolved | undefined, runtime: StudioRuntimeModule): { context?: NativeSpecimenContext; issues: string[] } {
  if (!sdk) return { issues: ['The installed Designer package has no published native specimen SDK.'] };
  if (!profile) return { issues: ['The emitted Designer selection profile is unavailable.'] };
  try {
    const context = sdk.emittedDesignerSpecimenContext(profile, runtime);
    if (context.profile !== profile || context.selectedComponents !== runtime.components) return { issues: ['The native specimen context does not belong to this emitted selection.'] };
    const bound = sdk.bindNativeSpecimenContext(context, runtime.components);
    if ('reason' in bound && typeof bound.reason === 'string') return { issues: [bound.reason] };
    return { context: bound as NativeSpecimenContext, issues: [] };
  } catch (error) { return { issues: [error instanceof Error ? error.message : 'The native specimen context could not be bound.'] }; }
}
export interface NativeLeafResolution {
  sourcePlan?: AgentSpecimenPlan;
  Component?: ComponentType<Record<string, unknown>>;
  sectionId?: string; registered: boolean; span?: SpecimenCardSpan;
  items: unknown[]; variantIds: string[]; props: Record<string, unknown> & { items: unknown[] }; issues: string[];
}
export function bindNativeAgentSpecimen(input: {
  sdk?: NativeSpecimenSDK; context?: NativeSpecimenContext; agent: string; plan: AgentSpecimenPlan;
  specimen?: string; expanded: boolean; need: (need: { leaf: string; reason: string }) => ReactNode;
  labels: { showAllVariants(count: number): ReactNode };
}): NativeLeafResolution {
  const { sdk, context, plan } = input;
  const unavailable = (issues: string[]): NativeLeafResolution => ({ registered: false, items: [], variantIds: [], props: { items: [] }, issues });
  if (!sdk || !context) return unavailable(['The selected native specimen context is unavailable.']);
  try {
    const props = { context, need: input.need, expanded: input.expanded, labels: input.labels };
    const bound = sdk.bindAgentSpecimenPlan({ agent: input.agent, plan, ...(input.specimen ? { specimen: input.specimen } : {}), ...('axes' in plan ? { axes: plan.axes } : {}), props, nativeRegistered: (id: string) => nativeSpecimenRegistered(context, id) });
    const issues = [...bound.issues];
    const id = bound.sectionId;
    const native = id && nativeSpecimenRegistered(context, id) ? context.surfaces?.[id] : undefined;
    if (!native?.renderContent) issues.push('The bound leaf has no descriptor-matched selected native content renderer.');
    const definitions = id ? sdk.studioSpecimenLeaves.filter(leaf => leaf.id === id) : [];
    const span = definitions.length === 1 ? definitions[0]?.span : undefined;
    return { ...(native?.renderContent ? { Component: native.renderContent as ComponentType<Record<string, unknown>> } : {}), sectionId: id, registered: bound.registered && !!native?.renderContent && issues.length === 0, ...(span ? { span } : {}), items: bound.items, variantIds: bound.variantIds, props: { ...props, items: bound.items, ...(bound.cell?.axes ? { axes: bound.cell.axes } : {}) }, issues };
  } catch (error) { return unavailable([error instanceof Error ? error.message : 'The native specimen plan could not be bound.']); }
}

/** Designer cases come from its official source registry, never the visible cell subset. */
export function bindNativeDesignerSpecimen(input: {
  sdk?: NativeSpecimenSDK; context?: NativeSpecimenContext; cell: CellDetail; expanded: boolean;
  need: (need: { leaf: string; reason: string }) => ReactNode; labels: { showAllVariants(count: number): ReactNode };
}): NativeLeafResolution {
  const { sdk, context, cell } = input;
  const unavailable = (issues: string[]): NativeLeafResolution => ({ registered: false, items: [], variantIds: [], props: { items: [] }, issues });
  if (!sdk?.resolveSpecimenLeafBinding || !sdk.enumerateRegisteredDesignerSpecimenCases || !Array.isArray(sdk.SPECIMEN_KIND_MAP) || !context) return unavailable(['The native Designer case enumeration capability is unavailable.']);
  const sourceLeaf = cell.id;
  const sourceSelected = Object.hasOwn(context.profile.components.components, sourceLeaf) || Object.hasOwn(context.profile.surfaces?.fills ?? {}, sourceLeaf) || Object.values(context.profile.values.members).some(member => member.slot === sourceLeaf);
  if (cell.agent !== 'designer' || !sourceSelected) return unavailable(['The Designer source cell has no matching selected native leaf.']);
  const layer = sourceLeaf.split('.')[0]!;
  const declaredKind = typeof cell.fields?.kind === 'string' ? cell.fields.kind : undefined;
  const kinds = [...new Set(sdk.SPECIMEN_KIND_MAP.filter(entry => entry.layer === layer).map(entry => entry.kind))];
  const kind = declaredKind ?? (kinds.length === 1 ? kinds[0] : undefined);
  if (!kind) return unavailable(['The selected Designer source has no unambiguous declared semantic kind.']);
  try {
    const binding = sdk.resolveSpecimenLeafBinding({ kind, layer, ...(typeof cell.fields?.specimen === 'string' ? { specimen: cell.fields.specimen } : {}) }, sdk.studioSpecimenLeaves);
    if ('error' in binding) return unavailable([binding.error]);
    const definition = binding.leaf;
    const cases = sdk.enumerateRegisteredDesignerSpecimenCases({ context, specimen: definition.id, sourceLeaf });
    if (!cases?.items.length) return unavailable(['The native Designer registry has no complete source cases.']);
    const props = { context, items: cases.items, ...(cases.axes ? { axes: cases.axes } : {}), expanded: input.expanded, need: input.need, labels: input.labels };
    const issues = (definition.validate?.(props) ?? []).map(need => `${need.leaf}: ${need.reason}`);
    const native = nativeSpecimenRegistered(context, definition.id) ? context.surfaces?.[definition.id] : undefined;
    if (!native?.renderContent) issues.push('The bound Designer leaf has no descriptor-matched selected native renderer.');
    const expectedVariantIds = cases.items.map(item => String(item.id));
    const sourcePlan: AgentSpecimenPlan = { cellId: cell.id, items: cases.items, expectedVariantIds, issues: [] };
    return { sourcePlan, ...(native?.renderContent ? { Component: native.renderContent as ComponentType<Record<string, unknown>> } : {}), sectionId: definition.id, registered: !!native?.renderContent && issues.length === 0, span: definition.span, items: cases.items, variantIds: issues.length ? [] : [...expectedVariantIds], props, issues };
  } catch (error) { return unavailable([error instanceof Error ? error.message : 'The native Designer source could not be enumerated.']); }
}
