#!/usr/bin/env node
/**
 * Generates and checks `styles/preview.css`, the one utility stylesheet the
 * `publisher-preview` pages link (copied into the output as
 * `publisher-preview.css`), in place of Designer's `compiled.css`.
 *
 * Why it exists. Designer's `compiled.css` holds only the classes Designer's
 * own components use. Publisher's web views emit classes of their own (band
 * rhythm such as `py-4xl tablet-lg:py-5xl`, view grids and gaps), which a
 * consumer gets from its own Tailwind build scanning Publisher's `dist`.
 * The preview has no consumer build, so without this file those classes
 * have no rule and the preview renders cramped and unrepresentative.
 *
 * What it holds, all produced by the real `tailwindcss` compiler:
 *
 * 1. Tailwind's preflight, in the `foundry-ui-base` layer. Designer's blocks
 *    are drawn against zero default margins on headings, paragraphs, lists
 *    and figures (Designer README, "Base layer"); the preview links what a
 *    Tailwind-native consumer already has.
 * 2. One utilities compile, through Designer's own generator
 *    (`dist/compiled-css/generate.js`, the same code that writes
 *    `compiled.css`), over Designer's exported-component candidates
 *    (`scanUtilitiesSources`) plus every class-shaped token, arbitrary
 *    variants such as `[&_h2]:text-h2` included, in the same Designer
 *    directories and in Publisher's own `src` (string literals and template
 *    literal text, excluding tests).
 *    One compile keeps Tailwind's own rule order across both packages, so a
 *    responsive variant always follows its base utility.
 *
 * Over-inclusion is harmless: Tailwind emits nothing for a token that is not
 * a utility, and a rule only applies where markup uses the class.
 * `src/preview/preview-css.test.ts` checks this file is fresh and that every
 * class the preview pages render has a rule here.
 *
 * Usage: node scripts/preview-css.mjs [--check | --write]
 * Exit codes: 0 = fresh or written, 1 = stale (--check), 2 = could not run.
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const publisherRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(publisherRoot, "package.json"));

export const PREVIEW_CSS_PATH = join(publisherRoot, "styles", "preview.css");

const HEADER = `/* ════════════════════════════════════════════════════════════════════
 * @clossys/publisher · styles/preview.css
 * ────────────────────────────────────────────────────────────────────
 * GENERATED FILE — do not hand-edit. Regenerate with
 * \`npm run generate:preview-css\` (from packages/publisher); checked by
 * \`src/preview/preview-css.test.ts\`. See \`scripts/preview-css.mjs\`.
 *
 * The utility stylesheet the publisher-preview pages link, in place of
 * Designer's compiled.css: Tailwind's preflight (layer foundry-ui-base),
 * then one real Tailwind compile of Designer's component classes and every
 * class Publisher's own views emit (layer foundry-ui-compiled), against
 * Designer's theme. Load it after Designer's tokens.css. For the preview
 * only: an app styles Publisher's views with its own Tailwind build.
 * ════════════════════════════════════════════════════════════════════ */

`;

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage"]);
const SKIP_FILE_RE = /\.(test|spec|check)\.(ts|tsx)$|\.d\.ts$/;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
// Permissive on purpose: also admits arbitrary variants such as `[&_h2]:text-h2`, which Designer's
// own compiled.css scanner does not. Tailwind emits nothing for a token that is not a utility.
const CANDIDATE_SHAPE_RE = /^[!@a-zA-Z[-][^\s"'`\\{};]*$/;
const MAX_CANDIDATE_LENGTH = 80;

function designerRoot() {
  return resolve(dirname(require.resolve("@clossys/designer/theme.css")), "..");
}

async function importDesignerTool(root, file) {
  const path = join(root, "dist", "compiled-css", file);
  if (!existsSync(path)) throw new Error(`Designer is not built: ${path} is missing (run npm run build in packages/designer).`);
  return import(pathToFileURL(path).href);
}

