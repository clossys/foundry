"use client";
import { createContext } from "react";

/** Why a chosen leaf's preview drew nothing although the host supplied one. Rendered as `data-preview-reason`. */
export type PreviewFailureReason = "specimen-error" | SpecimenUnavailableReason;
/**
 * Why a specimen is not drawn from designer sample content: the export only draws the host's own app-wide
 * toast queue, the member draws the host's own brand assets, the overlay opens only from the host's own trigger, or
 * the export's children are a collection or a render function and no sample content covers it. Rendered as `data-specimen-unavailable`.
 */
export type SpecimenUnavailableReason = "needs-host-queue" | "needs-brand-asset" | "needs-host-trigger" | "needs-sample-content";

/**
 * Set by the leaf cell that shows a host preview. Preview content reports a reason once nothing it holds
 * rendered, and `undefined` once something does again, so the cell never claims "live" for an empty plate.
 */
export const PreviewOutcomeContext = createContext<((reason: PreviewFailureReason | undefined) => void) | undefined>(undefined);
