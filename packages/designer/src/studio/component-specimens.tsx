"use client";
import { Component as ReactComponent, createElement, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import { componentMemberBinding } from "../catalog-core/emit-components.js";
import type { CompositeResolved, ResolvedComponent } from "../catalog-core/index.js";

/** The named exports of one module the host imported, e.g. `import * as components from "@clossys/designer/components"`. */
export type ComponentSpecimenModule = Readonly<Record<string, unknown>>;
/** A renderable implementation export as the host's React sees it. */
export type ComponentSpecimenComponent = ComponentType<Record<string, unknown>>;

/** One contract member bound to the implementation export and props the adopted descriptor maps it to. */
export interface ComponentSpecimenMember {
  readonly member: string;
  readonly Component: ComponentSpecimenComponent;
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
   * Specimen content by leaf. A leaf without one renders the implementation export once, labelled with the leaf,
   * then once per drawn member, labelled with its member key. Data-driven components (charts, tables, lists)
   * need an entry here: a bare render has no data to draw.
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
class SpecimenBoundary extends ReactComponent<{ readonly name: string; readonly children?: ReactNode }, { readonly failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  override componentDidCatch(_error: unknown, _info: ErrorInfo): void { /* The marker below is the record; Studio keeps running. */ }
  override render(): ReactNode { return this.state.failed ? <span hidden data-specimen-error={this.props.name} /> : this.props.children; }
}

function defaultSpecimen(binding: ComponentSpecimenBinding): ReactNode {
  const rows = [{ member: binding.leaf, Component: binding.Component, props: {} }, ...binding.members.filter(member => member.drawn)];
  return rows.map(row => <div key={row.member} data-component-specimen={row.member}>
    <SpecimenBoundary name={row.member}>{createElement(row.Component, { ...row.props }, row.member)}</SpecimenBoundary>
  </div>);
}

/**
 * Live component specimens for Studio, bound from the host's adopted library. Each chosen component leaf
 * resolves to the implementation export its descriptor names and every mapped member's dispatch, the same
 * rule the emitted component index follows. A leaf that cannot bind stays unavailable with a named refusal;
 * nothing falls back to another library or to a placeholder.
 */
export function componentSpecimenPreview(options: ComponentSpecimenOptions): ComponentSpecimenPreview {
  const refuse = (leaf: string, code: ComponentSpecimenRefusalCode, detail: string) => ({ refusal: { leaf, code, detail } });
  const exportOf = (leaf: string, module: string, name: string): { value: ComponentSpecimenComponent } | ReturnType<typeof refuse> => {
    const namespace = Object.hasOwn(options.modules, module) ? options.modules[module] : undefined;
    if (!namespace) return refuse(leaf, "module-unavailable", module);
    const value = Object.hasOwn(namespace, name) ? namespace[name] : undefined;
    return renderable(value) ? { value } : refuse(leaf, "export-unavailable", `${module}#${name}`);
  };
  const bind: ComponentSpecimenPreview["bind"] = (leaf, profile) => {
    if (!leaf.startsWith("components.")) return refuse(leaf, "not-a-component", leaf);
    const component: ResolvedComponent | undefined = profile.components.components[leaf];
    if (!component) return refuse(leaf, "not-chosen", leaf);
    const base = exportOf(leaf, component.impl.kind === "package" ? component.impl.module : component.impl.entry, component.impl.export);
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
      members.push({ member, Component: target.value, props: binding.property ? { [binding.property]: binding.value } : {}, interaction, drawn });
    }
    const source = component.origin.kind === "adopted" ? component.origin.source : component.descriptor.source;
    return { binding: { leaf, source, Component: base.value, members, unbound } };
  };
  return { bind, preview(leaf, profile) {
    const bound = bind(leaf, profile);
    if ("refusal" in bound) return undefined;
    const render = options.specimens && Object.hasOwn(options.specimens, leaf) ? options.specimens[leaf] : undefined;
    const content = render ? <SpecimenBoundary name={leaf}>{render(bound.binding)}</SpecimenBoundary> : defaultSpecimen(bound.binding);
    const Provider = options.provider;
    return <div data-component-specimens={leaf} data-specimen-source={bound.binding.source} className="flex flex-wrap items-center gap-md">
      {Provider ? <Provider>{content}</Provider> : content}
    </div>;
  } };
}
