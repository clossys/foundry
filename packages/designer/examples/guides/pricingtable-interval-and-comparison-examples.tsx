import { PricingTable } from "@clossys/designer/blocks";
import { Button } from "@clossys/designer/atoms";

function IntervalAmounts() {
  return <PricingTable heading="Tier amounts" interval="second" tiers={[
    {
      id: "one", name: "Tier one", features: ["Feature one"],
      priceByInterval: {
        first: { amount: "Amount one", priceText: "Amount one per first interval" },
        second: { amount: "Amount two", priceText: "Amount two per second interval", note: "Interval note" },
      },
      cta: <Button>Choose tier one</Button>,
    },
    {
      id: "two", name: "Tier two", price: "Fixed amount",
      features: ["Feature two"], cta: <Button>Choose tier two</Button>,
    },
  ]} />;
}

export default IntervalAmounts;
