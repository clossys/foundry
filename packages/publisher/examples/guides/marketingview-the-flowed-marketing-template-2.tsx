import { MarketingView } from "@clossys/publisher/web";

export function AboutPage() {
  return (
    <MarketingView
      brand="Example Studio"
      headerAction={<a href="/contact">Contact</a>}
      ground="transparent"
      heroHeading="About the studio"
      features={[]}
      ctaHeading="Start a project"
    />
  );
}

export default AboutPage;
