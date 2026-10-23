import { SiteFooter, SiteHeader } from "@clossys/designer/shell";

export function Chrome() {
  return (
    <>
      <SiteHeader surface="transparent" brand={<a href="/">Example Co</a>} />
      <SiteFooter
        ground="transparent"
        secondary={<SiteFooter.Legal entity="Example Co" links={[{ label: "Privacy", href: "/privacy" }]} />}
      />
    </>
  );
}

export default Chrome;
