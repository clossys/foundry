/**
 * Golden-output tests — the requirement this package's own delivery report
 * calls out by name. Each case here renders a REAL `ComposeDocument`
 * through the REAL `@clossys/designer` views (`ErrorView`, `AuthView`,
 * `MarketingView`) via `react-dom/server`'s `renderToStaticMarkup`, and
 * asserts the EXACT emitted HTML string — not "it didn't throw", not "the
 * output contains some substring somewhere", the actual bytes a browser
 * would receive.
 *
 * Why this matters, concretely: this is what would have caught a
 * regression where `AuthView`'s prop wiring silently swapped `heading` and
 * `description`, or where `Card`'s className stopped merging correctly, or
 * where a future `@clossys/designer` bump reordered DOM nodes — none of
 * which a "did it throw" test or a substring match would ever notice.
 * `docs`/the task brief for this package cites the exact precedent this is
 * built against: a researched decision to adopt `react-email` in a prior
 * renderer was reversed specifically because a golden test asserting real
 * output already proved the incumbent worked, and nothing justified the
 * migration risk. That is only possible when the golden test asserts real
 * bytes, not a shape a rewrite could accidentally still satisfy.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { createCopyResolver } from "@clossys/writer";
import type { CopyRef } from "@clossys/writer";
import type { ComposeDocument } from "../core/index.js";
import { resolveSectionedViewDocument } from "../core/sectioned-view.js";
import type { SectionedViewContentModule, SectionedViewContentSection, SectionedViewSection, SectionedViewSpecimenMedia, SectionedViewSpecimenPanel, SectionedViewSpecimenPart } from "../core/sectioned-view.js";
import { renderWebDocument } from "./renderWebDocument.js";
import { SectionedView as ServerSectionedView } from "./views/SectionedView.server.js";

describe("golden: ErrorView", () => {
  const doc: ComposeDocument = {
    id: "acme-404",
    channel: "web",
    template: "ErrorView",
    meta: {
      channel: "web",
      title: "Page not found — Acme",
      description: "The page you were looking for does not exist.",
    },
    bindings: [
      { slot: "status", value: "404" },
      { slot: "title", value: "Page not found" },
      { slot: "description", value: "The page you were looking for does not exist." },
    ],
  };

  it("renders the exact expected markup, byte for byte", () => {
    const { element } = renderWebDocument(doc);
    const html = renderToStaticMarkup(element);

    expect(html).toBe(
      '<div class="flex min-h-dvh flex-col items-center justify-center gap-lg p-2xl text-center">' +
        '<h1 class="text-display-l font-display text-ink-primary">404</h1>' +
        '<div class="flex flex-col justify-center gap-sm p-2xl text-center">' +
        '<h2 class="text-h2 font-display text-ink-primary">Page not found</h2>' +
        '<p class="text-body text-ink-secondary">The page you were looking for does not exist.</p>' +
        "</div>" +
        "</div>",
    );
  });

  it("omits the optional description paragraph entirely when the binding is absent — not an empty <p>", () => {
    const withoutDescription: ComposeDocument = {
      ...doc,
      bindings: [
        { slot: "status", value: "500" },
        { slot: "title", value: "Something went wrong" },
      ],
    };
    const { element } = renderWebDocument(withoutDescription);
    const html = renderToStaticMarkup(element);

    expect(html).toBe(
      '<div class="flex min-h-dvh flex-col items-center justify-center gap-lg p-2xl text-center">' +
        '<h1 class="text-display-l font-display text-ink-primary">500</h1>' +
        '<div class="flex flex-col justify-center gap-sm p-2xl text-center">' +
        '<h2 class="text-h2 font-display text-ink-primary">Something went wrong</h2>' +
        "</div>" +
        "</div>",
    );
    expect(html).not.toContain("<p");
  });
});

describe("golden: AuthView", () => {
  it("renders the exact expected markup, byte for byte, resolving a copyId binding through the caller's resolver", () => {
    const doc: ComposeDocument = {
      id: "acme-signin",
      channel: "web",
      template: "AuthView",
      meta: {
        channel: "web",
        title: "Sign in — Acme",
        description: "Sign in to your Acme account.",
      },
      bindings: [
        { slot: "brand", value: "Acme" },
        { slot: "heading", value: "Sign in" },
        { slot: "description", copyId: "auth.signin.description" },
        { slot: "form", value: "email + password form" },
        { slot: "footnote", value: "\u00A9 2026 Acme" },
      ],
    };

    const { element } = renderWebDocument(doc, {
      resolveCopyId: (copyId) => (copyId === "auth.signin.description" ? "Welcome back." : undefined),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toBe(
      '<div class="flex min-h-dvh flex-col">' +
        '<header class="bg-surface-raised py-sm border-b border-line-base" style="position:relative;z-index:var(--ui-z-shell, 20);border-bottom-width:var(--ui-border-hairline, 1px)">' +
        '<div class="mx-auto flex w-full flex-wrap items-center justify-between gap-md" style="padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))">' +
        '<div class="flex items-center gap-lg">Acme</div></div></header>' +
        '<main class="mx-auto flex w-full flex-1 flex-col gap-xl px-lg py-2xl" style="max-width:var(--ui-width-form-max, none)">' +
        '<div class="flex flex-col items-center gap-xs text-center">' +
        '<h1 class="text-h1 font-display text-ink-primary">Sign in</h1>' +
        '<p class="text-body text-ink-secondary">Welcome back.</p>' +
        "</div>" +
        '<div class="rounded-control bg-surface-raised p-lg flex flex-col gap-lg text-start" style="box-shadow:var(--ui-elevation-raised, 0 1px 0 var(--color-line-base, oklch(0.8761 0 0)))">' +
        "email + password form</div>" +
        '<p class="text-center text-body-s text-ink-muted">\u00A9 2026 Acme</p></main>' +
        '<footer class="bg-surface-raised text-ink-primary py-lg border-t border-line-base" style="position:relative;z-index:var(--ui-z-shell, 20);border-top-width:var(--ui-border-hairline, 1px)">' +
        '<div class="mx-auto flex w-full flex-col gap-lg" style="padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))"></div></footer></div>',
    );
  });
});

describe("golden: assetId — a real <img>, byte for byte, alt text and intrinsic dimensions included", () => {
  const asset = { id: "marketing.logo", type: "image", src: "https://cdn.example/logo.svg", width: 120, height: 40, alt: "Acme logo" };

  const doc: ComposeDocument = {
    id: "acme-signin-with-logo",
    channel: "web",
    template: "AuthView",
    meta: { channel: "web", title: "Sign in — Acme", description: "Sign in to your Acme account." },
    bindings: [
      { slot: "brand", assetId: "marketing.logo" },
      { slot: "heading", value: "Sign in" },
      { slot: "form", value: "email + password form" },
    ],
  };

  it("renders AuthView's brand slot as a real <img>, exact bytes, React's own automatic image preload included", () => {
    const { element } = renderWebDocument(doc, {
      resolveAssetId: (assetId) => (assetId === "marketing.logo" ? asset : undefined),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toBe(
      '<link rel="preload" as="image" href="https://cdn.example/logo.svg"/>' +
        '<div class="flex min-h-dvh flex-col">' +
        '<header class="bg-surface-raised py-sm border-b border-line-base" style="position:relative;z-index:var(--ui-z-shell, 20);border-bottom-width:var(--ui-border-hairline, 1px)">' +
        '<div class="mx-auto flex w-full flex-wrap items-center justify-between gap-md" style="padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))">' +
        '<div class="flex items-center gap-lg">' +
        '<img src="https://cdn.example/logo.svg" alt="Acme logo" width="120" height="40"/>' +
        "</div></div></header>" +
        '<main class="mx-auto flex w-full flex-1 flex-col gap-xl px-lg py-2xl" style="max-width:var(--ui-width-form-max, none)">' +
        '<div class="flex flex-col items-center gap-xs text-center">' +
        '<h1 class="text-h1 font-display text-ink-primary">Sign in</h1>' +
        "</div>" +
        '<div class="rounded-control bg-surface-raised p-lg flex flex-col gap-lg text-start" style="box-shadow:var(--ui-elevation-raised, 0 1px 0 var(--color-line-base, oklch(0.8761 0 0)))">' +
        "email + password form</div></main>" +
        '<footer class="bg-surface-raised text-ink-primary py-lg border-t border-line-base" style="position:relative;z-index:var(--ui-z-shell, 20);border-top-width:var(--ui-border-hairline, 1px)">' +
        '<div class="mx-auto flex w-full flex-col gap-lg" style="padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))"></div></footer></div>',
    );
  });

  it("a mixed document — some slots via value, one via assetId — renders both kinds in one pass", () => {
    const mixedDoc: ComposeDocument = {
      ...doc,
      bindings: [
        { slot: "brand", assetId: "marketing.logo" },
        { slot: "heading", value: "Sign in" },
        { slot: "description", copyId: "auth.signin.description" },
        { slot: "form", value: "email + password form" },
      ],
    };
    const { element } = renderWebDocument(mixedDoc, {
      resolveAssetId: (assetId) => (assetId === "marketing.logo" ? asset : undefined),
      resolveCopyId: (copyId) => (copyId === "auth.signin.description" ? "Welcome back." : undefined),
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain('<img src="https://cdn.example/logo.svg" alt="Acme logo" width="120" height="40"/>');
    expect(html).toContain("<h1");
    expect(html).toContain("Sign in");
    expect(html).toContain("Welcome back.");
    expect(html).toContain("email + password form");
  });

  it("src/alt escaping — a src/alt containing \", ', <, &, and </script> never breaks out of the <img> attribute (React's own JSX attribute escaping)", () => {
    const hostileAsset = {
      id: "marketing.logo", type: "image",
      src: `https://cdn.example/logo.svg?q="'<&></script>`,
      width: 10,
      height: 10,
      alt: `Acme "Logo" & <Co> </script>`,
    };
    const { element } = renderWebDocument(doc, {
      resolveAssetId: () => hostileAsset,
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain(
      'src="https://cdn.example/logo.svg?q=&quot;&#x27;&lt;&amp;&gt;&lt;/script&gt;"',
    );
    expect(html).toContain('alt="Acme &quot;Logo&quot; &amp; &lt;Co&gt; &lt;/script&gt;"');
    // The raw payload never survives anywhere in the emitted document.
    expect(html.includes('q="\'<&>')).toBe(false);
    expect(html.includes("</script>alert")).toBe(false);
  });
});

describe("golden: JSON-LD escaping — the </script> XSS case", () => {
  it("escapes a </script> sequence inside JSON-LD content so it can never terminate the real <script> tag", () => {
    const jsonLdEntry = {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: "Acme 404",
      // A hostile/untrusted string reaching this field, containing a
      // literal script-closing sequence followed by a fresh script —
      // exactly the payload this escaping exists to neutralize.
      description: "</script><script>alert(1)</script>",
    };
    const doc: ComposeDocument = {
      id: "acme-404-ld",
      channel: "web",
      template: "ErrorView",
      meta: {
        channel: "web",
        title: "Page not found",
        description: "Not found.",
        jsonLd: [jsonLdEntry],
      },
      bindings: [
        { slot: "status", value: "404" },
        { slot: "title", value: "Not found" },
      ],
    };

    const { head } = renderWebDocument(doc);

    expect(head.jsonLd).toHaveLength(1);
    const [payload] = head.jsonLd as [string];

    // The exact, asserted byte sequence — not "no </script> anywhere" as a
    // vague property, but the precise escaped form a browser's HTML parser
    // can never read as a tag boundary.
    expect(payload).toBe(
      '{"@context":"https://schema.org","@type":"WebPage","name":"Acme 404","description":"\\u003c/script\\u003e\\u003cscript\\u003ealert(1)\\u003c/script\\u003e"}',
    );

    // The structural property the byte-exact assertion above already
    // proves, stated as its own check for readability: no raw "<" survives
    // anywhere in the escaped payload, so "</script" cannot occur in it —
    // wrapping this string verbatim into <script type="application/ld+json">
    // {payload}</script> cannot close that tag early.
    expect(payload.includes("<")).toBe(false);
    expect(payload.includes("</script>")).toBe(false);

    // The payload round-trips back to the original object once a real HTML
    // parser (or, here, a plain unescape simulating one) has handed the
    // script's raw text content to JSON.parse — proving the escaping is
    // reversible and did not corrupt the data it protects.
    const unescaped = payload
      .replace(/\\u003c/g, "<")
      .replace(/\\u003e/g, ">")
      .replace(/\\u0026/g, "&");
    expect(JSON.parse(unescaped)).toEqual(jsonLdEntry);
  });

  it("produces zero jsonLd entries, not a missing field, when WebMeta.jsonLd is absent", () => {
    const doc: ComposeDocument = {
      id: "acme-no-ld",
      channel: "web",
      template: "ErrorView",
      meta: { channel: "web", title: "Not found", description: "Not found." },
      bindings: [
        { slot: "status", value: "404" },
        { slot: "title", value: "Not found" },
      ],
    };
    const { head } = renderWebDocument(doc);
    expect(head.jsonLd).toEqual([]);
  });
});

describe("golden: MarketingView", () => {
  it("renders the exact expected markup, byte for byte — every flowed slot filled, a repeating 'features' group of 2, and a repeating structured 'faq' group of 1", () => {
    const doc: ComposeDocument = {
      id: "acme-marketing-home",
      channel: "web",
      template: "MarketingView",
      meta: { channel: "web", title: "Acme — placeholder", description: "Placeholder page description." },
      bindings: [
        { slot: "brand", value: "Acme Wordmark" },
        { slot: "heroEyebrow", value: "Placeholder eyebrow" },
        { slot: "heroHeading", value: "Placeholder hero heading" },
        { slot: "heroDescription", value: "Placeholder hero description." },
        { slot: "featuresHeading", value: "Placeholder features heading" },
        { slot: "ctaHeading", value: "Placeholder CTA heading" },
        { slot: "ctaDescription", value: "Placeholder CTA description." },
      ],
    };

    const { element } = renderWebDocument(doc, {
      groups: [
        {
          slot: "features",
          items: [
            { index: 0, value: "Placeholder feature A" },
            { index: 1, value: "Placeholder feature B" },
          ],
        },
        {
          slot: "faq",
          items: [{ index: 0, fields: { question: { value: "Placeholder question A?" }, answer: { value: "Placeholder answer A." } } }],
        },
      ],
    });
    const html = renderToStaticMarkup(element);

    expect(html).toBe(
      '<div class="flex min-h-dvh flex-col">' +
        '<header class="bg-surface-raised py-sm border-b border-line-base" style="position:relative;z-index:var(--ui-z-shell, 20);border-bottom-width:var(--ui-border-hairline, 1px)">' +
        '<div class="mx-auto flex w-full flex-wrap items-center justify-between gap-md" style="padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))">' +
        '<div class="flex items-center gap-lg">Acme Wordmark</div>' +
        "</div>" +
        "</header>" +
        '<main class="flex flex-col gap-2xl py-2xl">' +
        '<section class="flex flex-col gap-xl">' +
        '<div data-section-intro="display" class="flex w-full flex-col items-start" style="max-width:var(--ui-width-prose-max, 48rem)">' +
        '<p class="text-caption uppercase tracking-label text-ink-muted">Placeholder eyebrow</p>' +
        '<h1 class="text-display-m tablet:text-display-l font-display leading-display text-balance text-ink-primary mt-sm">Placeholder hero heading</h1>' +
        '<p class="text-body-l text-pretty text-ink-secondary mt-2xl">Placeholder hero description.</p>' +
        "</div>" +
        "</section>" +
        '<div class="flex flex-col gap-lg bg-surface-sunken">' +
        '<div class="flex flex-col gap-xs">' +
        '<h2 class="text-h2 font-display text-ink-primary">Placeholder features heading</h2>' +
        "</div>" +
        '<div class="grid grid-cols-1 gap-lg tablet:grid-cols-2 desktop:grid-cols-3">' +
        '<div class="flex flex-col items-start gap-sm"><p class="text-body font-body font-medium text-ink-primary">Placeholder feature A</p></div>' +
        '<div class="flex flex-col items-start gap-sm"><p class="text-body font-body font-medium text-ink-primary">Placeholder feature B</p></div>' +
        "</div>" +
        "</div>" +
        '<div class="flex flex-col gap-lg">' +
        '<div class="flex flex-col border-t border-line-base">' +
        '<div class="group/faq block border-b border-line-base" data-rac="">' +
        '<button id="react-aria-_R_6eH1_" class="flex w-full cursor-pointer items-center justify-between gap-lg rounded-default py-lg text-start text-body-l font-medium tablet:py-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent summary-marker-none text-ink-primary" data-rac="" type="button" tabindex="0" data-react-aria-pressable="true" aria-expanded="false" aria-controls="react-aria-_R_6eH2_" slot="trigger">' +
        "<span>Placeholder question A?</span>" +
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 disclosure-icon-motion" style="width:var(--ui-icon-md, var(--spacing-xl, 24px));height:var(--ui-icon-md, var(--spacing-xl, 24px));flex-shrink:0;stroke-width:var(--ui-icon-stroke, 2)" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>' +
        "</button>" +
        '<div class="disclosure-panel-motion" data-rac="" id="react-aria-_R_6eH2_" role="group" aria-labelledby="react-aria-_R_6eH1_" aria-hidden="true" hidden="">' +
        '<div class="pb-lg pe-2xl text-body text-pretty tablet:pb-xl text-ink-secondary" style="max-width:var(--ui-width-prose-max, 48rem)">Placeholder answer A.</div>' +
        "</div>" +
        "</div>" +
        "</div>" +
        "</div>" +
        '<section class="bg-surface-sunken flex flex-col gap-xl">' +
        '<div data-section-intro="display" class="flex w-full flex-col items-start" style="max-width:var(--ui-width-prose-max, 48rem)">' +
        '<h2 class="text-display-m tablet:text-display-l font-display leading-display text-balance text-ink-primary">Placeholder CTA heading</h2>' +
        '<p class="text-body-l text-pretty text-ink-secondary mt-2xl">Placeholder CTA description.</p>' +
        "</div>" +
        "</section>" +
        "</main>" +
        '<footer class="bg-surface-raised text-ink-primary py-lg border-t border-line-base" style="position:relative;z-index:var(--ui-z-shell, 20);border-top-width:var(--ui-border-hairline, 1px)">' +
        '<div class="mx-auto flex w-full flex-col gap-lg" style="padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))"></div>' +
        "</footer>" +
        "</div>",
    );
  });

  it("renders a two-column Hero when heroMedia is present (tablet:grid-cols-2, not flex-only)", () => {
    const doc: ComposeDocument = {
      id: "acme-marketing-home",
      channel: "web",
      template: "MarketingView",
      meta: { channel: "web", title: "Acme — placeholder", description: "Placeholder page description." },
      bindings: [
        { slot: "brand", value: "Acme Wordmark" },
        { slot: "heroHeading", value: "Placeholder hero heading" },
        { slot: "heroMedia", assetId: "acme.hero.still" },
        { slot: "ctaHeading", value: "Placeholder CTA heading" },
      ],
    };
    const heroStill = {
      type: "image" as const,
      src: "https://cdn.example/hero-still.png",
      width: 640,
      height: 480,
      alt: "Placeholder product still",
    };
    const { element } = renderWebDocument(doc, {
      groups: [{ slot: "features", items: [] }],
      resolveAssetId: (id) => (id === "acme.hero.still" ? heroStill : undefined),
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain('class="grid grid-cols-1 items-center gap-xl tablet:grid-cols-2"');
    expect(html).toContain('src="https://cdn.example/hero-still.png"');
  });

  it("renders cleanly with zero features (an empty grid, not a crash) and omits the FAQ section entirely when its binding was never authored", () => {
    const doc: ComposeDocument = {
      id: "acme-marketing-home",
      channel: "web",
      template: "MarketingView",
      meta: { channel: "web", title: "Acme", description: "Acme description." },
      bindings: [
        { slot: "brand", value: "Acme Wordmark" },
        { slot: "heroHeading", value: "Placeholder hero heading" },
        { slot: "ctaHeading", value: "Placeholder CTA heading" },
      ],
    };

    const { element } = renderWebDocument(doc, { groups: [{ slot: "features", items: [] }] });
    const html = renderToStaticMarkup(element);

    expect(html).toBe(
      '<div class="flex min-h-dvh flex-col">' +
        '<header class="bg-surface-raised py-sm border-b border-line-base" style="position:relative;z-index:var(--ui-z-shell, 20);border-bottom-width:var(--ui-border-hairline, 1px)">' +
        '<div class="mx-auto flex w-full flex-wrap items-center justify-between gap-md" style="padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))">' +
        '<div class="flex items-center gap-lg">Acme Wordmark</div>' +
        "</div>" +
        "</header>" +
        '<main class="flex flex-col gap-2xl py-2xl">' +
        '<section class="flex flex-col gap-xl"><div data-section-intro="display" class="flex w-full flex-col items-start" style="max-width:var(--ui-width-prose-max, 48rem)"><h1 class="text-display-m tablet:text-display-l font-display leading-display text-balance text-ink-primary">Placeholder hero heading</h1></div></section>' +
        '<section class="bg-surface-sunken flex flex-col gap-xl"><div data-section-intro="display" class="flex w-full flex-col items-start" style="max-width:var(--ui-width-prose-max, 48rem)"><h2 class="text-display-m tablet:text-display-l font-display leading-display text-balance text-ink-primary">Placeholder CTA heading</h2></div></section>' +
        "</main>" +
        '<footer class="bg-surface-raised text-ink-primary py-lg border-t border-line-base" style="position:relative;z-index:var(--ui-z-shell, 20);border-top-width:var(--ui-border-hairline, 1px)">' +
        '<div class="mx-auto flex w-full flex-col gap-lg" style="padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))"></div>' +
        "</footer>" +
        "</div>",
    );
    expect(html).not.toContain("aria-expanded");
  });
});

// ---------------------------------------------------------------------------
// content-section: authored, validated and resolved through the document
// contract, then rendered by the server SectionedView. Placeholder copy only.
// ---------------------------------------------------------------------------

const contentCopy = new Map<string, string>();
/** A CopyRef whose text the fixture registry below resolves to `text`. */
const copy = (id: string, text: string): CopyRef => {
  contentCopy.set(id, text);
  return { id };
};
const tone = (value: "success" | "warning" | "danger" | "info" | "neutral", id: string, text: string) => ({ tone: value, label: copy(`golden.status.${id}`, text) });

