// Generated from pinned Foundry Publisher and Designer candidates. Run npm run generate:studio-map.
import type { ComponentType } from 'react';
import type { StudioShellProps } from '../frames/studio-shell';
import Frame0 from "../frames/studio-shell";
import Section0 from "../sections/studio-page-header";
import Section1 from "../sections/studio-home";
import Section2 from "../sections/module-outline";
import Section3 from "../sections/module-checks";
import Section4 from "../sections/studio-page-tabs";
import Section5 from "../sections/studio-slot-groups";
import Section6 from "../sections/studio-leaf-header";
import Section7 from "../sections/studio-specimen";
import Section8 from "../sections/studio-options";
import Section9 from "../sections/studio-checks";
import Section10 from "../sections/studio-contract";
import Section11 from "../sections/studio-history";
import Section12 from "../sections/studio-references";

/** Pinned page frame per frame slot. */
export const studioFrames: Record<string, ComponentType<StudioShellProps>> = {
  "frames.studio-shell": Frame0,
};
/** Pinned section per section slot; each takes one prop, named by its contract input. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each section types its own input; the assembly binds it by name.
export const studioSections: Record<string, ComponentType<any>> = {
  "sections.studio.page-header": Section0,
  "sections.studio.home": Section1,
  "sections.module.outline": Section2,
  "sections.module.checks": Section3,
  "sections.studio.page-tabs": Section4,
  "sections.studio.slot-groups": Section5,
  "sections.studio.leaf-header": Section6,
  "sections.studio.specimen": Section7,
  "sections.studio.options": Section8,
  "sections.studio.checks": Section9,
  "sections.studio.contract": Section10,
  "sections.studio.history": Section11,
  "sections.studio.references": Section12,
};
