/**
 * Compile-time assertions for the catalog entry types. This file is compiled
 * by the package typecheck (it is not a test file), so each
 * `@ts-expect-error` below fails the build if the guarded rule stops holding.
 * It is never imported.
 */
import type { ComponentEntry, BlockEntry, IconPlacement, TokenEntry, TokenPlacement } from "./types.js";

const tokenBase = {
  id: "--color-line-panel",
  label: "Line panel",
  l1: "color",
  l2: "line",
  lever: true,
  modes: "per-mode",
  reference: { light: { alias: "--color-line-base" }, dark: { alias: "--color-line-base" } },
  inTheme: true,
  utilities: [],
  pairs: [],
  sourceRows: [20],
  previousIds: [],
  lifecycle: "draft",
  ownerReview: "not-yet-reviewed",
} as const;

/** A brand-optional token names its fallback. */
export const optionalWithFallback: TokenEntry = { ...tokenBase, tier: "brand-optional", fallback: { alias: "--color-line-base" } };
// @ts-expect-error A brand-optional token without a fallback is refused.
export const optionalWithoutFallback: TokenEntry = { ...tokenBase, tier: "brand-optional" };
// @ts-expect-error Only a brand-optional token carries a fallback.
export const requiredWithFallback: TokenEntry = { ...tokenBase, tier: "brand-required", fallback: { alias: "--color-line-base" } };
// @ts-expect-error A per-mode token needs a light and a dark reference.
export const perModeWithOneValue: TokenEntry = { ...tokenBase, tier: "brand-required", reference: { literal: "1px" } };

/** L2 ids are scoped to their L1. */
export const shapeFocus: TokenPlacement = { l1: "shape", l2: "focus" };
// @ts-expect-error `icon` is a shape L2, not a color L2.
export const misplacedToken: TokenPlacement = { l1: "color", l2: "icon" };
// @ts-expect-error `theme` is an interface L2, not a subject L2.
export const misplacedIcon: IconPlacement = { l1: "subject", l2: "theme" };

const blockBase = {
  id: "say.chapter",
  label: "Chapter",
  l1: "explain",
  l2: "sections",
  export: "Chapter",
  built: "yes",
  stableCandidate: false,
  signedOff: false,
  ownerReview: "not-yet-reviewed",
} as const;

/** A deprecated block names its successor. */
export const deprecatedWithSuccessor: BlockEntry = { ...blockBase, lifecycle: "deprecated", successor: "say.takeaway" };
// @ts-expect-error A deprecated block without a successor is refused.
export const deprecatedWithoutSuccessor: BlockEntry = { ...blockBase, lifecycle: "deprecated" };
// @ts-expect-error Block ids keep a known shape prefix.
export const unknownBlockPrefix: BlockEntry = { ...blockBase, id: "card.chapter", lifecycle: "draft" };

// @ts-expect-error Component ids keep the `<verb>.<name>` shape.
export const componentWithoutPrefix: ComponentEntry["id"] = "button";
