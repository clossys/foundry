import { ArticleBody, SectionFrame, Stat } from "@clossys/designer/blocks";

function MarketingChapter() {
  return (
    <SectionFrame ground="base" measure="prose">
      <ArticleBody>
        <h2>Section heading text</h2>
        <p>Body copy goes here.</p>
      </ArticleBody>
    </SectionFrame>
  );
}

export default MarketingChapter;
export { Stat };
