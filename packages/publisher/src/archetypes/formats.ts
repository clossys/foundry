/**
 * Page formats (substrates) Publisher assembles a page onto. Data only: a
 * format declares how the page behaves as a whole (scroll, sticky chrome,
 * aspect ratio), which frames it accepts, the copy budget Writer must respect
 * and the page actions it requires. Section compatibility lives in the
 * Publisher-owned sidecar `section-formats.ts`, never in Designer files.
 */
import type { FormatId } from "../formats/contract.js";

export const PAGE_FORMAT_IDS = ["vertical-page", "slide", "canvas"] as const;
export type PageFormatId = (typeof PAGE_FORMAT_IDS)[number];

/** Page action intents a format can require. Ids only; labels belong to Writer. */
export const CANVAS_ACTION_INTENTS = ["canvas.zoom", "canvas.fit", "canvas.minimap"] as const;
export type PageActionIntent = (typeof CANVAS_ACTION_INTENTS)[number];

export interface PageFormatCopyBudget {
  /** The unit a word budget is counted over: one slide, one canvas board, or none. */
  readonly unit: "slide" | "board" | null;
  /** Maximum words of bound copy per unit (sum over every bound key of one section). */
  readonly maxWords: number | null;
  /** Whether long-form sections (articles, legal prose, FAQs) may be placed at all. */
  readonly longForm: boolean;
}

export interface PageFormat {
  readonly id: PageFormatId;
  /** The existing delivery format leaf this substrate renders through, if any. */
  readonly delivery: FormatId | null;
  readonly scroll: "document" | "none" | "pan-zoom";
  /** Whether a sticky header frame member (`position.sticky`) is allowed. */
  readonly stickyHeader: boolean;
  readonly aspectRatio: { readonly width: number; readonly height: number } | null;
  /** Designer frame slot ids accepted as the page frame. Empty: the format has no shell. */
  readonly frames: readonly `frames.${string}`[];
  /** Whether a page in this format must declare a frame. */
  readonly frameRequired: boolean;
  readonly copy: PageFormatCopyBudget;
  /** Page action intents every page in this format must declare. */
  readonly requiredActions: readonly PageActionIntent[];
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

export const PAGE_FORMATS: Readonly<Record<PageFormatId, PageFormat>> = freeze({
  "vertical-page": {
    id: "vertical-page", delivery: "web.page.responsive", scroll: "document", stickyHeader: true, aspectRatio: null,
    frames: ["frames.site-shell", "frames.app-shell", "frames.auth-shell", "frames.document"], frameRequired: true,
    copy: { unit: null, maxWords: null, longForm: true },
    requiredActions: [],
  },
  slide: {
    id: "slide", delivery: "deck.16x9", scroll: "none", stickyHeader: false, aspectRatio: { width: 16, height: 9 },
    frames: [], frameRequired: false,
    copy: { unit: "slide", maxWords: 60, longForm: false },
    requiredActions: [],
  },
  canvas: {
    id: "canvas", delivery: null, scroll: "pan-zoom", stickyHeader: true, aspectRatio: null,
    frames: ["frames.app-shell"], frameRequired: true,
    copy: { unit: "board", maxWords: 120, longForm: false },
    requiredActions: ["canvas.zoom", "canvas.fit", "canvas.minimap"],
  },
});

export function isPageFormatId(value: unknown): value is PageFormatId {
  return typeof value === "string" && (PAGE_FORMAT_IDS as readonly string[]).includes(value);
}
