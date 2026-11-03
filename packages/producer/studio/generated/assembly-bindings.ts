// Generated from pinned Foundry Publisher and Designer candidates. Run npm run generate:studio-map.
import { createElement, type ComponentType } from 'react';
import type { StudioShellProps } from '../frames/studio-shell';
import provenance from './studio-provenance.json';
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
/** The generated DOM provenance markers (slot id, candidate file, content hash) one section root carries. */
export type StudioProvenance = Readonly<Record<'data-clossys-slot' | 'data-clossys-candidate' | 'data-clossys-hash', string>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each section types its own input; the assembly binds it by name.
const marked = (Section: ComponentType<any>, marks: StudioProvenance): ComponentType<any> => function Marked(props: object) { return createElement(Section, { ...props, ...marks }); };

/** Pinned section per section slot; each takes one prop, named by its contract input, plus its provenance markers. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each section types its own input; the assembly binds it by name.
export const studioSections: Record<string, ComponentType<any>> = {
  "sections.studio.page-header": marked(Section0, (provenance as Record<string, StudioProvenance>)["sections.studio.page-header"]),
  "sections.studio.home": marked(Section1, (provenance as Record<string, StudioProvenance>)["sections.studio.home"]),
  "sections.module.outline": marked(Section2, (provenance as Record<string, StudioProvenance>)["sections.module.outline"]),
  "sections.module.checks": marked(Section3, (provenance as Record<string, StudioProvenance>)["sections.module.checks"]),
  "sections.studio.page-tabs": marked(Section4, (provenance as Record<string, StudioProvenance>)["sections.studio.page-tabs"]),
  "sections.studio.slot-groups": marked(Section5, (provenance as Record<string, StudioProvenance>)["sections.studio.slot-groups"]),
  "sections.studio.leaf-header": marked(Section6, (provenance as Record<string, StudioProvenance>)["sections.studio.leaf-header"]),
  "sections.studio.specimen": marked(Section7, (provenance as Record<string, StudioProvenance>)["sections.studio.specimen"]),
  "sections.studio.options": marked(Section8, (provenance as Record<string, StudioProvenance>)["sections.studio.options"]),
  "sections.studio.checks": marked(Section9, (provenance as Record<string, StudioProvenance>)["sections.studio.checks"]),
  "sections.studio.contract": marked(Section10, (provenance as Record<string, StudioProvenance>)["sections.studio.contract"]),
  "sections.studio.history": marked(Section11, (provenance as Record<string, StudioProvenance>)["sections.studio.history"]),
  "sections.studio.references": marked(Section12, (provenance as Record<string, StudioProvenance>)["sections.studio.references"]),
};
