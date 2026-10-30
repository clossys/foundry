/**
 * The one public surface runtime registry, shipped through `@clossys/designer/frames`
 * (SURFACE_RUNTIME_POINTER). Hosts build ConsumerRuntimePorts.renderers from it; the
 * manifest producer (catalog-core/surface-runtime-manifest) names the same pointer.
 */
import { createElement, type ReactNode } from "react";
import { ConsumerComponentProvider } from "./component-leaf.client.js";
import type { RuntimeRenderInput } from "../catalog-core/runtime-ports.js";
import { mergeRendererGroups, surfaceRendererId, SURFACE_RUNTIME_POINTER, type SurfaceRendererGroup } from "./contract.js";
import { frameRenderers } from "./frames/index.js";
import { sectionRenderers } from "./sections/index.js";

export const surfaceRuntimeRenderers: SurfaceRendererGroup = mergeRendererGroups(frameRenderers, sectionRenderers);

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
      // A client host may already own the provider outside runtime assembly.
      if (!input.componentIndex) return entry.render(input);
      const value = { ...input.componentIndex, profile: input.profile };
      return createElement(ConsumerComponentProvider, { value, children: entry.render(input) });
    };
  }
  return callbacks;
}
export { SURFACE_RUNTIME_POINTER, surfaceRendererId, mergeRendererGroups, runtimeValue, runtimeText, runtimeRecord, runtimeMember } from "./contract.js";
export type { SurfaceRuntimeLeaf, SurfaceRuntimeRenderer, SurfaceRendererEntry, SurfaceRendererGroup } from "./contract.js";

export { ConsumerComponentProvider };
export type { ConsumerComponentBinding, ConsumerComponentSelection } from "./component-leaf.client.js";
