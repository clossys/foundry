/** @vitest-environment node */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * R2F-51: the vendored Intent `SearchField` drops upstream's default `aria-label="Search"` (with a visible
 * `<Label>` child react-aria would otherwise name the input "Search <label>"). This audit pins that every
 * source call site names the field itself: a `<Label>`-family child or an explicit `aria-label`/`aria-labelledby`.
 */
const src = resolve(import.meta.dirname, "../..");
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === "node_modules" ? [] : sources(path);
    return /\.tsx$/.test(entry) ? [path] : [];
  });
}
const NAMED = /aria-label(?:ledby)?=|<(?:Label|SearchLabel|FieldLabel)\b/;

function callSites(): Array<{ file: string; jsx: string }> {
  const sites: Array<{ file: string; jsx: string }> = [];
  for (const file of sources(src)) {
    const text = readFileSync(file, "utf8");
    if (!/import\s*\{[^}]*\bSearchField\b[^}]*\}\s*from\s*"[^"]*(?:intent\/search-field|components\/index|\.\.\/components|\.\/components)(?:\.js)?"/.test(text) && !/SearchField\s*=\s*componentLeaf/.test(text)) continue;
    for (const match of text.matchAll(/<SearchField\b/g)) {
      const start = match.index!;
      const close = text.indexOf("</SearchField>", start);
      const selfClose = text.indexOf("/>", start);
      const end = close === -1 ? selfClose + 2 : close + "</SearchField>".length;
      sites.push({ file: relative(src, file), jsx: text.slice(start, end) });
    }
  }
  return sites;
}

describe("Intent SearchField call sites name the field (R2F-51)", () => {
  it("finds the source call sites", () => {
    expect(callSites().length).toBeGreaterThan(0);
  });
  it.each(callSites().map(site => [site.file, site.jsx] as const))("%s names its SearchField", (_file, jsx) => {
    expect(jsx).toMatch(NAMED);
  });
});
