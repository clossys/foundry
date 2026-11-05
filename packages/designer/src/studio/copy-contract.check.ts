/** Compile-time contract: a host must provide Writer resolution explicitly. */
import { createRouteStudioLabels } from "./route-labels.js";
import type { StudioCopyBinding } from "./copy-binding.js";
import type { DesignerRoutePageProps } from "./route-data.js";
import type { DesignerPageProps } from "./system-canvas/DesignerPage.js";
import type { StudioCanvasProps } from "./types.js";

export function checkRequiredStudioCopy(copy: StudioCopyBinding, serverData: DesignerRoutePageProps["serverData"]) {
  const route: DesignerRoutePageProps = { copy, serverData, initialSession: undefined };
  const studio: StudioCanvasProps = { copy };
  const canvas: DesignerPageProps = { copy };
  void route; void studio; void canvas;
  // @ts-expect-error A route without host copy is not a valid call site.
  const missingRoute: DesignerRoutePageProps = { serverData, initialSession: undefined };
  // @ts-expect-error Standalone studio views require the same host binding.
  const missingStudio: StudioCanvasProps = {};
  // @ts-expect-error The canvas cannot silently infer a binding or locale.
  const missingCanvas: DesignerPageProps = {};
  void missingRoute; void missingStudio; void missingCanvas;
  // @ts-expect-error The label factory never accepts a missing binding.
  createRouteStudioLabels(undefined);
}
