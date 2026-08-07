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
 * Proves tree-shaking with a real bundler and a real measurement of the
 * BUNDLED OUTPUT — not by inspecting esbuild's `metafile.inputs`, which
 * (verified while writing this test) lists every module esbuild PARSED
 * while resolving the dependency graph, whether or not that module's code
 * survived dead-code elimination into the final output. A barrel
 * (`src/icons/index.ts`) re-exporting all 32 names is always parsed to
 * discover what it exports, even when only one of those names is actually
 * used — so `metafile.inputs` reports all 32 icon files regardless of
 * tree-shaking. The only thing that actually proves tree-shaking happened
 * is the bundled OUTPUT TEXT.
 *
 * The marker for "is icon X's definition present in the output" is the
 * quoted display-name string literal `createIcon("XIcon", ...)` embeds
 * (`"XIcon"`) — not the SVG path data. An earlier version of this test used
 * each icon's `d`/coordinate attribute values as markers, but esbuild
 * re-serializes the surrounding object literal (different whitespace, and
 * two icons — CreditCardIcon, MonitorIcon — have no `<path>` at all, only
 * short, collision-prone numeric attributes like `x1: "2"`), so a
 * pretty-printed source substring doesn't reliably survive bundling even
 * when the code it names does. A quoted string-literal argument, by
 * contrast, is preserved byte-for-byte by every JS bundler (renaming it
 * would change program behavior), so it's the one substring guaranteed to
 * survive if and only if that `createIcon(...)` call itself survived
 * tree-shaking.
 */

const here = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(here, "icons");

const iconNames: string[] = readdirSync(iconsDir)
  .filter((f) => f.endsWith("Icon.tsx"))
  .map((f) => f.replace(/\.tsx$/, ""));

function marker(name: string): string {
  return `"${name}"`;
}

async function bundleOutput(code: string): Promise<string> {
  const result = await esbuild.build({
    stdin: { contents: code, resolveDir: here, loader: "tsx" },
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    external: ["react", "react/jsx-runtime", "react-dom"],
    absWorkingDir: here,
  });
  return result.outputFiles[0]?.text ?? "";
}

describe("tree-shaking (measured against real bundler OUTPUT, not import graph)", () => {
  it("ships exactly the 32 icons this test sweeps over (sanity on the test's own setup)", () => {
    expect(iconNames).toHaveLength(32);
  });

  it("markers are unique — no icon name's quoted marker is a substring of another's", () => {
    for (const a of iconNames) {
      for (const b of iconNames) {
        if (a === b) continue;
        expect(marker(b).includes(marker(a)), `"${a}" must not be a substring marker of "${b}"`).toBe(false);
      }
    }
  });

  it("importing ONE icon's output contains ONLY that icon's own marker — none of the other 31", async () => {
    const text = await bundleOutput(`export { ClockIcon } from "./index.js";`);
    let present = 0;
    for (const name of iconNames) {
      const found = text.includes(marker(name));
      if (name === "ClockIcon") {
        expect(found, "ClockIcon's own marker must be present").toBe(true);
        present++;
      } else {
        expect(found, `${name}'s marker must NOT leak into a ClockIcon-only bundle`).toBe(false);
      }
    }
    expect(present).toBe(1);
  });

  it("sanity: every marker DOES appear when the full 32-icon barrel is imported — proving a marker's absence above is real tree-shaking, not a marker that could never appear", async () => {
    const text = await bundleOutput(`export * from "./icons/index.js";`);
    for (const name of iconNames) {
      expect(text.includes(marker(name)), `${name}'s marker should be present in the full bundle`).toBe(true);
    }
  });

  it("a two-icon import contains exactly those two icons' markers, not a third", async () => {
    const text = await bundleOutput(
      `export { ClockIcon, SearchIcon } from "./index.js";`,
    );
    expect(text.includes(marker("ClockIcon"))).toBe(true);
    expect(text.includes(marker("SearchIcon"))).toBe(true);
    expect(text.includes(marker("XIcon"))).toBe(false);
    expect(text.includes(marker("SunIcon"))).toBe(false);
  });

  it("the single-icon bundle is meaningfully smaller than the full-barrel bundle", async () => {
    const single = await bundleOutput(`export { ClockIcon } from "./index.js";`);
    const full = await bundleOutput(`export * from "./icons/index.js";`);
    // 32 icons in, 1 icon out — the single bundle should be well under a
    // third of the full one, not just nominally smaller.
    expect(single.length).toBeLessThan(full.length / 3);
  });
});
