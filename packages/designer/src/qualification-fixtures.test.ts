// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main as brand } from "./tokens/cli.js";
import { main as contrast } from "./tokens/contrast-cli.js";

// Exercise the qualification adapter's real fixture arguments against the
// production CLI entry functions, without packing or installing a candidate.
const adapter = JSON.parse(readFileSync(new URL("../../../governance/release-qualification-adapters/designer/current-direct.json", import.meta.url), "utf8")) as {
  cases: { id: string; bin: string; args: { fixture: string }[]; exitCode: number }[];
};
const fixtures = new URL("../../../governance/release-qualification-fixtures/designer/current-direct/", import.meta.url);
const bins: Record<string, (argv: string[]) => number> = {
  "designer-brand-check": brand,
  "designer-contrast-check": contrast,
};

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("qualification brand and contrast controls", () => {
  for (const item of adapter.cases.filter(item => Object.hasOwn(bins, item.bin))) {
    it(item.id, () => {
      const args = item.args.map(arg => fileURLToPath(new URL(arg.fixture, fixtures)));
      expect(bins[item.bin]!(args)).toBe(item.exitCode);
    });
  }
});

// Fresh requirements remain enforced: these mutations must fail, rather than
// letting a fixture repair hide a weakened CLI or a skipped policy input.
it.each([
  { name: "panel binding", fixture: "brand/satisfied.css", main: brand, remove: /  --radius-panel: [^\n]*\n/, exit: 1 },
  { name: "quiet control contrast", fixture: "contrast/satisfied.css", main: contrast, remove: /  --color-control-quiet: [^\n]*\n/, exit: 2 },
])("refuses missing $name", ({ fixture, main, remove, exit }) => {
  const original = readFileSync(new URL(fixture, fixtures), "utf8");
  const mutated = original.replace(remove, "");
  expect(mutated).not.toBe(original);
  const directory = mkdtempSync(join(tmpdir(), "designer-qualification-fixture-"));
  try {
    const path = join(directory, "input.css");
    writeFileSync(path, mutated);
    expect(main([path])).toBe(exit);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
