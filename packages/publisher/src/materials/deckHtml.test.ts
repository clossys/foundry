import { describe, expect, it } from "vitest";
import type { RenderSlidesResult } from "../slides/index.js";
import { renderPitchDeckHtml } from "./deckHtml.js";

const result: RenderSlidesResult = {
  slides: [
    { id: "cover", index: 0, svg: "<svg data-slide='cover'></svg>", warnings: [] },
    { id: "traction", index: 1, svg: "<svg data-slide='traction'></svg>", warnings: [] },
  ],
  width: 1920,
  height: 1080,
  aspect: "16:9",
  unknownNoteKeys: [],
  warnings: [],
};

describe("renderPitchDeckHtml", () => {
  it("embeds every slide's SVG, in deck order", () => {
    const html = renderPitchDeckHtml(result, { title: "Launch deck" });
    expect(html.indexOf("data-slide='cover'")).toBeLessThan(html.indexOf("data-slide='traction'"));
  });

  it("only the first slide is visible before any navigation", () => {
    const html = renderPitchDeckHtml(result, { title: "Launch deck" });
    expect(html).toMatch(/id="slide-cover"[^>]*>/);
    expect(html).not.toMatch(/id="slide-cover"[^>]*hidden/);
    expect(html).toMatch(/id="slide-traction"[^>]*hidden/);
  });

  it("escapes the title and audience label", () => {
    const html = renderPitchDeckHtml(result, { title: "Foo & <Bar>", audience: "\"Investor\"" });
    expect(html).toContain("Foo &amp; &lt;Bar&gt;");
    expect(html).toContain("&quot;Investor&quot;");
    expect(html).not.toContain("<Bar>");
  });

  it("wires keyboard navigation for both arrow directions plus Home/End", () => {
    const html = renderPitchDeckHtml(result, { title: "Launch deck" });
    expect(html).toContain("ArrowRight");
    expect(html).toContain("ArrowLeft");
    expect(html).toContain("Home");
    expect(html).toContain("End");
  });

  it("includes the shared print stylesheet, one slide per printed page", () => {
    const html = renderPitchDeckHtml(result, { title: "Launch deck" });
    expect(html).toContain("break-after: page");
    expect(html).toContain('data-materials-kind="deck"');
  });

  it("is a single self-contained document: no external script or stylesheet reference", () => {
    const html = renderPitchDeckHtml(result, { title: "Launch deck" });
    expect(html).not.toMatch(/<link[^>]+rel=["']stylesheet["']/);
    expect(html).not.toMatch(/<script[^>]+src=/);
  });

  it("shows the total slide count", () => {
    const html = renderPitchDeckHtml(result, { title: "Launch deck" });
    expect(html).toContain("/ 2");
  });
});


describe("document locale from Writer", () => {
  const manifest = { defaultLocale: "en", locales: [
    { tag: "en", dir: "ltr" as const, state: "active" as const },
    { tag: "ar", dir: "rtl" as const, state: "active" as const },
    { tag: "ar-XB", dir: "rtl" as const, state: "pseudo" as const },
    { tag: "en-US", dir: "ltr" as const, state: "active" as const },
  ] };
  it.each([[undefined, "en", "ltr"], ["ar", "ar", "rtl"], ["ar-XB", "ar-XB", "rtl"], ["en-us", "en-US", "ltr"]])("renders %s as %s/%s", (locale, tag, dir) => {
    const options = locale === undefined ? {} : { locale, manifest };
    expect(renderPitchDeckHtml(result, { title: "Deck", ...options })).toContain(`<html lang="${tag}" dir="${dir}">`);
  });
  it("uses the manifest default and refuses undeclared direction", () => {
    const options = { manifest: { ...manifest, defaultLocale: "ar" } };
    expect(renderPitchDeckHtml(result, { title: "Deck", ...options })).toContain('<html lang="ar" dir="rtl">');
    expect(() => renderPitchDeckHtml(result, { title: "Deck", ...{ locale: "ar" } })).toThrow();
  });
});
