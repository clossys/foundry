/**
 * Golden-output tests — the same bar `../web/golden-render.test.ts` is
 * built against (see its own doc comment): each case renders a REAL
 * `ComposeDocument` through the REAL `renderPrintDocument`, and asserts
 * the EXACT emitted HTML string — not "it didn't throw", not "the output
 * contains some substring somewhere", the actual bytes a browser's print
 * pipeline (or a downstream rasterizer) would receive.
 */

import { describe, expect, it } from "vitest";
import type { ComposeDocument } from "../core/index.js";
import { renderPrintDocument } from "./renderPrintDocument.js";

// The real `@vespeneventures/designer/tokens` `--font-display`/`--font-body`
// literals, rewritten single-quote-safe for embedding in a double-quoted
// HTML `style="..."` attribute — see `internal/style.ts`'s own
// `toAttributeSafeCss`.
const FONT_DISPLAY_ATTR = "system-ui, ui-sans-serif, -apple-system, 'Segoe UI', sans-serif";
const FONT_BODY_ATTR = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";

describe("golden: A4 flyer — bleed, crop marks, page background, style roles, break-after, vAlign", () => {
  const doc: ComposeDocument = {
    id: "acme-flyer",
    channel: "print",
    template: "Flyer",
    meta: {
      channel: "print",
      pageSize: "A4",
      orientation: "portrait",
      margins: { top: "20mm", right: "15mm", bottom: "20mm", left: "15mm" },
      bleed: "3mm",
      cropMarks: true,
      dpi: 300,
    },
    layout: {
      background: { background: "--color-surface-base" },
      slots: [
        { key: "logo", element: "logo", frame: { x: 0, y: 0, w: 0.3, h: 0.1 } },
        {
          key: "headline",
          element: "heading",
          frame: { x: 0, y: 0.15, w: 1, h: 0.15 },
          required: true,
          align: "center",
          style: { color: "--color-ink-primary" },
        },
        {
          key: "body",
          element: "body",
          frame: { x: 0.1, y: 0.35, w: 0.8, h: 0.4 },
          vAlign: "middle",
        },
      ],
    },
    bindings: [
      { slot: "logo", value: "ACME" },
      { slot: "headline", copyId: "flyer.headline" },
      { slot: "body", value: "Join us for the launch event." },
    ],
  };

  it("renders the exact expected HTML+CSS document, byte for byte", () => {
    const { html } = renderPrintDocument(doc, {
      resolveCopyId: (id) => (id === "flyer.headline" ? "Grand Opening" : undefined),
      breakAfter: ["headline"],
    });

    expect(html).toBe(
      "<!doctype html>" +
        '<html lang="en">' +
        "<head>" +
        '<meta charset="utf-8">' +
        "<title>acme-flyer</title>" +
        "<style>" +
        "@page{size:A4 portrait;margin-top:20mm;margin-right:15mm;margin-bottom:20mm;margin-left:15mm;bleed:3mm;marks:crop;}" +
        "*{box-sizing:border-box;}html,body{margin:0;padding:0;}" +
        "</style>" +
        "</head>" +
        "<body>" +
        '<div class="page" data-template="Flyer" ' +
        'style="position:relative;width:210mm;height:297mm;background-color:#f5f5f5">' +
        '<div class="page-content" style="position:absolute;top:20mm;right:15mm;bottom:20mm;left:15mm">' +
        '<div class="slot" data-slot="logo" data-element="logo" ' +
        `style="position:absolute;left:0%;top:0%;width:30%;height:10%;font-family:${FONT_DISPLAY_ATTR};font-size:18px;break-inside:avoid;page-break-inside:avoid">` +
        "ACME</div>" +
        '<div class="slot" data-slot="headline" data-element="heading" ' +
        `style="position:absolute;left:0%;top:15%;width:100%;height:15%;text-align:center;font-family:${FONT_DISPLAY_ATTR};font-size:28px;color:#1a1a1a;` +
        'break-inside:avoid;page-break-inside:avoid;break-after:page;page-break-after:always">' +
        "Grand Opening</div>" +
        '<div class="slot" data-slot="body" data-element="body" ' +
        `style="position:absolute;left:10%;top:35%;width:80%;height:40%;display:flex;flex-direction:column;` +
        `justify-content:center;font-family:${FONT_BODY_ATTR};font-size:15px;break-inside:avoid;page-break-inside:avoid">` +
        "Join us for the launch event.</div>" +
        "</div>" +
        "</div>" +
        "</body>" +
        "</html>",
    );
  });

  it("carries meta.dpi through to the result unchanged, without using it to change any rendering", () => {
    const { page } = renderPrintDocument(doc, {
      resolveCopyId: (id) => (id === "flyer.headline" ? "Grand Opening" : undefined),
    });
    expect(page.dpi).toBe(300);
  });
});

