import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";
import { scanCompiledCssSources } from "./scan-sources.js";
import { generateUtilitiesCss } from "./utilities.js";

const packageRoot = resolve(import.meta.dirname, "..", "..");

describe("generateUtilitiesCss", () => {
  it("emits single-line @source inline directives with sorted, de-duplicated, quote-safe candidates", () => {
    const css = generateUtilitiesCss(["px-md", "bg-accent", "px-md", 'bad"one', "has space"]);
    expect(css).toContain('@source inline("bg-accent px-md");');
    expect(css).not.toContain("bad");
  });

  it("styles/utilities.css is in sync with the component scan and lists real utilities", () => {
    const onDisk = readFileSync(resolve(packageRoot, "styles", "utilities.css"), "utf8");
    expect(onDisk).toBe(generateUtilitiesCss(scanCompiledCssSources(packageRoot).candidates));
    expect(onDisk).toMatch(/\bbg-accent\b/);
  });

  it("importing styles/utilities.css after theme.css generates this package's utilities with no path @source", async () => {
    const req = createRequire(import.meta.url);
    const compiler = await compile(
      '@import "tailwindcss/utilities"; @import "./styles/theme.css"; @import "./styles/utilities.css";',
      {
        base: packageRoot,
        loadStylesheet: async (id, base) => {
          const path = id.startsWith("tailwindcss/") ? req.resolve(`${id}.css`) : resolve(base, id);
          return { path, base: resolve(path, ".."), content: readFileSync(path, "utf8") };
        },
      },
    );
    const out = compiler.build([]);
    expect(out).toMatch(/\.bg-accent\s*\{/);
    expect(out).toMatch(/\.rounded-pill\s*\{/);
  });

  it("theme-keys.css keeps --breakpoint-* as literal lengths", () => {
    const keys = readFileSync(resolve(packageRoot, "styles", "theme-keys.css"), "utf8");
    const decls = [...keys.matchAll(/--breakpoint-[a-z-]+:\s*([^;]+);/g)].map((m) => m[1]!.trim());
    expect(decls.length).toBeGreaterThan(0);
    for (const v of decls) expect(v).toMatch(/^\d+(?:\.\d+)?(?:px|rem|em)$/);
  });
});
