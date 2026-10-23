import { OrderedStepSequence } from "@clossys/designer/blocks";

export default function Example() { return <>
<OrderedStepSequence
  heading="How it works"
  items={[
    { id: "discover", ordinal: "01", label: "First", heading: "Discover", description: "Understand the need." },
    { id: "decide", ordinal: "02", label: "Second", heading: "Decide", description: "Choose a path." },
  ]}
/>
</>; }
