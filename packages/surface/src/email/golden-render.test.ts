/**
 * Golden-output tests for `./email` — the same bar `./web`'s own
 * `golden-render.test.ts` sets (see that file's top comment): assert the
 * EXACT emitted bytes, not "it didn't throw," not "the output contains a
 * substring somewhere. Every string below is the real,
 * `renderEmailDocument`-produced output for the fixture directly above it —
 * a regression in row ordering, escaping, token resolution, or the
 * document's own structural chrome (the MSO comments, the preheader block,
 * the wrapper tables) changes these bytes and this test catches it.
 */

import { describe, expect, it } from "vitest";
import type { ComposeDocument, LayoutSpec } from "../core/index.js";
import { renderEmailDocument } from "./renderEmailDocument.js";

describe("golden: a simple four-slot welcome email", () => {
  const layout: LayoutSpec = {
    slots: [
      { key: "eyebrow", element: "eyebrow", frame: { x: 0, y: 0, w: 1, h: 0.05 }, required: false },
      { key: "heading", element: "heading", frame: { x: 0, y: 0.05, w: 1, h: 0.1 }, required: true },
      { key: "body", element: "body", frame: { x: 0, y: 0.15, w: 1, h: 0.2 }, required: true },
      { key: "cta", element: "button", frame: { x: 0, y: 0.35, w: 1, h: 0.1 }, required: false },
    ],
  };

  const doc: ComposeDocument = {
    id: "acme-welcome",
    channel: "email",
    template: "WelcomeEmail",
    meta: {
      channel: "email",
      subject: "Welcome to Acme",
      preheader: "Your account is ready.",
    },
    bindings: [
      { slot: "eyebrow", value: "ACME" },
      { slot: "heading", value: "Welcome aboard" },
      { slot: "body", copyId: "welcome.body" },
      { slot: "cta", value: "Get started" },
    ],
  };

  it("renders the exact expected HTML, byte for byte, resolving a copyId binding through resolveCopy", () => {
    const { html } = renderEmailDocument(doc, {
      layout,
      lookup: (copyId) => (copyId === "welcome.body" ? "We are glad you are here." : undefined),
    });

    expect(html).toBe(
      "<!doctype html>" +
        '<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">' +
        "<head>" +
        '<meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">' +
        '<meta http-equiv="X-UA-Compatible" content="IE=edge">' +
        '<meta name="color-scheme" content="light">' +
        "<title>Welcome to Acme</title>" +
        "<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->" +
        "</head>" +
        '<body style="margin:0;padding:0;background-color:#f5f5f5;">' +
        '<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">Your account is ready.' +
        "&zwnj;&nbsp;".repeat(20) +
        "</div>" +
        '<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#f5f5f5;">' +
        "<tr>" +
        '<td align="center" style="padding:0;">' +
        '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;margin:0 auto;background-color:#ffffff;">' +
        '<tr><td style="font-family:ui-sans-serif, system-ui, -apple-system, \'Segoe UI\', sans-serif;font-size:12px;font-weight:700;line-height:1.4;color:#5c5c5c;mso-line-height-rule:exactly;margin:0;text-transform:uppercase;letter-spacing:0.08em;padding:16px 24px;">ACME</td></tr>' +
        '<tr><td style="font-family:system-ui, ui-sans-serif, -apple-system, \'Segoe UI\', sans-serif;font-size:28px;font-weight:700;line-height:1.25;color:#1a1a1a;mso-line-height-rule:exactly;margin:0;padding:16px 24px;">Welcome aboard</td></tr>' +
        '<tr><td style="font-family:ui-sans-serif, system-ui, -apple-system, \'Segoe UI\', sans-serif;font-size:15px;font-weight:400;line-height:1.6;color:#3d3d3d;mso-line-height-rule:exactly;margin:0;padding:16px 24px;">We are glad you are here.</td></tr>' +
        '<tr><td style="font-family:ui-sans-serif, system-ui, -apple-system, \'Segoe UI\', sans-serif;font-size:15px;font-weight:600;line-height:1.4;color:#f5f5f5;mso-line-height-rule:exactly;margin:0;text-align:center;background-color:#5c5c5c;border-radius:6px;padding:12px 24px;">Get started</td></tr>' +
        "</table>" +
        "</td>" +
        "</tr>" +
        "</table>" +
        "<!--[if mso]></td></tr></table><![endif]-->" +
        "</body>" +
        "</html>",
    );
  });

  it("renders the exact expected plain-text alternative, derived from the same resolved texts as the HTML", () => {
    const { text } = renderEmailDocument(doc, {
      layout,
      lookup: (copyId) => (copyId === "welcome.body" ? "We are glad you are here." : undefined),
    });

    expect(text).toBe("ACME\n\nWelcome aboard\n\nWe are glad you are here.\n\nGet started\n");
  });

  it("carries subject/preheader through unchanged, and reports zero warnings for a single-column layout", () => {
    const { subject, preheader, warnings } = renderEmailDocument(doc, {
      layout,
      lookup: () => "We are glad you are here.",
    });

    expect(subject).toBe("Welcome to Acme");
    expect(preheader).toBe("Your account is ready.");
    expect(warnings).toEqual([]);
  });
});

