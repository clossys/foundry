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
/** Permissive licences only; anything else (copyleft, unknown, missing) needs a deliberate decision. */
const ALLOWED_LICENCES = ["MIT", "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "0BSD"];
const mentions = (text: string) => expect(notices.includes(text), `THIRD-PARTY-NOTICES.md must contain ${JSON.stringify(text)}`).toBe(true);

describe("THIRD-PARTY-NOTICES.md", () => {
  it("ships in the package", () => {
    expect(pkg.files).toContain("THIRD-PARTY-NOTICES.md");
  });

  it("gives every notice section exactly one SPDX licence line from the permissive allow-list", () => {
    const sections = notices.split(/^## /m).slice(1);
    expect(sections.length).toBeGreaterThan(0);
    const problems = sections.flatMap(section => {
      const title = section.slice(0, section.indexOf("\n"));
      const ids = [...section.matchAll(/^SPDX-License-Identifier: *(.*)$/gm)].map(m => m[1]!.trim());
      if (ids.length !== 1) return [`${title}: ${ids.length} SPDX-License-Identifier lines`];
      return ALLOWED_LICENCES.includes(ids[0]!) ? [] : [`${title}: ${ids[0]}`];
    });
    expect(problems).toEqual([]);
    expect(notices).not.toMatch(/\b[AL]?GPL\b|General Public License|Mozilla Public License|Eclipse Public License|Server Side Public License/i);
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
