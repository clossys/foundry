import { HeroView } from "@clossys/publisher/web";

const brand: React.ReactNode = "Example Studio"; // the caller's brand mark, for example a Designer `Brandmark`
const backdrop: React.ReactNode = <div aria-hidden="true">Backdrop</div>; // a dark visual, for example a scrimmed image
const Link: React.FC<{ href: string; buttonVariant: "primary"; children: React.ReactNode }> = ({ href, children }) => <a href={href}>{children}</a>; // Designer's `Link`, from its `/atoms` barrel

export function DarkHomePage() {
  return (
    <HeroView
      brand={brand}
      headerAction={
        <Link href="/start" buttonVariant="primary">
          Start
        </Link>
      }
      heading="A page that says one thing"
      backdrop={backdrop}
      ground="inverse"
      footer="surface"
      legal={{ entity: "Example Co", links: [{ label: "Privacy", href: "/privacy" }] }}
    />
  );
}

export default DarkHomePage;
