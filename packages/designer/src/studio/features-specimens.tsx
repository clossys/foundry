/** Synthetic Features samples, bound through the same section renderer as consumers. */
import type { RuntimeJson } from "../catalog-core/runtime-ports.js";
import type { ImageResource } from "../catalog-assets/media.js";
import type { FeatureSectionLayout } from "../blocks/features/types.js";
import { featuresInputs, renderFeaturesSection } from "../runtime/sections/features.js";
import type { SectionRenderInput } from "../runtime/sections/group-a-content.js";

export const FEATURES_SPECIMEN_LAYOUTS = ["grid", "list", "split", "bento", "tabs", "alternating", "scroll"] as const satisfies readonly FeatureSectionLayout[];

const diagram = {
  kind: "illustration", width: 960, height: 600,
  alt: "ExampleCo. workspace with an overview and three connected steps",
  src: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600" viewBox="0 0 960 600"><rect width="960" height="600" rx="24" fill="#f3f4f6"/><rect x="64" y="64" width="832" height="100" rx="16" fill="#d1d5db"/><path d="M240 320h480" stroke="#6b7280" stroke-width="8"/><g fill="#9ca3af"><rect x="96" y="236" width="224" height="224" rx="24"/><rect x="368" y="236" width="224" height="224" rx="24"/><rect x="640" y="236" width="224" height="224" rx="24"/></g></svg>')}`,
} satisfies ImageResource;

/** Data is JSON, never a React-node substitute for runtime content. */
export const featuresSpecimenContent = {
  header: { eyebrow: "ExampleCo.", heading: "One place to move work forward", description: "A shared view of the details, decisions and next steps." },
  items: [
    { id: "overview", heading: "See the whole picture", description: "Bring current work and the next steps into a single view.", figure: { kind: "image", resource: { ...diagram } } },
    { id: "decisions", heading: "Keep decisions close", description: "Add the context your team needs alongside each item.", figure: { kind: "image", resource: { ...diagram, alt: "ExampleCo. decisions beside their related work" } } },
    { id: "progress", heading: "Make progress visible", description: "Follow each step from a first idea to a shared outcome.", figure: { kind: "image", resource: { ...diagram, alt: "ExampleCo. progress across three connected steps" } } },
  ],
} satisfies Readonly<Record<string, RuntimeJson>>;

/** Public sample API for the Studio dispatcher; defaults to the authored bento specimen. */
export function featuresSpecimenInput(layout: FeatureSectionLayout = "bento"): SectionRenderInput {
  return {
    fill: { leaf: "sections.features", ...featuresInputs },
    selection: { leaf: "sections.features", members: [`layout.${layout}`] },
    content: Object.fromEntries(Object.entries(featuresSpecimenContent).map(([slot, value]) => [slot, { value }])),
  } as unknown as SectionRenderInput;
}

export function FeaturesSpecimen({ layout = "bento" }: { layout?: FeatureSectionLayout }) {
  return <>{renderFeaturesSection(featuresSpecimenInput(layout))}</>;
}
