// @vitest-environment node
//
// Overrides this package's default jsdom environment (vitest.config.ts) for
// this file only: jsdom's `TextEncoder` polyfill fails one of esbuild's own
// startup invariants ("new TextEncoder().encode('') instanceof Uint8Array"),
// so esbuild cannot run under jsdom at all. This file needs a real bundler,
// not a DOM, so plain Node is both correct and necessary here.
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as esbuild from "esbuild";

/**
 * Carried over from this scope's own pre-merge, standalone `icons`
 * package's `src/tree-shake.test.ts`, adapted for DATA exports instead of components
 * (see this directory's README/CHANGELOG note on why `./icons` ships
 * `IconNode` data rather than components). Proves tree-shaking with a real
 * bundler and a real measurement of the BUNDLED OUTPUT — not by inspecting
 * esbuild's `metafile.inputs`, which (verified while writing the original
 * version of this test) lists every module esbuild PARSED while resolving
 * the dependency graph, whether or not that module's code survived dead-
 * code elimination into the final output. A barrel (`src/icons/index.ts`)
 * re-exporting all 32 names is always parsed to discover what it exports,
 * even when only one of those names is actually used — so `metafile.inputs`
 * reports all 32 modules regardless of tree-shaking. The only thing that
 * actually proves tree-shaking happened is the bundled OUTPUT TEXT.
 *
 * ### The marker changed shape from the component-era version
 *
 * The old version's marker was the quoted display-name string literal
 * `createIcon("ClockIcon", ...)` embeds (`"ClockIcon"`) — guaranteed to
 * survive bundling byte-for-byte, since renaming a string literal argument
 * would change program behavior. Pure data exports have no such call-site
 * string. The next-best guaranteed-preserved text is each module's own
 * `var <Name> = [` declaration line (verified against a real esbuild
 * build, below) — unminified esbuild does not rename top-level identifiers
 * absent a real naming collision, and none exists here (every export in
 * this directory already has a distinct name).
 *
 * A BARE identifier (just `"Clock"`, no `var ... = [` wrapper) was
 * considered and rejected: three of this directory's 32 names are a
 * literal PREFIX of another (`Check` of `CheckCircle`, `User` of `Users`,
 * `X` of `XCircle`) — a collision the pre-merge package's own `Icon`-
 * suffixed names happened to avoid (`"UserIcon"` is not a contiguous
 * substring of `"UsersIcon"`, because the plural's extra `s` sits between
 * them) but this directory's un-suffixed convention does not (see
 * README.md, "Naming convention", for why the suffix was dropped anyway).
 * The `var <Name> = [` wrapper breaks all three: `"var User = ["` is not a
 * substring of `"var Users = ["`, and so on for the other two pairs —
 * verified computationally below by the "markers are unique" test, the
 * same sanity check the original version of this file ran.
 */

const here = dirname(fileURLToPath(import.meta.url));

const iconNames: string[] = readdirSync(here)
  .filter((f) => /^[A-Z][A-Za-z0-9]*\.ts$/.test(f))
  .map((f) => f.replace(/\.ts$/, ""));

function marker(name: string): string {
  return `var ${name} = [`;
}

async function bundleOutput(code: string): Promise<string> {
  const result = await esbuild.build({
    stdin: { contents: code, resolveDir: here, loader: "ts" },
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    absWorkingDir: here,
  });
  return result.outputFiles[0]?.text ?? "";
}

describe("tree-shaking (measured against real bundler OUTPUT, not import graph)", () => {
  it("ships exactly the 32 icons this test sweeps over (sanity on the test's own setup)", () => {
    expect(iconNames).toHaveLength(32);
  });

  it("markers are unique — no icon name's marker is a substring of another's", () => {
    for (const a of iconNames) {
      for (const b of iconNames) {
        if (a === b) continue;
        expect(marker(b).includes(marker(a)), `"${a}" must not be a substring marker of "${b}"`).toBe(false);
      }
    }
  });

  it("importing ONE glyph's output contains ONLY that glyph's own marker — none of the other 31", async () => {
    const text = await bundleOutput(`export { Clock } from "./index.js";`);
    let present = 0;
    for (const name of iconNames) {
      const found = text.includes(marker(name));
      if (name === "Clock") {
        expect(found, "Clock's own marker must be present").toBe(true);
        present++;
      } else {
        expect(found, `${name}'s marker must NOT leak into a Clock-only bundle`).toBe(false);
      }
    }
    expect(present).toBe(1);
  });

  it("sanity: every marker DOES appear when the full 32-icon barrel is imported — proving a marker's absence above is real tree-shaking, not a marker that could never appear", async () => {
    const text = await bundleOutput(`export * from "./index.js";`);
    for (const name of iconNames) {
      expect(text.includes(marker(name)), `${name}'s marker should be present in the full bundle`).toBe(true);
    }
  });

  it("a two-glyph import contains exactly those two glyphs' markers, not a third", async () => {
    const text = await bundleOutput(`export { Clock, Search } from "./index.js";`);
    expect(text.includes(marker("Clock"))).toBe(true);
    expect(text.includes(marker("Search"))).toBe(true);
    expect(text.includes(marker("X"))).toBe(false);
    expect(text.includes(marker("Sun"))).toBe(false);
  });

  it("the single-glyph bundle is meaningfully smaller than the full-barrel bundle", async () => {
    const single = await bundleOutput(`export { Clock } from "./index.js";`);
    const full = await bundleOutput(`export * from "./index.js";`);
    // 32 icons in, 1 icon out — the single bundle should be well under a
    // third of the full one, not just nominally smaller.
    expect(single.length).toBeLessThan(full.length / 3);
  });

  /**
   * `package.json`'s `"sideEffects": false` is what makes the above
   * reliable — performed by hand (not re-run by this file, the same
   * "described, not scripted" precedent the pre-merge package's own
   * version of this test set): temporarily removing `sideEffects: false`
   * from `packages/ui/package.json` and re-running the single-glyph test
   * above reintroduces the exact leak these tests exist to catch (every
   * other icon's marker starts appearing in a Clock-only bundle, because
   * esbuild can no longer assume an unused module is side-effect-free and
   * safe to drop). Reverted immediately after confirming red.
   */
});