/** Every string literal and template-literal text segment in one source file. */
function literalsOf(content) {
  const literals = [];
  for (const m of content.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) literals.push(m[1]);
  for (const m of content.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) literals.push(m[1]);
  for (const m of content.matchAll(/`((?:[^`\\]|\\.)*)`/g)) literals.push(m[1].replace(/\$\{[^}]*\}/g, " "));
  return literals;
}

/** Class-shaped tokens in every non-test `.ts`/`.tsx` file under `dir`, added to `out`. */
export function scanSourceCandidates(dir, out = new Set()) {
  const walk = (current) => {
    for (const entry of readdirSync(current).sort()) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(current, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      if (!stat.isFile() || !SOURCE_EXTENSIONS.has(extname(entry)) || SKIP_FILE_RE.test(entry)) continue;
      for (const literal of literalsOf(readFileSync(full, "utf8"))) {
        for (const token of literal.split(/\s+/)) {
          if (token.length > 0 && token.length <= MAX_CANDIDATE_LENGTH && CANDIDATE_SHAPE_RE.test(token)) out.add(token);
        }
      }
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

async function compilePreflight() {
  const { compile } = await import("tailwindcss");
  const files = { "tailwindcss/theme": "tailwindcss/theme.css", "tailwindcss/preflight": "tailwindcss/preflight.css" };
  const compiled = await compile(`@import "tailwindcss/theme" theme(reference);\n@import "tailwindcss/preflight" layer(foundry-ui-base);\n`, {
    base: publisherRoot,
    loadStylesheet: async (id) => {
      const subpath = files[id];
      if (subpath === undefined) throw new Error(`preview-css: unexpected stylesheet import "${id}"`);
      const path = require.resolve(subpath);
      return { path, base: dirname(path), content: readFileSync(path, "utf8") };
    },
  });
  return compiled.build([]);
}

/** Builds the full `styles/preview.css` text. Deterministic for the same sources. */
export async function generatePreviewCss() {
  const root = designerRoot();
  const { scanUtilitiesSources, UTILITIES_SOURCE_DIRS } = await importDesignerTool(root, "scan-sources.js");
  const { generateCompiledCss } = await importDesignerTool(root, "generate.js");

  // Designer's own candidates, then the same exported directories again through this
  // script's permissive scan, then all of Publisher's own src.
  const candidates = new Set(scanUtilitiesSources(root).candidates);
  for (const dir of UTILITIES_SOURCE_DIRS) scanSourceCandidates(join(root, "src", dir), candidates);
  scanSourceCandidates(join(publisherRoot, "src"), candidates);

  const utilities = await generateCompiledCss({ stylesDir: join(root, "styles"), candidates: [...candidates].sort() });
  // Drop Designer's own compiled.css file header; keep its base layer and the utilities.
  const headerEnd = utilities.css.indexOf("*/\n\n");
  if (!utilities.css.startsWith("/*") || headerEnd < 0) throw new Error("preview-css: Designer's generated CSS no longer starts with its file header");
  const body = utilities.css.slice(headerEnd + 4);

  const preflight = (await compilePreflight()).trim();
  return `${HEADER}${preflight}\n\n${body.trimStart()}`;
}

async function main(argv) {
  const mode = argv.includes("--write") ? "write" : "check";
  for (const arg of argv) {
    if (arg !== "--write" && arg !== "--check") {
      console.error(`preview-css: unknown argument "${arg}". Usage: node scripts/preview-css.mjs [--check | --write]`);
      return 2;
    }
  }
  const css = await generatePreviewCss();
  if (mode === "write") {
    writeFileSync(PREVIEW_CSS_PATH, css, "utf8");
    console.log(`Wrote ${PREVIEW_CSS_PATH} (${Buffer.byteLength(css, "utf8")} bytes).`);
    return 0;
  }
  if (!existsSync(PREVIEW_CSS_PATH)) {
    console.error(`preview-css: ${PREVIEW_CSS_PATH} does not exist; run npm run generate:preview-css.`);
    return 2;
  }
  if (readFileSync(PREVIEW_CSS_PATH, "utf8") !== css) {
    console.error("preview-css: styles/preview.css is stale; run npm run generate:preview-css.");
    return 1;
  }
  console.log("styles/preview.css is fresh.");
  return 0;
}

const invoked = process.argv[1] !== undefined && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
if (invoked) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`preview-css: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 2;
    },
  );
}
