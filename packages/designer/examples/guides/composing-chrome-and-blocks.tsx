import { SiteHeader, SiteFooter } from "@clossys/designer/shell";
import { Hero, FeatureGrid } from "@clossys/designer/blocks";
import { Button, Link } from "@clossys/designer/atoms";

function MarketingPage() {
  return (
    <>
      <SiteHeader
        brand={<Link href="/" variant="standalone">Brand name</Link>}
        actions={<Button>CTA label</Button>}
      />
      <main>
        <Hero
          heading="Heading text"
          description="Subheading copy goes here."
          actions={<Button>CTA label</Button>}
        />
        <FeatureGrid
          heading="Grid heading"
          items={[
            { id: "one", heading: "Feature heading one", description: "Feature description one." },
            { id: "two", heading: "Feature heading two", description: "Feature description two." },
          ]}
        />
      </main>
      <SiteFooter
        secondary={<span>Secondary text goes here.</span>}
      />
    </>
  );
}

export default MarketingPage;
