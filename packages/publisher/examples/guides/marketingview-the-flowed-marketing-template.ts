const fixtureResolveCopy: import("@clossys/writer").CopyResolver = (ref) => ({
  ref, text: ref.id, recordId: "readme-example", revision: "1", locale: "en",
  source: { kind: "consumer", reference: "readme-example" }, entryId: ref.id,
});
const myCopyResolver = fixtureResolveCopy;

import type { SurfaceDocument } from "@clossys/publisher/core";
import { resolveSurfaceDocument } from "@clossys/publisher/core";
import { renderWebDocument } from "@clossys/publisher/web";

const ref = (id: string) => ({ id });

const acmeMarketingHome: SurfaceDocument = {
  id: "acme.marketing.home",
  channel: "web",
  template: "MarketingView",
  meta: { channel: "web", title: ref("acme.brand"), description: ref("acme.hero.description") },
  bindings: [
    { slot: "brand", copy: ref("acme.brand") },
    { slot: "heroHeading", copy: ref("acme.hero.heading") },
    { slot: "heroDescription", copy: ref("acme.hero.description") },
    { slot: "ctaHeading", copy: ref("acme.cta.heading") },
    // Required repeating slot; an explicitly empty grid is valid.
    { slot: "features", items: [] },
    // A repeating slot — one CopyRef per placeholder feature, in order.
    {
      slot: "faq",
      items: [
        {
          fields: {
            question: { copy: ref("acme.faq.one.question") },
            answer: { copy: ref("acme.faq.one.answer") },
          },
        },
      ],
    },
  ],
};

const resolved = resolveSurfaceDocument(acmeMarketingHome, myCopyResolver);
const { element, head } = renderWebDocument(resolved.document, {
  groups: resolved.groups, // carries the structured FAQ fields
});

export { element, head };
