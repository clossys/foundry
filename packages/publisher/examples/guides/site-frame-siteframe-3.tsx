import type { SiteFrameConfig, SiteIconLinkInput } from "@clossys/publisher/web";

const profile: SiteIconLinkInput = {
  href: "https://social.example/profile",
  label: { id: "social.profile" },
  icon: [["path", { d: "M3 12h18" }]],
};

export const publicChrome: SiteFrameConfig["site"] = {
  actions: [{ ...profile, href: "/contact", label: { id: "nav.contact" }, emphasis: "ghost" }],
  footerLinks: [{ href: "/about", label: { id: "footer.about" } }],
  social: { label: { id: "footer.profiles" }, links: [profile] },
};

export default function Example() { return <pre>{JSON.stringify(publicChrome)}</pre>; }
