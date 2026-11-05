import { describe, expect, it } from "vitest";
import { renderSpecimenPage, specimenRecordFrom } from "./index.js";
import { SPECIMEN_CHROME_CSS } from "./chrome.js";
import type { SpecimenRecord } from "./types.js";

/** A library record as Producer's store hands it over: the whole registry item is the one payload file. */
function libraryRecord(slot: string, element: string, kind: string, layer: string, item: unknown): SpecimenRecord {
  return specimenRecordFrom({ id: `${slot}/${element}`, version: 1, kind, layer, files: [{ path: `${element}.json`, content: JSON.stringify(item) }], preview: {}, contentHash: "h" });
}

const page = (record: SpecimenRecord, mode: "light" | "dark" = "light") =>
  renderSpecimenPage({ record, query: { element: record.id }, mode, assetBase: "/__specimen/assets/", nonce: "n" });

/** Whatever a token or asset card draws, it is never the generic fallback and never a reported failure. */
function expectDrawn(html: string) {
  expect(html).not.toContain("no renderer yet");
  expect(html).not.toContain("data-specimen-stub");
  expect(html).not.toContain("data-specimen-unavailable");
  expect(html).toContain('"preErrors":[]');
}

describe("token specimens (data)", () => {
  it("draws a colour token as a swatch of its own value in the requested mode", () => {
    const record = libraryRecord("themes.background", "background", "registry:theme", "themes", { name: "background", type: "registry:theme", cssVars: { light: { background: "#F5F5F5" }, dark: { background: "#0A0A0A" } } });
    expect(record.kind).toBe("data");
    const light = page(record), dark = page(record, "dark");
    expectDrawn(light);
    expect(light).toContain('data-token="color"');
    expect(light).toContain('class="specimen-swatch" style="background:#F5F5F5"');
    expect(dark).toContain('class="specimen-swatch" style="background:#0A0A0A"');
  });

  it("draws radius, spacing, shadow, tracking and motion tokens by what they are", () => {
    const cases: [string, unknown, string][] = [
      ["radius", { cssVars: { light: { radius: "0.25rem" } } }, 'data-token="radius"'],
      ["spacing", { cssVars: { theme: { spacing: "0.25rem" } } }, 'data-token="spacing"'],
      ["shadow", { cssVars: { theme: { "shadow-sm": "0 1px 3px 0 rgb(0 0 0 / 0.1)", "shadow-lg": "0 10px 15px -3px rgb(0 0 0 / 0.1)" } } }, 'data-token="shadow"'],
      ["tracking-tight", { cssVars: { theme: { "tracking-tight": "-0.025em" } } }, 'data-token="tracking"'],
      ["animate-marquee", { cssVars: { theme: { "animate-marquee": "marquee var(--duration) infinite linear" } }, css: { "@keyframes marquee": { from: { transform: "translateX(0)" }, to: { transform: "translateX(calc(-100% - var(--gap)))" } } } }, "@keyframes marquee{from{transform:translateX(0)}"],
    ];
    for (const [name, body, marker] of cases) {
      const html = page(libraryRecord(`themes.${name}`, name, "registry:theme", "themes", { name, type: "registry:theme", ...(body as object) }));
      expectDrawn(html);
      expect(html).toContain(marker);
    }
  });

  it("draws a font token as a type ladder in its family", () => {
    const html = page(libraryRecord("themes.font-sans", "font-sans", "registry:font", "themes", { name: "font-sans", type: "registry:font", font: { family: "'Inter Variable', sans-serif", variable: "--font-sans" } }));
    expectDrawn(html);
    expect(html).toContain('data-token="font"');
    expect(html).toContain("font-family:&#39;Inter Variable&#39;, sans-serif");
  });

  it("drops values that would break out of CSS and reports a token with nothing to draw", () => {
    const html = page(libraryRecord("themes.bad", "bad", "registry:theme", "themes", { name: "bad", type: "registry:theme", cssVars: { light: { bad: "red;}</style><script>x</script>" } } }));
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain('data-specimen-unavailable="data"');
    expect(html).toContain("no token values to draw");
  });
});

describe("asset specimens (media)", () => {
  const tokens = (name: string, members: Record<string, unknown>) => ({ path: `clossys/assets.${name}.json`, type: "registry:file", content: JSON.stringify({ assets: { [name]: members } }) });
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100"/></svg>';

  it("draws svg members, resolving an alias to the item's own file", () => {
    const record = libraryRecord("assets.favicon", "favicon", "registry:item", "assets", { name: "favicon", type: "registry:item", files: [
      { path: "favicon/vector.svg", type: "registry:file", content: svg },
      tokens("favicon", { vector: { $type: "svg", $value: "{{assets.mark.positive}}" } }),
    ] });
    expect(record.kind).toBe("media");
    const html = page(record);
    expectDrawn(html);
    expect(html).toContain(`src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg).replace(/'/g, "&#39;")}"`);
  });

  it("draws glyphs inline, images, video posters, ratios and patterns", () => {
    const image = "data:image/svg+xml;base64,PHN2Zy8+";
    const html = page(libraryRecord("assets.mixed", "mixed", "registry:item", "assets", { name: "mixed", type: "registry:item", files: [tokens("mixed", {
      glyph: { $type: "glyph", $value: [["path", { d: "M5 12h14", key: "k", onload: "x" }], ["circle", { cx: "12", cy: "12", r: "4" }]] },
      placeholder: { $type: "rules", $value: { src: image, width: 100, height: 100 } },
      video: { $type: "rules", $value: { src: "data:video/webm;base64,AAAA", poster: image, width: 320, height: 180 } },
      wide: { $type: "rules", $value: { width: 21, height: 9 } },
      dots: { $type: "rules", $value: { shape: "dots", ink: "--color-line-strong", tile: "--spacing-xl" } },
    })] }));
    expectDrawn(html);
    expect(html).toContain('<path d="M5 12h14"/><circle cx="12" cy="12" r="4"/>');
    expect(html).not.toContain("onload");
    expect(html).toContain(`src="${image}" alt="placeholder" style="aspect-ratio:100 / 100"`);
    expect(html).toContain('alt="video poster"');
    expect(html).not.toContain("data:video");
    expect(html).toContain("21:9");
    expect(html).toContain("--specimen-ink:var(--color-line-strong, var(--border))");
  });

  it("reports an asset with nothing to draw instead of a blank", () => {
    const html = page(libraryRecord("assets.none", "none", "registry:item", "assets", { name: "none", type: "registry:item", files: [tokens("none", { odd: { $type: "rules", $value: { kind: "x" } } })] }));
    expect(html).toContain('data-specimen-unavailable="media"');
    expect(html).toContain("no member that can be drawn");
  });
});

describe("specimen stage", () => {
  it("never lays out wider than its frame (the size contract is reflow)", () => {
    expect(SPECIMEN_CHROME_CSS).toContain("#specimen-stage { width: min(100%, var(--specimen-width, 100%));");
  });
});