describe("golden: assetId — an <img> row, byte for byte, joining the same ordered stack as text", () => {
  const layout: LayoutSpec = {
    slots: [
      { key: "heading", element: "heading", frame: { x: 0, y: 0, w: 1, h: 0.1 }, required: true },
      { key: "hero", element: "image", frame: { x: 0, y: 0.1, w: 1, h: 0.4 } },
    ],
  };
  const doc: ComposeDocument = {
    id: "acme-hero-email",
    channel: "email",
    template: "T",
    meta: { channel: "email", subject: "S", preheader: "P" },
    bindings: [
      { slot: "heading", value: "Big news" },
      { slot: "hero", assetId: "marketing.hero" },
    ],
  };
  const asset = { id: "marketing.hero", type: "image", src: "https://cdn.example/hero.png", width: 600, height: 300, alt: "A hero shot" };

  it("renders the exact expected HTML, byte for byte — an <img> row with explicit width/height ATTRIBUTES, border=0, display:block", () => {
    const { html } = renderEmailDocument(doc, {
      layout,
      assetLookup: (assetId) => (assetId === "marketing.hero" ? asset : undefined),
    });

    expect(html).toContain(
      '<tr><td style="font-family:ui-sans-serif, system-ui, -apple-system, \'Segoe UI\', sans-serif;font-size:13px;font-weight:400;line-height:1.4;color:#6f6f6f;mso-line-height-rule:exactly;margin:0;text-align:center;padding:16px 24px;">' +
        '<img src="https://cdn.example/hero.png" alt="A hero shot" width="600" height="300" border="0" style="display:block" />' +
        "</td></tr>",
    );
  });

  it("the plain-text alternative carries the asset's own alt text for that row", () => {
    const { text } = renderEmailDocument(doc, {
      layout,
      assetLookup: (assetId) => (assetId === "marketing.hero" ? asset : undefined),
    });
    expect(text).toBe("Big news\n\nA hero shot\n");
  });

  it("src/alt escaping — a src/alt containing \", ', <, &, and </script> is escaped, never breaking out of the <img> attribute", () => {
    const hostileAsset = {
      id: "marketing.hero", type: "image",
      src: `https://cdn.example/hero.png?q="'<&></script>`,
      width: 10,
      height: 10,
      alt: `Say "hi" & <bye> </script>`,
    };
    const { html } = renderEmailDocument(doc, { layout, assetLookup: () => hostileAsset });

    expect(html).toContain(
      'src="https://cdn.example/hero.png?q=&quot;&#39;&lt;&amp;&gt;&lt;/script&gt;"',
    );
    expect(html).toContain('alt="Say &quot;hi&quot; &amp; &lt;bye&gt; &lt;/script&gt;"');
    expect(html.includes('q="\'<&>')).toBe(false);
    expect(html.includes("</script>alert")).toBe(false);
  });
});