describe("golden: Custom-sized landscape business card — no bleed/marks/background, HTML-escaped text", () => {
  const doc: ComposeDocument = {
    id: "biz-card",
    channel: "print",
    template: "BusinessCard",
    meta: {
      channel: "print",
      pageSize: "Custom",
      orientation: "landscape",
      margins: { top: "0", right: "0", bottom: "0", left: "0" },
    },
    layout: {
      slots: [{ key: "name", element: "heading", frame: { x: 0.05, y: 0.1, w: 0.9, h: 0.3 }, required: true }],
    },
    bindings: [{ slot: "name", value: "Jane & <Doe>" }],
  };

  it("renders the exact expected HTML, with a raw length pair in @page's size (no orientation keyword) and escaped text content", () => {
    const { html } = renderPrintDocument(doc, { customPageSize: { width: "3.5in", height: "2in" } });

    expect(html).toBe(
      "<!doctype html>" +
        '<html lang="en">' +
        "<head>" +
        '<meta charset="utf-8">' +
        "<title>biz-card</title>" +
        "<style>" +
        "@page{size:3.5in 2in;margin-top:0;margin-right:0;margin-bottom:0;margin-left:0;}" +
        "*{box-sizing:border-box;}html,body{margin:0;padding:0;}" +
        "</style>" +
        "</head>" +
        "<body>" +
        '<div class="page" data-template="BusinessCard" style="position:relative;width:3.5in;height:2in">' +
        '<div class="page-content" style="position:absolute;top:0;right:0;bottom:0;left:0">' +
        '<div class="slot" data-slot="name" data-element="heading" ' +
        `style="position:absolute;left:5%;top:10%;width:90%;height:30%;font-family:${FONT_DISPLAY_ATTR};font-size:28px;break-inside:avoid;page-break-inside:avoid">` +
        "Jane &amp; &lt;Doe&gt;</div>" +
        "</div>" +
        "</div>" +
        "</body>" +
        "</html>",
    );
  });

  it("the escaped text proves no raw < or > from the binding survives verbatim", () => {
    const { html } = renderPrintDocument(doc, { customPageSize: { width: "3.5in", height: "2in" } });
    expect(html).not.toContain("Jane & <Doe>");
    expect(html).toContain("Jane &amp; &lt;Doe&gt;");
  });
});

describe("golden: assetId — an <img> positioned by the slot's frame, exactly like a text slot", () => {
  const doc: ComposeDocument = {
    id: "acme-flyer-hero",
    channel: "print",
    template: "Flyer",
    meta: {
      channel: "print",
      pageSize: "A4",
      orientation: "portrait",
      margins: { top: "20mm", right: "20mm", bottom: "20mm", left: "20mm" },
    },
    layout: {
      slots: [
        { key: "title", element: "heading", frame: { x: 0, y: 0, w: 1, h: 0.2 }, required: true },
        { key: "hero", element: "image", frame: { x: 0.1, y: 0.25, w: 0.8, h: 0.4 } },
      ],
    },
    bindings: [
      { slot: "title", value: "Grand Opening" },
      { slot: "hero", assetId: "marketing.hero" },
    ],
  };
  const asset = { id: "marketing.hero", type: "image", src: "https://cdn.example/hero.png", width: 800, height: 400, alt: "Storefront photo" };

  it("renders the exact expected HTML, byte for byte — object-fit:contain so a mismatched aspect ratio never distorts", () => {
    const { html } = renderPrintDocument(doc, {
      resolveAssetId: (assetId) => (assetId === "marketing.hero" ? asset : undefined),
    });

    expect(html).toBe(
      "<!doctype html>" +
        '<html lang="en">' +
        "<head>" +
        '<meta charset="utf-8">' +
        "<title>acme-flyer-hero</title>" +
        "<style>" +
        "@page{size:A4 portrait;margin-top:20mm;margin-right:20mm;margin-bottom:20mm;margin-left:20mm;}" +
        "*{box-sizing:border-box;}html,body{margin:0;padding:0;}" +
        "</style>" +
        "</head>" +
        "<body>" +
        '<div class="page" data-template="Flyer" style="position:relative;width:210mm;height:297mm">' +
        '<div class="page-content" style="position:absolute;top:20mm;right:20mm;bottom:20mm;left:20mm">' +
        '<div class="slot" data-slot="title" data-element="heading" ' +
        `style="position:absolute;left:0%;top:0%;width:100%;height:20%;font-family:${FONT_DISPLAY_ATTR};font-size:28px;break-inside:avoid;page-break-inside:avoid">` +
        "Grand Opening</div>" +
        '<div class="slot" data-slot="hero" data-element="image" ' +
        'style="position:absolute;left:10%;top:25%;width:80%;height:40%;break-inside:avoid;page-break-inside:avoid">' +
        '<img src="https://cdn.example/hero.png" alt="Storefront photo" style="width:100%;height:100%;object-fit:contain;display:block" />' +
        "</div>" +
        "</div>" +
        "</div>" +
        "</body>" +
        "</html>",
    );
  });

  it("src/alt escaping — a src/alt containing \", ', <, &, and </script> is escaped, never breaking out of the <img> attribute", () => {
    const hostileAsset = {
      id: "marketing.hero", type: "image",
      src: `https://cdn.example/hero.png?q="'<&></script>`,
      width: 10,
      height: 10,
      alt: `A "storefront" & <sign> </script>`,
    };
    const { html } = renderPrintDocument(doc, { resolveAssetId: () => hostileAsset });

    // print's escapeHtmlAttr escapes &, <, >, " (not ' — safe as-is inside a
    // double-quoted HTML attribute, the same convention this channel's
    // own escape.ts documents) — see this test's own assertions below for
    // exactly what that means for a src containing a raw apostrophe.
    expect(html).toContain('src="https://cdn.example/hero.png?q=&quot;\'&lt;&amp;&gt;&lt;/script&gt;"');
    expect(html).toContain('alt="A &quot;storefront&quot; &amp; &lt;sign&gt; &lt;/script&gt;"');
    expect(html.includes('q="\'<&>')).toBe(false);
    expect(html.includes("</script>alert")).toBe(false);
  });

  it("a mixed document — text and asset slots on the same page — both render", () => {
    const { html } = renderPrintDocument(doc, {
      resolveAssetId: (assetId) => (assetId === "marketing.hero" ? asset : undefined),
    });
    expect(html).toContain(">Grand Opening<");
    expect(html).toContain('<img src="https://cdn.example/hero.png"');
  });
});
