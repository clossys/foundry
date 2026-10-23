import { PricingTable } from "@clossys/designer/blocks";
import { Button } from "@clossys/designer/atoms";

function EntitlementComparison() {
  return <PricingTable heading="Tier entitlements" tiers={[
    { id: "one", name: "Tier one", price: "Amount one", features: ["Feature one"], cta: <Button>Choose one</Button> },
    { id: "two", name: "Tier two", price: "Amount two", features: ["Feature two"], cta: <Button>Choose two</Button>, isHighlighted: true, badge: "Featured tier" },
  ]} comparison={{
    featuredLabel: "Featured tier",
    markLabels: ["Not included", "First mark", "Second mark", "Third mark", "Included"],
    keyLabel: "Entitlement key",
    groups: [{ id: "features", label: "Feature access", rows: [
      { id: "first", label: "Feature one", cells: { one: { kind: "mark", included: true }, two: { kind: "mark", included: true } } },
      { id: "second", label: "Feature two", cells: { one: { kind: "mark", included: false }, two: { kind: "mark", included: true } } },
    ] }],
  }} />;
}

export default EntitlementComparison;
