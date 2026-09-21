import { Faq, FeatureGrid, Hero, OrderedStepSequence, StatusList, Stat } from "@clossys/designer/blocks";
import { createSectionedView } from "./SectionedViewContent.js";

/** Ordinary Designer-backed rendering for a resolved SectionedViewDocument. */
export const SectionedView = createSectionedView({ Hero, FeatureGrid, Faq, OrderedStepSequence, StatusList, Stat });
export type { SectionedViewLandmark, SectionedViewProps } from "./SectionedViewContent.js";
