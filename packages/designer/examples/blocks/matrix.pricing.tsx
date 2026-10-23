import { PricingTable } from "@clossys/designer/blocks";
import { Button } from "@clossys/designer/atoms";

function ProductPricing() {
  return (
    <PricingTable
      heading="Pricing heading"
      tiers={[
        {
          id: "starter",
          name: "Tier name one",
          price: "Price one",
          features: ["Feature one", "Feature two"],
          cta: <Button variant="secondary">CTA label one</Button>,
        },
        {
          id: "team",
          name: "Tier name two",
          price: "Price two",
          features: ["Feature one", "Feature two", "Feature three"],
          cta: <Button>CTA label two</Button>,
          isHighlighted: true,
          badge: "Badge text",
        },
      ]}
    />
  );
}

export default ProductPricing;
