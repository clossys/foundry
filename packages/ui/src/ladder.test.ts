import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * UI exposes reusable visual vocabulary only. Atoms are foundational;
 * blocks may compose atoms; shell and charts are sibling domains built on
 * atoms/blocks. Page-level views live in `@vespeneventures/surface/web`.
 */
const srcDir = dirname(fileURLToPath(import.meta.url));
const atomsDir = join(srcDir, "atoms");
const blocksDir = join(srcDir, "blocks");
const shellDir = join(srcDir, "shell");
const chartsDir = join(srcDir, "charts");
const themeDir = join(srcDir, "theme");
const iconsDir = join(srcDir, "icons");

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectSourceFiles(full, out);
    else if ([".ts", ".tsx"].includes(extname(full)) && !entry.includes(".test.")) out.push(full);
  }
  return out;
}

const IMPORT_RE = /(?:\bimport\s*\(|\brequire\s*\(|\b(?:import|export)\b[^'"]*?\bfrom\s*|\bimport\s+)\s*["']([^"']+)["']/g;

function referencesLayer(specifier: string, layer: string): boolean {
  return specifier.split("/").includes(layer);
}

function violations(dir: string, forbidden: readonly string[]): string[] {
  const found: string[] = [];
  for (const file of collectSourceFiles(dir)) {
    const code = readFileSync(file, "utf8");
    for (const match of code.matchAll(IMPORT_RE)) {
      const specifier = match[1] as string;
      for (const layer of forbidden) {
        if (referencesLayer(specifier, layer)) found.push(`${file}: ${specifier}`);
      }
    }
  }
  return found;
}

describe("ui layer dependencies", () => {
  it("atoms do not depend on blocks, shell, or charts", () => {
    expect(violations(atomsDir, ["blocks", "shell", "charts"])).toEqual([]);
  });

  it("blocks do not depend on shell or charts", () => {
    expect(violations(blocksDir, ["shell", "charts"])).toEqual([]);
  });

  it("shell does not depend on charts", () => {
    expect(violations(shellDir, ["charts"])).toEqual([]);
  });

  it("charts depend on neither blocks nor shell", () => {
    expect(violations(chartsDir, ["blocks", "shell"])).toEqual([]);
  });

  it("theme depends on neither blocks, shell, nor charts", () => {
    expect(violations(themeDir, ["blocks", "shell", "charts"])).toEqual([]);
  });

  it("icons remain pure glyph data", () => {
    expect(violations(iconsDir, ["atoms", "blocks", "shell", "charts", "theme"])).toEqual([]);
  });

  it("nothing outside theme depends on it — the same one-way sibling shape charts has", () => {
    expect(violations(atomsDir, ["theme"])).toEqual([]);
    expect(violations(blocksDir, ["theme"])).toEqual([]);
    expect(violations(shellDir, ["theme"])).toEqual([]);
    expect(violations(chartsDir, ["theme"])).toEqual([]);
  });

  it("the permitted blocks-to-atoms direction has real coverage", () => {
    expect(violations(blocksDir, ["atoms"]).length).toBeGreaterThan(0);
  });

  it("the permitted theme-to-atoms direction has real coverage", () => {
    expect(violations(themeDir, ["atoms"]).length).toBeGreaterThan(0);
  });
});
