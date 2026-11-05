/** Runtime-only server facade; Studio preview samples belong to the client registry. */
import { createElement, lazy } from "react";
import frameSlots from "../catalog/slots/frames.json" with { type: "json" };
import sectionSlots from "../catalog/slots/sections.json" with { type: "json" };
import { surfaceRendererId, SURFACE_RUNTIME_POINTER, type SurfaceRendererEntry, type SurfaceRuntimeLeaf } from "./contract.js";
import { documentRenderer } from "./frames/document.js";
import { siteShellRuntimeRenderer } from "./frames/site-shell.js";
import { authShellRenderer } from "./frames/auth-shell.js";

// As with the public server AppFrame, raw react-server imports do not evaluate the
// client module. RSC bundlers retain its use-client boundary and the existing
// AppFrame/FrameSlots boundaries below it.
const ClientSurfaceRuntime = lazy(async () => ({ default: (await import("./SurfaceRuntime.client.js")).SurfaceRuntime }));

/** Server rendering needs leaf/render, never Studio's dataset-bound sample callback. */
export type ServerSurfaceRendererEntry = Pick<SurfaceRendererEntry, "leaf" | "render">;
const serverFrames: Readonly<Record<string, ServerSurfaceRendererEntry>> = {
  [documentRenderer.leaf]: documentRenderer,
  [siteShellRuntimeRenderer.leaf]: siteShellRuntimeRenderer,
  [authShellRenderer.leaf]: authShellRenderer,
};

/** The same catalog keys as the client registry, with interactive rendering behind a client reference. */
// Inputs cross that reference intact. Hosts must obey ordinary RSC serialization
// rules; this facade does not turn server-origin callbacks into client functions.
export const surfaceRuntimeRenderers: Readonly<Record<string, ServerSurfaceRendererEntry>> = Object.freeze(Object.fromEntries(
  [...frameSlots, ...sectionSlots].map(({ id: leaf }): [string, ServerSurfaceRendererEntry] => [leaf, serverFrames[leaf] ?? {
    leaf: leaf as SurfaceRuntimeLeaf,
    render: input => {
      if (input.componentIndex) throw new Error("NEED component selection: install the module index in the client host before rendering server surface references");
      return createElement(ClientSurfaceRuntime, { leaf, input });
    },
  }]),
));

export function surfaceRuntimePointers(): Readonly<Record<string, typeof SURFACE_RUNTIME_POINTER>> {
  return Object.fromEntries(Object.keys(surfaceRuntimeRenderers).map(leaf => [leaf, SURFACE_RUNTIME_POINTER]));
}

export function surfaceRuntimeCallbacks(leaves: readonly string[] = Object.keys(surfaceRuntimeRenderers)): Record<string, SurfaceRendererEntry["render"]> {
  const callbacks: Record<string, SurfaceRendererEntry["render"]> = {};
  for (const leaf of leaves) {
    const entry = surfaceRuntimeRenderers[leaf];
    if (!entry) throw new TypeError(`surface runtime: no package renderer for ${leaf}`);
    callbacks[surfaceRendererId(leaf)] = entry.render;
  }
  return callbacks;
}

export { SURFACE_RUNTIME_POINTER, surfaceRendererId } from "./contract.js";
