import { ContentSection, Items } from "@clossys/designer/blocks";

function SplitSection() {
  return (
    <ContentSection
      layout="split-start"
      size="standard"
      eyebrow="Eyebrow text"
      heading="Section heading"
      media={<img src="/media.png" alt="Media description" />}
    >
      <Items
        arrangement="rows"
        treatment="rule"
        columns={1}
        items={[
          { id: "one", heading: "Topic one" },
          { id: "two", heading: "Topic two" },
        ]}
      />
    </ContentSection>
  );
}

export default SplitSection;
