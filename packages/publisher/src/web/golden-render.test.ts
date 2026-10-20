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
import type { SectionedViewContentBlock, SectionedViewContentSection, SectionedViewSection, SectionedViewSpecimenMedia, SectionedViewSpecimenPanel, SectionedViewSpecimenPart } from "../core/sectioned-view.js";
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
        '<header data-header-root="" class="bg-surface-raised py-sm border-b border-line-base site-header-contract" style="position:relative;z-index:var(--ui-z-shell, 20);border-bottom-width:var(--ui-border-hairline, 1px)">' +
        '<div class="site-header-row">' +
        '<div class="site-header-brand">Acme</div><div class="site-header-actions"></div></div></header>' +
        '<main class="mx-auto flex w-full flex-1 flex-col gap-xl px-lg py-2xl" style="max-width:var(--ui-width-form-max, none)">' +
        '<div class="flex flex-col items-center gap-xs text-center">' +
        '<h1 class="text-h1 font-display text-ink-primary">Sign in</h1>' +
        '<p class="text-body text-ink-secondary">Welcome back.</p>' +
        "</div>" +
        '<div class="rounded-control bg-surface-raised p-lg flex flex-col gap-lg text-start" style="box-shadow:var(--ui-elevation-raised, 0 1px 0 var(--color-line-base, oklch(0.8761 0 0)))">' +
        "email + password form</div>" +
        '<p class="text-center text-body-s text-ink-muted">\u00A9 2026 Acme</p></main>' +
        '<footer data-footer-root="" class="site-footer-dark bg-surface-raised text-ink-primary py-lg border-t border-line-base" style="position:relative;z-index:var(--ui-z-shell, 20);border-top-width:var(--ui-border-hairline, 1px)"><div class="mx-auto flex w-full flex-col gap-lg" style="padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))"></div></footer></div>',
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
        '<header data-header-root="" class="bg-surface-raised py-sm border-b border-line-base site-header-contract" style="position:relative;z-index:var(--ui-z-shell, 20);border-bottom-width:var(--ui-border-hairline, 1px)">' +
        '<div class="site-header-row">' +
        '<div class="site-header-brand">' +
        '<img src="https://cdn.example/logo.svg" alt="Acme logo" width="120" height="40"/>' +
        '</div><div class="site-header-actions"></div></div></header>' +
        '<main class="mx-auto flex w-full flex-1 flex-col gap-xl px-lg py-2xl" style="max-width:var(--ui-width-form-max, none)">' +
        '<div class="flex flex-col items-center gap-xs text-center">' +
        '<h1 class="text-h1 font-display text-ink-primary">Sign in</h1>' +
        "</div>" +
        '<div class="rounded-control bg-surface-raised p-lg flex flex-col gap-lg text-start" style="box-shadow:var(--ui-elevation-raised, 0 1px 0 var(--color-line-base, oklch(0.8761 0 0)))">' +
        "email + password form</div></main>" +
        '<footer data-footer-root="" class="site-footer-dark bg-surface-raised text-ink-primary py-lg border-t border-line-base" style="position:relative;z-index:var(--ui-z-shell, 20);border-top-width:var(--ui-border-hairline, 1px)"><div class="mx-auto flex w-full flex-col gap-lg" style="padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))"></div></footer></div>',
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
        '<header data-header-root="" class="bg-surface-raised py-sm border-b border-line-base site-header-contract" style="position:relative;z-index:var(--ui-z-shell, 20);border-bottom-width:var(--ui-border-hairline, 1px)">' +
        '<div class="site-header-row">' +
        '<div class="site-header-brand">Acme Wordmark</div>' +
        '<div class="site-header-actions"></div></div>' +
        "</header>" +
        '<main class="flex flex-col gap-2xl py-2xl">' +
        '<section class="flex flex-col gap-xl">' +
        '<div data-section-intro="display" class="flex w-full flex-col items-start" style="max-width:var(--ui-width-prose-max, 48rem)">' +
        '<p class="text-body-s font-medium uppercase tracking-label text-accent-text">Placeholder eyebrow</p>' +
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
        '<footer data-footer-root="" class="site-footer-dark bg-surface-raised text-ink-primary py-lg border-t border-line-base" style="position:relative;z-index:var(--ui-z-shell, 20);border-top-width:var(--ui-border-hairline, 1px)"><div class="mx-auto flex w-full flex-col gap-lg" style="padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))"></div>' + "</footer>" +
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
        '<header data-header-root="" class="bg-surface-raised py-sm border-b border-line-base site-header-contract" style="position:relative;z-index:var(--ui-z-shell, 20);border-bottom-width:var(--ui-border-hairline, 1px)">' +
        '<div class="site-header-row">' +
        '<div class="site-header-brand">Acme Wordmark</div>' +
        '<div class="site-header-actions"></div></div>' +
        "</header>" +
        '<main class="flex flex-col gap-2xl py-2xl">' +
        '<section class="flex flex-col gap-xl"><div data-section-intro="display" class="flex w-full flex-col items-start" style="max-width:var(--ui-width-prose-max, 48rem)"><h1 class="text-display-m tablet:text-display-l font-display leading-display text-balance text-ink-primary">Placeholder hero heading</h1></div></section>' +
        '<section class="bg-surface-sunken flex flex-col gap-xl"><div data-section-intro="display" class="flex w-full flex-col items-start" style="max-width:var(--ui-width-prose-max, 48rem)"><h2 class="text-display-m tablet:text-display-l font-display leading-display text-balance text-ink-primary">Placeholder CTA heading</h2></div></section>' +
        "</main>" +
        '<footer data-footer-root="" class="site-footer-dark bg-surface-raised text-ink-primary py-lg border-t border-line-base" style="position:relative;z-index:var(--ui-z-shell, 20);border-top-width:var(--ui-border-hairline, 1px)"><div class="mx-auto flex w-full flex-col gap-lg" style="padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))"></div>' + "</footer>" +
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

