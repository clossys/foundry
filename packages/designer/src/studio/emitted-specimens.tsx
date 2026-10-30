"use client";

import { createElement, forwardRef, isValidElement, type ReactNode } from "react";
import type { CompositeResolved } from "../catalog-core/types.js";
import type { ResolvedComponent } from "../catalog-core/resolve-components.js";
import { componentMemberBinding } from "../catalog-core/emit-components.js";
import { importFoundryComponents } from "../importers/foundry-components.js";
import { componentOf } from "../catalog-core/resolve-components.js";
import { surfacePrimary } from "../catalog-core/surface-library.js";
import * as packageComponents from "../components/index.js";
import * as packageCharts from "../charts/index.js";
import * as packageShell from "../shell/index.js";
import { packageSurfacePreview } from "./planned-surface-previews.js";
import type { ComponentSpecimenComponent, ComponentSpecimenModule } from "./component-specimens.js";
import type { DesignerSpecimenContext, DesignerSurfaceSpecimen } from "./DesignerSpecimen.js";

/** Namespaces emitted from the same native selection as profile. No package/default imports are rendering ports. */
export interface EmittedDesignerSpecimenRuntime {
  readonly components: ComponentSpecimenModule;
  readonly surfaces: ComponentSpecimenModule;
  readonly tree?: ComponentSpecimenModule;
  readonly disclosure?: ComponentSpecimenModule;
}

const renderable = (value: unknown): value is ComponentSpecimenComponent => typeof value === "function" || typeof value === "object" && value !== null && "$$typeof" in value;
/** Native component-index export convention, verified against emitComponents in the focused tests. */
const primary = (leaf: string) => leaf.slice("components.".length).split("-").map(part => part[0]!.toUpperCase() + part.slice(1)).join("");

/**
 * Bridge implementation-shaped registry samples to the native emitted contract adapters.
 * Inverting a propMap here is essential: source Badge.variant=default may be contract variant.primary.
 * Every call still executes the selected emitted leaf, including its native provenance stamp.
 */
