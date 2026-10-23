import { FeatureGrid } from "@clossys/designer/blocks";

function ProductFeatures() {
  return (
    <FeatureGrid
      heading="Grid heading"
      description="Grid description."
      items={[
        { id: "one", heading: "Feature heading one", description: "Feature description one." },
        { id: "two", heading: "Feature heading two", description: "Feature description two." },
        { id: "three", heading: "Feature heading three", description: "Feature description three." },
      ]}
    />
  );
}

export default ProductFeatures;
