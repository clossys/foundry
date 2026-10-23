import { SiteFrame, AuthView } from "@clossys/publisher/web";
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
const form = <form><button type="submit">Sign in</button></form>;

export default function Example() {
  return (<>
<SiteFrame shell={shell} resolveCopy={resolveCopy} resolveAsset={resolveAsset}>
  <AuthView heading="Sign in" description="Use your work email." form={form} />
</SiteFrame>
</>);
}
