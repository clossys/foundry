import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { TOKENS } from "@clossys/designer/tokens";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
// The generator is a plain build script (scripts/preview-css.mjs); test files are outside tsc.
import { generatePreviewCss } from "../../scripts/preview-css.mjs";
import { PREVIEW_UTILITIES_BASENAME, previewUtilitiesSourcePath } from "./preview-stylesheet.js";
import { buildMinimalBrandCssFromTokens, writePreviewGallery } from "./render-preview-gallery.js";

const committed = readFileSync(previewUtilitiesSourcePath(), "utf8");

/** Escapes one class name the way it appears in a selector (`tablet-lg:py-5xl` -> `tablet-lg\:py-5xl`). */
function selectorFor(className: string): string {
  return `.${className.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`)}`;
}

function hasRuleFor(css: string, className: string): boolean {
  const selector = selectorFor(className);
  let from = 0;
  for (;;) {
    const at = css.indexOf(selector, from);
    if (at < 0) return false;
    const next = css.charAt(at + selector.length);
    if (!/[a-zA-Z0-9_\\-]/.test(next)) return true;
    from = at + 1;
  }
}

function classesOf(html: string): Set<string> {
  const out = new Set<string>();
  // An HTML parser decodes attribute entities exactly once, as a browser does.
  const fragment = JSDOM.fragment(html);
  for (const element of fragment.querySelectorAll("[class]")) {
    for (const token of element.classList) out.add(token);
  }
  return out;
}

function inlineStyleOf(html: string): string {
  return [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join("\n");
}

let dir: string;
let pages: Array<{ file: string; html: string }>;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "publisher-preview-css-"));
  const brandPath = join(dir, "input-brand.css");
  writeFileSync(brandPath, buildMinimalBrandCssFromTokens({ TOKENS }));
  writePreviewGallery({ brandCssPath: brandPath, outputDir: join(dir, "out") });
  function htmlFiles(prefix = ""): string[] {
    return readdirSync(join(dir, "out", prefix), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? htmlFiles(`${prefix}${entry.name}/`) : [`${prefix}${entry.name}`]);
  }
  pages = htmlFiles()
    .filter((file) => file.endsWith(".html"))
    .sort()
    .map((file) => ({ file, html: readFileSync(join(dir, "out", file), "utf8") }))
    .filter(page => [...page.html.matchAll(/href="([^"]+)"/g)].some(match => resolve(dir, "out", dirname(page.file), match[1]) === resolve(dir, "out", PREVIEW_UTILITIES_BASENAME)));
}, 30_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("styles/preview.css", () => {
  it("decodes class attributes once without interpreting encoded entity text again", () => {
    const html = '<div class="encoded&amp;quot; encoded&amp;#x27; quote&quot; apostrophe&#x27; amp&amp;"></div>';
    expect(classesOf(html)).toEqual(new Set(["encoded&quot;", "encoded&#x27;", 'quote"', "apostrophe'", "amp&"]));
    expect(classesOf('<div class="plain gt&gt; lt&lt; encoded&amp;gt; encoded&amp;lt; numeric&#38; nonbreaking&#160;x unknown&unsupported;"><svg class="svg&amp;"></svg></div>'))
      .toEqual(new Set(["plain", "gt>", "lt<", "encoded&gt;", "encoded&lt;", "numeric&", "nonbreaking\u00a0x", "unknown&unsupported;", "svg&"]));
  });

  it("is fresh: regenerating it from the current sources gives the committed file", async () => {
    expect(await generatePreviewCss(), "styles/preview.css is stale; run npm run generate:preview-css").toBe(committed);
  }, 30_000);

  it("holds Tailwind's preflight in the base layer before the utilities", () => {
    const base = committed.indexOf("@layer foundry-ui-base {");
    const utilities = committed.indexOf("@layer foundry-ui-compiled {");
    expect(base).toBeGreaterThan(0);
    expect(utilities).toBeGreaterThan(base);
    expect(committed.slice(base, utilities)).toMatch(/\*, ::after, ::before, ::backdrop, ::file-selector-button \{\s*box-sizing: border-box;\s*margin: 0;\s*padding: 0;/);
  });

  it("is copied into the preview output and linked by the gallery, the content catalog and the site pages", () => {
    expect(readFileSync(join(dir, "out", PREVIEW_UTILITIES_BASENAME), "utf8")).toBe(committed);
    const linking = pages.map((page) => page.file);
    expect(linking).toEqual(expect.arrayContaining(["gallery.html", "content-catalog.html", "site-home.html", ...["overview", "introduce", "show", "explain", "index-function", "sequence", "compare", "frame", "parts"].map(fn => `catalog/${fn}.html`)]));
    for (const page of pages) expect(page.html, page.file).not.toContain("designer-compiled.css");
  });

  it("has a rule for every class a preview page renders, other than the page's own chrome classes", () => {
    expect(pages.length).toBeGreaterThan(2);
    const missing: string[] = [];
    for (const page of pages) {
      const chrome = inlineStyleOf(page.html);
      for (const className of classesOf(page.html)) {
        if (!hasRuleFor(committed, className) && !hasRuleFor(chrome, className)) missing.push(`${page.file}: ${className}`);
      }
    }
    expect(missing).toEqual([]);
  }, 30_000);

  it("covers the live ContentSection band rhythm rendered by Publisher's native catalog", () => {
    const standardRhythm = ["py-4xl", "tablet:py-5xl", "desktop:py-6xl"];
    const page = pages.find((page) => page.file === "catalog/introduce.html");
    expect(page).toBeDefined();
    const bands = JSDOM.fragment(page!.html).querySelectorAll("[data-content-section]");
    expect([...bands].some((band) => standardRhythm.every((className) => band.classList.contains(className)))).toBe(true);
    for (const className of standardRhythm) expect(hasRuleFor(committed, className), className).toBe(true);
  });
});
