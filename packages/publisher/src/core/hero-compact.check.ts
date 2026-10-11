import type { SectionedViewHeroSection, ResolvedSectionedViewSection } from "./sectioned-view.js";
export const compactHero: SectionedViewHeroSection = { id: "hero", kind: "hero", heading: { id: "sample.heading" }, size: "compact" };
export const defaultHero: SectionedViewHeroSection = { ...compactHero, size: "display" };
// @ts-expect-error The unreleased compact boolean is replaced by the closed size axis.
export const invalidCompactHero: SectionedViewHeroSection = { ...compactHero, compact: true };
// @ts-expect-error Hero size has no standard setting.
export const invalidHeroSize: SectionedViewHeroSection = { ...compactHero, size: "standard" };
export const resolvedCompactHero: ResolvedSectionedViewSection = { id: "hero", kind: "hero", ground: "inverse", heading: "Sample", size: "compact" };
