/**
 * Exercises `compileConsumerCss` against real `theme.css` and optional
 * `@source` / dist candidate scanning — the unstyled-Hero failure mode when
 * consumers import theme without scanning built output.
 *
 * The pnpm symlink `@source` pitfall (originally reported as Turbopack
 * resolving a symlinked `node_modules` path to nothing — see README Setup)
 * IS reproduced here as a control, per the 2026-09-21 issue #1032 comment
 * confirming a consumer integration saw it live. `compileConsumerCss`
 * itself cannot be reused for that reproduction: its `@source` line is
 * decorative for the programmatic `compile().build()` path (see that
 * module's header) — candidates come from a hand-rolled directory walk
 * (`scanClassCandidates`) that never exercises Tailwind's own symlink
 * handling. The "pnpm symlinked node_modules layout" describe block below
 * instead drives `@tailwindcss/oxide`'s `Scanner` directly — the same
 * native scanner the real Tailwind v4 CLI, PostCSS plugin, and Vite plugin
 * use to resolve a directory `@source` — against a `.pnpm`-store-style
 * fixture built from this package's own `npm pack` tarball, so the
 * candidate set reflects genuine Tailwind symlink resolution instead of
 * this test file's own directory walk.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { checkHeroCss, HERO_BUTTON_REQUIRED_UTILITIES } from "./check-hero-css.js";
import { compileConsumerCss } from "./compile-consumer-css.js";

const packageRoot = resolve(import.meta.dirname, "..", "..");
const distDir = resolve(packageRoot, "dist");
const themeCssPath = resolve(packageRoot, "styles", "theme.css");

/** Relative `@source` path from the default fixture workDir to `dist/`. */
const sourceRelativeToFixture = "../../../dist";

const UNSTYLED_HERO_MARKERS: (typeof HERO_BUTTON_REQUIRED_UTILITIES)[number][] = [
  "text-display-l",
  "font-display",
  "tablet:grid-cols-2",
];

function ensureDistBuilt(): void {
  if (existsSync(distDir)) return;
  execSync("npm run build", { cwd: packageRoot, stdio: "inherit" });
}

beforeAll(() => {
  ensureDistBuilt();
});

const packageVersion: string = (
  JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")) as { version: string }
).version;

