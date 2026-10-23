import type { SiteFrameConfig } from "@clossys/publisher/web";

const mobileFrame: SiteFrameConfig = {
  // The registered image is the complete logo asset, with its own plate.
  brand: { assetId: "brand-logo", label: { id: "brand.home" }, size: "md", variant: "mark", plate: "self" },
  skipLink: { id: "shell.skipLink" },
  origin: "https://example.com",
  site: {
    nav: {
      label: { id: "nav.label" }, triggerLabel: { id: "nav.menu" },
      links: [{ href: "/about", label: { id: "nav.about" } }],
    },
    actions: [{
      href: "/contact", label: { id: "nav.contact" }, emphasis: "primary",
      icon: [["path", { d: "M4 12h16m-6-6 6 6-6 6" }]],
    }],
  },
  legal: { entity: { id: "legal.entity" }, links: [{ href: "/privacy", label: { id: "legal.privacy" } }] },
};

export default function Example() { return <pre>{JSON.stringify(mobileFrame)}</pre>; }
