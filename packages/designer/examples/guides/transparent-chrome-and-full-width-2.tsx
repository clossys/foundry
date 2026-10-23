import { SiteFooter, SiteHeader } from "@clossys/designer/shell";

export function InverseChrome() {
  return (
    <div className="bg-surface-inverse text-ink-on-inverse">
      <SiteHeader surface="transparent" tone="inverse" brand={<a href="/">Example Co</a>} />
      <SiteFooter
        ground="transparent-inverse"
        secondary={<SiteFooter.Legal entity="Example Co" links={[{ label: "Privacy", href: "/privacy" }]} />}
      />
    </div>
  );
}

export default InverseChrome;
