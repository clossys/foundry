/**
 * Golden-output tests for `./image` — the bar `src/web/golden-render.test.ts`
 * sets for this whole package: assert the EXACT emitted SVG string, byte
 * for byte, not "it didn't throw" and not a substring match. See that
 * file's own top comment for the fuller argument.
 *
 * Every number asserted below is also hand-computed and stated in this
 * package's PR description — this file is the executable form of that
 * arithmetic, not a separate claim.
 */

import { describe, expect, it } from "vitest";
import type { ComposeDocument } from "../core/index.js";
import { renderImageDocument } from "./renderImageDocument.js";

// `@vespeneventures/ui/tokens`' real `--font-display`/`--font-body` literals,
// XML-attribute-escaped (their embedded `"Segoe UI"` double quotes become
// `&quot;`) — see `../internal/typography.ts`'s `resolveElementFontFamily`
// and `escapeXml`. Declared once here so a token wording change updates
// every golden string below in one place, not N independent ones.
const FONT_DISPLAY_XML = 'system-ui, ui-sans-serif, -apple-system, &quot;Segoe UI&quot;, sans-serif';
const FONT_BODY_XML = 'ui-sans-serif, system-ui, -apple-system, &quot;Segoe UI&quot;, sans-serif';

describe("golden: a real OG-card-shaped image document", () => {
  const doc: ComposeDocument = {
    id: "acme-og-card",
    channel: "image",
    template: "og-card",
    meta: { channel: "image", width: 1200, height: 630, format: "svg", alt: "Acme — build faster" },
    layout: {
      background: { background: "--color-surface-base" },
      slots: [
        { key: "eyebrow", element: "eyebrow", frame: { x: 0.08, y: 0.1, w: 0.6, h: 0.08 }, style: { color: "--color-ink-secondary" } },
        { key: "headline", element: "heading", frame: { x: 0.08, y: 0.22, w: 0.84, h: 0.4 }, required: true, style: { color: "--color-ink-primary" } },
        { key: "divider", element: "divider", frame: { x: 0.08, y: 0.85, w: 0.84, h: 0.02 } },
      ],
    },
    bindings: [
      { slot: "eyebrow", value: "Product update" },
      { slot: "headline", value: "Ship faster with Acme" },
      { slot: "divider", value: "unused" },
    ],
  };

  it("renders the exact expected SVG, byte for byte", () => {
    const result = renderImageDocument(doc);

    expect(result.svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="Acme — build faster">' +
        "<title>Acme — build faster</title>" +
        '<rect x="0" y="0" width="1200" height="630" fill="#f5f5f5" />' +
        `<g data-slot="eyebrow"><text x="96" y="72.6" font-size="12" font-family="${FONT_BODY_XML}" fill="#3d3d3d" text-anchor="start">` +
        '<tspan x="96" dy="0">Product update</tspan></text></g>' +
        `<g data-slot="headline"><text x="96" y="161" font-size="28" font-family="${FONT_DISPLAY_XML}" fill="#1a1a1a" text-anchor="start">` +
        '<tspan x="96" dy="0">Ship faster with Acme</tspan></text></g>' +
        '<g data-slot="divider"><line x1="96" y1="541.8" x2="1104" y2="541.8" stroke="#cccccc" stroke-width="1" /></g>' +
        "</svg>",
    );
    expect(result.warnings).toEqual([]);
  });

  it("HAND-COMPUTED geometry: eyebrow slot {x:0.08,y:0.1,w:0.6,h:0.08} on 1200x630 -> x=96,y=63,w=720,h=50.4; \"eyebrow\" resolves to --text-caption=12px (ELEMENT_TYPOGRAPHY_ROLE) -> first baseline = 63 + 12*0.8 = 72.6", () => {
    const result = renderImageDocument(doc);
    expect(result.svg).toContain('<tspan x="96" dy="0">Product update</tspan>');
    expect(result.svg).toContain('y="72.6"');
  });

  it("HAND-COMPUTED geometry: headline slot {x:0.08,y:0.22,w:0.84,h:0.4} on 1200x630 -> x=96,y=138.6; \"heading\" resolves to --text-h1=28px -> first baseline = 138.6 + 28*0.8 = 161", () => {
    const result = renderImageDocument(doc);
    expect(result.svg).toContain('y="161"');
  });

  it("HAND-COMPUTED geometry: divider slot {x:0.08,y:0.85,w:0.84,h:0.02} on 1200x630 -> x1=96, x2=96+1008=1104, y=535.5+6.3=541.8", () => {
    const result = renderImageDocument(doc);
    expect(result.svg).toContain('x1="96" y1="541.8" x2="1104" y2="541.8"');
  });

  it("no oklch() or var(--...) survives anywhere in the emitted SVG", () => {
    const result = renderImageDocument(doc);
    expect(result.svg).not.toMatch(/oklch\(/i);
    expect(result.svg).not.toMatch(/var\(--/);
  });
});

describe("golden: geometry — a slot at {x:0.25,y:0.5,w:0.5,h:0.25} on a 1920x1080 canvas", () => {
  it("lands at exactly x=480, y=540, w=960, h=270", () => {
    const doc: ComposeDocument = {
      id: "geometry-check",
      channel: "image",
      template: "geometry-check",
      meta: { channel: "image", width: 1920, height: 1080, format: "svg", alt: "geometry check" },
      layout: {
        slots: [{ key: "block", element: "fill", frame: { x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, style: { background: "--color-surface-raised" }, required: true }],
      },
      bindings: [{ slot: "block", value: "content" }],
    };
    const result = renderImageDocument(doc);
    expect(result.svg).toContain('<rect x="480" y="540" width="960" height="270"');
  });
});

describe("golden: scale 2 — width/height double, viewBox stays logical", () => {
  it("hand-computed: 1200x630 at scale 2 -> attrs 2400x1260, viewBox stays '0 0 1200 630'", () => {
    const doc: ComposeDocument = {
      id: "scale-check",
      channel: "image",
      template: "scale-check",
      meta: { channel: "image", width: 1200, height: 630, format: "svg", scale: 2, alt: "scale check" },
      layout: { slots: [{ key: "body", element: "body", frame: { x: 0, y: 0, w: 1, h: 1 }, required: true }] },
      bindings: [{ slot: "body", value: "x" }],
    };
    const result = renderImageDocument(doc);
    expect(result.width).toBe(2400);
    expect(result.height).toBe(1260);
    expect(result.viewBox).toEqual({ width: 1200, height: 630 });
    expect(result.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1260" viewBox="0 0 1200 630"')).toBe(true);
  });
});

describe("golden: XML escaping — the nasty-character fixture", () => {
  it("escapes <, &, \", ', and ]]> in both alt text and slot text, byte for byte", () => {
    const doc: ComposeDocument = {
      id: "escaping-fixture",
      channel: "image",
      template: "escaping-fixture",
      meta: { channel: "image", width: 400, height: 200, format: "svg", alt: `<alt> & "quote" 'apos' ]]>` },
      layout: { slots: [{ key: "body", element: "body", frame: { x: 0, y: 0, w: 1, h: 1 }, required: true }] },
      bindings: [{ slot: "body", value: `<b>&"'"</b> ]]> end` }],
    };
    const result = renderImageDocument(doc);

    expect(result.svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200" role="img" ' +
        'aria-label="&lt;alt&gt; &amp; &quot;quote&quot; &apos;apos&apos; ]]&gt;">' +
        "<title>&lt;alt&gt; &amp; &quot;quote&quot; &apos;apos&apos; ]]&gt;</title>" +
        `<g data-slot="body"><text x="0" y="12" font-size="15" font-family="${FONT_BODY_XML}" fill="#111111" text-anchor="start">` +
        '<tspan x="0" dy="0">&lt;b&gt;&amp;&quot;&apos;&quot;&lt;/b&gt; ]]&gt; end</tspan></text></g>' +
        "</svg>",
    );

    // No raw "<" or literal "]]>" survives anywhere except the one real <svg>/<title>/<g>/<text>/<tspan> tag structure this function itself emits.
    expect(result.svg.includes("]]>")).toBe(false);
  });
});

describe("golden: assetId — a real <image>, byte for byte, alt in <title>+aria-label, aspect-ratio-aware", () => {
  const doc: ComposeDocument = {
    id: "acme-hero-card",
    channel: "image",
    template: "og-card",
    meta: { channel: "image", width: 1200, height: 630, format: "svg", alt: "Acme card" },
    layout: {
      slots: [
        { key: "headline", element: "heading", frame: { x: 0.08, y: 0.08, w: 0.84, h: 0.2 }, style: { color: "--color-ink-primary" } },
        { key: "hero", element: "image", frame: { x: 0.1, y: 0.3, w: 0.8, h: 0.5 } },
      ],
    },
    bindings: [
      { slot: "headline", value: "Ship faster" },
      { slot: "hero", assetId: "marketing.hero" },
    ],
  };

  it("renders the exact expected SVG, byte for byte, when the asset's aspect ratio MATCHES the frame's — no warning fires", () => {
    // frame {x:0.1,y:0.3,w:0.8,h:0.5} on 1200x630 -> x=120,y=189,w=960,h=315
    // -> frame aspect 960/315 = 3.0476..; asset chosen at exactly that ratio.
    const matchedAsset = { id: "marketing.hero", src: "https://cdn.example/hero.png", width: 1920, height: 630, alt: "A hero shot" };
    const result = renderImageDocument(doc, { resolveAssetId: () => matchedAsset });

    expect(result.svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="Acme card">' +
        "<title>Acme card</title>" +
        `<g data-slot="headline"><text x="96" y="72.8" font-size="28" font-family="${FONT_DISPLAY_XML}" fill="#1a1a1a" text-anchor="start">` +
        '<tspan x="96" dy="0">Ship faster</tspan></text></g>' +
        '<g data-slot="hero"><image x="120" y="189" width="960" height="315" href="https://cdn.example/hero.png" ' +
        'preserveAspectRatio="xMidYMid slice" aria-label="A hero shot"><title>A hero shot</title></image></g>' +
        "</svg>",
    );
    expect(result.warnings).toEqual([]);
  });

  it("fires an aspect-ratio warning when the asset's own ratio disagrees with the frame's — 'image' kind is filled/cropped (xMidYMid slice), never distorted", () => {
    const mismatchedAsset = { id: "marketing.hero", src: "https://cdn.example/hero-square.png", width: 500, height: 500, alt: "A square hero shot" };
    const result = renderImageDocument(doc, { resolveAssetId: () => mismatchedAsset });

    expect(result.svg).toContain('preserveAspectRatio="xMidYMid slice"');
    expect(result.warnings).toEqual([
      'slot "hero" (element "image") asset\'s intrinsic aspect ratio (500x500, 1.000) disagrees with its frame\'s aspect ratio (960x315, 3.048) — rendered filled and cropped via preserveAspectRatio="xMidYMid slice" rather than distorted.',
    ]);
  });

  it("a 'logo' kind is letterboxed (xMidYMid meet), never cropped, and warns identically when its ratio disagrees with the frame's", () => {
    const logoDoc: ComposeDocument = {
      id: "logo-doc",
      channel: "image",
      template: "og-card",
      meta: { channel: "image", width: 400, height: 200, format: "svg", alt: "logo card" },
      layout: { slots: [{ key: "brand", element: "logo", frame: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 } }] },
      bindings: [{ slot: "brand", assetId: "marketing.logo" }],
    };
    const wideLogo = { id: "marketing.logo", src: "https://cdn.example/logo.svg", width: 300, height: 60, alt: "Acme wordmark" };
    const result = renderImageDocument(logoDoc, { resolveAssetId: () => wideLogo });

    expect(result.svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200" role="img" aria-label="logo card">' +
        "<title>logo card</title>" +
        '<g data-slot="brand"><image x="40" y="20" width="120" height="60" href="https://cdn.example/logo.svg" ' +
        'preserveAspectRatio="xMidYMid meet" aria-label="Acme wordmark"><title>Acme wordmark</title></image></g>' +
        "</svg>",
    );
    expect(result.warnings).toEqual([
      'slot "brand" (element "logo") asset\'s intrinsic aspect ratio (300x60, 5.000) disagrees with its frame\'s aspect ratio (120x60, 2.000) — rendered letterboxed (never cropped) via preserveAspectRatio="xMidYMid meet" rather than distorted.',
    ]);
  });

  it("src/alt escaping — a src/alt containing <, &, \", ', and ]]> is escaped, byte for byte, never breaking out of the <image> attributes", () => {
    const hostileAsset = {
      id: "marketing.hero",
      src: `https://cdn.example/hero.png?q=<&>"'</script>]]>`,
      width: 1920,
      height: 630,
      alt: `<alt> & "quote" 'apos' </script> ]]>`,
    };
    const result = renderImageDocument(doc, { resolveAssetId: () => hostileAsset });

    expect(result.svg).toContain(
      '<image x="120" y="189" width="960" height="315" href="https://cdn.example/hero.png?q=&lt;&amp;&gt;&quot;&apos;&lt;/script&gt;]]&gt;" ' +
        'preserveAspectRatio="xMidYMid slice" aria-label="&lt;alt&gt; &amp; &quot;quote&quot; &apos;apos&apos; &lt;/script&gt; ]]&gt;">' +
        "<title>&lt;alt&gt; &amp; &quot;quote&quot; &apos;apos&apos; &lt;/script&gt; ]]&gt;</title></image>",
    );
    expect(result.svg.includes("]]>")).toBe(false);
    expect(result.svg.includes("</script>")).toBe(false);
  });

  it("a mixed document — a text heading and an assetId hero image — renders both", () => {
    const matchedAsset = { id: "marketing.hero", src: "https://cdn.example/hero.png", width: 1920, height: 630, alt: "A hero shot" };
    const result = renderImageDocument(doc, { resolveAssetId: () => matchedAsset });
    expect(result.svg).toContain("Ship faster");
    expect(result.svg).toContain('href="https://cdn.example/hero.png"');
  });
});

describe("golden: overflow — a deliberately long string in a narrow, short slot", () => {
  it("wraps, truncates with an ellipsis, and REPORTS the overflow naming the slot — the fixture built to trigger it", () => {
    const doc: ComposeDocument = {
      id: "overflow-fixture",
      channel: "image",
      template: "overflow-fixture",
      meta: { channel: "image", width: 400, height: 200, format: "svg", alt: "overflow fixture" },
      layout: { slots: [{ key: "cramped", element: "body", frame: { x: 0.1, y: 0.1, w: 0.2, h: 0.05 }, required: true }] },
      bindings: [
        {
          slot: "cramped",
          value:
            "This is a deliberately long sentence that cannot possibly fit inside such a narrow and short slot without wrapping and overflowing badly.",
        },
      ],
    };
    const result = renderImageDocument(doc);

    expect(result.svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200" role="img" aria-label="overflow fixture">' +
        "<title>overflow fixture</title>" +
        `<g data-slot="cramped"><text x="40" y="32" font-size="15" font-family="${FONT_BODY_XML}" fill="#111111" text-anchor="start">` +
        '<tspan x="40" dy="0">This is …</tspan></text></g>' +
        "</svg>",
    );

    expect(result.warnings).toEqual([
      'slot "cramped" (element "body") text overflowed its frame at font-size 15px and was truncated — see wrapText in src/image/engine.ts for the wrapping heuristic and its accuracy limits.',
    ]);
  });
});
