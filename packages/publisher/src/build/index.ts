/**
 * `@clossys/publisher/build`: the site build's Publisher-owned pieces. It reads only what the caller
 * hands it (resolved choices, never the slot records), and imports nothing from `@clossys/producer`
 * (system.md 14.2). Producer resolves pins and calls it.
 */
export { firstComponentSource } from "./component-export.js";
export { defaultInstallOut, INSTALL_MARKER, installOutRoot } from "./install-out.js";
export { writerText } from "./site-plan.js";
export { buildSlides, DECK_FRAME_ID, slideRoutes, SLIDES_STYLESHEET, slidesStylesheet } from "./slides.js";
export type { SlideInput, SlideRoute, SlidesBuildInput, SlidesBuildResult } from "./slides.js";
export type {
  Json,
  PageCopyBinding,
  PublisherEntry,
  PublisherInput,
  PublisherRoute,
  PublisherRouteSlot,
  WriterInput,
  WriterRecord,
  WriterSectionBinding,
} from "./site-plan.js";
