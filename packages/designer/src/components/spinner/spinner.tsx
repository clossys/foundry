"use client";
import { type SVGAttributes } from "react";
import { ProgressBar } from "react-aria-components";
import { Icon } from "../icon/index.js";
import { cn } from "../_parts/rail-utils/index.js";
import { useFeedbackCopy, FEEDBACK_COPY_REFS, type FeedbackCopyResolver } from "../_parts/rail-feedback-copy/index.js";
export type SpinnerSize = "sm" | "md" | "lg";
export interface SpinnerProps extends Omit<SVGAttributes<SVGSVGElement>, "children" | "className"> { size?: SpinnerSize; className?: string; label?: string; decorative?: boolean; copy?: FeedbackCopyResolver }
function Spinner({size = "md", className, label: suppliedLabel, decorative = false, copy, ...props}: SpinnerProps) {
  const resolve = useFeedbackCopy(copy);
  const label = decorative ? undefined : suppliedLabel ?? resolve(FEEDBACK_COPY_REFS.spinnerLoading);
  const {"aria-labelledby": labelledBy, "aria-describedby": describedBy, "aria-details": details, "aria-label": _label, ...ring} = props;
  const graphic = <Icon {...ring} asset="assets.icon-loader" decorative size={size} data-slot="spinner" className={cn("motion-safe:animate-(--animate-spin) motion-reduce:animate-none", className)} />;
  return decorative ? graphic : <ProgressBar isIndeterminate aria-label={label} aria-labelledby={labelledBy} aria-describedby={describedBy} aria-details={details} className="inline-block">{graphic}</ProgressBar>;
}
export { Spinner };
