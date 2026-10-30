import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(import.meta.dirname, "..");
const req = createRequire(import.meta.url);

async function build(entry: string): Promise<string> {
  const compiler = await compile(entry, {
    base: packageRoot,
    loadStylesheet: async (id, base) => {
      const path = id.startsWith("tailwindcss") ? req.resolve(id === "tailwindcss" ? "tailwindcss/index.css" : `${id}.css`) : resolve(base, id);
      return { path, base: resolve(path, ".."), content: readFileSync(path, "utf8") };
    },
  });
  return compiler.build([]);
}

/** The body of the first rule whose selector list starts with `selector`, comments stripped. */
function ruleBody(css: string, selector: RegExp): string {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const match = new RegExp(`(?:^|[}\\s])${selector.source}[^{]*\\{([^}]*)\\}`).exec(clean);
  expect(match, `rule ${selector}`).not.toBeNull();
  return match![1]!;
}

function fontFamily(body: string): string {
  return /font-family:\s*([^;]+);/.exec(body)?.[1] ?? "";
}

// Tailwind's preflight sets the document face from `--default-font-family`
// (and code/kbd/pre from `--default-mono-font-family`). Unless the theme routes
// those to this package's font tokens, every surface that does not opt into the
// `font-body` utility (the application frame, the Studio, the boards) renders
// in Tailwind's own `--font-sans` stack and never sees the brand's body face.
describe.each([
  ["theme.css (greenfield)", '@import "tailwindcss"; @import "./styles/theme.css";'],
  ["theme-keys.css (existing token root)", '@import "tailwindcss"; @import "./styles/theme-keys.css";'],
])("the document default face through %s", (_label, entry) => {
  it("reads --font-body for the document and --font-mono for code", async () => {
    const css = await build(entry);
    expect(fontFamily(ruleBody(css, /html,\s*:host/))).toMatch(/^var\(--font-body\b/);
    expect(fontFamily(ruleBody(css, /code,\s*kbd,\s*samp,\s*pre/))).toMatch(/^var\(--font-mono\b/);
  });
});
