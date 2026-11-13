/**
 * Package-owned surface runtime renderers. A renderer turns one selected
 * library fill into real package UI: `(RuntimeRenderInput) => node`. Content arrives as
 * JSON (RuntimeContent per contract slot); a Frame's behaviour arrives on `input.host`
 * (RuntimeFrameHost). Renderers compose registered components and blocks only.
 */
import type { ReactNode } from "react";
import type { RuntimeJson, RuntimeRenderInput } from "../catalog-core/runtime-ports.js";
import type { SpecimenDataset } from "../studio/specimen-dataset.js";

export type SurfaceRuntimeLeaf = `frames.${string}` | `sections.${string}`;
export type SurfaceRuntimeRenderer = (input: RuntimeRenderInput<ReactNode>) => ReactNode;
export interface SurfaceRendererEntry {
  readonly leaf: SurfaceRuntimeLeaf;
  readonly render: SurfaceRuntimeRenderer;
  /** JSON content per contract slot drawn from the shared synthetic dataset (Designer preview). */
  readonly sample: (dataset: SpecimenDataset) => Readonly<Record<string, RuntimeJson>>;
}
/** One group's renderers, keyed by leaf. Section groups A/B/C each own one of these. */
export type SurfaceRendererGroup = Readonly<Record<string, SurfaceRendererEntry>>;

/** Every renderer ships from this one public registry export; the manifest producer names it. */
export const SURFACE_RUNTIME_POINTER = Object.freeze({ module: "@clossys/designer/frames", export: "surfaceRuntimeRenderers" } as const);
/** Renderer descriptor id for a leaf; ConsumerRuntimePorts.renderers is keyed by it. */
export function surfaceRendererId(leaf: string): `package:${string}` { return `package:${leaf}`; }

/** Merge renderer groups, refusing a leaf claimed twice or filed under the wrong key. */
export function mergeRendererGroups(...groups: readonly SurfaceRendererGroup[]): SurfaceRendererGroup {
  const merged: Record<string, SurfaceRendererEntry> = {};
  for (const group of groups) for (const [leaf, entry] of Object.entries(group)) {
    if (entry.leaf !== leaf) throw new TypeError(`surface runtime: ${leaf} is registered under the wrong key`);
    if (Object.hasOwn(merged, leaf)) throw new TypeError(`surface runtime: ${leaf} has two renderers`);
    merged[leaf] = entry;
  }
  return Object.freeze(merged);
}

/** Resolved JSON for one content slot, or undefined when the selection left it empty. */
export function runtimeValue(input: Pick<RuntimeRenderInput<unknown>, "content">, slot: string): RuntimeJson | undefined {
  return Object.hasOwn(input.content, slot) ? input.content[slot]!.value : undefined;
}
export function runtimeText(input: Pick<RuntimeRenderInput<unknown>, "content">, slot: string): string | undefined {
  const value = runtimeValue(input, slot);
  return typeof value === "string" && value.trim() ? value : undefined;
}
export function runtimeRecord(input: Pick<RuntimeRenderInput<unknown>, "content">, slot: string): Readonly<Record<string, RuntimeJson>> | undefined {
  const value = runtimeValue(input, slot);
  return value && typeof value === "object" && !Array.isArray(value) ? value as Readonly<Record<string, RuntimeJson>> : undefined;
}
/** The selected member of one axis (e.g. `layout` → `layout.immersive`), else the fallback. */
export function runtimeMember<T extends string>(input: Pick<RuntimeRenderInput<unknown>, "selection">, axis: string, fallback: T): T {
  const selected = input.selection.members.find(member => member.startsWith(axis + "."));
  return (selected ? selected.slice(axis.length + 1) : fallback) as T;
}