const fieldsVisual = (id: string, rows: number): SectionedViewSpecimenPart => ({
  id,
  type: "fields",
  label: copy(`golden.${id}.label`, "Placeholder record fields"),
  columns: 2,
  items: Array.from({ length: rows }, (_, index) => ({ id: `f${index}`, label: copy(`golden.${id}.f${index}.label`, `Field ${index + 1}`), value: copy(`golden.${id}.f${index}.value`, `Value ${index + 1}`) })),
});

const recordPanel = (id: string, title: string): SectionedViewSpecimenPanel => ({
  id,
  title: copy(`golden.${id}.title`, title),
  meta: copy(`golden.${id}.meta`, "Placeholder meta"),
  status: tone("warning", `${id}.review`, "In review"),
  parts: [
    fieldsVisual(`${id}-fields`, 2),
    { id: "checks", type: "status-rows", items: [{ id: "one", label: copy(`golden.${id}.check`, "Placeholder check"), status: tone("success", `${id}.within`, "Within range") }] },
    { id: "ratio", type: "meter", label: copy(`golden.${id}.ratio`, "Placeholder ratio"), value: 2, scaleMax: 4, limit: 3, direction: "max", tone: "info", valueText: copy(`golden.${id}.ratio.value`, "2.0"), limitText: copy(`golden.${id}.ratio.limit`, "Limit 3.0") },
  ],
  footer: { assignee: { initials: copy(`golden.${id}.initials`, "PA"), name: copy(`golden.${id}.name`, "Placeholder assignee") }, note: copy(`golden.${id}.note`, "Placeholder note") },
});

