import { createSectionedView } from "./SectionedViewContent.js";
import { sectionedViewBlocks } from "./SectionedViewBlocks.server.js";

/** Server-safe Designer-backed rendering for a resolved SectionedViewDocument. */
export const SectionedView = createSectionedView(sectionedViewBlocks);
export type { SectionedViewLandmark, SectionedViewProps } from "./SectionedViewContent.js";
