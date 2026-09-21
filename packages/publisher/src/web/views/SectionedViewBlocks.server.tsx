import {
  Faq,
  FeatureGrid,
  Hero,
  OrderedStepSequence,
  PricingTable as DesignerPricingTable,
  SECTION_GROUND_CLASSES,
  Stat,
  StatusList,
} from "@clossys/designer/blocks/server";
import type { SectionedViewBlockSet } from "./SectionedViewContent.js";
import { ServerTestimonial } from "./ServerTestimonial.js";

type PricingTableProps = Parameters<SectionedViewBlockSet["PricingTable"]>[0];
type TestimonialProps = Parameters<SectionedViewBlockSet["Testimonial"]>[0];

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

function Testimonial(props: TestimonialProps) {
  return <ServerTestimonial quote={props.quote} attributorName={props.attributorName} attributorRole={props.attributorRole} />;
}

/** Server-safe Designer-backed blocks for the react-server SectionedView entry. */
export const sectionedViewBlocks: SectionedViewBlockSet = {
  Hero,
  FeatureGrid,
  Faq,
  OrderedStepSequence,
  StatusList,
  Stat,
  PricingTable,
  Testimonial,
};