const joined = (id: string, refs: CopyRef[]): CopyRef => copy(id, refs.map(ref => contentCopy.get(ref.id)!).join(" · "));
/** Recompose retired multi-panel examples into one legal panel without discarding their visible copy or status cells. */
const combinePanels = (id: string, panels: SectionedViewSpecimenPanel[], connector?: CopyRef): SectionedViewSpecimenPanel => {
  const rows: Extract<SectionedViewSpecimenPart, { type: "table" }>["rows"][number][] = [];
  const parts: SectionedViewSpecimenPart[] = [];
  const labels: CopyRef[] = [];
  let table: Extract<SectionedViewSpecimenPart, { type: "table" }> | undefined;
  for (const panel of panels) for (const part of panel.parts) {
    if (part.label !== undefined) labels.push(part.label);
    if (part.type === "table") { table = part; rows.push(...part.rows); }
    else if (part.type === "fields") {
      if (part.items.length !== 2) throw new Error("Expected the original two field pairs");
      rows.push({ id: part.id, cells: part.items.map(item => ({ text: joined(`golden.${id}.${part.id}.${item.id}`, [item.label, item.value]) })) });
    }
    else if (part.type === "schedule") rows.push(...part.items.map(item => ({ id: `${part.id}-${item.id}`, cells: [{ text: joined(`golden.${id}.${part.id}.${item.id}`, [item.date, item.label]) }, { text: item.amount }] })));
    else if (part.type === "shares") rows.push(...part.items.map(item => ({ id: `${part.id}-${item.id}`, cells: [{ text: item.name }, { text: item.shareText }] })));
    else if (part.type === "files") rows.push(...part.items.map(item => ({ id: `${part.id}-${item.id}`, cells: [{ text: item.name }, { text: item.format }] })));
    else parts.push(part);
  }
  if (table === undefined) throw new Error("Expected original two-column table");
  const first = panels[0]!;
  return { id, title: joined(`golden.${id}.title`, panels.map(panel => panel.title)), meta: first.meta, status: first.status,
    parts: [{ ...table, id: "combined", label: labels.length === 0 ? undefined : joined(`golden.${id}.labels`, labels), rows }, ...parts],
    footer: connector === undefined ? first.footer : { ...first.footer, note: joined(`golden.${id}.footer`, [first.footer!.note!, connector]) } };
};
const specimenMedia = (label: string, panel: SectionedViewSpecimenPanel): SectionedViewSpecimenMedia => ({
  type: "specimen", label: copy(`golden.specimen.${label}`, `Placeholder specimen showing ${label}`), panel,
});

const textItem = (id: string, extra: Record<string, unknown> = {}) => ({ id, heading: copy(`golden.item.${id}.heading`, `Item ${id}`), description: copy(`golden.item.${id}.description`, `Placeholder description ${id}.`), ...extra });