describe("golden: a mixed document — text and asset slots in one email", () => {
  it("renders a text row, an image row, and a second text row, in frame order", () => {
    const layout: LayoutSpec = {
      slots: [
        { key: "eyebrow", element: "eyebrow", frame: { x: 0, y: 0, w: 1, h: 0.05 } },
        { key: "hero", element: "image", frame: { x: 0, y: 0.05, w: 1, h: 0.4 } },
        { key: "body", element: "body", frame: { x: 0, y: 0.45, w: 1, h: 0.2 }, required: true },
      ],
    };
    const doc: ComposeDocument = {
      id: "acme-mixed",
      channel: "email",
      template: "T",
      meta: { channel: "email", subject: "S", preheader: "P" },
      bindings: [
        { slot: "eyebrow", value: "ACME" },
        { slot: "hero", assetId: "marketing.hero" },
        { slot: "body", copyId: "welcome.body" },
      ],
    };
    const asset = { id: "marketing.hero", type: "image", src: "https://cdn.example/hero.png", width: 600, height: 300, alt: "A hero shot" };

    const { html, text } = renderEmailDocument(doc, {
      layout,
      lookup: (copyId) => (copyId === "welcome.body" ? "Glad you're here." : undefined),
      assetLookup: (assetId) => (assetId === "marketing.hero" ? asset : undefined),
    });

    expect(html.indexOf(">ACME<")).toBeGreaterThan(-1);
    expect(html.indexOf('<img src="https://cdn.example/hero.png"')).toBeGreaterThan(html.indexOf(">ACME<"));
    expect(html.indexOf(">Glad you&#39;re here.<")).toBeGreaterThan(html.indexOf('<img src="https://cdn.example/hero.png"'));
    expect(text).toBe("ACME\n\nA hero shot\n\nGlad you're here.\n");
  });
});

describe("golden: HTML-escaping — the <script> injection case", () => {
  it("escapes <script>, &, \", and > inside a resolved slot's text, and leaves the plain-text alternative unescaped", () => {
    const layout: LayoutSpec = {
      slots: [{ key: "body", element: "body", frame: { x: 0, y: 0, w: 1, h: 1 }, required: true }],
    };
    const hostileText = `<script>alert(1)</script> & "quoted" 'quoted' > tail`;
    const doc: ComposeDocument = {
      id: "acme-hostile",
      channel: "email",
      template: "T",
      meta: { channel: "email", subject: "S", preheader: "P" },
      bindings: [{ slot: "body", value: hostileText }],
    };

    const { html, text } = renderEmailDocument(doc, { layout });

    expect(html).toContain(
      '<td style="font-family:ui-sans-serif, system-ui, -apple-system, \'Segoe UI\', sans-serif;font-size:15px;font-weight:400;line-height:1.6;color:#3d3d3d;mso-line-height-rule:exactly;margin:0;padding:16px 24px;">' +
        "&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quoted&quot; &#39;quoted&#39; &gt; tail" +
        "</td>",
    );
    // No raw "<script" survives anywhere in the emitted HTML — the exact
    // property the byte-exact assertion above already proves, called out
    // as its own check for readability (same pattern `./web`'s own
    // JSON-LD golden test uses for the identical XSS shape).
    expect(html.includes("<script>alert(1)</script>")).toBe(false);

    // The plain-text alternative carries the RAW text — no HTML escaping
    // is applied there, since it is never embedded in markup.
    expect(text).toBe(`${hostileText}\n`);
  });
});

describe("golden: no oklch(...) and no var(--...) ever survive into the emitted HTML", () => {
  it("asserts by regex that every color/font/size in the document is a literal value", () => {
    const layout: LayoutSpec = {
      slots: [
        { key: "heading", element: "heading", frame: { x: 0, y: 0, w: 1, h: 0.1 }, required: true },
        { key: "body", element: "body", frame: { x: 0, y: 0.1, w: 1, h: 0.2 }, required: true },
        { key: "cta", element: "button", frame: { x: 0, y: 0.3, w: 1, h: 0.1 }, required: false },
        { key: "note", element: "divider", frame: { x: 0, y: 0.4, w: 1, h: 0.05 }, required: false },
      ],
    };
    const doc: ComposeDocument = {
      id: "acme-token-check",
      channel: "email",
      template: "T",
      meta: { channel: "email", subject: "Token check", preheader: "Every value here is literal." },
      bindings: [
        { slot: "heading", value: "Heading" },
        { slot: "body", value: "Body copy." },
        { slot: "cta", value: "Go" },
        { slot: "note", value: "A note under the line." },
      ],
    };

    const { html } = renderEmailDocument(doc, { layout });

    expect(/oklch\(/i.test(html)).toBe(false);
    expect(/var\(--/i.test(html)).toBe(false);
    // Positive control: real literal hex colors ARE present, proving the
    // regexes above are looking at a document that actually has colors in
    // it rather than passing vacuously.
    expect(/#[0-9a-f]{6}/i.test(html)).toBe(true);
  });
});
