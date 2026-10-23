import { ContentSection, FeatureGrid, MediaFigure } from "@clossys/designer/blocks";

function ProductSection() {
  return (
    <ContentSection eyebrow="Eyebrow text" heading="Section heading" description="One supporting line.">
      <FeatureGrid items={[{ id: "one", heading: "Item heading", description: "Item copy." }]} />
      <MediaFigure caption="Caption text">
        <img src="/media.png" alt="Media description" />
      </MediaFigure>
    </ContentSection>
  );
}

export default ProductSection;
