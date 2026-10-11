import type { SectionedViewHeroSection, ResolvedSectionedViewSection } from "./sectioned-view.js";
export const compactHero: SectionedViewHeroSection = { id: "hero", kind: "hero", heading: { id: "sample.heading" }, compact: true };
export const defaultHero: SectionedViewHeroSection = { ...compactHero, compact: false };
// @ts-expect-error — compact is a boolean, never an authored sizing string.
export const invalidCompactHero: SectionedViewHeroSection = { ...compactHero, compact: "compact" };
export const resolvedCompactHero: ResolvedSectionedViewSection = { id: "hero", kind: "hero", ground: "inverse", heading: "Sample", compact: true };
