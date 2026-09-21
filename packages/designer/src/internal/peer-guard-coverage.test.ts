import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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

/**
 * Matches BOTH a static `import ... from "specifier"` and a dynamic
 * `import("specifier")` — #749's fix made `atoms/internal/cx.ts` resolve
 * `tailwind-merge` via a dynamic `import()` (inside a `try`/`catch`,
 * so an absent optional peer degrades instead of throwing; see that
 * file's own header) instead of the static import it used before. A
 * detector that only matched the static `from "..."` shape would stop
 * seeing that real import site at all the moment it went dynamic —
 * silently losing coverage rather than adapting to it.
 */
function filesImporting(specifier: string): string[] {
  const quoted = `"${specifier}"`.replace(/[.+*?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`from\\s+${quoted}|import\\(\\s*${quoted}\\s*\\)`);
  return ALL_SOURCE_FILES.filter((file) => {
    const code = readFileSync(file, "utf8");
    return pattern.test(code);
  }).map((file) => relative(packageSrcRoot, file));
}

function fileCallsAssertPeerVersionFor(relativePath: string, peer: string): boolean {
  const code = readFileSync(join(packageSrcRoot, relativePath), "utf8");
  return code.includes("assertPeerVersion(") && code.includes(`peer: "${peer}"`);
}

/**
 * #903 (designer's half): every `<dir>/server.ts` is its own `exports`
 * subpath a consumer can import without ever loading its sibling
 * `<dir>/index.ts` — so a guard wired only into `index.ts` covers nothing for
 * a consumer who only ever resolves `@clossys/designer/charts/server`.
 * The barrel set below is DERIVED from `package.json#exports` (never a
 * hand-written array that could drift from it, same reasoning as
 * `ALL_SOURCE_FILES` above) and checked against BUILT `dist/` — what a
 * consumer actually resolves — rather than `src/`, so a source-only guard
 * that fails to survive the build is caught here too.
 */
const packageRoot = join(packageSrcRoot, "..");
const exportsMap = (JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { exports: Record<string, { import?: string }> }).exports;

const COMPONENT_LAYER_DIRS = ["atoms", "blocks", "charts", "shell", "theme"] as const;

const COMPONENT_BARRELS = Object.keys(exportsMap)
  .filter((subpath) => COMPONENT_LAYER_DIRS.some((dir) => subpath === `./${dir}` || subpath === `./${dir}/server`))
  .map((subpath) => {
    const distImport = exportsMap[subpath]?.import;
    if (!distImport) throw new Error(`${subpath} has no "import" condition in package.json#exports`);
    return { subpath, distPath: distImport.replace(/^\.\//, "") };
  });

function readDistFile(distPath: string): string {
  const full = join(packageRoot, distPath);
  if (!existsSync(full)) {
    throw new Error(`${distPath} does not exist — run "npm run build" in packages/designer before this test (dist/ is gitignored and must be fresh, same precondition as check:contrast and check:package-governance)`);
  }
  return readFileSync(full, "utf8");
}

describe("peer guard coverage (#182)", () => {
  it("covers every component-layer exports subpath, derived from package.json — not a hand-written barrel list", () => {
    // Regression guard for #903: this must be 10 (5 index.ts + 5
    // server.ts — one per component-layer dir) for designer today. Of
    // those 10, 9 actually call assertPeerVersion (theme/server.ts is
    // the documented exception the next test below confirms). A number
    // changes only when package.json#exports itself changes, which is
    // the point — the count is a consequence of the derivation, not an
    // assertion pinned independently of it.
    expect(COMPONENT_BARRELS.length).toBe(10);
  });

  it("every component-layer barrel that imports react in its BUILT dist output guards it, except a documented exception", () => {
    for (const { subpath, distPath } of COMPONENT_BARRELS) {
      const code = readDistFile(distPath);
      const importsReact = /from\s+"react"/.test(code);

      if (!importsReact) {
        // theme/server is the one barrel with no runtime react import at
        // all (getThemeInitScript has no react dependency — see
        // theme/server.ts's own header) — nothing to guard, and its
        // absence must stay documented there rather than silently
        // vanishing from this test's coverage.
        expect(subpath, `${subpath} has no "react" import in dist and must document why (see theme/server.ts's header) if that's intentional`).toBe("./theme/server");
        const source = readFileSync(join(packageSrcRoot, distPath.replace(/^dist\//, "").replace(/\.js$/, ".ts")), "utf8");
        expect(source, `${subpath}'s source must document why it has no react peer guard`).toMatch(/no `?react`? peer guard/i);
        continue;
      }

      expect(code.includes("assertPeerVersion("), `${subpath} (${distPath}) imports react but never calls assertPeerVersion`).toBe(true);
      expect(code.includes('peer: "react"'), `${subpath} (${distPath}) imports react but doesn't guard peer "react"`).toBe(true);
    }
  });
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

  it("tailwindcss is imported only from guarded compile sites, and each guards it", () => {
    const allowed = new Set(["compiled-css/generate.ts", "hero-css/compile-consumer-css.ts"]);
    const importers = filesImporting("tailwindcss").concat(filesImporting("tailwindcss/theme")).concat(filesImporting("tailwindcss/utilities"));
    for (const importer of importers) {
      expect(allowed.has(importer), `an unexpected new tailwindcss import site needs its own #182 guard: ${importer}`).toBe(true);
    }
    expect(fileCallsAssertPeerVersionFor("compiled-css/generate.ts", "tailwindcss")).toBe(true);
    expect(fileCallsAssertPeerVersionFor("hero-css/compile-consumer-css.ts", "tailwindcss")).toBe(true);
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
