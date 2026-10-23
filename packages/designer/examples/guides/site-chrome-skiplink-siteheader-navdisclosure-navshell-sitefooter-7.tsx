import { SiteFooter } from "@clossys/designer/shell";

export function Footer() {
  return (
    <SiteFooter
      secondary={
        <SiteFooter.Legal
          entity="Example Co"
          linksLabel="Legal"
          links={[
            { label: "Terms", href: "/terms" },
            { label: "Privacy", href: "/privacy" },
          ]}
        />
      }
    />
  );
}

export default Footer;
