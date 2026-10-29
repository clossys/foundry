/**
 * The one public surface runtime registry, shipped through `@clossys/designer/frames`
 * (SURFACE_RUNTIME_POINTER). Hosts build ConsumerRuntimePorts.renderers from it; the
 * manifest producer (catalog-core/surface-runtime-manifest) names the same pointer.
 */
import { createElement, type ReactNode } from "react";
import type { RuntimeRenderInput } from "../catalog-core/runtime-ports.js";
import { mergeRendererGroups, surfaceRendererId, SURFACE_RUNTIME_POINTER, type SurfaceRendererGroup } from "./contract.js";
import { SelectedComponents, requireComponentIndex } from "#designer-component-selection";
import { frameRenderers } from "./frames/index.js";
import { sectionRenderers } from "./sections/index.js";

const renderers = mergeRendererGroups(frameRenderers, sectionRenderers);
export const surfaceRuntimeRenderers: SurfaceRendererGroup = Object.fromEntries(Object.entries(renderers).map(([leaf, entry]) => [leaf, { ...entry, render: input => input.components === undefined ? entry.render(input) : createElement(SelectedComponents, { components: input.components }, entry.render(input)) }]));

/** Leaf → registry pointer, the input planSurfaceRuntime takes. */
export function surfaceRuntimePointers(): Readonly<Record<string, typeof SURFACE_RUNTIME_POINTER>> {
  return Object.fromEntries(Object.keys(surfaceRuntimeRenderers).map(leaf => [leaf, SURFACE_RUNTIME_POINTER]));
}
/** ConsumerRuntimePorts.renderers for the given leaves (all registered leaves by default). */
export function surfaceRuntimeCallbacks(leaves: readonly string[] = Object.keys(surfaceRuntimeRenderers)): Record<string, (input: RuntimeRenderInput<ReactNode>) => ReactNode> {
  const callbacks: Record<string, (input: RuntimeRenderInput<ReactNode>) => ReactNode> = {};
  for (const leaf of leaves) {
    const entry = surfaceRuntimeRenderers[leaf];
    if (!entry) throw new TypeError(`surface runtime: no package renderer for ${leaf}`);
    callbacks[surfaceRendererId(leaf)] = input => {
      requireComponentIndex(input.components);
      return entry.render(input);
    };
  }
  return callbacks;
}
export { SURFACE_RUNTIME_POINTER, surfaceRendererId, mergeRendererGroups, runtimeValue, runtimeText, runtimeRecord, runtimeMember } from "./contract.js";
export type { SurfaceRuntimeLeaf, SurfaceRuntimeRenderer, SurfaceRendererEntry, SurfaceRendererGroup } from "./contract.js";
