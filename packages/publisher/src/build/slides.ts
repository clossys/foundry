/**
 * The slides release build (foundry-build-0027): static HTML, one file per slide at `<root>/<deck>/<n>/index.html`, plus
 * one print stylesheet at `<root>/print.css`. No presenter script: a slide links its neighbours with `<link rel>` only.
 * Reads resolved input only (system.md 14.2): Producer resolves the pins, renders each slide's Designer section on the
 * `slide` medium with its Writer words bound, and hands the markup here. Assembles only: no words, no styling beyond
 * the 16:9 canvas and print page box.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface SlideInput {
  /** The page option's instance key for this slide (`title`, `agenda`, ...). */
  readonly role: string;
  /** The Designer section slot it renders (`sections.slide-title`). */
  readonly section: string;
  /** The section's rendered markup on the slide medium, Writer words already bound. */
  readonly html: string;
}
export interface SlidesBuildInput {
  readonly publicationId: string;
  /** The page slot's route pattern, `/slides/<deck>/<n>`. */
  readonly path: string;
  readonly deck: string;
  readonly lang: string;
  /** The deck's title text, resolved from its Writer meta record. */
  readonly title: string;
  /** The Designer frame the deck sits on; a slides release only takes `frames.deck`. */
  readonly frame: string;
  readonly slides: readonly SlideInput[];
}
export interface SlideRoute { readonly n: number; readonly role: string; readonly path: string; readonly file: string }
export interface SlidesBuildResult { readonly routes: readonly SlideRoute[]; readonly stylesheet: string }

export const DECK_FRAME_ID = "frames.deck";
export const SLIDES_STYLESHEET = "print.css";

const SEGMENT = /^[a-z0-9][a-z0-9-]*$/;
const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** One route per slide, numbered from 1 in deck order. */
export function slideRoutes(input: SlidesBuildInput): SlideRoute[] {
  if (!input.path.includes("<deck>") || !input.path.endsWith("/<n>")) throw new Error(`slides: path ${input.path} is not <root>/<deck>/<n>`);
  if (!SEGMENT.test(input.deck)) throw new Error(`slides: deck ${input.deck} is not a route segment`);
  return input.slides.map((slide, index) => {
    const path = input.path.replace("<deck>", input.deck).replace("<n>", String(index + 1));
    return { n: index + 1, role: slide.role, path, file: join(...path.split("/").filter(Boolean), "index.html") };
  });
}

/** The deck's print stylesheet: a 16:9 canvas on screen, one slide per page box in print. */
export function slidesStylesheet(): string {
  return [
    "html, body { margin: 0; padding: 0; }",
    ".deck-canvas { box-sizing: border-box; width: 100%; max-width: 1920px; aspect-ratio: 16 / 9; margin: 0 auto; overflow: hidden; }",
    "@page { size: 1920px 1080px; margin: 0; }",
    "@media print {",
    "  html, body { width: 1920px; height: 1080px; }",
    "  .deck-canvas { width: 1920px; height: 1080px; max-width: none; break-after: page; print-color-adjust: exact; -webkit-print-color-adjust: exact; }",
    "}",
    "",
  ].join("\n");
}

function slidePage(input: SlidesBuildInput, slide: SlideInput, route: SlideRoute, total: number): string {
  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(input.title)}</title>`,
    `<link rel="stylesheet" href="${"../".repeat(route.path.split("/").filter(Boolean).length - 1)}${SLIDES_STYLESHEET}">`,
    ...(route.n > 1 ? [`<link rel="prev" href="../${route.n - 1}/">`] : []),
    ...(route.n < total ? [`<link rel="next" href="../${route.n + 1}/">`] : []),
  ];
  return [
    "<!doctype html>",
    `<html lang="${escapeHtml(input.lang)}">`,
    `<head>\n${head.join("\n")}\n</head>`,
    `<body data-publication="${escapeHtml(input.publicationId)}" data-deck="${escapeHtml(input.deck)}">`,
    `<div class="deck-canvas" data-frame="${escapeHtml(input.frame)}" data-slide="${route.n}" data-role="${escapeHtml(slide.role)}" data-section="${escapeHtml(slide.section)}">`,
    slide.html,
    "</div>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/** Writes the deck under `outDir`: one `index.html` per slide and the shared print stylesheet. */
export function buildSlides(input: SlidesBuildInput, outDir: string): SlidesBuildResult {
  if (input.frame !== DECK_FRAME_ID) throw new Error(`slides: frame ${input.frame} is not ${DECK_FRAME_ID}`);
  if (!input.slides.length) throw new Error("slides: a deck has at least one slide");
  for (const slide of input.slides) {
    if (/<script\b/i.test(slide.html)) throw new Error(`slides: ${slide.role} carries a script; a slides release is static HTML`);
  }
  const routes = slideRoutes(input);
  routes.forEach((route, index) => {
    const target = join(outDir, route.file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, slidePage(input, input.slides[index]!, route, routes.length));
  });
  const root = input.path.split("/").filter(Boolean)[0]!;
  const stylesheet = join(root, SLIDES_STYLESHEET);
  mkdirSync(join(outDir, root), { recursive: true });
  writeFileSync(join(outDir, stylesheet), slidesStylesheet());
  return { routes, stylesheet };
}
