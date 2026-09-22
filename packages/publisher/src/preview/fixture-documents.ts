import { createElement } from "react";
import { createCopyResolver } from "@clossys/writer";
import type { ComposeDocument } from "../core/index.js";
import type { SectionedViewDocument } from "../core/sectioned-view.js";
import { PREVIEW_FIXTURE_COPY_REGISTRY } from "./fixture-copy-registry.js";

export const PREVIEW_BRAND_LABEL = "Preview";

const ref = (id: string) => ({ id });

export const previewCopyResolver = createCopyResolver(PREVIEW_FIXTURE_COPY_REGISTRY);

export const previewMarketingDocument: ComposeDocument = {
  id: "publisher-preview-marketing",
  channel: "web",
  template: "MarketingView",
  meta: {
    channel: "web",
    title: "Publisher preview — MarketingView",
    description: "Fixture marketing surface for publisher-preview.",
  },
  bindings: [
    { slot: "brand", value: PREVIEW_BRAND_LABEL },
    { slot: "heroEyebrow", value: "Placeholder eyebrow" },
    { slot: "heroHeading", value: "Placeholder hero heading" },
    { slot: "heroDescription", value: "Placeholder hero description." },
    { slot: "featuresHeading", value: "Placeholder features heading" },
    { slot: "ctaHeading", value: "Placeholder CTA heading" },
    { slot: "ctaDescription", value: "Placeholder CTA description." },
  ],
};

export const previewMarketingGroups = [
  {
    slot: "features",
    items: [
      { index: 0, value: "Placeholder feature A" },
      { index: 1, value: "Placeholder feature B" },
    ],
  },
  {
    slot: "faq",
    items: [
      {
        index: 0,
        fields: {
          question: { value: "Placeholder question?" },
          answer: { value: "Placeholder answer." },
        },
      },
    ],
  },
];

export const previewAuthDocument: ComposeDocument = {
  id: "publisher-preview-auth",
  channel: "web",
  template: "AuthView",
  meta: {
    channel: "web",
    title: "Publisher preview — AuthView",
    description: "Fixture auth surface for publisher-preview.",
  },
  bindings: [
    { slot: "brand", value: PREVIEW_BRAND_LABEL },
    { slot: "heading", value: "Sign in" },
    { slot: "description", value: "Welcome back." },
    { slot: "form", value: '<form><label>Email <input type="email" /></label></form>' },
    { slot: "footnote", value: "Fixture footnote." },
  ],
};

export const previewErrorDocument: ComposeDocument = {
  id: "publisher-preview-error",
  channel: "web",
  template: "ErrorView",
  meta: {
    channel: "web",
    title: "Publisher preview — ErrorView",
    description: "Fixture error surface for publisher-preview.",
  },
  bindings: [
    { slot: "status", value: "404" },
    { slot: "title", value: "Page not found" },
    { slot: "description", value: "The page you were looking for does not exist." },
  ],
};