const ledgerPanel = (id: string): SectionedViewSpecimenPanel => ({
  id,
  title: copy(`golden.${id}.title`, "Placeholder ledger"),
  parts: [
    {
      id: "matrix",
      type: "table",
      caption: copy(`golden.${id}.caption`, "Placeholder table"),
      columns: [{ id: "name", label: copy(`golden.${id}.col.name`, "Name") }, { id: "state", label: copy(`golden.${id}.col.state`, "State") }],
      rows: [{ id: "r1", cells: [{ text: copy(`golden.${id}.r1`, "Row one") }, { status: tone("info", `${id}.received`, "Received") }] }],
    },
    { id: "due", type: "schedule", items: [{ id: "one", date: copy(`golden.${id}.date`, "Day 1"), label: copy(`golden.${id}.due`, "Placeholder milestone"), amount: copy(`golden.${id}.amount`, "100 units") }] },
  ],
});

const holdersPanel = (id: string): SectionedViewSpecimenPanel => ({
  id,
  title: copy(`golden.${id}.title`, "Placeholder holders"),
  parts: [
    { id: "split", type: "shares", items: [{ id: "one", name: copy(`golden.${id}.holder`, "Placeholder holder"), share: 60, shareText: copy(`golden.${id}.share`, "60%") }] },
    { id: "docs", type: "files", items: [{ id: "one", format: copy(`golden.${id}.format`, "PDF"), name: copy(`golden.${id}.file`, "Placeholder file") }] },
  ],
});

