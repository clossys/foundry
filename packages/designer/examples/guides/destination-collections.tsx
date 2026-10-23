import { Items } from "@clossys/designer/blocks/server";

export default function Example() { return <>
<Items
  arrangement="rows"
  treatment="plate"
  items={[
    { id: "guides", heading: "Guides", description: "Find instructions by topic.", href: "/guides" },
    { id: "support", heading: "Support", description: "Get help with your next step.", href: "/support" },
  ]}
/>
</>; }
