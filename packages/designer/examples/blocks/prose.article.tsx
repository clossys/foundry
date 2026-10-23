import { ArticleBody, SectionFrame } from "@clossys/designer/blocks";

function ArticlePage() {
  return (
    <SectionFrame measure="prose">
      <ArticleBody>
        <h2>Section heading text</h2>
        <p>Body copy goes here.</p>
        <ul>
          <li>List item text</li>
        </ul>
      </ArticleBody>
    </SectionFrame>
  );
}

export default ArticlePage;