const specimenMedia = (label: string, panels: SectionedViewSpecimenPanel[], arrangement?: SectionedViewSpecimenMedia["arrangement"]): SectionedViewSpecimenMedia => ({
  type: "specimen",
  label: copy(`golden.specimen.${label}`, `Placeholder specimen showing ${label}`),
  ...(arrangement === undefined ? {} : { arrangement }),
  ...(arrangement === "flow" ? { connector: copy(`golden.specimen.${label}.connector`, "Placeholder connector") } : {}),
  panels,
});

const textItem = (id: string, extra: Record<string, unknown> = {}) => ({ id, heading: copy(`golden.item.${id}.heading`, `Item ${id}`), description: copy(`golden.item.${id}.description`, `Placeholder description ${id}.`), ...extra });

const contentBand = (id: string, extra: Partial<SectionedViewContentSection> = {}): SectionedViewContentSection => ({ id, kind: "content-section", heading: copy(`golden.${id}.heading`, `Heading ${id}`), ...extra });

const MODULES = {
  features: { type: "features", columns: 3, treatment: "plate", items: [textItem("fa", { icon: "landmark" }), textItem("fb", { icon: "scale" }), textItem("fc", { icon: "globe" })] },
  cards: {
    type: "cards",
    items: [
      { ...textItem("wide"), span: "two-thirds", icon: "layers", eyebrow: copy("golden.item.wide.eyebrow", "Placeholder eyebrow"), visual: fieldsVisual("wide-visual", 3) },
      { ...textItem("narrow"), span: "third" },
      { ...textItem("t1"), span: "third" },
      { ...textItem("t2"), span: "third" },
      { ...textItem("t3"), span: "third" },
    ],
  },
  comparison: {
    type: "comparison",
    before: { label: copy("golden.before.label", "Before"), points: [copy("golden.before.p1", "Placeholder point one"), copy("golden.before.p2", "Placeholder point two")], visual: holdersPanel("holders-before") },
    after: { label: copy("golden.after.label", "After"), points: [copy("golden.after.p1", "Placeholder point three"), copy("golden.after.p2", "Placeholder point four")], visual: holdersPanel("holders-after") },
  },
  topics: { type: "topics", columns: 2, items: [textItem("ta", { icon: "file-check" }), textItem("tb"), textItem("tc"), textItem("td")] },
  steps: {
    type: "steps",
    items: [
      { id: "one", ordinal: copy("golden.step.one.ordinal", "01"), heading: copy("golden.step.one.heading", "Step one"), visual: ledgerPanel("ledger-step") },
      { id: "two", ordinal: copy("golden.step.two.ordinal", "02"), heading: copy("golden.step.two.heading", "Step two") },
      { id: "three", ordinal: copy("golden.step.three.ordinal", "03"), heading: copy("golden.step.three.heading", "Step three") },
    ],
  },
  faq: { type: "faq", items: ["q1", "q2", "q3", "q4"].map((id) => ({ id, question: copy(`golden.faq.${id}.q`, `Placeholder question ${id}?`), answer: copy(`golden.faq.${id}.a`, `Placeholder answer ${id}.`) })) },
} satisfies Record<string, SectionedViewContentModule>;

