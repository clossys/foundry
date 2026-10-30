// @vitest-environment node
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadCatalogBundles } from "../catalog-bundles.js";
import { loadCatalog, loadComponentCompositionRules, loadComponentRegistry } from "../catalog-core/index.js";
import { completedCatalogLibrary } from "../catalog-core/__fixtures__/completed-catalog-library.js";
import type { CompositeCatalogData, CompositeLibraryData } from "../catalog-core/types.js";
import { applyDecisions } from "./apply-decisions.js";
import { libraryFiles } from "./fs-library.js";
import { main } from "./cli.js";

/**
 * A minimal persisted composite library, written through the same projection the product persists with:
 * one composed slot (compose:file-trigger@1 over the selected button) and one package-pointer chart.
 * The package-export inventory is supplied as evidence, shaped like a persisted component-observations.json.
 */
const packageExports = {
  "@clossys/designer/charts": ["AreaChart"],
  "@clossys/designer/components": ["Button", "GlyphProvider", "Icon", "IconButton"],
  "react-aria-components": ["FileTrigger"],
};
let catalog: CompositeCatalogData, files: Map<string, string>, temporary: string, root: string;
beforeAll(() => {
  const values = loadCatalog();
  catalog = { values, components: { slots: loadComponentRegistry().slots, fills: loadCatalogBundles().componentFills, rules: loadComponentCompositionRules() } } as CompositeCatalogData;
  const { source, adoptedAt, ...valuePortion } = completedCatalogLibrary(values, { id: "example", kind: "consumer", author: "consumer", license: "UNLICENSED" }, "2026-10-26");
  const empty: CompositeLibraryData = { source, adoptedAt, values: valuePortion, components: { fills: [], files: [] } };
  const library = applyDecisions(catalog, empty, [
    { slot: "components.icon", kind: "adopt", source: "foundry", note: "Selected glyph primitive" },
    { slot: "components.button", kind: "adopt", source: "foundry", note: "Selected button" },
    { slot: "components.file-trigger", kind: "compose", rule: "compose:file-trigger@1", reads: ["components.button"], note: "Composed file trigger" },
    { slot: "components.chart-area", kind: "adopt", source: "foundry", note: "Package-pointer chart" },
  ]);
  files = libraryFiles(catalog, library, undefined, { packageExports });
}, 120_000);
beforeEach(async () => {
  temporary = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "designer-cli-persisted-"))); root = join(temporary, "library");
  await fs.mkdir(join(root, "fills"), { recursive: true });
  for (const [name, content] of files) {
    await fs.mkdir(dirname(join(root, name)), { recursive: true }); await fs.writeFile(join(root, name), content);
  }
  await fs.writeFile(join(root, "component-observations.json"), JSON.stringify({ packageExports }, null, 2) + "\n");
}, 60_000);
afterEach(async () => { await fs.rm(temporary, { recursive: true, force: true }); });
async function run(...args: string[]) {
  const out: string[] = [], error: string[] = [];
  const code = await main([...args, "--root", root], { out: text => out.push(text), error: text => error.push(text) });
  return { code, out: out.join("\n"), error: error.join("\n") };
}

describe("designer-library CLI on a persisted composite library", () => {
  it("emits component-index with the registered composition rules, bundle fills and the library's own observations", async () => {
    const before = await fs.readFile(join(root, "component-index.ts"), "utf8");
    expect(await run("emit", "--check", "--target", "component-index")).toMatchObject({ code: 0, out: "Library emission is current" });
    expect(await run("emit", "--target", "component-index")).toMatchObject({ code: 0, error: "" });
    expect(await fs.readFile(join(root, "component-index.ts"), "utf8")).toBe(before);
    expect(before).toContain('export { ChartArea } from "./components/chart-area/index";');
    expect(before).toContain('export { FileTrigger } from "./components/file-trigger/index";');
    expect(await fs.readFile(join(root, "components/chart-area/index.ts"), "utf8")).toContain('from "@clossys/designer/charts"');
  });

  it("accepts an explicit --observations file and stays fail-closed without package-export evidence", async () => {
    const supplied = join(temporary, "observations.json");
    await fs.rename(join(root, "component-observations.json"), supplied);
    expect(await run("emit", "--check", "--target", "component-index", "--observations", supplied)).toMatchObject({ code: 0 });
    const none = await run("emit", "--check", "--target", "component-index");
    expect(none.code).toBe(2); expect(none.error).toMatch(/components: unavailable package export \w+/);
  });

  it("refuses a missing or malformed observations file with a clear code and changes nothing", async () => {
    const before = await fs.readFile(join(root, "component-index.ts"), "utf8");
    const missing = await run("emit", "--target", "component-index", "--observations", join(temporary, "absent.json"));
    expect(missing.code).toBe(2); expect(missing.error).toContain("observations unavailable");
    const malformed = join(temporary, "malformed.json");
    await fs.writeFile(malformed, JSON.stringify({ packageExports: { "@clossys/designer/charts": "AreaChart" } }));
    const bad = await run("emit", "--target", "component-index", "--observations", malformed);
    expect(bad.code).toBe(2); expect(bad.error).toContain("observations malformed");
    expect((await run("status", "--observations", malformed)).code).toBe(2);
    expect(await fs.readFile(join(root, "component-index.ts"), "utf8")).toBe(before);
  });

  it("graph --write then --check succeeds on the persisted library without crashing", async () => {
    expect(await run("graph", "--write")).toMatchObject({ code: 0, error: "" });
    const graph = JSON.parse(await fs.readFile(join(root, "usage-graph.json"), "utf8"));
    expect(JSON.stringify(graph)).toContain("components.chart-area");
    expect(await run("graph", "--check")).toMatchObject({ code: 0, out: "usage-graph.json is current" });
  });
});
