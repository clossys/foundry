import { HeroView } from "@clossys/publisher/web";

const brand: React.ReactNode = "Example Studio"; // the caller's brand mark, for example a Designer `Brandmark`

export function HomePage() {
  return (
    <HeroView
      brand={brand}
      headerAction={<a href="/start">Start</a>}
      heading="A page that says one thing"
      description="One supporting line."
      legal={{ entity: "Example Co", links: [{ label: "Privacy", href: "/privacy" }] }}
    />
  );
}

export default HomePage;
