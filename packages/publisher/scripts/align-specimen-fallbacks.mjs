#!/usr/bin/env node
/**
 * Writes the fallback of every `var(--x)` that Publisher's CSS emitters write (CONTAM-U7): the
 * specimen theme, chrome and token renderers and the web views whose class strings and inline
 * styles read theme variables. No value is typed here; each comes from Designer's declared-fallback
 * reader (`dist/compiled-css/declared-fallbacks.js`, the reader `compiled.css` uses):
 *
 * - a read of a global token (`:root` or theme level) takes its expanded declared value;
 * - a bare read of a variable declared in the same emitted stylesheet takes that declaration
 *   (U1's output rule, `addDeclaredFallbacks`);
 * - a bare read of a variable Publisher's own sources set inline (`runtimeSetVariables`, which
 *   includes HTML `style="--x:..."` strings) takes `unset`;
 * - a scoped or runtime read that already carries a fallback is left as written and listed.
 *
 * Inside a Tailwind arbitrary value (`grid-cols-[var(--x)_1fr]`) a space would split the class, so
 * the same value is spelled in Tailwind form: `var(--x,V)`, spaces as `_`.
 *
 * After changing a web view, regenerate `styles/preview.css` (`npm run generate:preview-css`).
 * Build Designer first.
 *
 *   node scripts/align-specimen-fallbacks.mjs [--check]
 * Exit codes: 0 = aligned or written, 1 = a fallback differs (--check), 2 = could not run.
 */
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
export const publisherRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Publisher's CSS emitters, relative to the package root. */
export const EMITTERS = [
  "src/specimen/theme.ts",
  "src/specimen/chrome.ts",
  "src/specimen/render-tokens.ts",
  "src/web/compositions/PublisherCompositionsView.tsx",
  "src/web/engines/preview/LayoutPreview.tsx",
  "src/web/engines/preview/PreviewViewport.tsx",
  "src/web/formats/PublisherFormatsView.tsx",
  "src/web/instances/PublisherInstancesView.tsx",
  "src/web/publisher/app/AppPack.tsx",
];

function designerRoot() {
  return resolve(dirname(require.resolve("@clossys/designer/theme.css")), "..");
}

async function importDesignerTool(root, file) {
  const path = join(root, "dist", "compiled-css", file);
  if (!existsSync(path)) throw new Error(`Designer is not built: ${path} is missing (run npm run build in packages/designer).`);
  return import(pathToFileURL(path).href);
}

/** The reader, Designer's declared sources with Publisher's own inline setters, and Designer's compiled.css. */
export async function loadReader() {
  const root = designerRoot();
  const { compiledCssDeclaredSources } = await importDesignerTool(root, "generate.js");
  const reader = await importDesignerTool(root, "declared-fallbacks.js");
  const { runtimeSetVariables } = await importDesignerTool(root, "runtime-setters.js");
  const sources = { ...compiledCssDeclaredSources(join(root, "styles")), runtimeSetVariables: runtimeSetVariables(publisherRoot) };
  const outputCss = readFileSync(join(root, "styles", "compiled.css"), "utf8");
  return { ...reader, sources, outputCss };
}

/** A Tailwind arbitrary value holding a `var(` read: `[...]` with no whitespace or quote inside. */
const ARBITRARY_VAR_RE = /\[([^\]\s"'`]*var\(--[^\]\s"'`]*)\]/g;

/** `text` with every emitted read aligned; arbitrary values spelled in Tailwind form. */
export function alignText(text, reader) {
  const { addDeclaredFallbacks, alignDeclaredFallbacks, sources, outputCss } = reader;
  const align = (css, own) => alignDeclaredFallbacks(addDeclaredFallbacks(css, sources), sources, `${outputCss}\n${own}`);
  let out = "";
  let last = 0;
  for (const m of text.matchAll(ARBITRARY_VAR_RE)) {
    const value = align((m[1]).replace(/_/g, " "), "").replace(/,\s+/g, ",").replace(/\s+/g, "_");
    out += align(text.slice(last, m.index), text) + `[${value}]`;
    last = m.index + m[0].length;
  }
  return out + align(text.slice(last), text);
}

/** Each emitter's current text and its aligned text. */
export async function alignEmitters(reader) {
  const r = reader ?? (await loadReader());
  return EMITTERS.map((file) => {
    const path = join(publisherRoot, file);
    const current = readFileSync(path, "utf8");
    return { file, path, current, expected: alignText(current, r) };
  });
}

const invoked = process.argv[1] !== undefined && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
if (invoked) {
  try {
    const reader = await loadReader();
    const results = await alignEmitters(reader);
    const stale = results.filter((r) => r.expected !== r.current);
    if (process.argv.includes("--check")) {
      for (const r of stale) console.error(`${r.file}: a fallback differs from its declared value. Run node scripts/align-specimen-fallbacks.mjs.`);
      if (stale.length > 0) process.exit(1);
      console.log(`${results.length} emitters: every fallback equals its declared value.`);
    } else {
      for (const r of stale) writeFileSync(r.path, r.expected, "utf8");
      console.log(stale.length > 0 ? `Wrote ${stale.map((r) => r.file).join(", ")}.` : "Already aligned.");
    }
    const listed = new Set();
    for (const r of results) {
      for (const read of reader.classifyFallbackReads(r.expected, reader.sources, `${reader.outputCss}\n${r.expected}`)) {
        if (read.kind !== "global" && read.kind !== "tw-property") listed.add(`${read.name} (${read.kind})`);
      }
    }
    console.log(`Left as written (no global declared value): ${[...listed].sort().join(", ") || "none"}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}
