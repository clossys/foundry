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

import { renderWebDocument } from "@clossys/publisher/web";
import type { SiteFrameInput } from "@clossys/publisher/web";
import type { ComposeDocument } from "@clossys/publisher/core";

const auth: ComposeDocument = { id: "sign-in", channel: "web", template: "AuthView", meta: { channel: "web", title: "Sign in", description: "Welcome" }, bindings: [{ slot: "heading", value: "Sign in" }, { slot: "form", value: "Sign-in form" }] }; // AuthView heading/form bindings, without chrome bindings
const frame: SiteFrameInput = fixtureFrame; // shell and its CopyRef-based copy and asset resolvers
const { element, head } = renderWebDocument(auth, { frame });

export { element, head };
