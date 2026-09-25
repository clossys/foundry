import { Button } from "@clossys/designer/atoms";
import { ArticleBody, Hero, SectionFrame } from "@clossys/designer/blocks";

export default function Page() {
  return (
    <main>
      <Hero heading="One clear promise" actions={<Button variant="primary">Start</Button>} />
      <SectionFrame measure="prose">
        <ArticleBody>
          <h2>How it works</h2>
          <p>Every band on this page comes from one component library.</p>
        </ArticleBody>
      </SectionFrame>
    </main>
  );
}
