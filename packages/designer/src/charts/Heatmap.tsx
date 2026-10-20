"use client";
import { HeatmapView } from "./internal/signature-views.js";
import { useInspection } from "./internal/use-inspection.js";
import type { HeatmapProps } from "./internal/signature-types.js";
export type { HeatmapProps } from "./internal/signature-types.js";

/** Sequential magnitude grid or categorical identity grid with keyboard inspection. */
export function Heatmap(props: HeatmapProps) {
  return <HeatmapView props={props} interaction={useInspection(props)} />;
}
