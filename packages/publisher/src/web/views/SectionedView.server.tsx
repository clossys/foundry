import { createSectionedView } from "./SectionedViewContent.js";
import { sectionedViewBlocks } from "./SectionedViewBlocks.server.js";

/** Server-safe Designer-backed rendering for a resolved SectionedViewDocument. */
export const SectionedView = createSectionedView(sectionedViewBlocks);
export type { SectionedViewCallToAction, SectionedViewLandmark, SectionedViewProps } from "./SectionedViewContent.js";
