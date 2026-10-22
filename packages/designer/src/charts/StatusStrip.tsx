"use client";
import { StatusView } from "./internal/signature-views.js";
import { useInspection } from "./internal/use-inspection.js";
import type { StatusStripProps } from "./internal/signature-types.js";
export type {
  StatusStripProps,
  StatusStripSegment,
} from "./internal/signature-types.js";

/** Proportional status intervals with labelled patterns and explicit unknown gaps. */
export function StatusStrip(props: StatusStripProps) {
  return <StatusView props={props} interaction={useInspection(props)} />;
}
