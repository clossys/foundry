import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * THIRD-PARTY-NOTICES.md must cover the third-party material this package
 * ships: the Lucide path data vendored in scripts/icon-source-data.json at the
 * versions scripts/generate-icons.mjs pins, and any package it would install.
 * Optional peers are installed by the consumer, not by this package;
 * import-boundary.test.ts pins that peer set.
 */
const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file: string) => readFileSync(join(pkgDir, file), "utf8");
const notices = read("THIRD-PARTY-NOTICES.md");
const pkg = JSON.parse(read("package.json"));
const mentions = (text: string) => expect(notices.includes(text), `THIRD-PARTY-NOTICES.md must contain ${JSON.stringify(text)}`).toBe(true);

describe("THIRD-PARTY-NOTICES.md", () => {
  it("ships in the package", () => {
    expect(pkg.files).toContain("THIRD-PARTY-NOTICES.md");
  });

  it("names every Lucide version the icon generator pins, with the Lucide licence", () => {
    const pinned = new Set([...read("scripts/generate-icons.mjs").matchAll(/\bLucide (\d+\.\d+\.\d+)\b/g)].map(m => m[1]));
    expect(pinned.size).toBeGreaterThan(0);
    for (const version of pinned) mentions(`version ${version}`);
    mentions("\n## Lucide\n");
    mentions("ISC License");
  });

  it("states the number of vendored glyphs the generator compiles", () => {
    const glyphs = Object.keys(JSON.parse(read("scripts/icon-source-data.json")));
    mentions(`The ${glyphs.length} glyphs`);
  });

  it("has a section for every package this package would install at runtime", () => {
    const runtime = ["dependencies", "optionalDependencies", "bundleDependencies", "bundledDependencies"].flatMap(key => {
      const value = pkg[key] ?? {};
      return Array.isArray(value) ? value : Object.keys(value);
    });
    for (const name of runtime) mentions(`\n## ${name}\n`);
  });
});
