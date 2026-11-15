/**
 * `release slides --build` (foundry-build-0027): static HTML, one file per slide, plus one print stylesheet; no
 * presenter script. The build reads resolved input only (each slide's Designer markup with Writer words bound), so the
 * test resolves the slides starter the way Producer does and stands in rendered markup for each section.
 */
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDefaults, loadStarter, slotContract, type PageOption, type PageSlot } from "../catalog/ia/tree.js";
import { buildSlides, slideRoutes, type SlidesBuildInput } from "./index.js";

const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]);

/** The slides starter, resolved: one deck, its page option's sections in order, each as rendered slide markup. */
function resolvedStarter(): SlidesBuildInput {
  const starter = loadStarter("slides");
  const page = loadDefaults().get("page.deck/starter-v1.json")!.content as unknown as PageOption;
  return {
    publicationId: starter.id,
    path: (slotContract("page.deck") as PageSlot).path!,
    deck: starter.decks![0]!,
    lang: "en",
    title: "deck.meta",
    frame: "frames.deck",
    slides: page.sections.map(section => ({
      role: section.role,
      section: section.use.replace(/^designer\//, ""),
      html: `<section data-slot="${section.use.replace(/^designer\/sections\./, "")}" data-medium="${section.variant?.medium}"></section>`,
    })),
  };
}

describe("release slides --build", () => {
  it("writes one HTML file per slide under /slides/<deck>/<n>, plus print.css", () => {
    const input = resolvedStarter();
    const out = mkdtempSync(join(tmpdir(), "publisher-slides-"));
    const result = buildSlides(input, out);
    const files = walk(out).map(path => relative(out, path)).sort();
    const html = files.filter(path => path.endsWith(".html"));
    expect(input.slides).toHaveLength(6);
    expect(html).toEqual(["slides/starter/1/index.html", "slides/starter/2/index.html", "slides/starter/3/index.html", "slides/starter/4/index.html", "slides/starter/5/index.html", "slides/starter/6/index.html"]);
    expect(files).toEqual([...html, "slides/print.css"].sort());
    expect(result.routes).toEqual(slideRoutes(input));
    expect(result.routes.map(route => route.path)).toEqual([1, 2, 3, 4, 5, 6].map(n => `/slides/starter/${n}`));
  });

  it("each slide is static HTML on a 16:9 canvas with the print stylesheet and no script", () => {
    const out = mkdtempSync(join(tmpdir(), "publisher-slides-"));
    buildSlides(resolvedStarter(), out);
    const first = readFileSync(join(out, "slides/starter/1/index.html"), "utf8");
    expect(first).toContain('<link rel="stylesheet" href="../../print.css">');
    expect(first).toContain('<link rel="next" href="../2/">');
    expect(first).toContain('data-frame="frames.deck"');
    expect(first).toContain('<section data-slot="slide-title" data-medium="slide"></section>');
    for (const path of walk(out)) expect(readFileSync(path, "utf8"), path).not.toMatch(/<script/i);
    const css = readFileSync(join(out, "slides/print.css"), "utf8");
    expect(css).toContain("aspect-ratio: 16 / 9");
    expect(css).toContain("@page");
    expect(css).toMatch(/@media print/);
  });

  it("mutation: a slide carrying a presenter script is refused", () => {
    const input = resolvedStarter();
    const slides = input.slides.map((slide, index) => index === 2 ? { ...slide, html: `${slide.html}<script>next()</script>` } : slide);
    expect(() => buildSlides({ ...input, slides }, mkdtempSync(join(tmpdir(), "publisher-slides-")))).toThrow("slides: statement carries a script; a slides release is static HTML");
  });

  it("mutation: a slide on a frame other than frames.deck is refused", () => {
    expect(() => buildSlides({ ...resolvedStarter(), frame: "frames.site-shell" }, mkdtempSync(join(tmpdir(), "publisher-slides-")))).toThrow("slides: frame frames.site-shell is not frames.deck");
  });
});
