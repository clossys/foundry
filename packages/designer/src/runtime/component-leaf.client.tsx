"use client";
import { createContext, createElement, useContext, type ElementType, type ReactNode } from "react";
import type { CompositeResolved } from "../catalog-core/types.js";
import { componentDescriptorHash, verifyComponentOutput } from "../catalog-core/resolve-components.js";
import { componentSecondaryExports } from "../catalog-core/component-secondary-exports.js";
import { componentMemberBinding } from "../catalog-core/emit-components.js";
import { stableStringify } from "../catalog-core/stable.js";

/** An inspected compiled module; keys are its actual named exports, never guessed leaf aliases. */
export type ConsumerComponentBinding = Readonly<Record<string, unknown>>;
export interface ConsumerComponentSelection {
  readonly profile: Pick<CompositeResolved, "components">;
  readonly selectionHash: string;
  /** Exact chosen impl.module / impl.entry -> installed or consumer-compiled module namespace. */
  readonly modules: Readonly<Record<string, ConsumerComponentBinding>>;
  /** Descriptor identities of the consumer index that imported these modules. */
  readonly descriptors: Readonly<Record<string, string>>;
}
const ComponentSelection = createContext<ConsumerComponentSelection | undefined>(undefined);

/** The consumer's compiled index owns imports. No component implementation defaults live here. */
export function ConsumerComponentProvider({ value, children }: { readonly value: ConsumerComponentSelection; readonly children: ReactNode }) {
  if (value.selectionHash !== value.profile.components.selectionHash) throw new Error("NEED component selection: index selection hash differs");
  return createElement(ComponentSelection.Provider, { value, children });
}

export function SelectedComponentLeaf({ leaf, parts, componentProps }: { readonly leaf: string; readonly parts: readonly string[]; readonly componentProps: Readonly<Record<string, unknown>> }): ReactNode {
  const selection = useContext(ComponentSelection), chosen = selection?.profile.components.components[leaf];
  if (!selection || !chosen) throw new Error(`NEED component selection: ${leaf}`);
  if (selection.selectionHash !== selection.profile.components.selectionHash || selection.descriptors[leaf] !== componentDescriptorHash(chosen.descriptor)) throw new Error(`NEED component selection: stale descriptor for ${leaf}`);
  if (stableStringify(chosen.impl) !== stableStringify(chosen.descriptor.impl) || stableStringify(chosen.propMap) !== stableStringify(chosen.descriptor.propMap)) throw new Error(`NEED component selection: resolved implementation differs for ${leaf}`);
  if (chosen.impl.kind === "source") verifyComponentOutput(chosen.descriptor, selection.profile.components.files);
  const specifier = chosen.impl.kind === "package" ? chosen.impl.module : chosen.impl.entry;
  const namespace = selection.modules[specifier];
  let Component: unknown = namespace?.[chosen.impl.export];
  const nextProps = { ...componentProps };
  if (!parts.length) {
    const mappings = new Map<string, Map<string, ReturnType<typeof componentMemberBinding>>>();
    for (const [member, pointer] of Object.entries(chosen.propMap)) {
      const binding = componentMemberBinding(chosen, member, pointer), segments = member.split(".");
      if (binding.intrinsic || segments.length !== 2) continue;
      const bareRoot = binding.module === specifier && binding.name === chosen.impl.export && !binding.part && !binding.property;
      if (bareRoot && chosen.descriptor.props.includes(segments[0]!)) continue;
      if (!mappings.has(segments[0]!)) mappings.set(segments[0]!, new Map());
      mappings.get(segments[0]!)!.set(segments[1]!, binding);
    }
    for (const [axis, choices] of mappings) {
      if (!(axis in componentProps)) continue;
      const binding = choices.get(String(componentProps[axis]));
      if (!binding) throw new Error(`NEED component selection: unsupported ${leaf}.${axis}`);
      delete nextProps[axis];
      let target = selection.modules[binding.module]?.[binding.name];
      if (binding.part) target = target && (typeof target === "function" || typeof target === "object") && Object.hasOwn(target, binding.part) ? (target as Record<string, unknown>)[binding.part] : undefined;
      if (binding.module !== specifier || binding.name !== chosen.impl.export || binding.part) Component = target;
      if (binding.property) nextProps[binding.property] = binding.value;
    }
  }
  const secondary = parts.length === 1 ? componentSecondaryExports(chosen.descriptor, selection.profile.components.files).find(row => row.name === parts[0]) : undefined;
  if (chosen.impl.kind === "source" && parts.length && !secondary) throw new Error(`NEED component selection: undeclared ${leaf}.${parts.join(".")}`);
  if (secondary) Component = namespace?.[secondary.export];
  else for (const part of parts) Component = Component && (typeof Component === "function" || typeof Component === "object") && Object.hasOwn(Component, part) ? (Component as Record<string, unknown>)[part] : undefined;
  if (typeof Component !== "function" && (!Component || typeof Component !== "object" || !("$$typeof" in Component))) throw new Error(`NEED component selection: ${leaf}${parts.length ? `.${parts.join(".")}` : ""}`);
  return createElement(Component as ElementType, nextProps);
}
