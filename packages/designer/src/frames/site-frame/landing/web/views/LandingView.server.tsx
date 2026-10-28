import { createLandingView } from "./LandingViewContent.js";
import { sectionedViewBlocks } from "./SectionedViewBlocks.server.js";

/** Server-backed rendering for resolved landing documents. */
export const LandingView = createLandingView(sectionedViewBlocks.ContentSection);
