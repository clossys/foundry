import { SiteFrame, StatusView } from "@clossys/publisher/web";
const fixtureResolveCopy: import("@clossys/writer").CopyResolver = (ref) => ({
  ref, text: ref.id, recordId: "readme-example", revision: "1", locale: "en",
  source: { kind: "consumer", reference: "readme-example" }, entryId: ref.id,
});
const frame: import("@clossys/publisher/web").SiteFrameInput = {
  shell: {
    brand: { assetId: "brand-mark", label: { id: "brand.home" }, size: "md", variant: "mark" },
    skipLink: { id: "shell.skip" },
    footer: { legal: { entity: { id: "legal.entity" }, links: [{ href: "/privacy", label: { id: "legal.privacy" } }] } },
  },
  resolveCopy: fixtureResolveCopy,
  resolveAsset: () => ({ type: "image", src: "/mark.svg", width: 48, height: 48, alt: "Example" }),
};
const { shell, resolveCopy, resolveAsset } = frame;

export default function Example() {
  return (<>
<SiteFrame shell={shell} resolveCopy={resolveCopy} resolveAsset={resolveAsset}>
  <StatusView
    status={404}
    subtitle="This page does not exist."
    action={<a href="/">Back to home</a>}
    routes={{ label: "Useful destinations", items: [
      { id: "help", heading: "Help", href: "/help" },
      { id: "contact", heading: "Contact", href: "/contact" },
    ] }}
  />
</SiteFrame>

<SiteFrame shell={shell} resolveCopy={resolveCopy} resolveAsset={resolveAsset}>
  <StatusView
    status="Careers"
    subtitle="This page is on its way."
    action={<a href="/">Back to home</a>}
  />
</SiteFrame>
</>);
}
