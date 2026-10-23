import { PricingTable } from "@clossys/designer/blocks";
import { Button } from "@clossys/designer/atoms";

function TextComparison() {
  return <PricingTable heading="Tier details" tiers={[
    { id: "one", name: "Tier one", price: "Amount one", features: ["Feature one"], cta: <Button>Choose one</Button> },
    { id: "two", name: "Tier two", price: "Amount two", features: ["Feature two"], cta: <Button>Choose two</Button> },
  ]} comparison={{ groups: [{ id: "details", label: "Included details", rows: [
    { id: "capacity", label: "Capacity", cells: { one: { kind: "text", text: "First allowance" }, two: { kind: "text", text: "Second allowance" } } },
    { id: "support", label: "Support", cells: { one: { kind: "text", text: "Written guidance" }, two: { kind: "text", text: "Guided assistance" } } },
  ] }] }} />;
}

export default TextComparison;
