import { Matrix } from "@clossys/designer/blocks";

export default function Example() { return <>
<Matrix
  sides={[
    { id: "first", label: "First option", heading: "A shared record", points: ["One source", "Clear dates"] },
    { id: "second", label: "Second option", heading: "A shared view", points: ["One view", "Clear owners"] },
  ]}
  featured="second"
/>
</>; }
