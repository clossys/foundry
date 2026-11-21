/**
 * The slides release build (foundry-build-0027, fix-0027-r1): static HTML, one file per slide at
 * `<root>/<deck>/<n>/index.html`, plus the deck's theme stylesheet and one print stylesheet under `<root>/`. No presenter
 * script: a slide links its neighbours with `<link rel>` only.
 *
 * Reads resolved input only (system.md 14.2): Producer resolves the pins, renders the Designer deck frame (its default or
 * pin) with the slide slot left as `DECK_SLIDE_SLOT`, renders each slide's Designer section on the `slide` medium with its
 * Writer words bound, compiles the theme stylesheet those sections need, and hands all of it here. Assembles only: each
 * slide is the frame's markup with one section in its slide slot. The frame owns the canvas (root, aspect, surface); the
 * one size source is the frame contract's `canvas` (its aspect member at the print base width), which the print page box
 * is derived from. No words, no styling.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface SlideInput {
  /** The page option's instance key for this slide (`title`, `agenda`, ...). */
  readonly role: string;
  /** The Designer section slot it renders on the slide medium (`sections.hero`). */
  readonly section: string;
  /** The section's rendered markup on the slide medium, Writer words already bound. */
  readonly html: string;
}
/** The Designer deck frame, resolved: its contract's root and canvas, and its rendered markup. */
export interface DeckFrameInput {
  /** The Designer frame slot; a slides release only takes `frames.deck`. */
  readonly id: string;
  /** The frame contract's root element (`main`): the rendered markup must open with it. */
  readonly root: string;
  /** The frame contract's canvas, the one size source: the print page box is derived from it. */
  readonly canvas: { readonly width: number; readonly height: number };
  /** The frame's rendered markup (its package default or pin), holding `DECK_SLIDE_SLOT` exactly once. */
  readonly html: string;
}
/** The theme stylesheet the deck's sections need (tokens plus the utilities their markup uses), written beside print.css. */
export interface DeckThemeInput {
  /** The file name under `<root>/`, a `.css` name other than `print.css`. */
  readonly name: string;
  readonly css: string;
}
export interface SlidesBuildInput {
  readonly publicationId: string;
  /** The page slot's route pattern, `/slides/<deck>/<n>`. */
  readonly path: string;
  readonly deck: string;
  readonly lang: string;
  /** The deck's title text, resolved from its Writer meta record. */
  readonly title: string;
  readonly frame: DeckFrameInput;
  readonly theme: DeckThemeInput;
  readonly slides: readonly SlideInput[];
}
export interface SlideRoute { readonly n: number; readonly role: string; readonly path: string; readonly file: string }
export interface SlidesBuildResult {
  readonly routes: readonly SlideRoute[];
  /** The print stylesheet, `<root>/print.css`, relative to the output directory. */
  readonly stylesheet: string;
  /** The theme stylesheet, `<root>/<theme.name>`, relative to the output directory. */
  readonly theme: string;
}

export const DECK_FRAME_ID = "frames.deck";
export const SLIDES_STYLESHEET = "print.css";
/** Where the frame's slide slot sits in its rendered markup; the build puts one section there per slide. */
export const DECK_SLIDE_SLOT = "<!--clossys:slot slide-->";

