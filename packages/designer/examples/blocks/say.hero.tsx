import { Hero } from "@clossys/designer/blocks";
import { Button } from "@clossys/designer/atoms";

function LandingHero() {
  return (
    <Hero
      eyebrow="Eyebrow text"
      heading="Heading text"
      description="Subheading copy goes here."
      actions={<Button>CTA label</Button>}
    />
  );
}

export default LandingHero;
