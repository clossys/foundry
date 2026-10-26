"use client";
import { Component as ReactComponent, createElement, useCallback, useContext, useEffect, useState, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import { componentMemberBinding } from "../catalog-core/emit-components.js";
import type { CompositeResolved, ResolvedComponent } from "../catalog-core/index.js";
import { componentSpecimenSample, componentSpecimenUnavailableReason, type ComponentSpecimenSample } from "./component-specimen-samples.js";
import { PreviewOutcomeContext, type SpecimenUnavailableReason } from "./preview-outcome.js";

/** The named exports of one module the host imported, e.g. `import * as components from "@clossys/designer/components"`. */
export type ComponentSpecimenModule = Readonly<Record<string, unknown>>;
/** A renderable implementation export as the host's React sees it. */
export type ComponentSpecimenComponent = ComponentType<Record<string, unknown>>;

/** One contract member bound to the implementation export and props the adopted descriptor maps it to. */
export interface ComponentSpecimenMember {
  readonly member: string;
  readonly Component: ComponentSpecimenComponent;
  /** The module specifier and export name the member's pointer dispatches to (`./shell#Brandmark` reads from the shell module). */
  readonly specifier: string;
  readonly exportName: string;
  readonly props: Readonly<Record<string, unknown>>;
  /** A hover, press or focus-visible state: the implementation sets it on interaction, a static render cannot. */
  readonly interaction: boolean;
  /** Drawn by the default specimen: a literal-valued prop (`Button.size=sm`) or a `state.*` boolean flag (`Button.isDisabled`). */
  readonly drawn: boolean;
}

/** Everything a specimen needs for one chosen component leaf, bound from the host's own modules. */
export interface ComponentSpecimenBinding {
  readonly leaf: string;
  /** The library the chosen fill came from. */
  readonly source: string;
  /** The implementation export the descriptor names (`impl.export`). */
  readonly Component: ComponentSpecimenComponent;
  /** The module specifier the export was read from (`impl.module` or `impl.entry`), the key in `modules`. */
  readonly specifier: string;
  /** The export's name in that module (`impl.export`). */
  readonly exportName: string;
  /** That whole module, for a specimen that draws the component with its sibling parts. */
  readonly exports: ComponentSpecimenModule;
  /** Mapped contract members, in descriptor order. Unmapped members are absent. */
  readonly members: readonly ComponentSpecimenMember[];
  /** Mapped members whose pointer the component dispatcher cannot express (a compound part or a prose note), with the reason. */
  readonly unbound: readonly { readonly member: string; readonly detail: string }[];
}

/** Host-authored specimen content for one leaf, drawn with the bound implementation. */
export type ComponentSpecimenRender = (binding: ComponentSpecimenBinding) => ReactNode;

/** Why a leaf has no live specimen. The code is stable; `detail` names the leaf, module or export. */
export type ComponentSpecimenRefusalCode = "not-a-component" | "not-chosen" | "module-unavailable" | "export-unavailable";
export interface ComponentSpecimenRefusal {
  readonly leaf: string;
  readonly code: ComponentSpecimenRefusalCode;
  readonly detail: string;
}

export interface ComponentSpecimenOptions {
  /**
   * The adopted library's modules, keyed by the exact specifier each chosen descriptor names: a package
   * module (`impl.module`, and `<package>/<subpath>` for a propMap pointer such as `./charts#BarChart`)
   * or a library source entry (`impl.entry`). Nothing is imported or inferred; a missing key refuses.
   */
  readonly modules: Readonly<Record<string, ComponentSpecimenModule>>;
  /**
   * Specimen content by leaf; an entry replaces everything below. A leaf without one renders the implementation
   * export once, labelled with the leaf, then once per drawn member, labelled with its member key. A data-driven
   * Foundry component (charts, table, tree, field, ...) draws with designer-provided neutral sample content
   * instead of the label; another library's data-driven component needs an entry here.
   */
  readonly specimens?: Readonly<Record<string, ComponentSpecimenRender>>;
  /** Wraps every specimen, e.g. the library's emitted `LibraryProvider`. */
  readonly provider?: ComponentType<{ readonly children?: ReactNode }>;
}

export interface ComponentSpecimenPreview {
  /** Pass as `CompositeStudioSnapshot.preview`, or call first from the host's own preview. Undefined for a refusal. */
  readonly preview: (leaf: string, profile: CompositeResolved) => ReactNode | undefined;
  /** The binding a specimen would draw, or the named reason there is none. */
  readonly bind: (leaf: string, profile: CompositeResolved) => { readonly binding: ComponentSpecimenBinding } | { readonly refusal: ComponentSpecimenRefusal };
}

const renderable = (value: unknown): value is ComponentSpecimenComponent =>
  typeof value === "function" || (typeof value === "object" && value !== null && "$$typeof" in value);

/** A specimen that throws while rendering keeps its cell, marked for the capture harness, instead of unmounting Studio. */
class SpecimenBoundary extends ReactComponent<{ readonly name: string; readonly onFail: (name: string) => void; readonly children?: ReactNode }, { readonly failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  override componentDidCatch(_error: unknown, _info: ErrorInfo): void { this.props.onFail(this.props.name); }
  override render(): ReactNode { return this.state.failed ? <span hidden data-specimen-error={this.props.name} /> : this.props.children; }
}

/**
 * The specimens of one leaf. Once every one it tries has thrown (or the provider around them has), it reports
 * `specimen-error` to the leaf cell, which then reads unavailable with that reason instead of live. When it
 * tries none, because sample data cannot draw any of them, it reports their named reason.
 */
function SpecimenSet({ total, unavailable, children }: { readonly total: number; readonly unavailable?: SpecimenUnavailableReason; readonly children: (onFail: (name: string) => void, onProviderFail: () => void) => ReactNode }) {
  const report = useContext(PreviewOutcomeContext);
  const [failed, setFailed] = useState<{ readonly names: ReadonlySet<string>; readonly provider: boolean }>(() => ({ names: new Set(), provider: false }));
  const onFail = useCallback((name: string) => setFailed(previous => previous.names.has(name) ? previous : { ...previous, names: new Set(previous.names).add(name) }), []);
  const onProviderFail = useCallback(() => setFailed(previous => previous.provider ? previous : { ...previous, provider: true }), []);
  const reason = failed.provider || (total > 0 && failed.names.size >= total) ? "specimen-error" : total === 0 ? unavailable ?? "specimen-error" : undefined;
  useEffect(() => { report?.(reason); }, [report, reason]);
  useEffect(() => () => report?.(undefined), [report]);
  return children(onFail, onProviderFail);
}

type SpecimenRow = { readonly member: string; readonly Component: ComponentSpecimenComponent; readonly props: Readonly<Record<string, unknown>>; readonly specifier: string; readonly exportName: string };
const specimenRows = (binding: ComponentSpecimenBinding): SpecimenRow[] =>
  [{ member: binding.leaf, Component: binding.Component, props: {}, specifier: binding.specifier, exportName: binding.exportName }, ...binding.members.filter(member => member.drawn)];

/**
 * A sample describes the base export; a member bound to another export keeps its label. A row whose export
 * sample data cannot draw (`unavailableOf`) is marked with the reason and never rendered.
 */
function defaultSpecimen(binding: ComponentSpecimenBinding, sample: ComponentSpecimenSample | undefined, unavailableOf: (row: SpecimenRow) => SpecimenUnavailableReason | undefined, onFail: (name: string) => void): ReactNode {
  return specimenRows(binding).map(row => { const unavailable = unavailableOf(row); return <div key={row.member} data-component-specimen={row.member}>
    {unavailable ? <span hidden data-specimen-unavailable={unavailable} /> : <SpecimenBoundary name={row.member} onFail={onFail}>{sample && row.Component === binding.Component
      ? createElement(row.Component, { ...sample.props, children: sample.children, ...row.props })
      : createElement(row.Component, { ...row.props }, row.member)}</SpecimenBoundary>}
  </div>; });
}

/** `@scope/name/charts` is `./charts`; a sample key is the export address a Foundry fill pins (`./charts#BarChart`). */
const sampleKey = (specifier: string, exportName: string) => {
  const parts = specifier.split("/");
  return `./${parts.slice(specifier.startsWith("@") ? 2 : 1).join("/")}#${exportName}`;
};

/**
 * Live component specimens for Studio, bound from the host's adopted library. Each chosen component leaf
 * resolves to the implementation export its descriptor names and every mapped member's dispatch, the same
 * rule the emitted component index follows. A leaf that cannot bind stays unavailable with a named refusal;
 * nothing falls back to another library or to a placeholder.
 */
export function componentSpecimenPreview(options: ComponentSpecimenOptions): ComponentSpecimenPreview {
  const refuse = (leaf: string, code: ComponentSpecimenRefusalCode, detail: string) => ({ refusal: { leaf, code, detail } });
  const exportOf = (leaf: string, module: string, name: string): { value: ComponentSpecimenComponent; namespace: ComponentSpecimenModule } | ReturnType<typeof refuse> => {
    const namespace = Object.hasOwn(options.modules, module) ? options.modules[module] : undefined;
    if (!namespace) return refuse(leaf, "module-unavailable", module);
    const value = Object.hasOwn(namespace, name) ? namespace[name] : undefined;
    return renderable(value) ? { value, namespace } : refuse(leaf, "export-unavailable", `${module}#${name}`);
  };
  const bind: ComponentSpecimenPreview["bind"] = (leaf, profile) => {
    if (!leaf.startsWith("components.")) return refuse(leaf, "not-a-component", leaf);
    const component: ResolvedComponent | undefined = profile.components.components[leaf];
    if (!component) return refuse(leaf, "not-chosen", leaf);
    const specifier = component.impl.kind === "package" ? component.impl.module : component.impl.entry;
    const base = exportOf(leaf, specifier, component.impl.export);
    if ("refusal" in base) return base;
    const members: ComponentSpecimenMember[] = [], unbound: { member: string; detail: string }[] = [];
    for (const member of component.descriptor.members) {
      const pointer = Object.hasOwn(component.propMap, member) ? component.propMap[member] : undefined;
      if (!pointer) continue;
      let binding: ReturnType<typeof componentMemberBinding>;
      try { binding = componentMemberBinding(component, member, pointer); }
      catch (error) { unbound.push({ member, detail: error instanceof Error ? error.message : String(error) }); continue; }
      const target = exportOf(leaf, binding.module, binding.name);
      if ("refusal" in target) return target;
      const interaction = binding.intrinsic === true;
      const drawn = !interaction && binding.property !== undefined && (typeof binding.value === "string" || (member.startsWith("state.") && binding.value === true));
      members.push({ member, Component: target.value, specifier: binding.module, exportName: binding.name, props: binding.property ? { [binding.property]: binding.value } : {}, interaction, drawn });
    }
    const source = component.origin.kind === "adopted" ? component.origin.source : component.descriptor.source;
    return { binding: { leaf, source, Component: base.value, specifier, exportName: component.impl.export, exports: base.namespace, members, unbound } };
  };
  return { bind, preview(leaf, profile) {
    const bound = bind(leaf, profile);
    if ("refusal" in bound) return undefined;
    const { binding } = bound;
    const render = options.specimens && Object.hasOwn(options.specimens, leaf) ? options.specimens[leaf] : undefined;
    const component = profile.components.components[leaf]!;
    // Designer samples (and the reasons sample data cannot draw an export) cover Foundry's own package exports only.
    const samples = !render && component.descriptor.source === "foundry" && component.impl.kind === "package";
    const sample = samples ? componentSpecimenSample(sampleKey(binding.specifier, binding.exportName), binding.Component, binding.exports) : undefined;
    const unavailableOf = (row: SpecimenRow) => samples ? componentSpecimenUnavailableReason(sampleKey(row.specifier, row.exportName)) : undefined;
    const rows = render ? [] : specimenRows(binding);
    const unavailable = rows.map(unavailableOf).filter(reason => reason !== undefined);
    const total = render ? 1 : rows.length - unavailable.length;
    const Provider = options.provider;
    // A new selection or library remounts the set, so an earlier failure never outlives the specimens it described.
    return <div data-component-specimens={leaf} data-specimen-source={binding.source} className="flex flex-wrap items-center gap-md">
      <SpecimenSet key={`${profile.selectionHash}:${binding.specifier}#${binding.exportName}`} total={total} unavailable={unavailable[0]}>{(onFail, onProviderFail) => {
        const content = render ? <SpecimenBoundary name={leaf} onFail={onFail}>{render(binding)}</SpecimenBoundary> : defaultSpecimen(binding, sample, unavailableOf, onFail);
        return Provider ? <SpecimenBoundary name={leaf} onFail={onProviderFail}><Provider>{content}</Provider></SpecimenBoundary> : content;
      }}</SpecimenSet>
    </div>;
  } };
}