const SEGMENT = /^[a-z0-9][a-z0-9-]*$/;
const THEME_NAME = /^[a-z0-9][a-z0-9.-]*\.css$/;
const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Script in a slide or frame: a slides release is static HTML, so a script tag, an inline handler or a javascript: URL is refused. */
function scriptFinding(html: string): string | undefined {
  if (/<script\b/i.test(html)) return "carries a script";
  if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(html)) return "carries an inline event handler (on*=)";
  if (/<[a-z][^>]*=\s*["']?\s*javascript\s*:/i.test(html)) return "carries a javascript: URL";
  return undefined;
}

/** One route per slide, numbered from 1 in deck order. */
export function slideRoutes(input: Pick<SlidesBuildInput, "path" | "deck" | "slides">): SlideRoute[] {
  if (!input.path.includes("<deck>") || !input.path.endsWith("/<n>")) throw new Error(`slides: path ${input.path} is not <root>/<deck>/<n>`);
  if (!SEGMENT.test(input.deck)) throw new Error(`slides: deck ${input.deck} is not a route segment`);
  return input.slides.map((slide, index) => {
    const path = input.path.replace("<deck>", input.deck).replace("<n>", String(index + 1));
    return { n: index + 1, role: slide.role, path, file: join(...path.split("/").filter(Boolean), "index.html") };
  });
}

/** The deck's print stylesheet: the page box only, sized from the frame contract's canvas. The frame draws the canvas. */
export function slidesStylesheet(canvas: DeckFrameInput["canvas"]): string {
  const { width, height } = canvas;
  return [
    "html, body { margin: 0; padding: 0; }",
    `body { max-width: ${width}px; margin: 0 auto; }`,
    `@page { size: ${width}px ${height}px; margin: 0; }`,
    "@media print {",
    `  html, body { width: ${width}px; height: ${height}px; max-width: none; overflow: hidden; print-color-adjust: exact; -webkit-print-color-adjust: exact; }`,
    "}",
    "",
  ].join("\n");
}

function checkFrame(frame: DeckFrameInput): void {
  if (frame.id !== DECK_FRAME_ID) throw new Error(`slides: frame ${frame.id} is not ${DECK_FRAME_ID}`);
  if (!/^[a-z][a-z0-9-]*$/.test(frame.root) || !new RegExp(`^<${frame.root}[\\s>]`).test(frame.html.trimStart())) {
    throw new Error(`slides: frame ${frame.id} markup does not open with its contract root <${frame.root}>`);
  }
  if (frame.html.split(DECK_SLIDE_SLOT).length !== 2) throw new Error(`slides: frame ${frame.id} markup must hold its slide slot ${DECK_SLIDE_SLOT} exactly once`);
  const { width, height } = frame.canvas;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error(`slides: frame ${frame.id} canvas ${width}x${height} is not a pixel size`);
  const script = scriptFinding(frame.html);
  if (script) throw new Error(`slides: frame ${frame.id} ${script}; a slides release is static HTML`);
}

function slidePage(input: SlidesBuildInput, slide: SlideInput, routes: readonly SlideRoute[], index: number, hrefs: readonly string[]): string {
  const route = routes[index]!;
  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(input.title)}</title>`,
    ...hrefs.map(href => `<link rel="stylesheet" href="${escapeHtml(href)}">`),
    ...(index > 0 ? [`<link rel="prev" href="${escapeHtml(routes[index - 1]!.path)}">`] : []),
    ...(index < routes.length - 1 ? [`<link rel="next" href="${escapeHtml(routes[index + 1]!.path)}">`] : []),
  ];
  const attributes = `data-publication="${escapeHtml(input.publicationId)}" data-deck="${escapeHtml(input.deck)}" data-frame="${escapeHtml(input.frame.id)}" data-slide="${route.n}" data-role="${escapeHtml(slide.role)}" data-section="${escapeHtml(slide.section)}"`;
  return [
    "<!doctype html>",
    `<html lang="${escapeHtml(input.lang)}">`,
    `<head>\n${head.join("\n")}\n</head>`,
    `<body ${attributes}>`,
    input.frame.html.trim().replace(DECK_SLIDE_SLOT, () => slide.html),
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/** Writes the deck under `outDir`: one `index.html` per slide, the theme stylesheet and the print stylesheet. */
export function buildSlides(input: SlidesBuildInput, outDir: string): SlidesBuildResult {
  checkFrame(input.frame);
  if (!THEME_NAME.test(input.theme.name) || input.theme.name === SLIDES_STYLESHEET) throw new Error(`slides: theme stylesheet ${input.theme.name} is not a .css name other than ${SLIDES_STYLESHEET}`);
  if (!input.slides.length) throw new Error("slides: a deck has at least one slide");
  for (const slide of input.slides) {
    const script = scriptFinding(slide.html);
    if (script) throw new Error(`slides: ${slide.role} ${script}; a slides release is static HTML`);
  }
  const routes = slideRoutes(input);
  const root = input.path.split("/").filter(Boolean)[0]!;
  // Root-relative hrefs, built from the route: they resolve the same with or without a trailing slash.
  const theme = `${root}/${input.theme.name}`;
  const stylesheet = `${root}/${SLIDES_STYLESHEET}`;
  const hrefs = [theme, stylesheet].map(path => `/${path}`);
  routes.forEach((route, index) => {
    const target = join(outDir, route.file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, slidePage(input, input.slides[index]!, routes, index, hrefs));
  });
  mkdirSync(join(outDir, root), { recursive: true });
  writeFileSync(join(outDir, root, input.theme.name), input.theme.css);
  writeFileSync(join(outDir, root, SLIDES_STYLESHEET), slidesStylesheet(input.frame.canvas));
  return { routes, stylesheet, theme };
}
