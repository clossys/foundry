// Supply required ArticleBody children (TS2741).
import { MarketingChapter } from "@clossys/designer/blocks";
import { ArticleBody } from "@clossys/designer/blocks";

function FoldChapter() {
  return (
    <MarketingChapter title="Chapter heading" description="Supporting line.">
      <ArticleBody>{/* long-form prose */}Example chapter content.</ArticleBody>
    </MarketingChapter>
  );
}

export default FoldChapter;
