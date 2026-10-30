import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, sep } from "node:path";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";
import { scanClassCandidates } from "./class-scan.js";
import { scanCompiledCssSources, scanUtilitiesSources, UTILITIES_SOURCE_DIRS } from "./scan-sources.js";
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
    expect(onDisk).toBe(generateUtilitiesCss(scanUtilitiesSources(packageRoot).candidates));
    expect(onDisk).toMatch(/\bbg-accent\b/);
  });

  it("lists classes only the chart components render", () => {
    const onDisk = readFileSync(resolve(packageRoot, "styles", "utilities.css"), "utf8");
    const listed = new Set(onDisk.match(/[^\s"()]+/g));
    const narrow = new Set(scanCompiledCssSources(packageRoot).candidates);
    const only = scanClassCandidates(resolve(packageRoot, "src", "charts")).candidates.filter((c) => !narrow.has(c) && /^[a-z]+-\d/.test(c));
    expect(only.length, "charts render a utility no component, block or shell renders").toBeGreaterThan(0);
    for (const c of only) expect(listed.has(c), `${c} (from src/charts)`).toBe(true);
    expect(listed.has("h-3")).toBe(true);
  });

  it("covers every exported TSX implementation with a path-boundary scan root", () => {
    const pkg = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")) as { exports: Record<string, unknown> };
    const dirs = new Set(Object.keys(pkg.exports).map(key => key.split("/")[1]!).filter(dir => dir && !dir.includes(".")));
    const implementations = [...dirs].flatMap(dir => {
      const root = resolve(packageRoot, "src", dir);
      if (!existsSync(root)) return [];
      return readdirSync(root, { recursive: true }).map(file => `${dir}/${String(file).split(sep).join("/")}`);
    }).filter(file => file.endsWith(".tsx") && !file.endsWith(".test.tsx"));
    const covered = (file: string) => UTILITIES_SOURCE_DIRS.some(root => file.startsWith(`${root}/`));
    expect(implementations.length).toBeGreaterThan(0);
    for (const file of implementations) expect(covered(file), file).toBe(true);
    expect(covered("frames/AppFrame.tsx")).toBe(true);
    expect(covered("studio/AssetExemptions.tsx")).toBe(true);
    expect(covered("studio-other/AssetExemptions.tsx")).toBe(false);
    expect(covered("frames-other/AppFrame.tsx")).toBe(false);
    expect(covered("tokens/preview/index.tsx")).toBe(true);
    expect(covered("tokens/preview-other/index.tsx")).toBe(false);
    expect(covered("tokens/other.tsx")).toBe(false);
    expect([...UTILITIES_SOURCE_DIRS]).not.toContain("tokens");
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
});
