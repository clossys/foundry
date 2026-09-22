import { createSectionedView } from "./SectionedViewContent.js";
import { sectionedViewBlocks } from "./SectionedViewBlocks.js";

/** Ordinary Designer-backed rendering for a resolved SectionedViewDocument. */
export const SectionedView = createSectionedView(sectionedViewBlocks);
export type { SectionedViewLandmark, SectionedViewProps } from "./SectionedViewContent.js";