const contentBand = (id: string, extra: Partial<SectionedViewContentSection> = {}): SectionedViewContentSection => ({ id, kind: "content-section", heading: copy(`golden.${id}.heading`, `Heading ${id}`), ...extra });

const BLOCKS = {
  features: { type: "items", arrangement: "columns", columns: 3, treatment: "plate", items: [textItem("fa", { icon: "landmark" }), textItem("fb", { icon: "scale" }), textItem("fc", { icon: "globe" })] },
  cards: {
    type: "items", arrangement: "bento", treatment: "plate",
    items: [
      { ...textItem("wide"), span: "two-thirds", icon: "layers", eyebrow: copy("golden.item.wide.eyebrow", "Placeholder eyebrow"), visual: fieldsVisual("wide-visual", 3) },
      { ...textItem("narrow"), span: "third" },
      { ...textItem("t1"), span: "third" },
      { ...textItem("t2"), span: "third" },
      { ...textItem("t3"), span: "third" },
    ],
  },
  comparison: { type: "matrix", featured: "after", sides: [
    { id: "before", label: copy("golden.before.label", "Before"), heading: copy("golden.before.heading", "Earlier state"), description: copy("golden.before.description", "Placeholder point one · Placeholder point two"), visual: holdersPanel("holders-before") },
    { id: "after", label: copy("golden.after.label", "After"), heading: copy("golden.after.heading", "Later state"), description: copy("golden.after.description", "Placeholder point three · Placeholder point four"), visual: holdersPanel("holders-after") },
  ] },
  topics: { type: "items", arrangement: "rows", treatment: "rule", columns: 2, items: [textItem("ta", { icon: "file-check" }), textItem("tb"), textItem("tc"), textItem("td")] },
  steps: {
    type: "items", arrangement: "columns", order: "connected", caption: copy("golden.steps.caption", "Sample data."),
    items: [
      { id: "one", heading: copy("golden.step.one.heading", "Step one"), visual: (() => { const panel = combinePanels("ledger-step-merged", [ledgerPanel("ledger-step")]); const part = panel.parts[0]!; return { ...part, label: panel.title }; })() },
      { id: "two", heading: copy("golden.step.two.heading", "Step two") },
      { id: "three", heading: copy("golden.step.three.heading", "Step three") },
    ],
  },
  faq: { type: "items", arrangement: "rows", reveal: "disclose", treatment: "rule", items: ["q1", "q2", "q3", "q4"].map((id) => ({ id, heading: copy(`golden.faq.${id}.q`, `Placeholder question ${id}?`), description: copy(`golden.faq.${id}.a`, `Placeholder answer ${id}.`) })) },
} satisfies Record<string, SectionedViewContentBlock>;

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
  it("renders an intro band (header, a primary and a secondary button, no block) as a standard frame, byte for byte", () => {
    const { html } = renderContent(
      contentBand("intro", {
        description: copy("golden.intro.description", "Placeholder intro."),
        actions: [
          { id: "start", label: copy("golden.intro.start", "Start a record"), href: "/start", emphasis: "primary" },
          { id: "more", label: copy("golden.intro.more", "Read the guide"), href: "/more", emphasis: "secondary" },
        ],
      }),
    );
    expect(html).toBe(INTRO_BAND_HTML);
  });

  it("renders a feature-grid block in a stacked band, with explicit icons and no item eyebrow", () => {
    const { root } = renderContent(contentBand("features", { block: BLOCKS.features }));
    const section = band(root, "features");
    expect(section.getAttribute("data-content-section")).toBe("");
    expect(section.querySelector("[data-content-section-header] h2")?.textContent).toBe("Heading features");
    const grid = section.querySelector("[data-content-section-modules] [data-items][data-arrangement=columns]");
    expect(grid?.getAttribute("data-columns")).toBe("3");
    expect(grid?.getAttribute("data-treatment")).toBe("plate");
    expect(grid?.querySelectorAll("h3")).toHaveLength(3);
    const items = [...section.querySelectorAll("[data-item]")];
    // Canonical items expose their real nested heading outline.
    expect(items.map((item) => item.querySelector("h3")?.textContent)).toEqual(["Item fa", "Item fb", "Item fc"]);
    expect(section.querySelectorAll("h3")).toHaveLength(3);
    expect(items.every((item) => item.querySelector('svg[aria-hidden="true"]') !== null)).toBe(true);
  });

  it("renders a card-grid bento: spans in order, a card eyebrow, and a card visual named by its part label", () => {
    const { root } = renderContent(contentBand("cards", { block: BLOCKS.cards }));
    const cards = [...band(root, "cards").querySelectorAll("[data-items][data-arrangement=bento] [data-item]")];
    expect(cards.map((card) => card.getAttribute("data-span"))).toEqual(["two-thirds", "third", "third", "third", "third"]);
    expect(cards.map((card) => card.querySelector("h3")?.textContent)).toEqual(["Item wide", "Item narrow", "Item t1", "Item t2", "Item t3"]);
    expect(cards[0]?.textContent).toContain("Placeholder eyebrow");
    const visual = cards[0]?.querySelector("[data-item-visual] figure[data-specimen]");
    expect(visual?.getAttribute("aria-label")).toBe("Placeholder record fields");
    expect(cards.slice(1).every((card) => card.querySelector("[data-specimen]") === null)).toBe(true);
  });

  it("renders a comparison with a panel visual on each side, each figure named by its side heading", () => {
    const { root } = renderContent(contentBand("comparison", { block: BLOCKS.comparison }));
    const section = band(root, "comparison");
    expect(section.querySelectorAll("[data-matrix-side]")).toHaveLength(2);
    const visuals = [...section.querySelectorAll("[data-matrix-side] figure[data-specimen]")];
    expect(visuals.map((figure) => figure.getAttribute("aria-label"))).toEqual(["Earlier state", "Later state"]);
    expect(section.textContent).toContain("Placeholder point four");
  });

  it("preserves comparison points as a separate supported form with equal lists", () => {
    const { root } = renderContent(contentBand("points", { block: { type:"matrix",featured:"after",sides:[{id:"before",label:copy("golden.points.before.label","Before"),heading:copy("golden.points.before.heading","Earlier state"),points:[copy("golden.points.one","Placeholder point one"),copy("golden.points.two","Placeholder point two")]},{id:"after",label:copy("golden.points.after.label","After"),heading:copy("golden.points.after.heading","Later state"),points:[copy("golden.points.three","Placeholder point three"),copy("golden.points.four","Placeholder point four")]}] } }));
    const sides=[...band(root,"points").querySelectorAll("[data-matrix-side]")];expect(sides).toHaveLength(2);expect([...sides[0]!.querySelectorAll("li")].map(node=>node.textContent)).toEqual(["Placeholder point one","Placeholder point two"]);expect([...sides[1]!.querySelectorAll("li")].map(node=>node.textContent)).toEqual(["Placeholder point three","Placeholder point four"]);expect(sides[1]!.querySelector('[data-featured="true"]')).not.toBeNull();
  });
  it("renders a topic-list block as a two-column list", () => {
    const { root } = renderContent(contentBand("topics", { block: BLOCKS.topics }));
    const list = band(root, "topics").querySelector("ul[data-items][data-arrangement=rows]");
    expect(list?.getAttribute("data-columns")).toBe("2");
    expect(list?.querySelectorAll(":scope > li")).toHaveLength(4);
  });

  it("renders an ordered-step-sequence block as an ordered list with a step visual", () => {
    const { root } = renderContent(contentBand("steps", { block: BLOCKS.steps }));
    const section = band(root, "steps");
    expect(section.querySelector("[data-content-section-modules] ol")?.querySelectorAll(":scope > li")).toHaveLength(3);
    const visual = section.querySelector("[data-item-visual] figure[data-specimen]");
    expect(visual?.getAttribute("aria-label")).toBe("Placeholder ledger");
    expect(visual?.textContent).toContain("Placeholder table");
    for(const text of ["Day 1","Placeholder milestone","100 units","Received"])expect(visual?.textContent).toContain(text);
    expect([...section.querySelectorAll("[data-item-ordinal]")].map(node=>node.textContent)).toEqual(["1","2","3"]);
  });

  it("renders a specimen split: the text column, then the media column, on the start side", () => {
    const { root } = renderContent(contentBand("split", { layout: "split-start", block: { type: "items", arrangement: "rows", treatment: "rule", columns: 1, items: [textItem("sa"), textItem("sb")] }, media: specimenMedia("split", recordPanel("record", "Placeholder record")) }));
    const section = band(root, "split");
    expect(section.getAttribute("data-layout")).toBe("split-start");
    expect(section.hasAttribute("data-media-side")).toBe(false);
    expect(section.querySelector("[data-content-section-text] ul[data-items][data-arrangement=rows]")).not.toBeNull();
    const figure = section.querySelector("[data-content-section-media] > figure[data-specimen]");
    expect(figure?.getAttribute("data-arrangement")).toBe("single");
    expect(figure?.getAttribute("aria-label")).toBe("Placeholder specimen showing split");
    expect(figure?.querySelectorAll("[data-specimen-part]")).toHaveLength(3);
  });

  it("recomposes prior multi-panel examples into bounded single panels with their copy, states and connector", () => {
    const { root } = renderContent(
      contentBand("row", { media: specimenMedia("row", combinePanels("row-merged", [ledgerPanel("ledger-row"), holdersPanel("holders-row")])) }),
      contentBand("flow", { media: specimenMedia("flow", combinePanels("flow-merged", [recordPanel("record-flow", "Placeholder first"), ledgerPanel("ledger-flow"), holdersPanel("holders-flow")], copy("golden.specimen.flow.connector", "Placeholder connector"))) }),
    );
    const row = band(root, "row").querySelector("[data-content-section-media] figure[data-specimen]");
    expect(row?.getAttribute("data-arrangement")).toBe("single");
    expect(row?.querySelectorAll("[data-specimen-panel]")).toHaveLength(1);
    for (const text of ["Placeholder ledger", "Placeholder holders", "Placeholder table", "Row one", "Received", "Day 1", "Placeholder milestone", "100 units", "Placeholder holder", "60%", "PDF", "Placeholder file"]) expect(row?.textContent).toContain(text);
    const flow = band(root, "flow").querySelector("[data-content-section-media] figure[data-specimen]");
    expect(flow?.getAttribute("data-arrangement")).toBe("single");
    const fieldRow = [...flow!.querySelectorAll("tr")].find(row => row.textContent?.includes("Field 1"))!;
    expect(fieldRow.querySelector('th[scope="row"]')?.textContent).toBe("Field 1 · Value 1");
    expect(fieldRow.querySelector("td > span:last-child")?.textContent).toBe("Field 2 · Value 2");
    for (const text of ["Placeholder first", "Placeholder meta", "In review", "Placeholder record fields", "Field 1", "Value 1", "Field 2", "Value 2", "Placeholder check", "Within range", "Placeholder ratio", "2.0", "Limit 3.0", "Placeholder ledger", "Placeholder holders", "Placeholder table", "Row one", "Received", "Day 1", "Placeholder milestone", "100 units", "Placeholder holder", "60%", "PDF", "Placeholder file", "Placeholder assignee", "Placeholder note", "Placeholder connector"]) expect(flow?.textContent).toContain(text);
  });

  it("renders disclosed items in a split frame with native server rows", () => {
    const { root } = renderContent(contentBand("questions", { layout: "split-end", eyebrow: copy("golden.questions.eyebrow", "Placeholder eyebrow"), block: BLOCKS.faq }));
    const section = band(root, "questions");
    expect(section.getAttribute("data-layout")).toBe("split-end");
    expect(section.hasAttribute("data-content-section-faq")).toBe(false);
    expect(section.querySelector("[data-content-section-text] h2")?.textContent).toBe("Heading questions");
    const rows = section.querySelectorAll("[data-content-section-modules] details > summary");
    expect([...rows].map((summary) => summary.textContent)).toEqual(["Placeholder question q1?", "Placeholder question q2?", "Placeholder question q3?", "Placeholder question q4?"]);
    expect(section.querySelectorAll("[data-content-section-modules] details")).toHaveLength(4);
  });

  it("resolves an omitted second set-piece action to quiet with a decorative trailing chevron", () => {
    const { root } = renderContent(contentBand("chapter", {
      layout: "split-end",
      media: specimenMedia("chapter", recordPanel("chapter-record", "Placeholder record")),
      block: { type: "items", arrangement: "columns", columns: 3, scale: "statement", treatment: "plain", items: [textItem("fa"), textItem("fb"), textItem("fc")] },
      actions: [{ id: "lead", label: copy("golden.chapter.lead", "Read the guide"), href: "/guide" }, { id: "more", label: copy("golden.chapter.more", "See details"), href: "/details" }],
    }));
    const [lead, more] = [...band(root, "chapter").querySelectorAll<HTMLElement>("[data-section-intro-actions] > a")];
    expect(lead?.className).toBe(OUTLINE_MD);
    expect(lead?.getAttribute("data-action-emphasis")).toBe("secondary");
    expect(more?.getAttribute("data-action-emphasis")).toBe("quiet");
    expect(more?.className.split(" ")).toEqual(expect.arrayContaining(["quiet-action", "text-body", "text-control-quiet"]));
    expect(more?.lastElementChild?.getAttribute("aria-hidden")).toBe("true");
  });

  it("paints the section's ground on its root and inks inverse actions for that ground", () => {
    const { root } = renderContent(contentBand("dark", { ground: "inverse", description: copy("golden.dark.description", "Placeholder lede."), actions: [{ id: "go", label: copy("golden.dark.go", "Continue"), href: "/go" }] }));
    const section = band(root, "dark");
    expect(section.className.split(" ")).toContain("bg-surface-inverse");
    const go = section.querySelector<HTMLElement>('a[href="/go"]');
    expect(go?.className.split(" ")).toEqual(expect.arrayContaining(["text-body", "bg-control-tonal-inverse", "text-ink-on-inverse"]));
    expect(go?.getAttribute("data-action-emphasis")).toBe("tertiary");
    // The outline takes its ink from the row, which carries the inverse ground's primary ink.
    expect(go?.parentElement?.className.split(" ")).toContain("text-ink-on-inverse");
  });

  it("renders every in-section action as a full-size button: primary filled, secondary outline, the same size", () => {
    const { root } = renderContent(contentBand("pair", { actions: [{ id: "a", label: copy("golden.pair.a", "Start a record"), href: "/a", emphasis: "primary" }, { id: "b", label: copy("golden.pair.b", "See an example"), href: "/b", emphasis: "secondary" }] }));
    const [primary, secondary] = [...band(root, "pair").querySelectorAll<HTMLElement>("[data-section-intro-actions] > a")];
    expect(primary?.className).toBe(PRIMARY_MD);
    expect(primary?.getAttribute("data-action-emphasis")).toBe("primary");
    expect(secondary?.className).toBe(OUTLINE_MD);
    expect(secondary?.getAttribute("data-action-emphasis")).toBe("secondary");
    const sizeOf = (className: string) => className.split(" ").filter((token) => /^(px|py|text-body|rounded)-/.test(token) || token === "text-body-l");
    expect(sizeOf(secondary!.className)).toEqual(sizeOf(primary!.className));
    expect(band(root, "pair").querySelectorAll("a.underline")).toHaveLength(0);
  });

  it("closes a split band's text column with the footnote, its one link underlined, and renders none when absent", () => {
    const { root } = renderContent(
      contentBand("aside", { layout: "split-end", block: BLOCKS.topics, footnote: { text: copy("golden.aside.footnote", "Placeholder aside."), link: { label: copy("golden.aside.link", "Placeholder link"), href: "/aside" } } }),
      contentBand("plain", { block: BLOCKS.topics }),
    );
    const note = band(root, "aside").querySelector<HTMLElement>("[data-content-section-footnote]");
    expect(note?.parentElement?.hasAttribute("data-content-section-text")).toBe(true);
    expect(note?.parentElement?.lastElementChild).toBe(note);
    expect(note?.textContent).toBe("Placeholder aside. Placeholder link");
    const links = note!.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute("href")).toBe("/aside");
    expect(links[0]!.className.split(" ")).toContain("underline");
    expect(band(root, "plain").querySelector("[data-content-section-footnote]")).toBeNull();
  });

  it("renders linked block items as one link each, named by the item title, with a decorative chevron", () => {
    const linkedTopics = { ...BLOCKS.topics, items: BLOCKS.topics.items.map((item) => ({ ...item, href: `/topics/${item.id}` })) };
    const linkedSteps = { ...BLOCKS.steps, items: BLOCKS.steps.items.map((step) => ({ ...step, href: `/steps/${step.id}` })) };
    const { root } = renderContent(contentBand("linked-topics", { block: linkedTopics }), contentBand("linked-steps", { block: linkedSteps }));
    const topicLinks = [...band(root, "linked-topics").querySelectorAll<HTMLAnchorElement>("ul[data-items][data-arrangement=rows] > li a")];
    expect(topicLinks.map((link) => [link.getAttribute("href"), link.textContent?.trim()])).toEqual([
      ["/topics/ta", "Item ta"],
      ["/topics/tb", "Item tb"],
      ["/topics/tc", "Item tc"],
      ["/topics/td", "Item td"],
    ]);
    expect(topicLinks.every((link) => link.hasAttribute("data-card-link") && link.querySelector('svg[aria-hidden="true"]') !== null)).toBe(true);
    const stepLinks = [...band(root, "linked-steps").querySelectorAll<HTMLAnchorElement>("ol > li a[data-card-link]")];
    expect(stepLinks.map((link) => link.getAttribute("href"))).toEqual(["/steps/one", "/steps/two", "/steps/three"]);
    // A step's visual stays outside its link: nothing focusable in a specimen.
    expect(band(root, "linked-steps").querySelectorAll("[data-specimen] a")).toHaveLength(0);
  });

  it("puts nothing focusable inside any specimen", () => {
    const { root } = renderContent(
      contentBand("cards", { block: BLOCKS.cards }),
      contentBand("comparison", { block: BLOCKS.comparison }),
      contentBand("steps", { block: BLOCKS.steps }),
      contentBand("flow", { media: specimenMedia("flow", combinePanels("flow-merged", [recordPanel("record-flow", "Placeholder first"), ledgerPanel("ledger-flow"), holdersPanel("holders-flow")], copy("golden.specimen.flow.connector", "Placeholder connector"))) }),
    );
    const figures = [...root.querySelectorAll("[data-specimen]")];
    expect(figures.length).toBe(5);
    for (const figure of figures) {
      expect(figure.querySelectorAll("a, button, input, select, textarea, summary, [tabindex], [contenteditable]")).toHaveLength(0);
    }
  });
});

