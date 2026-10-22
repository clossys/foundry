import {
  FeatureGrid,
  Hero,
  Items,
  OrderedStepSequence,
  PricingTable as DesignerPricingTable,
  SECTION_GROUND_CLASSES,
  Stat,
  StatusList,
  Testimonial,
} from "@clossys/designer/blocks/server";
import type { SectionedViewBlockSet } from "./SectionedViewContent.js";
import { createContentSectionBlock } from "./SectionedViewContentSection.js";

type PricingTableProps = Parameters<SectionedViewBlockSet["PricingTable"]>[0];

function PricingTable({ id, eyebrow, heading, description, items, headingLevel, ground }: PricingTableProps) {
  const colors = SECTION_GROUND_CLASSES[ground];
  return (
    <div id={id} className={SECTION_GROUND_CLASSES[ground].surface}>
      {eyebrow ? <p className={`text-caption uppercase tracking-label ${colors.muted}`}>{eyebrow}</p> : null}
      <DesignerPricingTable
        heading={heading}
        description={description}
        headingLevel={headingLevel}
        tiers={items.map((item) => ({
          id: item.id,
          name: item.name,
          price: item.price,
          description: item.description,
          features: item.features,
          cta: item.cta ?? "",
        }))}
      />
    </div>
  );
}

/** Server-safe Designer-backed blocks for the react-server SectionedView entry. */
export const sectionedViewBlocks: SectionedViewBlockSet = {
  Hero,
  FeatureGrid,
  OrderedStepSequence,
  StatusList,
  Stat,
  PricingTable,
  Testimonial,
  ContentSection: createContentSectionBlock(Items),
};
