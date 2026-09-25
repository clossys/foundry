import { createElement } from "react";
import type { ReactElement } from "react";
import type { ComposeDocument } from "../core/index.js";
import type { ResolvedSurfaceGroup } from "../core/index.js";
import { ErrorView } from "../web/views/ErrorView.js";
import { PREVIEW_BRAND_LABEL } from "./fixture-documents.js";
import { previewCopyString } from "./fixture-copy-registry.js";

/**
 * Fixture `ComposeDocument`s for `templates/site`'s own routes (issue
 * #1208), one per `web-route-manifest.json` entry — every route there
 * names `MarketingView`, so each fixture below binds the identical set of
 * `MarketingView` slots `templates/site/app/*.tsx` itself resolves through
 * `renderWebDocument`, just with this preview's own fixture copy instead
 * of a consumer's `clossys/publisher/surfaces/*.json`. `templates/site/app/not-found.tsx`
 * is the one route that calls `ErrorView` directly rather than going
 * through `renderWebDocument` + a named template — `notFoundElement`
 * below mirrors that exact call shape.
 *
 * All prose is looked up from `fixture-copy-registry.ts` by id, never
 * typed here — see that file's own top comment.
 */

export interface SitePageFixture {
  /** The route id, matching `web-route-manifest.json`'s own `"id"` field. */
  routeId: string;
  /** A short slug for this preview's own output filename — never the route id itself, which contains "/". */
  slug: string;
  document: ComposeDocument;
  groups: ResolvedSurfaceGroup[];
}

function marketingDoc(id: string, copyPrefix: string, options: { withFeatures?: boolean; withFaq?: boolean } = {}): ComposeDocument {
  const bindings: ComposeDocument["bindings"] = [
    { slot: "brand", value: PREVIEW_BRAND_LABEL },
    { slot: "heroEyebrow", copyId: `${copyPrefix}.hero.eyebrow` },
    { slot: "heroHeading", copyId: `${copyPrefix}.hero.heading` },
    { slot: "heroDescription", copyId: `${copyPrefix}.hero.description` },
    { slot: "ctaHeading", copyId: `${copyPrefix}.cta.heading` },
    { slot: "ctaDescription", copyId: `${copyPrefix}.cta.description` },
  ];
  if (options.withFeatures) {
    bindings.push({ slot: "featuresHeading", copyId: "preview.site.home.features.heading" });
  }
  return {
    id,
    channel: "web",
    template: "MarketingView",
    meta: {
      channel: "web",
      title: previewCopyString(`${copyPrefix}.meta.title`),
      description: previewCopyString(`${copyPrefix}.meta.description`),
    },
    bindings,
  };
}

function marketingGroups(options: { withFeatures?: boolean; withFaq?: boolean } = {}): ResolvedSurfaceGroup[] {
  const groups: ResolvedSurfaceGroup[] = [
    {
      slot: "features",
      items: options.withFeatures
        ? [
            { index: 0, value: previewCopyString("preview.site.home.features.one.heading") },
            { index: 1, value: previewCopyString("preview.site.home.features.two.heading") },
          ]
        : [],
    },
  ];
  if (options.withFaq) {
    groups.push({
      slot: "faq",
      items: [
        {
          index: 0,
          fields: {
            question: { value: previewCopyString("preview.site.home.faq.question") },
            answer: { value: previewCopyString("preview.site.home.faq.answer") },
          },
        },
      ],
    });
  }
  return groups;
}

export const SITE_PAGE_FIXTURES: readonly SitePageFixture[] = [
  {
    routeId: "/",
    slug: "home",
    document: marketingDoc("publisher-preview-site-home", "preview.site.home", { withFeatures: true, withFaq: true }),
    groups: marketingGroups({ withFeatures: true, withFaq: true }),
  },
  {
    routeId: "/about",
    slug: "about",
    document: marketingDoc("publisher-preview-site-about", "preview.site.about"),
    groups: marketingGroups(),
  },
  {
    routeId: "/contact",
    slug: "contact",
    document: marketingDoc("publisher-preview-site-contact", "preview.site.contact"),
    groups: marketingGroups(),
  },
  {
    routeId: "/privacy",
    slug: "privacy",
    document: marketingDoc("publisher-preview-site-privacy", "preview.site.privacy"),
    groups: marketingGroups(),
  },
  {
    routeId: "/terms",
    slug: "terms",
    document: marketingDoc("publisher-preview-site-terms", "preview.site.terms"),
    groups: marketingGroups(),
  },
];

/** Mirrors `templates/site/app/not-found.tsx`'s own direct `ErrorView` call — that route never goes through `renderWebDocument`, so neither does this fixture. */
export function buildNotFoundElement(): ReactElement {
  return createElement(ErrorView, {
    status: 404,
    title: previewCopyString("preview.site.not-found.title"),
    description: previewCopyString("preview.site.not-found.description"),
    action: createElement("a", { href: "/" }, previewCopyString("preview.site.not-found.action")),
  });
}
