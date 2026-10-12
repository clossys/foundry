import { createLandingView } from "./LandingViewContent.js";
import { sectionedViewBlocks } from "./SectionedViewBlocks.js";

/** Ordinary rendering for resolved landing documents. */
export const LandingView = createLandingView(sectionedViewBlocks.ContentSection);
export type { LandingViewCallToAction, LandingViewHeader, LandingViewProps } from "./LandingViewContent.js";
