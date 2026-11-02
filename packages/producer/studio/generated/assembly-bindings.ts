// Generated Studio DRAFT preview from explicit native bindings; unapproved and not release qualified.
import type { ComponentType } from 'react';
import type { StudioShellProps } from '../frames/studio-shell';
import Frame0 from "../frames/studio-shell";
import Section0 from "../sections/module-checks";
import Section1 from "../sections/module-explorer";
import Section2 from "../sections/module-outline";
import Section3 from "../sections/studio-agent-gallery";
import Section4 from "../sections/studio-checks";
import Section5 from "../sections/studio-contract";
import Section6 from "../sections/studio-history";
import Section7 from "../sections/studio-home";
import Section8 from "../sections/studio-leaf-header";
import Section9 from "../sections/studio-options";
import Section10 from "../sections/studio-publications";
import Section11 from "../sections/studio-references";
import Section12 from "../sections/studio-specimen";

/** Draft preview page frame per frame slot. */
export const studioFrames: Record<string, ComponentType<StudioShellProps>> = {
  "frames.studio-shell": Frame0,
};
/** Draft preview section per section slot; each takes one prop, named by its contract input. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each section types its own input; the assembly binds it by name.
export const studioSections: Record<string, ComponentType<any>> = {
  "sections.module.checks": Section0,
  "sections.module.explorer": Section1,
  "sections.module.outline": Section2,
  "sections.studio.agent-gallery": Section3,
  "sections.studio.checks": Section4,
  "sections.studio.contract": Section5,
  "sections.studio.history": Section6,
  "sections.studio.home": Section7,
  "sections.studio.leaf-header": Section8,
  "sections.studio.options": Section9,
  "sections.studio.publications": Section10,
  "sections.studio.references": Section11,
  "sections.studio.specimen": Section12,
};
