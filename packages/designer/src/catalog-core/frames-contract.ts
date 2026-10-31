import type { FrameStageContract } from "./body-substrate.js";
import type { TailwindBreakpoint } from "./breakpoints.js";
/** A frame owns page chrome or an unanchored overlay, never section content. */
export interface LandmarkSpec {
  slot: string;
  role: "banner" | "navigation" | "main" | "complementary" | "contentinfo" | "region";
  /** Banner and contentinfo are page-level; nested navigation stays named. */
  topLevel: boolean;
  nameRequired: boolean;
  id?: string;
  tabIndex?: -1;
}

export interface FrameContract {
  kind: "frame";
  /** Absent means stage capability is unspecified, never implicitly flow or canvas. */
  stage?: FrameStageContract;
  root: "html" | "div" | "header" | "nav" | "aside" | "footer" | "dialog";
  /** Ordered page landmarks, including landmarks supplied through slots. */
  landmarks: readonly LandmarkSpec[];
  slots: readonly {
    id: string;
    required: boolean;
    accepts: "view" | "host-node" | `components.${string}` | "sections.*";
  }[];
  /** Closed configuration values use axis.value names. Header position.sticky/static is independent of its surface. */
  members: { mode: "closed"; names: readonly string[] };
  /** State belongs to the host; fills must not persist these ports themselves. */
  statePorts: readonly {
    id: string;
    type: "boolean" | "number" | "string";
    values?: readonly string[];
  }[];
  rendering: "server" | "client";
  /** Tailwind screens the frame adapts at; fixed, never themes leaves. */
  breakpoints: readonly TailwindBreakpoint[];
  allowedReads: {
    themes: readonly `themes.${string}`[];
    assets: readonly `assets.${string}`[];
    /** Canonical repository source paths of permitted package-private modules; never consumer assets. */
    privateInternal?: readonly string[];
  };
  composes?: readonly (`components.${string}` | `frames.${string}`)[];
  /** The main landmark id targeted by the shell's first, focus-visible link. */
  skipTarget?: string;
}
