/**
 * Exercises `compileConsumerCss` against real `theme.css` and optional
 * `@source` / dist candidate scanning — the unstyled-Hero failure mode when
 * consumers import theme without scanning built output.
 *
 * The pnpm symlink `@source` pitfall (Turbopack resolving a symlinked
 * `node_modules` path to nothing) is not reproduced here; see README Setup.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
