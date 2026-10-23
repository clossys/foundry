const fixtureResolveCopy: import("@clossys/writer").CopyResolver = (ref) => ({
  ref, text: ref.id, recordId: "readme-example", revision: "1", locale: "en",
  source: { kind: "consumer", reference: "readme-example" }, entryId: ref.id,
});
const fixtureFrame: import("@clossys/publisher/web").SiteFrameInput = {
  shell: {
    brand: { assetId: "brand-mark", label: { id: "brand.home" }, size: "md", variant: "mark" },
    skipLink: { id: "shell.skip" },
    footer: { legal: { entity: { id: "legal.entity" }, links: [{ href: "/privacy", label: { id: "legal.privacy" } }] } },
  },
  resolveCopy: fixtureResolveCopy,
  resolveAsset: () => ({ type: "image", src: "/mark.svg", width: 48, height: 48, alt: "Example" }),
};

import { NotFoundDocument } from "@clossys/publisher/web";
import type { SiteFrameInput } from "@clossys/publisher/web";

const frame: SiteFrameInput = fixtureFrame; // built from the configured copy, not from the request

export default function GlobalNotFound() {
  return (
    <NotFoundDocument
      lang="en"
      documentTitle={{ page: "Page not found", brand: "Example Studio" }}
      icon={{ href: "/icon.svg", type: "image/svg+xml" }}
      stylesheets={["/site.css"]}
      {...frame}
      status="404"
      subtitle="This page does not exist."
      action={<a href="/" className="bg-accent">Back to home</a>}
    />
  );
}
