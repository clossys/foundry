import type { LayoutBreakpoint } from "../layouts/contract.js";
import type { ArrangementModel, LayoutId } from "../layouts/ids.js";

export const FORMAT_IDS = ["web.page.responsive", "email.html", "image.og", "document.pdf-a4", "video.16x9", "deck.16x9"] as const;
export type FormatId = (typeof FORMAT_IDS)[number];
/** Closed delivery inventory. Registration is not evidence that an exporter exists. */
export const FORMAT_DELIVERY_IDS = {
  "web.page.responsive": ["static-site-bundle"],
  "deck.16x9": ["pdf", "pptx", "google-slides", "link"],
  "email.html": ["html", "text"],
  "image.og": ["png", "jpg", "webp", "svg"],
  "document.pdf-a4": ["pdf", "docx"],
  "video.16x9": ["mp4", "gif"],
} as const;
export type DeliveryId = typeof FORMAT_DELIVERY_IDS[FormatId][number];
export type SlideFidelity = "editable" | "flat";
export interface FormatDelivery {
  readonly id: DeliveryId;
  readonly label: string;
  readonly status: "built" | "concept-only";
  readonly fidelityChoices?: readonly SlideFidelity[];
}
export interface PublisherDeliveryChoice {
  readonly id: DeliveryId;
  /** Required explicitly for PPTX and Google Slides; there is no default. */
  readonly fidelity?: SlideFidelity;
}
export type FormatMedium = "screen" | "email" | "image" | "document" | "video" | "deck";
export type FormatSize =
  | { readonly kind: "responsive"; readonly breakpoints: readonly `tokens.breakpoint.${LayoutBreakpoint}`[] }
  | { readonly kind: "fixed"; readonly unit: "px"; readonly width: number; readonly height?: number }
  | { readonly kind: "paper"; readonly unit: "mm"; readonly width: number; readonly height: number }
  | { readonly kind: "aspect-ratio"; readonly width: number; readonly height: number };

/** Generation configuration only; no renderer, instance or audience content is stored here. */
export interface FormatLeaf {
  readonly id: FormatId;
  readonly medium: FormatMedium;
  readonly family: string;
  readonly label: string;
  readonly status: "built" | "concept";
  readonly outputType: "html" | "png" | "pdf" | "mp4" | "slides";
  readonly size: FormatSize;
  readonly deliveries: readonly FormatDelivery[];
  readonly fps?: number;
  readonly arrangement: ArrangementModel;
  readonly allowedCompositions: readonly LayoutId[];
  readonly heldCompositions: readonly LayoutId[];
  readonly frames: readonly `frames.${string}`[];
  readonly usedByPacks: readonly string[];
}
/** Medium > family > format leaf. Neither group may contain another group level. */
export interface FormatIA {
  readonly nodes: readonly {
    readonly id: FormatMedium;
    readonly label: string;
    readonly children: readonly { readonly id: string; readonly label: string; readonly leaves: readonly FormatId[] }[];
  }[];
}
export interface FormatFinding {
  readonly code: "id" | "contract" | "ia";
  readonly subject: string;
  readonly message: string;
}
export interface FormatBindingFinding {
  readonly path: "format" | "layout" | "frame";
  readonly message: string;
}
