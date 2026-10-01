import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
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
    expect(only.length, "charts render a utility no atom, block or shell renders").toBeGreaterThan(0);
    for (const c of only) expect(listed.has(c), `${c} (from src/charts)`).toBe(true);
    expect(listed.has("h-3")).toBe(true);
  });

  it("scans every exported component directory", () => {
    const pkg = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")) as { exports: Record<string, unknown> };
    const dirs = new Set(Object.keys(pkg.exports).map((k) => k.split("/")[1]!).filter((d) => d && !d.includes(".")));
    const withComponents = [...dirs].filter((d) => {
      try {
        return readdirSync(resolve(packageRoot, "src", d), { recursive: true }).some((f) => /(?<!\.test)\.tsx$/.test(String(f)));
      } catch {
        return false;
      }
    });
    expect(withComponents.length).toBeGreaterThan(0);
    for (const d of withComponents) expect([...UTILITIES_SOURCE_DIRS], d).toContain(d);
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
