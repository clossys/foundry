import type { FrameStageContract } from "./body-substrate.js";
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
  root: "div" | "header" | "nav" | "aside" | "footer" | "dialog";
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
  breakpoints: readonly `tokens.breakpoint.${string}`[];
  layers: readonly `tokens.z-index.${string}`[];
  allowedReads: {
    tokens: readonly `tokens.${string}`[];
    assets: readonly `assets.${string}`[];
  };
  composes?: readonly (`components.${string}` | `frames.${string}`)[];
  /** The main landmark id targeted by the shell's first, focus-visible link. */
  skipTarget?: string;
}
