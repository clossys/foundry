/** Selected component binding without specimen samples or preview rendering. */
import type { ComponentType } from "react";
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
  /** Mapped members whose pointer the component dispatcher cannot express (a compound part or a prose note) or whose export is not renderable, with the reason. */
  readonly unbound: readonly { readonly member: string; readonly detail: string }[];
}

/** Why a leaf has no live specimen. The code is stable; `detail` names the leaf, module or export. */
export type ComponentSpecimenRefusalCode = "not-a-component" | "not-chosen" | "module-unavailable" | "export-unavailable";
export interface ComponentSpecimenRefusal {
  readonly leaf: string;
  readonly code: ComponentSpecimenRefusalCode;
  readonly detail: string;
}

const renderable = (value: unknown): value is ComponentSpecimenComponent =>
  typeof value === "function" || (typeof value === "object" && value !== null && "$$typeof" in value);

/** Binds only the caller's actual selected descriptor and exact imported modules. */
export function bindComponentSpecimen(modules: Readonly<Record<string, ComponentSpecimenModule>>, leaf: string, profile: CompositeResolved): { readonly binding: ComponentSpecimenBinding } | { readonly refusal: ComponentSpecimenRefusal } {
  const refuse = (leaf: string, code: ComponentSpecimenRefusalCode, detail: string) => ({ refusal: { leaf, code, detail } });
  const exportOf = (leaf: string, module: string, name: string): { value: ComponentSpecimenComponent; namespace: ComponentSpecimenModule } | ReturnType<typeof refuse> => {
    const namespace = Object.hasOwn(modules, module) ? modules[module] : undefined;
    if (!namespace) return refuse(leaf, "module-unavailable", module);
    const value = Object.hasOwn(namespace, name) ? namespace[name] : undefined;
    return renderable(value) ? { value, namespace } : refuse(leaf, "export-unavailable", `${module}#${name}`);
  };

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
    // A member naming a non-renderable export (a props type such as `SliderPrimitiveProps`) drops that member, named.
    if ("refusal" in target && target.refusal.code === "export-unavailable") { unbound.push({ member, detail: `export-unavailable: ${target.refusal.detail}` }); continue; }
    if ("refusal" in target) return target;
    // A compound sub-part (Disclosure.Group) is a static property of the export, as the emitted adapter dispatches it.
    const part = binding.part === undefined ? target.value : (target.value as unknown as Record<string, unknown>)[binding.part];
    if (!renderable(part)) { unbound.push({ member, detail: `export-unavailable: ${binding.module}#${binding.name}.${binding.part}` }); continue; }
    const interaction = binding.intrinsic === true;
    const drawn = !interaction && binding.property !== undefined && (typeof binding.value === "string" || (member.startsWith("state.") && binding.value === true));
    members.push({ member, Component: part, specifier: binding.module, exportName: binding.name, props: binding.property ? { [binding.property]: binding.value } : {}, interaction, drawn });
  }
  const source = component.origin.kind === "adopted" ? component.origin.source : component.descriptor.source;
  return { binding: { leaf, source, Component: base.value, specifier, exportName: component.impl.export, exports: base.namespace, members, unbound } };
}
