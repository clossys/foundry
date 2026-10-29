/** Standalone server components stay hook-free; selected rendering enters the client runtime. */
import { createElement, lazy, type ReactNode } from "react";
import type { RuntimeRenderInput } from "../catalog-core/runtime-ports.js";

const ClientSurfaceRuntime = lazy(async () => ({ default: (await import("../runtime/SurfaceRuntime.client.js")).SurfaceRuntime }));

/** This implementation is reachable only by native standalone server components. */
export function selectedComponent<T>(_name: string, standalone: T, _members: readonly string[] = []): T {
  return standalone;
}
export function renderWithSelectedComponents(leaf: string, input: RuntimeRenderInput<ReactNode>, render: (input: RuntimeRenderInput<ReactNode>) => ReactNode): ReactNode {
  return input.components === undefined ? render(input) : createElement(ClientSurfaceRuntime, { leaf, input });
}
