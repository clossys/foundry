// Generated from pinned Foundry Publisher candidates and the Studio library selection. Run npm run generate:studio-map.
import type { ComponentType } from 'react';
import type { StudioShellProps } from '../frames/studio-shell';
import Frame0 from "../frames/studio-shell";
import Section0 from "../sections/studio-home";
import Section1 from "../sections/module-outline";
import Section2 from "../sections/module-checks";
import Section3 from "../sections/studio-agent-gallery";
import Section4 from "../sections/studio-leaf-header";
import Section5 from "../sections/studio-specimen";
import Section6 from "../sections/studio-options";
import Section7 from "../sections/studio-checks";
import Section8 from "../sections/studio-contract";
import Section9 from "../sections/studio-history";
import Section10 from "../sections/studio-references";
import Section11 from "../sections/module-explorer";
import Section12 from "../sections/studio-publications";

/** Pinned page frame per frame slot. */
export const studioFrames: Record<string, ComponentType<StudioShellProps>> = {
  "frames.studio-shell": Frame0,
};
/** Pinned section per section slot; each takes one prop, named by its contract input. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each section types its own input; the assembly binds it by name.
export const studioSections: Record<string, ComponentType<any>> = {
  "sections.studio.home": Section0,
  "sections.module.outline": Section1,
  "sections.module.checks": Section2,
  "sections.studio.agent-gallery": Section3,
  "sections.studio.leaf-header": Section4,
  "sections.studio.specimen": Section5,
  "sections.studio.options": Section6,
  "sections.studio.checks": Section7,
  "sections.studio.contract": Section8,
  "sections.studio.history": Section9,
  "sections.studio.references": Section10,
  "sections.module.explorer": Section11,
  "sections.studio.publications": Section12,
};
