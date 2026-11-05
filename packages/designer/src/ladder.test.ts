import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * UI exposes reusable visual vocabulary only. Components are foundational;
 * blocks may compose components; shell and charts are sibling domains built on
 * components/blocks. Page-level views live in `@example/surface/web`.
 */
const srcDir = dirname(fileURLToPath(import.meta.url));
const componentsDir = join(srcDir, "components");
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
  it("keeps AccountMenu imports inside its host-data and visual composition boundary", () => {
    const source = readFileSync(join(blocksDir, "AccountMenu.tsx"), "utf8");
    const imports = [...source.matchAll(IMPORT_RE)].map(match => match[1]);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter(specifier => !/^(?:react|\.\/account-menu-types\.js|\.\.\/components\/(?:Avatar|Button|Icon|Menu|Tooltip)\.js|\.\.\/icons\/(?:Check|ChevronUp)\.js)$/.test(specifier!))).toEqual([]);
    expect(source).not.toMatch(/\b(?:localStorage|sessionStorage|indexedDB|cookie|fetch)\b/);
  });
  it("keeps CommandMenu data and actions host-owned with no service imports", () => {
    const source = readFileSync(join(blocksDir, "CommandMenu.tsx"), "utf8");
    expect(source).not.toMatch(/\b(?:fetch|localStorage|sessionStorage|indexedDB|XMLHttpRequest)\b/);
    for (const match of source.matchAll(IMPORT_RE)) {
      expect(match[1]).not.toMatch(/auth|storage|fetch|theme|bouncer|node:/i);
    }
  });
  it("components do not depend on blocks, shell, or charts", () => {
    expect(violations(componentsDir, ["blocks", "shell", "charts"])).toEqual([]);
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
    expect(violations(iconsDir, ["components", "blocks", "shell", "charts", "theme"])).toEqual([]);
  });

  it("nothing outside theme depends on it — the same one-way sibling shape charts has", () => {
    expect(violations(componentsDir, ["theme"])).toEqual([]);
    expect(violations(blocksDir, ["theme"])).toEqual([]);
    expect(violations(shellDir, ["theme"])).toEqual([]);
    expect(violations(chartsDir, ["theme"])).toEqual([]);
  });

  it("frames compose Designer layers without importing Publisher or self package entrypoints", () => {
    const files = collectSourceFiles(join(srcDir, "frames"));
    expect(files.some(file => file.endsWith("AppFrame.tsx"))).toBe(true);
    for (const file of files) for (const match of readFileSync(file, "utf8").matchAll(IMPORT_RE)) {
      expect(match[1]).not.toMatch(/@clossys\/(?:publisher|designer)(?:\/|$)/);
    }
    for (const dir of [componentsDir, blocksDir, shellDir, chartsDir, themeDir]) expect(violations(dir, ["frames"])).toEqual([]);
  });

  it("the permitted blocks-to-components direction has real coverage", () => {
    expect(violations(blocksDir, ["components"]).length).toBeGreaterThan(0);
  });

  it("the permitted theme-to-components direction has real coverage", () => {
    expect(violations(themeDir, ["components"]).length).toBeGreaterThan(0);
  });
});
