"use client";

import type { ReactNode } from "react";
import type { RuntimeRenderInput } from "../catalog-core/runtime-ports.js";
import { surfaceRuntimeCallbacks, surfaceRuntimeRenderers, surfaceRendererId } from "./index.js";

/** Keeps the interactive adapters, AppFrame and FrameSlots in the client graph. */
export function SurfaceRuntime({ leaf, input }: { readonly leaf: string; readonly input: RuntimeRenderInput<ReactNode> }): ReactNode {
  const entry = surfaceRuntimeRenderers[leaf];
  if (!entry) throw new TypeError(`surface runtime: no package renderer for ${leaf}`);
  return surfaceRuntimeCallbacks([leaf])[surfaceRendererId(leaf)]!(input);
}