/** Designer `buttonLinkClassName` at `md`, as an in-section action renders it. */
const PRIMARY_MD =
  "inline-flex items-center justify-center gap-sm rounded-control text-body font-body transition-colors motion-reduce:transition-none px-md py-sm text-body bg-accent text-ink-on-accent hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const OUTLINE_MD =
  "inline-flex items-center justify-center gap-sm rounded-control text-body font-body transition-colors motion-reduce:transition-none px-md py-sm text-body bg-transparent ring-inset ring-current ring-1 hover:ring-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/**
 * Captured from this renderer; Designer `ContentSection` stacked anatomy. A
 * band with no block and no media is a statement band: `SectionIntro` at the
 * display emphasis, its actions a filled primary and an outline secondary
 * button at the same size, as the band's last element: a header-only band
 * with actions takes no footnote.
 */
const INTRO_BAND_HTML =
  "<div class=\"flex flex-col gap-2xl py-2xl\">" +
  "<div id=\"intro\" data-content-section=\"\" class=\"flex w-full flex-col gap-2xl tablet-lg:gap-3xl items-start py-4xl tablet:py-5xl desktop:py-6xl\">" +
  "<div data-content-section-header=\"\" data-section-intro=\"section\" class=\"flex w-full flex-col items-start\" style=\"max-width:var(--ui-width-prose-max, 48rem)\">" +
  "<h2 id=\"intro:heading\" class=\"text-h1 tablet:text-h0 tablet-lg:text-display-m font-display leading-heading text-balance text-ink-primary\">Heading intro" +
  "</h2>" +
  "<p class=\"text-body-l text-pretty text-ink-secondary mt-xl\">Placeholder intro." +
  "</p>" +
  "<div data-section-intro-actions=\"\" class=\"flex flex-wrap items-center gap-x-lg gap-y-sm text-ink-primary mt-2xl\">" +
  "<a href=\"/start\" class=\"inline-flex items-center justify-center gap-sm rounded-control text-body font-body transition-colors motion-reduce:transition-none px-md py-sm text-body bg-accent text-ink-on-accent hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent\" data-action-emphasis=\"primary\">Start a record" +
  "</a>" +
  "<a href=\"/more\" class=\"inline-flex items-center justify-center gap-sm rounded-control text-body font-body transition-colors motion-reduce:transition-none px-md py-sm text-body bg-transparent ring-inset ring-current ring-1 hover:ring-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent\" data-action-emphasis=\"secondary\">Read the guide" +
  "</a>" +
  "</div>" +
  "</div>" +
  "</div>" +
  "</div>";
