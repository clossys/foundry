import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, join } from "node:path";
import { Scanner } from "@tailwindcss/oxide";
import { compile } from "tailwindcss";
import { resolveAgent } from "../agents.js";
import { agentModule } from "./cells.js";
import { SHADCN_SELECTION_BASE_CSS } from "./selection-shadcn-base.js";

/** The caller resolves these values from the same consumer selection as the sources. */
export interface SelectionCssTokens { css: string; theme: string }

const require = createRequire(import.meta.url);

/** Native @source discovery over the exact emitted files, without a filesystem-wide scan. */
async function selectedUtilities(files: ReadonlyMap<string, string>, stylesDir: string, hostCandidates: readonly string[], theme: string) {
  const sources = [...files.keys()].filter(name => /\.(?:[cm]?[jt]sx?|json)$/.test(name) && !name.endsWith(".d.ts")).sort();
  const entry = [
    '@import "tailwindcss/theme.css" layer(foundry-ui-selected-theme);',
    '@import "tailwindcss/utilities.css" layer(foundry-ui-selected) source(none);',
    SHADCN_SELECTION_BASE_CSS,
    theme,
    ...sources.map(name => `@source ${JSON.stringify(name)};`),
  ].join("\n");
  const compiled = await compile(entry, {
    base: stylesDir,
    loadStylesheet: async id => {
      const path = require.resolve(id);
      return { path, base: dirname(path), content: await readFile(path, "utf8") };
    },
  });
  const scanner = new Scanner({});
  // Core Tailwind declares the sources; its own scanner extracts their candidates.
  // All contents come from this selection's immutable map, including dot/ignored paths.
  const selected = scanner.scanFiles(compiled.sources.map(source => {
    const content = files.get(source.pattern);
    if (source.negated || content === undefined) throw new Error("Selected CSS source does not belong to the emitted selection");
    return { content, extension: extname(source.pattern).slice(1) };
  }));
  const candidates = [...new Set([...selected, ...hostCandidates])].sort();
  return { candidates, css: compiled.build(candidates) };
}

/** Generate selected utility closure with Designer's real compiler and foundations. */
export async function selectionCss(files: ReadonlyMap<string, string>, hostCandidates: readonly string[] = ["m-0", "font-body"], consumerTokens: SelectionCssTokens = { css: "", theme: "" }): Promise<string> {
  const stylesDir = join(resolveAgent("designer").packageRoot, "styles");
  const [tokens, utilities, selected, generator] = await Promise.all([
    readFile(join(stylesDir, "tokens.css"), "utf8"),
    readFile(join(stylesDir, "utilities.css"), "utf8"),
    selectedUtilities(files, stylesDir, hostCandidates, consumerTokens.theme),
    agentModule("designer", "compiled-css/generate.js"),
  ]);
  // Public package-backed selected fills share the official shipped candidates.
  const official = [...utilities.matchAll(/@source\s+inline\(("(?:[^"\\]|\\.)*")\)/g)]
    .flatMap(match => (JSON.parse(match[1]!) as string).split(/\s+/));
  const candidates = [...new Set([...official, ...selected.candidates])].filter(Boolean).sort();
  const generated = await generator.generateCompiledCss({ stylesDir, candidates }) as { css: string };
  const owned = [...files].filter(([name]) => extname(name) === ".css")
    .sort(([left], [right]) => left.localeCompare(right)).map(([, contents]) => contents);
  return [tokens, generated.css, selected.css, ...owned, consumerTokens.css].join("\n");
}
