/**
 * `release slides --build` (foundry-build-0027, fix-0027-r1): static HTML, one file per slide, plus the theme and print
 * stylesheets; no presenter script. The build reads resolved input only, so the test resolves the slides starter the
 * way Producer does: the Designer deck frame is rendered from its package default (TSX to static markup), its root and
 * canvas come from the Designer frame contract, and each section stands in as rendered markup.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  designerPackageDir, loadDefaults, loadDesignerFrameContract, loadDesignerPackageDefaults, loadStarter, slotContract, type PageOption, type PageSlot,
} from "../catalog/ia/tree.js";
import { buildSlides, DECK_SLIDE_SLOT, slideRoutes, type DeckFrameInput, type SlidesBuildInput } from "./index.js";

const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]);
const clone = <T>(value: T): T => structuredClone(value);
const out = () => mkdtempSync(join(tmpdir(), "publisher-slides-"));
const requireHere = createRequire(import.meta.url);

interface RegistryItem { export: string; files: { path: string; content: string }[] }
const frameDefault = (): RegistryItem => clone(loadDesignerPackageDefaults("frames.deck")[0]!.content as unknown as RegistryItem);

/** A Designer registry item's export rendered to static markup (TSX transpiled, `cn` joined), its children in the slide slot. */
function renderFrame(item: RegistryItem): string {
  const { outputText } = ts.transpileModule(item.files[0]!.content, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const module = { exports: {} as Record<string, unknown> };
  const load = (id: string): unknown => id === "@/lib/utils" ? { cn: (...names: unknown[]) => names.filter(Boolean).join(" ") } : requireHere(id);
  new Function("require", "exports", "module", outputText)(load, module.exports, module);
  const Frame = module.exports[item.export] as ComponentType<{ children: ReactNode }>;
  return renderToStaticMarkup(createElement(Frame, null, createElement("clossys-slot"))).replace("<clossys-slot></clossys-slot>", DECK_SLIDE_SLOT);
}

/** The Designer deck frame, resolved: contract root and canvas from Designer, markup rendered from its default. */
function resolvedFrame(item: RegistryItem = frameDefault()): DeckFrameInput {
  const contract = loadDesignerFrameContract("frames.deck");
  return { id: "frames.deck", root: contract.root, canvas: { width: contract.canvas.width, height: contract.canvas.height }, html: renderFrame(item) };
}

/** The slides starter, resolved: one deck, its page option's sections in order, each as rendered slide markup. */
function resolvedStarter(frame: DeckFrameInput = resolvedFrame()): SlidesBuildInput {
  const starter = loadStarter("slides");
  const page = loadDefaults().get("page.deck/starter-v1.json")!.content as unknown as PageOption;
  return {
    publicationId: starter.id,
    path: (slotContract("page.deck") as PageSlot).path!,
    deck: starter.decks![0]!,
    lang: "en",
    title: "deck.meta",
    frame,
    theme: { name: "theme.css", css: ":root { --background: white; }\n" },
    slides: page.sections.map(section => ({
      role: section.role,
      section: section.use.replace(/^designer\//, ""),
      html: `<section data-slot="${section.use.replace(/^designer\/sections\./, "")}" data-medium="${section.variant?.medium}"></section>`,
    })),
  };
}

const build = (input: SlidesBuildInput) => {
  const dir = out();
  buildSlides(input, dir);
  return Object.fromEntries(walk(dir).map(path => [relative(dir, path), readFileSync(path, "utf8")]));
};

describe("release slides --build", () => {
  it("writes one HTML file per slide under /slides/<deck>/<n>, plus the theme and print stylesheets", () => {
    const input = resolvedStarter();
    const dir = out();
    const result = buildSlides(input, dir);
    const files = walk(dir).map(path => relative(dir, path)).sort();
    const html = files.filter(path => path.endsWith(".html"));
    expect(input.slides).toHaveLength(6);
    expect(html).toEqual(["slides/starter/1/index.html", "slides/starter/2/index.html", "slides/starter/3/index.html", "slides/starter/4/index.html", "slides/starter/5/index.html", "slides/starter/6/index.html"]);
    expect(files).toEqual([...html, "slides/print.css", "slides/theme.css"].sort());
    expect(result).toMatchObject({ stylesheet: "slides/print.css", theme: "slides/theme.css" });
    expect(result.routes).toEqual(slideRoutes(input));
    expect(result.routes.map(route => route.path)).toEqual([1, 2, 3, 4, 5, 6].map(n => `/slides/starter/${n}`));
  });

  it("each slide is the rendered Designer deck frame with its section in the slide slot, static, no script", () => {
    const files = build(resolvedStarter());
    const first = files["slides/starter/1/index.html"]!;
    const body = first.slice(first.indexOf("<body"), first.indexOf("</body>"));
    expect(body).toMatch(/<main data-slot="deck-frame" data-aspect="16:9" class="[^"]*aspect-video[^"]*">\s*<section data-slot="hero" data-medium="slide"><\/section>\s*<\/main>/);
    expect(body.match(/<main\b/g)).toHaveLength(1);
    expect(first).not.toContain("deck-canvas");
    expect(first).not.toContain(DECK_SLIDE_SLOT);
    expect(first).toContain('data-frame="frames.deck"');
    for (const [path, text] of Object.entries(files)) expect(text, path).not.toMatch(/<script/i);
  });

  it("the canvas size has one source, the Designer frame contract: print.css derives the page box from it", () => {
    const contract = loadDesignerFrameContract("frames.deck");
    expect(contract).toMatchObject({ root: "main", canvas: { aspect: "16:9", width: 1920, height: 1080 } });
    expect(resolvedFrame().html).not.toMatch(/max-w-|\bw-\[|\bh-\[/);
    const css = build(resolvedStarter())["slides/print.css"]!;
    expect(css).toContain("@page { size: 1920px 1080px; margin: 0; }");
    expect(css).toMatch(/@media print/);
    expect(css).not.toContain("aspect-ratio");
    const smaller = build(resolvedStarter({ ...resolvedFrame(), canvas: { width: 1280, height: 720 } }))["slides/print.css"]!;
    expect(smaller).toContain("@page { size: 1280px 720px; margin: 0; }");
    expect(smaller).not.toContain("1920");
  });

  it("reads frames.deck from Designer's registered slots/frames.json: root, slide slot and aspect member", () => {
    const records = JSON.parse(readFileSync(join(designerPackageDir(), "src", "catalog", "slots", "frames.json"), "utf8")) as { id: string; contract: { members: { names: string[] } } }[];
    const contract = loadDesignerFrameContract("frames.deck");
    expect(contract).toMatchObject({ kind: "frame", root: "main", aspect: "16:9", slots: [{ id: "slide", required: true }] });
    const withMembers = (names: string[]) => {
      const dir = mkdtempSync(join(tmpdir(), "publisher-deck-frame-"));
      mkdirSync(join(dir, "src", "catalog", "slots"), { recursive: true });
      const edited = records.map(record => record.id === "frames.deck" ? { ...record, contract: { ...record.contract, members: { ...record.contract.members, names } } } : record);
      writeFileSync(join(dir, "src", "catalog", "slots", "frames.json"), JSON.stringify(edited));
      return dir;
    };
    expect(loadDesignerFrameContract("frames.deck", withMembers(["aspect.4-3"])).canvas).toEqual({ aspect: "4:3", width: 1920, height: 1440 });
    expect(() => loadDesignerFrameContract("frames.deck", withMembers([]))).toThrow("designer: frame frames.deck declares no aspect member (aspect.<w>-<h>)");
    expect(() => loadDesignerFrameContract("frames.site-shell")).toThrow(/declares no aspect member/);
    expect(() => loadDesignerFrameContract("sections.hero")).toThrow("designer: sections.hero is not a registered frame in slots/frames.json");
  });

  it("changing the frame default changes the release output", () => {
    const before = build(resolvedStarter());
    const item = frameDefault();
    item.files[0]!.content = item.files[0]!.content.replace("bg-background", "bg-muted").replace('data-aspect="16:9"', 'data-aspect="16:9" data-surface="deck"');
    const after = build(resolvedStarter(resolvedFrame(item)));
    expect(after["slides/starter/1/index.html"]).not.toEqual(before["slides/starter/1/index.html"]);
    expect(after["slides/starter/1/index.html"]).toMatch(/<main data-slot="deck-frame" data-aspect="16:9" data-surface="deck" class="[^"]*bg-muted/);
  });

  it("every slide links the theme stylesheet its sections need, and print.css after it", () => {
    const files = build(resolvedStarter());
    expect(files["slides/theme.css"]).toBe(":root { --background: white; }\n");
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const page = files[`slides/starter/${n}/index.html`]!;
      expect(page.indexOf('<link rel="stylesheet" href="/slides/theme.css">'), String(n)).toBeGreaterThan(-1);
      expect(page.indexOf('<link rel="stylesheet" href="/slides/print.css">')).toBeGreaterThan(page.indexOf("/slides/theme.css"));
    }
  });

  it("prev/next and stylesheet links resolve the same with or without a trailing slash", () => {
    const files = build(resolvedStarter());
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const page = files[`slides/starter/${n}/index.html`]!;
      const hrefs = [...page.matchAll(/<link rel="(stylesheet|prev|next)" href="([^"]+)">/g)].map(match => [match[1]!, match[2]!] as const);
      expect(hrefs.map(([rel]) => rel)).toEqual(["stylesheet", "stylesheet", ...(n > 1 ? ["prev"] : []), ...(n < 6 ? ["next"] : [])]);
      for (const [rel, href] of hrefs) {
        const bare = new URL(href, `https://deck.test/slides/starter/${n}`).pathname;
        expect(new URL(href, `https://deck.test/slides/starter/${n}/`).pathname, `${n} ${rel}`).toBe(bare);
        const file = rel === "stylesheet" ? bare.slice(1) : `${bare.slice(1)}/index.html`;
        expect(files[file], `${n} ${rel} ${href}`).toBeDefined();
      }
    }
    expect(files["slides/starter/2/index.html"]).toContain('<link rel="prev" href="/slides/starter/1">');
    expect(files["slides/starter/2/index.html"]).toContain('<link rel="next" href="/slides/starter/3">');
  });

  it("mutation: a slide carrying a presenter script is refused", () => {
    const input = resolvedStarter();
    const slides = input.slides.map((slide, index) => index === 2 ? { ...slide, html: `${slide.html}<script>next()</script>` } : slide);
    expect(() => buildSlides({ ...input, slides }, out())).toThrow("slides: statement carries a script; a slides release is static HTML");
  });

  it("mutation: an inline on*= handler or a javascript: URL in a slide or the frame is refused", () => {
    const input = resolvedStarter();
    const withSlide = (html: string) => ({ ...input, slides: input.slides.map((slide, index) => index === 1 ? { ...slide, html } : slide) });
    expect(() => buildSlides(withSlide('<section onclick="next()"></section>'), out())).toThrow("slides: agenda carries an inline event handler (on*=); a slides release is static HTML");
    expect(() => buildSlides(withSlide('<section><img src="x" ONERROR = "next()"></section>'), out())).toThrow("slides: agenda carries an inline event handler (on*=)");
    expect(() => buildSlides(withSlide('<section><a href="javascript:next()">x</a></section>'), out())).toThrow("slides: agenda carries a javascript: URL; a slides release is static HTML");
    expect(() => buildSlides(withSlide("<section><a href=' JavaScript:next()'>x</a></section>"), out())).toThrow("slides: agenda carries a javascript: URL");
    const frame = resolvedFrame();
    expect(() => buildSlides({ ...input, frame: { ...frame, html: frame.html.replace("<main ", '<main onload="next()" ') } }, out())).toThrow("slides: frame frames.deck carries an inline event handler (on*=)");
    expect(() => buildSlides(withSlide("<section><p>Write once: JavaScript: the good parts; one=two</p></section>"), out())).not.toThrow();
  });

  it("mutation: a frame without its contract root or slide slot is refused", () => {
    const input = resolvedStarter();
    const frame = resolvedFrame();
    expect(() => buildSlides({ ...input, frame: { ...frame, html: `<div class="deck-canvas">${DECK_SLIDE_SLOT}</div>` } }, out())).toThrow("slides: frame frames.deck markup does not open with its contract root <main>");
    expect(() => buildSlides({ ...input, frame: { ...frame, html: frame.html.replace(DECK_SLIDE_SLOT, "") } }, out())).toThrow(`slides: frame frames.deck markup must hold its slide slot ${DECK_SLIDE_SLOT} exactly once`);
  });

  it("mutation: a slide on a frame other than frames.deck is refused", () => {
    expect(() => buildSlides({ ...resolvedStarter(), frame: { ...resolvedFrame(), id: "frames.site-shell" } }, out())).toThrow("slides: frame frames.site-shell is not frames.deck");
  });
});