/** Packs this package's current tree and extracts it into `destDir`. Returns `destDir`. */
function packAndExtractInto(destDir: string): string {
  mkdirSync(destDir, { recursive: true });
  const packDest = mkdtempSync(join(tmpdir(), "designer-hero-css-pnpm-pack-"));
  try {
    const tarballName = execSync(`npm pack --pack-destination "${packDest}"`, {
      cwd: packageRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    execSync(`tar -xzf "${join(packDest, tarballName)}" -C "${destDir}" --strip-components=1`, {
      encoding: "utf8",
    });
  } finally {
    rmSync(packDest, { recursive: true, force: true });
  }
  return destDir;
}

/**
 * Builds a pnpm-style consumer `node_modules` layout: the packed tarball
 * lands in a `.pnpm/@clossys+designer@<version>/node_modules/@clossys/designer`
 * store directory, and `node_modules/@clossys/designer` is a *relative*
 * symlink into it — the same shape `pnpm install` produces, and the exact
 * layout issue #1032's 2026-09-21 comment names as reproducing missing
 * utilities.
 */
function buildPnpmSymlinkFixture(workDir: string): { consumerRoot: string; symlinkPackageRoot: string } {
  const consumerRoot = join(workDir, "consumer");
  const storeRoot = join(
    consumerRoot,
    "node_modules",
    ".pnpm",
    `@clossys+designer@${packageVersion}`,
    "node_modules",
    "@clossys",
    "designer",
  );
  packAndExtractInto(storeRoot);

  const symlinkPackageRoot = join(consumerRoot, "node_modules", "@clossys", "designer");
  mkdirSync(dirname(symlinkPackageRoot), { recursive: true });
  symlinkSync(
    join("..", ".pnpm", `@clossys+designer@${packageVersion}`, "node_modules", "@clossys", "designer"),
    symlinkPackageRoot,
    "dir",
  );
  return { consumerRoot, symlinkPackageRoot };
}

/**
 * Control layout: the packed tarball is extracted directly into
 * `node_modules/@clossys/designer` — no `.pnpm` store, no symlink. Models
 * npm/yarn classic hoisting, where the package a consumer imports IS the
 * directory Tailwind scans.
 */
function buildHoistedFixture(workDir: string): { consumerRoot: string; hoistedPackageRoot: string } {
  const consumerRoot = join(workDir, "consumer");
  const hoistedPackageRoot = join(consumerRoot, "node_modules", "@clossys", "designer");
  packAndExtractInto(hoistedPackageRoot);
  return { consumerRoot, hoistedPackageRoot };
}

/**
 * Scans `dir` with `@tailwindcss/oxide`'s `Scanner` — the native scanner a
 * real directory `@source` resolves to in the Tailwind v4 CLI, PostCSS
 * plugin, and Vite plugin. Follows symlinks exactly the way those
 * integrations do (or don't); this is the thing under test, not a stand-in
 * for it, so it deliberately does NOT reuse `compileConsumerCss`'s
 * `scanClassCandidates` shortcut.
 */
async function scanRealSourceCandidates(dir: string): Promise<string[]> {
  const { Scanner } = await import("@tailwindcss/oxide");
  const scanner = new Scanner({ sources: [{ base: dir, pattern: "**/*", negated: false }] });
  return scanner.scan();
}

/** Compiles `@import "tailwindcss"` + a resolved `theme.css` against a real candidate set. */
async function compileWithCandidates(themeCssFilePath: string, candidates: string[]): Promise<string> {
  const workDir = dirname(themeCssFilePath);
  const entryCss = `@import "tailwindcss";\n@import "${themeCssFilePath.replace(/\\/g, "/")}";\n`;
  const require = createRequire(import.meta.url);
  const { compile } = await import("tailwindcss");

  async function loadStylesheet(
    id: string,
    base: string,
  ): Promise<{ path: string; base: string; content: string }> {
    let target: string;
    if (id === "tailwindcss") {
      target = require.resolve("tailwindcss/index.css");
    } else if (id.startsWith(".") || id.startsWith("/")) {
      target = resolve(base, id);
    } else {
      target = require.resolve(id);
    }
    const content = readFileSync(target, "utf8");
    return { path: target, base: dirname(target), content };
  }

  const compiled = await compile(entryCss, { base: workDir, loadStylesheet });
  return compiled.build(candidates);
}

describe("compileConsumerCss — theme.css without @source", () => {
  it(
    "omits Hero/Button utility rules (unstyled Hero case)",
    { timeout: 30_000 },
    async () => {
      const css = await compileConsumerCss({ packageRoot });
      const missing = checkHeroCss(css).findings.map((f) => f.utility);
      expect(
        UNSTYLED_HERO_MARKERS.some((utility) => missing.includes(utility)),
      ).toBe(true);
    },
  );
});

describe("compileConsumerCss — theme.css with @source on dist", () => {
  it(
    "includes every utility required by checkHeroCss",
    { timeout: 60_000 },
    async () => {
      const css = await compileConsumerCss({
        packageRoot,
        source: sourceRelativeToFixture,
      });
      expect(checkHeroCss(css).findings).toEqual([]);
    },
  );
});

describe("compileConsumerCss — packed npm layout", () => {
  let packWorkDir: string;

  afterEach(() => {
    if (packWorkDir) {
      rmSync(packWorkDir, { recursive: true, force: true });
      packWorkDir = "";
    }
  });

  it(
    "passes checkHeroCss when compiled from npm pack extract (styles/ + dist/)",
    { timeout: 90_000 },
    async () => {
      packWorkDir = mkdtempSync(join(tmpdir(), "designer-hero-css-pack-"));
      const packDest = join(packWorkDir, "pack");
      execSync(`mkdir -p "${packDest}"`, { encoding: "utf8" });
      const tarballName = execSync(`npm pack --pack-destination "${packDest}"`, {
        cwd: packageRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
      const extractDir = join(packWorkDir, "extract");
      execSync(`mkdir -p "${extractDir}" && tar -xzf "${join(packDest, tarballName)}" -C "${extractDir}"`, {
        encoding: "utf8",
      });
      const packedRoot = join(extractDir, "package");
      expect(existsSync(join(packedRoot, "styles", "theme.css"))).toBe(true);
      expect(existsSync(join(packedRoot, "dist"))).toBe(true);

      const css = await compileConsumerCss({
        packageRoot: packedRoot,
        source: sourceRelativeToFixture,
      });
      expect(checkHeroCss(css).findings).toEqual([]);
    },
  );

  it(
    "reads styles/theme.css from packageRoot (packed layout uses the same paths)",
    { timeout: 30_000 },
    async () => {
      const themeSnippet = readFileSync(themeCssPath, "utf8").slice(0, 200);
      expect(themeSnippet).toContain("@clossys/designer");
      const css = await compileConsumerCss({ packageRoot });
      expect(css.length).toBeGreaterThan(0);
      expect(css).toMatch(/@theme|@layer|--/);
    },
  );
});

/**
 * Issue #1032 (2026-09-21 comment): a consumer integration confirmed a
 * directory `@source` pointing into `node_modules/@clossys/designer` emits
 * no Tailwind utilities under pnpm's symlinked layout. These tests
 * materialize that exact layout from this package's own `npm pack` tarball
 * and drive it through `@tailwindcss/oxide`'s `Scanner` — the real native
 * scanner behind a directory `@source`, not `compileConsumerCss`'s
 * hand-rolled candidate walk (see this file's header).
 *
 * KNOWN FINDING (this environment: tailwindcss/oxide 4.3.3, this machine's
 * platform): the symlink case below does NOT reproduce the missing
 * utilities — `Scanner` follows the pnpm symlink and returns the same
 * candidate set as the non-symlinked control. See the PR body for the full
 * list of what was tried (raw `Scanner` calls, the full `tailwindcss` CLI,
 * both absolute and symlink-embedded relative paths) and why the originally
 * reported failure is more likely specific to Turbopack's own module
 * resolution than to Tailwind's `@source` scanning itself. Both tests below
 * assert the utilities ARE present — that is the actual, verified behavior
 * of this package's declared `tailwindcss` peer range in this repository,
 * and the point of keeping this test is to catch a regression (or a fix
 * landing upstream that changes this) rather than to assert a failure that
 * does not occur here.
 */
describe("compileConsumerCss — pnpm symlinked node_modules layout (issue #1032)", () => {
  let fixtureWorkDir: string;

  afterEach(() => {
    if (fixtureWorkDir) {
      rmSync(fixtureWorkDir, { recursive: true, force: true });
      fixtureWorkDir = "";
    }
  });

  it(
    "real @source scanning through the pnpm symlink emits every required utility",
    { timeout: 90_000 },
    async () => {
      fixtureWorkDir = mkdtempSync(join(tmpdir(), "designer-hero-css-pnpm-symlink-"));
      const { symlinkPackageRoot } = buildPnpmSymlinkFixture(fixtureWorkDir);

      // Consumer's `@source` names the directory reached THROUGH the
      // symlink, exactly as issue #1032 describes — not the dereferenced
      // `.pnpm` store path.
      const symlinkedDist = join(symlinkPackageRoot, "dist");
      expect(existsSync(join(symlinkedDist, "atoms"))).toBe(true);

      const candidates = await scanRealSourceCandidates(symlinkedDist);
      expect(candidates.length).toBeGreaterThan(0);

      const css = await compileWithCandidates(join(symlinkPackageRoot, "styles", "theme.css"), candidates);
      const result = checkHeroCss(css);
      expect(result.findings).toEqual([]);
    },
  );

  it(
    "control: a non-symlinked (hoisted) dist layout also emits every required utility",
    { timeout: 90_000 },
    async () => {
      fixtureWorkDir = mkdtempSync(join(tmpdir(), "designer-hero-css-hoisted-"));
      const { hoistedPackageRoot } = buildHoistedFixture(fixtureWorkDir);

      const hoistedDist = join(hoistedPackageRoot, "dist");
      expect(existsSync(join(hoistedDist, "atoms"))).toBe(true);

      const candidates = await scanRealSourceCandidates(hoistedDist);
      expect(candidates.length).toBeGreaterThan(0);

      const css = await compileWithCandidates(join(hoistedPackageRoot, "styles", "theme.css"), candidates);
      const result = checkHeroCss(css);
      expect(result.findings).toEqual([]);
    },
  );
});