export function emittedDesignerSpecimenContext(profile: CompositeResolved, runtime: EmittedDesignerSpecimenRuntime): DesignerSpecimenContext {
  const modules: Record<string, Record<string, unknown>> = {};
  const replacements = new Map<unknown, ComponentSpecimenComponent>();
  const originalNamespaces: readonly ComponentSpecimenModule[] = [packageComponents, packageCharts, packageShell];
  const canonical = new Map(importFoundryComponents().fills.map(doc => [doc.$extensions["com.clossys.fill"].slot, componentOf(doc)]));
  const packageElements = new Set(originalNamespaces.flatMap(namespace => Object.values(namespace).filter(renderable)));
  const remap = (node: ReactNode): ReactNode => {
    if (Array.isArray(node)) return node.map(remap);
    if (!isValidElement<Record<string, unknown>>(node)) return node;
    const props = Object.fromEntries(Object.entries(node.props).map(([key, value]) => [key, isValidElement(value) || Array.isArray(value) ? remap(value as ReactNode) : key === "children" && typeof value === "function" ? (...args: unknown[]) => remap(value(...args)) : value]));
    const selected = replacements.get(node.type);
    if (!selected && packageElements.has(node.type as ComponentSpecimenComponent)) {
      const name = originalNamespaces.flatMap(namespace => Object.entries(namespace).filter(([, value]) => value === node.type).map(([name]) => name)).join("/");
      const EmptyState = runtime.surfaces.EmptyState;
      // A shared fixture may include an optional chart or artwork the consumer has not selected.
      // Keep the real parent specimen and expose that missing child through selected NEED chrome.
      if (renderable(EmptyState)) return createElement(EmptyState, { role: "status", title: `NEED: ${name}`, description: "This fixture component is absent from the emitted consumer selection." });
      throw new Error(`NEED: fixture component ${name} is absent from the emitted consumer selection`);
    }
    return createElement(selected ?? node.type, { ...props, key: node.key });
  };
  const bridge = (component: ResolvedComponent, forcedMember?: string): ComponentSpecimenComponent | undefined => {
    const Selected = runtime.components[primary(component.slot)];
    if (!renderable(Selected)) return undefined;
    const members = Object.entries(component.propMap).map(([member, pointer]) => ({ member, binding: componentMemberBinding(component, member, pointer) }));
    const Adapter = forwardRef<unknown, Record<string, unknown>>(function SelectedSpecimen(props, ref) {
      const next: Record<string, unknown> = { ...props };
      // Read each axis from original sample props, just as the native emitter reads each contract axis once.
      for (const { member, binding } of members) {
        if (binding.intrinsic || !binding.property || !Object.hasOwn(props, binding.property) || props[binding.property] !== binding.value) continue;
        const [axis, value] = member.split(".");
        if (!axis || !value) continue;
        delete next[binding.property];
        next[axis] = value;
      }
      if (forcedMember) {
        const [axis, value] = forcedMember.split(".");
        if (axis && value) next[axis] = value;
      }
      if (component.slot === "components.icon" && next.glyph !== undefined) {
        const glyph = JSON.stringify(next.glyph);
        const asset = Object.values(profile.values.members).find(member => member.$type === "glyph" && JSON.stringify(member.value.light) === glyph);
        if (!asset) throw new Error("NEED: specimen glyph is not in the selected consumer assets");
        delete next.glyph;
        next.asset = asset.slot;
      }
      for (const [key, value] of Object.entries(next)) if (isValidElement(value) || Array.isArray(value)) next[key] = remap(value as ReactNode);
      return createElement(Selected, { ...next, ref });
    });
    // Preserve native compound parts; never borrow them from a package module.
    for (const key of Object.keys(Selected)) if (!Object.hasOwn(Adapter, key)) Object.defineProperty(Adapter, key, { value: (Selected as unknown as Record<string, unknown>)[key], configurable: true });
    return Adapter;
  };
  for (const component of Object.values(profile.components.components)) {
    const Adapter = bridge(component);
    if (!Adapter) continue;
    const address = component.impl.kind === "package" ? component.impl.module : component.impl.entry;
    const namespace = modules[address] ??= {};
    namespace[component.impl.export] = Adapter;
    for (const [member, pointer] of Object.entries(component.propMap)) {
      const mapped = componentMemberBinding(component, member, pointer);
      if (mapped.name === component.impl.export || mapped.part) continue;
      const memberAdapter = bridge(component, member);
      if (memberAdapter) (modules[mapped.module] ??= {})[mapped.name] = memberAdapter;
    }
    if (component.slot === "components.navigation-tree") Object.assign(namespace, runtime.tree);
    if (component.slot === "components.disclosure") Object.assign(namespace, runtime.disclosure);
    for (const original of originalNamespaces) {
      // A selected source may use a different export name from the package fixture's implementation.
      const reference = canonical.get(component.slot);
      if (reference) {
        const root = original[reference.impl.kind === "composed" ? "" : reference.impl.export];
        if (renderable(root)) replacements.set(root, Adapter);
        for (const [member, pointer] of Object.entries(reference.propMap)) {
          const name = /(?:^|#)([A-Z][A-Za-z0-9]*)/.exec(pointer)?.[1];
          const part = name && reference.impl.kind !== "composed" && name !== reference.impl.export ? original[name] : undefined;
          const selectedMember = component.propMap[member] ? bridge(component, member) : undefined;
          if (renderable(part) && selectedMember) replacements.set(part, selectedMember);
        }
      }
    }
  }
  const surfaces: Record<string, DesignerSurfaceSpecimen> = {};
  for (const [leaf, selected] of Object.entries(profile.surfaces?.fills ?? {})) {
    const Selected = runtime.surfaces[surfacePrimary(leaf)];
    if (!renderable(Selected)) continue;
    const sample = packageSurfacePreview(selected.document);
    surfaces[leaf] = { descriptorHash: selected.descriptorHash, renderContent: props => createElement(Selected, props), render: () => {
      if ("reason" in sample) throw new Error(`NEED: ${leaf}: ${sample.reason}`);
      const root = sample.render();
      if (!isValidElement<Record<string, unknown>>(root)) throw new Error(`NEED: ${leaf} has no root fixture props`);
      const props = Object.fromEntries(Object.entries(root.props).map(([key, value]) => [key, isValidElement(value) || Array.isArray(value) ? remap(value as ReactNode) : value]));
      // Use the selected runtime surface itself; the registry supplies fixture props only.
      return createElement(Selected, props);
    } };
  }
  return { profile, modules, surfaces, surfaceBindingsOnly: true };
}
