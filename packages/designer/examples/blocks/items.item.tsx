import { Item, Items } from "@clossys/designer/blocks/server";

function RelatedResources() {
  return (
    <div>
      <Item id="notice" heading="Reference" meta="Updated" badge={{ label: "Live", tone: "success" }} treatment="plain" size="standard" ground="base" />
      <Items
        arrangement="columns"
        columns={2}
        treatment="plate"
        headingLevel={3}
        items={[
          { id: "guide", heading: "Guide", description: "Read the reference.", href: "/guide", badge: { label: "Live" } },
          { id: "examples", heading: "Examples", description: "Explore examples.", href: "/examples", meta: "Reference" },
        ]}
      />
    </div>
  );
}

export default RelatedResources;