export const previewSectionedDocument: SectionedViewDocument = {
  id: "publisher-preview-sectioned",
  sections: [
    {
      id: "hero",
      kind: "hero",
      ground: "base",
      eyebrow: ref("preview.sectioned.hero.eyebrow"),
      heading: ref("preview.sectioned.hero.heading"),
      description: ref("preview.sectioned.hero.description"),
    },
    {
      id: "features",
      kind: "feature-grid",
      ground: "sunken",
      heading: ref("preview.sectioned.features.heading"),
      description: ref("preview.sectioned.features.description"),
      items: [
        { id: "one", heading: ref("preview.sectioned.features.one.heading"), description: ref("preview.sectioned.features.one.description") },
        { id: "two", heading: ref("preview.sectioned.features.two.heading") },
      ],
    },
    {
      id: "faq",
      kind: "faq",
      ground: "base",
      heading: ref("preview.sectioned.faq.heading"),
      description: ref("preview.sectioned.faq.description"),
      items: [{ id: "one", question: ref("preview.sectioned.faq.one.question"), answer: ref("preview.sectioned.faq.one.answer") }],
    },
    {
      id: "steps",
      kind: "ordered-step-sequence",
      ground: "inverse",
      heading: ref("preview.sectioned.steps.heading"),
      items: [
        {
          id: "one",
          ordinal: ref("preview.sectioned.steps.one.ordinal"),
          label: ref("preview.sectioned.steps.one.label"),
          heading: ref("preview.sectioned.steps.one.heading"),
          description: ref("preview.sectioned.steps.one.description"),
        },
      ],
    },
    {
      id: "status",
      kind: "status-list",
      ground: "base",
      heading: ref("preview.sectioned.status.heading"),
      labels: {
        available: ref("preview.sectioned.status.available"),
        partial: ref("preview.sectioned.status.partial"),
        planned: ref("preview.sectioned.status.planned"),
        dispositions: { "not-offered": ref("preview.sectioned.status.not-offered") },
      },
      groups: [
        {
          id: "core",
          heading: ref("preview.sectioned.status.group.heading"),
          items: [
            { id: "capability", label: ref("preview.sectioned.status.item.label"), state: "available" },
            { id: "unavailable", label: ref("preview.sectioned.status.item.label"), disposition: "not-offered" },
          ],
        },
      ],
    },
    {
      id: "stats",
      kind: "stat-grid",
      ground: "sunken",
      heading: ref("preview.sectioned.stats.heading"),
      items: [
        {
          id: "users",
          label: ref("preview.sectioned.stats.one.label"),
          value: ref("preview.sectioned.stats.one.value"),
          delta: ref("preview.sectioned.stats.one.delta"),
          trend: "up",
        },
      ],
    },
    {
      id: "pricing",
      kind: "pricing",
      ground: "sunken",
      eyebrow: ref("preview.sectioned.pricing.eyebrow"),
      heading: ref("preview.sectioned.pricing.heading"),
      description: ref("preview.sectioned.pricing.description"),
      items: [
        {
          id: "team",
          name: ref("preview.sectioned.pricing.tier.name"),
          price: ref("preview.sectioned.pricing.tier.price"),
          features: [ref("preview.sectioned.pricing.tier.feature")],
          cta: ref("preview.sectioned.pricing.tier.cta"),
        },
      ],
    },
    {
      id: "proof",
      kind: "testimonial",
      ground: "base",
      heading: ref("preview.sectioned.testimonial.heading"),
      items: [
        {
          id: "one",
          quote: ref("preview.sectioned.testimonial.quote"),
          attributorName: ref("preview.sectioned.testimonial.name"),
          attributorRole: ref("preview.sectioned.testimonial.role"),
        },
      ],
    },
    {
      id: "outcomes",
      kind: "stat",
      ground: "inverse",
      heading: ref("preview.sectioned.stat.heading"),
      items: [
        {
          id: "uptime",
          label: ref("preview.sectioned.stat.label"),
          value: ref("preview.sectioned.stat.value"),
          delta: ref("preview.sectioned.stat.delta"),
        },
      ],
    },
  ],
};

export const previewDocumentViewDocument = {
  id: "publisher-preview.document",
  title: ref("preview.document.title"),
  sections: [
    {
      kind: "section" as const,
      id: "details",
      level: 2 as const,
      heading: ref("preview.document.section"),
      blocks: [{ kind: "paragraph" as const, content: [{ kind: "text" as const, text: ref("preview.document.body") }] }],
    },
  ],
};

export const previewDocumentViewAction = createElement("a", { href: "/notes" }, "Back");

export const previewCollectionViewProps = {
  brand: PREVIEW_BRAND_LABEL,
  heading: "Notes",
  focusTargetId: "preview-collection-heading",
  entries: [
    {
      id: "one",
      href: "/notes/one",
      title: "First note",
      date: { dateTime: "2026-09-01", text: "September 1, 2026" },
      summary: "A fixture entry.",
      tags: ["Release", "News"],
    },
  ],
  empty: { title: "Nothing published yet.", description: "Check back soon." },
  pagination: { next: { href: "/notes?page=2", label: "Next page" } },
};

export const previewCaptureViewProps = {
  brand: PREVIEW_BRAND_LABEL,
  heading: "Keep in touch",
  description: "Fixture capture surface.",
  form: createElement("form", { id: "preview-capture-form" }, "Fields"),
};
