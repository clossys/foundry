import { RelationGraph } from "@clossys/designer/blocks";

export default function Example() { return <>
<RelationGraph
  label="Relationships"
  kinds={["block", "pack"] as const}
  nodes={[
    { id: "detail", label: "Detail", kind: "block", href: "/detail" },
    { id: "collection", label: "Collection", kind: "pack" },
  ]}
  edges={[{ from: "collection", to: "detail", label: "contains" }]}
/>
</>; }
