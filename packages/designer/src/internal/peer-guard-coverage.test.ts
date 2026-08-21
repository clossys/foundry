import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #182 asks that every adapter module importing an optional peer be
 * guarded, and that coverage be CONFIRMED, not merely asserted in prose —
 * "enumerate them and confirm coverage rather than asserting it". This
 * file is that enumeration: it scans this package's own real source tree
 * (never a hand-maintained list that could drift from it) for every
 * import of each of the six peers `package.json`'s `peerDependenciesMeta`
 * declares optional, and checks each finding against where #182's guard
 * for that peer is actually wired in (see `internal/peer-version.ts`'s
 * own header for the full per-peer rationale this test enforces).
 */

const srcDir = dirname(fileURLToPath(import.meta.url));
const packageSrcRoot = join(srcDir, "..");

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectSourceFiles(full, out);
    else if ([".ts", ".tsx"].includes(entry.slice(entry.lastIndexOf("."))) && !entry.includes(".test.")) out.push(full);
  }
  return out;
}

const ALL_SOURCE_FILES = collectSourceFiles(packageSrcRoot);

function filesImporting(specifier: string): string[] {
  const needle = `"${specifier}"`;
  return ALL_SOURCE_FILES.filter((file) => {
    const code = readFileSync(file, "utf8");
    return new RegExp(`from\\s+${needle.replace(/[.+*?^${}()|[\]\\]/g, "\\$&")}`).test(code);
  }).map((file) => relative(packageSrcRoot, file));
}

function fileCallsAssertPeerVersionFor(relativePath: string, peer: string): boolean {
  const code = readFileSync(join(packageSrcRoot, relativePath), "utf8");
  return code.includes("assertPeerVersion(") && code.includes(`peer: "${peer}"`);
}

describe("peer guard coverage (#182)", () => {
  it("every file importing react-aria-components is a component subpath barrel that guards it", () => {
    const importers = filesImporting("react-aria-components");
    expect(importers.length).toBeGreaterThan(0);

    // The three public barrels that must each independently guard
    // react-aria-components, because each is a separate `exports` subpath
    // a consumer can import without ever loading the others.
    const guardedBarrels = ["atoms/index.ts", "blocks/index.ts", "shell/index.ts"];
    for (const barrel of guardedBarrels) {
      expect(fileCallsAssertPeerVersionFor(barrel, "react-aria-components")).toBe(true);
    }

    // Every real importer must live under one of those three barrels'
    // own subtree — otherwise a new adapter import site was added
    // somewhere this test (and #182's guard) doesn't yet cover.
    for (const importer of importers) {
      const coveredByABarrel = guardedBarrels.some((barrel) => importer.startsWith(barrel.replace("/index.ts", "/")) || importer === barrel);
      expect(coveredByABarrel, `${importer} imports react-aria-components outside a guarded barrel's subtree`).toBe(true);
    }
  });

  it("every component subpath barrel that imports react directly guards it", () => {
    const guardedBarrels = ["atoms/index.ts", "blocks/index.ts", "shell/index.ts", "charts/index.ts", "theme/index.ts"];
    for (const barrel of guardedBarrels) {
      expect(fileCallsAssertPeerVersionFor(barrel, "react")).toBe(true);
    }
  });

  it("tailwindcss is imported only from compiled-css/generate.ts, and that file guards it", () => {
    const importers = filesImporting("tailwindcss").concat(filesImporting("tailwindcss/theme")).concat(filesImporting("tailwindcss/utilities"));
    for (const importer of importers) {
      expect(importer, "an unexpected new tailwindcss import site needs its own #182 guard").toBe("compiled-css/generate.ts");
    }
    expect(fileCallsAssertPeerVersionFor("compiled-css/generate.ts", "tailwindcss")).toBe(true);
  });

  it("tailwind-merge is imported only from atoms/internal/cx.ts — the one file assertTailwindMergeVersion documents guarding", () => {
    const importers = filesImporting("tailwind-merge");
    expect(importers).toEqual(["atoms/internal/cx.ts"]);
  });

  it("react-dom has no adapter import site anywhere in this package's own source — nothing to guard", () => {
    expect(filesImporting("react-dom")).toEqual([]);
  });

  it("@internationalized/date has no adapter import site anywhere in this package's own runtime source — nothing to guard", () => {
    expect(filesImporting("@internationalized/date")).toEqual([]);
  });
});
