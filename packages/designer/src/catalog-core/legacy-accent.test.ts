// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { legacyColorUses, type LegacyColorMap } from "./legacy-color.js";

/**
 * G4 (GATES-RED round 4): `--color-accent` had two meanings, the legacy Foundry brand/action
 * colour and the stock shadcn highlight surface. Every old-meaning use in every package was
 * recomposed by the `styles/legacy-color-map.json` map (`accent` -> `primary`,
 * `accent-tint` -> `accent`) and the hand-authored key was removed, so the generated key
 * `--color-accent: var(--accent)` is the only meaning left.
 *
 * The check reads every package source and test. It skips only what carries the new
 * (shadcn) meaning by construction or is frozen input: the stock shadcn copy
 * (`packages/designer/ui`), vendored registry references (`packages/designer/references`),
 * the importers that read vendor class names (`src/importers`), and `__fixtures__` /
 * `test-fixtures` inputs. A declaration of the legacy token (`--color-accent-tint: ...`)
 * is a definition in the token layer, not a use.
 */
const repo = new URL("../../../../", import.meta.url);
const SKIP_DIR = new Set(["node_modules", "dist", ".next", "coverage", "__fixtures__", "test-fixtures", ".turbo"]);
const STOCK = [/^packages\/designer\/ui\//, /^packages\/designer\/references\//, /^packages\/designer\/src\/importers\//];
const walk = (dir: string): string[] =>
  readdirSync(new URL(dir, repo), { withFileTypes: true }).flatMap(entry => SKIP_DIR.has(entry.name) ? [] : entry.isDirectory() ? walk(`${dir}${entry.name}/`) : [`${dir}${entry.name}`]);
const files = walk("packages/").filter(path => /\.(?:tsx?|mts|mjs|css)$/.test(path) && !STOCK.some(rule => rule.test(path)));
const legacyMap = JSON.parse(readFileSync(new URL("packages/designer/styles/legacy-color-map.json", repo), "utf8")) as LegacyColorMap & { migrated: Record<string, { shadcn: string }> };
const OLD = { map: { accent: legacyMap.migrated.accent!, "accent-tint": legacyMap.map["accent-tint"]! } } as unknown as LegacyColorMap;
const DECLARATION = /^\s*["']?--color-accent(?:-tint)?["']?\s*:/;
const PROPERTY = /var\(\s*--color-accent(?:-tint)?(?![\w-])/g;

/** Old-meaning uses: an `accent-tint` utility, or a `var()` read of `--color-accent` / `--color-accent-tint`. */
function oldAccentUses(sources: readonly { path: string; content: string }[]): string[] {
  const rows: string[] = [];
  for (const source of sources) {
    const lines = source.content.split("\n");
    lines.forEach((line, index) => {
      if (DECLARATION.test(line)) return;
      for (const match of line.matchAll(PROPERTY)) rows.push(`${source.path}:${index + 1} ${match[0]}`);
    });
    for (const use of legacyColorUses([source], OLD)) if (use.legacy === "accent-tint" && !use.use.startsWith("--")) rows.push(`${use.file}:${use.line} ${use.use}`);
  }
  return rows;
}

describe("old-meaning brand accent (G4), every package", () => {
  it("records the migrated key and keeps it out of the live map", () => {
    expect(legacyMap.migrated.accent).toMatchObject({ shadcn: "primary" });
    expect(Object.keys(legacyMap.map)).not.toContain("accent");
    expect(legacyMap.map["accent-tint"]).toMatchObject({ shadcn: "accent" });
  });

  it("scans every package", () => {
    const packages = new Set(files.map(path => path.split("/")[1]));
    for (const name of ["designer", "publisher", "producer", "writer"]) expect(packages.has(name), name).toBe(true);
    expect(files.length).toBeGreaterThan(1000);
  });

  it("finds no old-meaning --color-accent use in any package", () => {
    expect(oldAccentUses(files.map(path => ({ path, content: readFileSync(new URL(path, repo), "utf8") })))).toEqual([]);
  });

  it("catches an old-meaning use planted in another package, and leaves token definitions alone", () => {
    // Spelled in parts so this file is not itself a use.
    const tint = ["accent", "tint"].join("-");
    const prop = ["--color", "accent"].join("-");
    const planted = [
      { path: "packages/publisher/src/web/m.tsx", content: `const a = "bg-${tint} hover:text-${tint}/80";\nconst b = { color: "var(${prop}, red)" };` },
      { path: "packages/designer/styles/m.css", content: `  ${prop}-tint: oklch(0.4748 0 0 / 0.1);\n  --x: var( ${prop}-tint);` },
    ];
    expect(oldAccentUses(planted)).toEqual([
      `packages/publisher/src/web/m.tsx:2 var(${prop}`,
      `packages/publisher/src/web/m.tsx:1 bg-${tint}`,
      `packages/publisher/src/web/m.tsx:1 hover:text-${tint}`,
      `packages/designer/styles/m.css:2 var( ${prop}-tint`,
    ]);
  });
});
