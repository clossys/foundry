import {
  FeatureGrid,
  Hero,
  Items,
  OrderedStepSequence,
  PricingTable as DesignerPricingTable,
  SectionHeader,
  SECTION_GROUND_CLASSES,
  Stat,
  StatusList,
  Testimonial as DesignerTestimonial,
} from "@clossys/designer/blocks";
import type { SectionedViewBlockSet } from "./SectionedViewContent.js";
import { createContentSectionBlock } from "./SectionedViewContentSection.js";

type PricingTableProps = Parameters<SectionedViewBlockSet["PricingTable"]>[0];
type TestimonialProps = Parameters<SectionedViewBlockSet["Testimonial"]>[0];

function PricingTable({ id, eyebrow, heading, description, items, headingLevel, ground }: PricingTableProps) {
  return (
    <div id={id} className={SECTION_GROUND_CLASSES[ground].surface}>
      {eyebrow ? <SectionHeader density="standard" ground={ground} eyebrow={eyebrow} /> : null}
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

function Testimonial(props: TestimonialProps) {
  return <DesignerTestimonial quote={props.quote} attributorName={props.attributorName} attributorRole={props.attributorRole} />;
}

/** Designer-backed blocks for the ordinary (client) SectionedView entry. */
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
