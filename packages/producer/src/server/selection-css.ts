import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { transform } from "esbuild";
import { resolveAgent } from "../agents.js";
import { agentModule } from "./cells.js";

/** Extract static class strings after the existing compiler normalizes TS/JSX quotes. */
async function sourceCandidates(name: string, contents: string): Promise<string[]> {
  const extension = extname(name);
  if (![".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"].includes(extension) || name.endsWith(".d.ts")) return [];
  const code = extension === ".json" ? contents : (await transform(contents, {
    loader: extension === ".tsx" ? "tsx" : extension === ".jsx" ? "jsx" : extension === ".ts" ? "ts" : "js",
    jsx: "automatic", legalComments: "none", charset: "utf8", supported: { "template-literal": false },
  })).code;
  // No utility shape filter: selected fills can use arbitrary values and variants.
  // Tailwind itself decides which literal tokens are supported utilities.
  return [...code.matchAll(/"(?:[^"\\]|\\.)*"/g)].flatMap(match => {
    try { return (JSON.parse(match[0]) as string).split(/\s+/).filter(Boolean); }
    catch { return []; }
  });
}

/** Generate selected utility closure with Designer's real compiler and foundations. */
export async function selectionCss(files: ReadonlyMap<string, string>, hostCandidates: readonly string[] = ["m-0", "font-body"]): Promise<string> {
  const stylesDir = join(resolveAgent("designer").packageRoot, "styles");
  const [tokens, utilities, selected, generator] = await Promise.all([
    readFile(join(stylesDir, "tokens.css"), "utf8"),
    readFile(join(stylesDir, "utilities.css"), "utf8"),
    Promise.all([...files].map(([name, contents]) => sourceCandidates(name, contents))),
    agentModule("designer", "compiled-css/generate.js"),
  ]);
  // Public package-backed selected fills share the official shipped candidates.
  const official = [...utilities.matchAll(/@source\s+inline\(("(?:[^"\\]|\\.)*")\)/g)]
    .flatMap(match => (JSON.parse(match[1]!) as string).split(/\s+/));
  const candidates = [...new Set([...official, ...selected.flat(), ...hostCandidates])].filter(Boolean).sort();
  const generated = await generator.generateCompiledCss({ stylesDir, candidates }) as { css: string };
  const owned = [...files].filter(([name]) => extname(name) === ".css")
    .sort(([left], [right]) => left.localeCompare(right)).map(([, contents]) => contents);
  return [tokens, generated.css, ...owned].join("\n");
}
