import { Card } from "@example/legacy-ui/atoms";
import { Hero } from "@clossys/designer/blocks";

export default function Page() {
  return (
    <main>
      <Hero heading="One clear promise" />
      <Card>A second design system mounted beside the first.</Card>
    </main>
  );
}
