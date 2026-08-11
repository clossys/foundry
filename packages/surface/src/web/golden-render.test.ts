/**
 * Golden-output tests — the requirement this package's own delivery report
 * calls out by name. Each case here renders a REAL `ComposeDocument`
 * through the REAL `@vespeneventures/ui` views (`ErrorView`, `AuthView`)
 * via `react-dom/server`'s `renderToStaticMarkup`, and asserts the EXACT
 * emitted HTML string — not "it didn't throw", not "the output contains
 * some substring somewhere", the actual bytes a browser would receive.
 *
 * Why this matters, concretely: this is what would have caught a
 * regression where `AuthView`'s prop wiring silently swapped `heading` and
 * `description`, or where `Card`'s className stopped merging correctly, or
 * where a future `@vespeneventures/ui` bump reordered DOM nodes — none of
 * which a "did it throw" test or a substring match would ever notice.
 * `docs`/the task brief for this package cites the exact precedent this is
 * built against: a researched decision to adopt `react-email` in a prior
 * renderer was reversed specifically because a golden test asserting real
 * output already proved the incumbent worked, and nothing justified the
 * migration risk. That is only possible when the golden test asserts real
 * bytes, not a shape a rewrite could accidentally still satisfy.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ComposeDocument } from "../core/index.js";
import { renderWebDocument } from "./renderWebDocument.js";

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
      '<div class="flex min-h-dvh flex-col items-center justify-center gap-lg p-xl">' +
        '<div class="rounded-control bg-surface-raised p-lg flex w-full max-w-sm flex-col gap-lg" ' +
        'style="box-shadow:var(--ui-elevation-raised, 0 1px 0 var(--color-line-base, oklch(0.8761 0 0)))">' +
        '<div class="flex flex-col gap-xs text-center">' +
        '<h1 class="text-h1 font-display text-ink-primary">Sign in</h1>' +
        '<p class="text-body text-ink-secondary">Welcome back.</p>' +
        "</div>" +
        "email + password form" +
        "</div>" +
        '<p class="text-center text-body-s text-ink-muted">\u00A9 2026 Acme</p>' +
        "</div>",
    );
  });
});

describe("golden: assetId — a real <img>, byte for byte, alt text and intrinsic dimensions included", () => {
  const asset = { id: "marketing.logo", src: "https://cdn.example/logo.svg", width: 120, height: 40, alt: "Acme logo" };

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
        '<div class="flex min-h-dvh flex-col items-center justify-center gap-lg p-xl">' +
        '<div class="flex justify-center">' +
        '<img src="https://cdn.example/logo.svg" alt="Acme logo" width="120" height="40"/>' +
        "</div>" +
        '<div class="rounded-control bg-surface-raised p-lg flex w-full max-w-sm flex-col gap-lg" ' +
        'style="box-shadow:var(--ui-elevation-raised, 0 1px 0 var(--color-line-base, oklch(0.8761 0 0)))">' +
        '<div class="flex flex-col gap-xs text-center">' +
        '<h1 class="text-h1 font-display text-ink-primary">Sign in</h1>' +
        "</div>" +
        "email + password form" +
        "</div>" +
        "</div>",
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
      id: "marketing.logo",
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