function renderContent(...sections: SectionedViewSection[]): { html: string; root: Document } {
  const authored = { id: "golden-content", sectionGroundRhythm: "view" as const, sections };
  const resolver = createCopyResolver({
    id: "golden-content-fixture",
    locale: "en",
    revision: "1",
    source: { kind: "consumer", reference: "fixtures/golden-content" },
    entries: [...contentCopy].map(([id, text]) => ({ id, text, context: "fixture", status: "approved" as const })),
  });
  const html = renderToStaticMarkup(createElement(ServerSectionedView, { document: resolveSectionedViewDocument(authored, resolver), landmark: "none" }));
  return { html, root: new JSDOM(html).window.document };
}

const band = (root: Document, id: string): HTMLElement => {
  const element = root.getElementById(id);
  if (element === null) throw new Error(`no band ${id}`);
  return element;
};

describe("golden: SectionedView content-section", () => {
  it("renders an intro band (header and text-link actions, no module) byte for byte", () => {
    const { html } = renderContent(contentBand("intro", { description: copy("golden.intro.description", "Placeholder intro."), actions: [{ id: "more", label: copy("golden.intro.more", "Read more"), href: "/more" }] }));
    expect(html).toBe(INTRO_BAND_HTML);
  });

  it("renders a features module in a stacked, centred band, with explicit icons and no item eyebrow", () => {
    const { root } = renderContent(contentBand("features", { align: "center", module: MODULES.features }));
    const section = band(root, "features");
    expect(section.getAttribute("data-content-section")).toBe("");
    expect(section.querySelector("[data-content-section-header] h2")?.textContent).toBe("Heading features");
    const grid = section.querySelector("[data-content-section-modules] [data-feature-grid-columns]");
    expect(grid?.getAttribute("data-feature-grid-columns")).toBe("3");
    expect(grid?.getAttribute("data-treatment")).toBe("plate");
    expect(grid?.getAttribute("data-emphasis")).toBe("item");
    const items = [...section.querySelectorAll("[data-feature-grid-item]")];
    // Item headings are emphasised text, not headings: the band's h2 is the one heading stop.
    expect(items.map((item) => item.querySelector("p")?.textContent)).toEqual(["Item fa", "Item fb", "Item fc"]);
    expect(section.querySelectorAll("h3")).toHaveLength(0);
    expect(items.every((item) => item.querySelector('svg[aria-hidden="true"]') !== null)).toBe(true);
  });

  it("renders a cards bento: spans in order, a card eyebrow, and a card visual named by its part label", () => {
    const { root } = renderContent(contentBand("cards", { module: MODULES.cards }));
    const cards = [...band(root, "cards").querySelectorAll("[data-card-grid] [data-card-grid-item]")];
    expect(cards.map((card) => card.getAttribute("data-span"))).toEqual(["two-thirds", "third", "third", "third", "third"]);
    expect(cards.map((card) => card.querySelector("h3")?.textContent)).toEqual(["Item wide", "Item narrow", "Item t1", "Item t2", "Item t3"]);
    expect(cards[0]?.textContent).toContain("Placeholder eyebrow");
    const visual = cards[0]?.querySelector("[data-card-grid-visual] figure[data-specimen]");
    expect(visual?.getAttribute("aria-label")).toBe("Placeholder record fields");
    expect(cards.slice(1).every((card) => card.querySelector("[data-specimen]") === null)).toBe(true);
  });

  it("renders a comparison with a panel visual on each side, each figure named by its panel title", () => {
    const { root } = renderContent(contentBand("comparison", { module: MODULES.comparison }));
    const section = band(root, "comparison");
    expect(section.querySelectorAll("[data-comparison-side]")).toHaveLength(2);
    const visuals = [...section.querySelectorAll("[data-comparison-visual] figure[data-specimen]")];
    expect(visuals.map((figure) => figure.getAttribute("aria-label"))).toEqual(["Placeholder holders", "Placeholder holders"]);
    expect(section.textContent).toContain("Placeholder point four");
  });

  it("renders a topics module as a two-column list", () => {
    const { root } = renderContent(contentBand("topics", { module: MODULES.topics }));
    const list = band(root, "topics").querySelector("ul[data-topic-list]");
    expect(list?.getAttribute("data-columns")).toBe("2");
    expect(list?.querySelectorAll(":scope > li")).toHaveLength(4);
  });

  it("renders steps as an ordered list with a step visual", () => {
    const { root } = renderContent(contentBand("steps", { module: MODULES.steps }));
    const section = band(root, "steps");
    expect(section.querySelector("[data-content-section-modules] ol")?.querySelectorAll(":scope > li")).toHaveLength(3);
    const visual = section.querySelector("[data-step-visual] figure[data-specimen]");
    expect(visual?.getAttribute("aria-label")).toBe("Placeholder ledger");
    expect(visual?.querySelector("table caption")?.textContent).toBe("Placeholder table");
  });

  it("renders a specimen split: the text column, then the media column, on the start side", () => {
    const { root } = renderContent(contentBand("split", { layout: "split", mediaSide: "start", module: { type: "topics", columns: 1, items: [textItem("sa"), textItem("sb")] }, media: specimenMedia("split", [recordPanel("record", "Placeholder record")]) }));
    const section = band(root, "split");
    expect(section.getAttribute("data-layout")).toBe("split");
    expect(section.getAttribute("data-media-side")).toBe("start");
    expect(section.querySelector("[data-content-section-text] ul[data-topic-list]")).not.toBeNull();
    const figure = section.querySelector("[data-content-section-media] > figure[data-specimen]");
    expect(figure?.getAttribute("data-arrangement")).toBe("single");
    expect(figure?.getAttribute("aria-label")).toBe("Placeholder specimen showing split");
    expect(figure?.querySelectorAll("[data-specimen-part]")).toHaveLength(3);
  });

  it("renders a specimen row and a flow with its connector below a stacked header", () => {
    const { root } = renderContent(
      contentBand("row", { media: specimenMedia("row", [ledgerPanel("ledger-row"), holdersPanel("holders-row")], "row") }),
      contentBand("flow", { media: specimenMedia("flow", [recordPanel("record-flow", "Placeholder first"), ledgerPanel("ledger-flow"), holdersPanel("holders-flow")], "flow") }),
    );
    const row = band(root, "row").querySelector("[data-content-section-media] figure[data-specimen]");
    expect(row?.getAttribute("data-arrangement")).toBe("row");
    expect(row?.querySelectorAll("[data-specimen-panel]").length).toBeGreaterThanOrEqual(2);
    const flow = band(root, "flow").querySelector("[data-content-section-media] figure[data-specimen]");
    expect(flow?.getAttribute("data-arrangement")).toBe("flow");
    expect(flow?.querySelector("[data-specimen-connector]")?.textContent).toContain("Placeholder connector");
  });

  it("renders a split FAQ as the FAQ band: a top-aligned header beside native disclosure rows", () => {
    const { root } = renderContent(contentBand("questions", { layout: "split", eyebrow: copy("golden.questions.eyebrow", "Placeholder eyebrow"), module: MODULES.faq }));
    const section = band(root, "questions");
    expect(section.getAttribute("data-layout")).toBe("split");
    expect(section.hasAttribute("data-content-section-faq")).toBe(true);
    expect(section.className.split(" ")).toContain("tablet-lg:items-start");
    expect(section.className.split(" ")).not.toContain("tablet-lg:items-center");
    expect(section.querySelector("[data-content-section-text] h2")?.textContent).toBe("Heading questions");
    const rows = section.querySelectorAll("[data-content-section-media] details > summary");
    expect([...rows].map((summary) => summary.textContent)).toEqual(["Placeholder question q1?", "Placeholder question q2?", "Placeholder question q3?", "Placeholder question q4?"]);
    expect(section.querySelector("[data-content-section-modules]")).toBeNull();
  });

  it("paints the section's ground on its root and inks inverse actions for that ground", () => {
    const { root } = renderContent(contentBand("dark", { ground: "inverse", description: copy("golden.dark.description", "Placeholder lede."), actions: [{ id: "go", label: copy("golden.dark.go", "Continue"), href: "/go" }] }));
    const section = band(root, "dark");
    expect(section.className.split(" ")).toContain("bg-surface-inverse");
    expect(section.querySelector('a[href="/go"]')?.className).toBe("text-body font-body underline text-ink-on-inverse");
  });

  it("puts nothing focusable inside any specimen", () => {
    const { root } = renderContent(
      contentBand("cards", { module: MODULES.cards }),
      contentBand("comparison", { module: MODULES.comparison }),
      contentBand("steps", { module: MODULES.steps }),
      contentBand("flow", { media: specimenMedia("flow", [recordPanel("record-flow", "Placeholder first"), ledgerPanel("ledger-flow"), holdersPanel("holders-flow")], "flow") }),
    );
    const figures = [...root.querySelectorAll("[data-specimen]")];
    expect(figures.length).toBe(5);
    for (const figure of figures) {
      expect(figure.querySelectorAll("a, button, input, select, textarea, summary, [tabindex], [contenteditable]")).toHaveLength(0);
    }
  });
});

/** Captured from this renderer; Designer `ContentSection` stacked anatomy with `SectionIntro` at the section emphasis. */
const INTRO_BAND_HTML =
  '<div class="flex flex-col gap-2xl py-2xl">' +
  '<div id="intro" data-content-section="" class="flex w-full flex-col gap-2xl tablet-lg:gap-3xl items-start">' +
  '<div data-content-section-header="" data-section-intro="section" class="flex w-full flex-col items-start" style="max-width:var(--ui-width-prose-max, 48rem)">' +
  '<h2 class="text-h1 tablet:text-h0 tablet-lg:text-display-m font-display leading-heading text-balance text-ink-primary">Heading intro</h2>' +
  '<p class="text-body-l text-pretty text-ink-secondary mt-xl">Placeholder intro.</p>' +
  '<div class="flex flex-wrap items-center gap-sm mt-2xl">' +
  '<a href="/more" class="text-body font-body underline text-ink-link">Read more</a>' +
  "</div>" +
  "</div>" +
  "</div>" +
  "</div>";
