/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import { readFileSync } from "node:fs";
import * as client from "./index.js";
import * as server from "./server.js";
import { flatten, metaOf } from "./model.js";
import type { DtcgToken, LibraryData } from "./types.js";

async function catalogBrowserClosure(plugins: Plugin[] = []) {
  const options = { bundle: true, write: false, format: "esm" as const, platform: "browser" as const, metafile: true, logLevel: "silent" as const };
  const parser = await build({ ...options, stdin: { contents: 'export * from "css-tree";', resolveDir: new URL("../../", import.meta.url).pathname } });
  const parserInputs = Object.keys(parser.metafile!.inputs).filter(path => path.includes("node_modules/")).sort();
  // Exact reference graph from the pinned parser, including its source-map helper.
  expect([...new Set(parserInputs.map(path => path.split("node_modules/").at(-1)!.split("/")[0]))].sort()).toEqual(["css-tree", "source-map-js"]);
  const result = await build({ ...options, entryPoints: [new URL("./index.ts", import.meta.url).pathname], plugins });
  const inputs = Object.keys(result.metafile!.inputs);
  expect(inputs.filter(path => path.includes("node_modules/")).sort()).toEqual(parserInputs);
  expect(inputs.filter(path => /catalog-assets\/(?:server|web-icons|raster)(?:[./-])/.test(path))).toEqual([]);
  // No externals: browser resolution must refuse any reachable Node built-in.
  expect(Object.values(result.metafile!.outputs).flatMap(output => output.imports)).toEqual([]);
  return result;
}

function assetLibrary(): { catalog: client.CatalogData; library: LibraryData } {
  const catalog = client.loadCatalog();
  let library: LibraryData = { source: { id: "example", kind: "consumer", author: "consumer", license: "MIT" }, fills: [], adoptedAt: "2026-10-23" };
  const color = (light: string, dark?: string): DtcgToken => ({ $type: "color", $value: light, $extensions: { "com.clossys.css": { raw: light }, ...(dark ? { "com.clossys.modes": { dark } } : {}) } });
  library = client.applyLibraryChange(catalog, library, { baseHash: client.libraryHash(library), changes: [
    { op: "author", slot: "themes.foreground", tokens: { default: color("#111111", "#ffffff") } },
    { op: "author", slot: "themes.primary-foreground", tokens: { default: color("#ffffff") } },
    { op: "author", slot: "themes.background", tokens: { default: color("#ffffff", "#111111") } },
    { op: "author", slot: "themes.primary", tokens: { default: color("#2255aa") } },
    { op: "author", slot: "themes.font-heading", tokens: { default: { $type: "fontFamily", $value: ["sans-serif"] } } },
    ...catalog.fills.filter(fill => metaOf(fill).source === "lucide").map(fill => ({ op: "adopt" as const, slot: metaOf(fill).slot, source: "lucide" })),
  ] });
  library = client.deriveIdentity(catalog, client.createConsumerIdentitySeeds(catalog, library, { name: "Example", fontLicence: { family: "sans-serif", outlining: "unknown" } }));
  library = client.authorImageRatios(catalog, library, { ratios: { landscape: { width: 3, height: 2 } }, source: "Consumer editorial brief", rationale: "Landscape crop for editorial media" });
  return { catalog, library };
}

describe("asset integration through the public catalog", () => {
  it("loads 56 token leaves and 49 asset leaves as fresh owned data", () => {
    const catalog = client.loadCatalog();
    expect(catalog.slots.filter(slot => slot.layer === "themes")).toHaveLength(56);
    expect(catalog.slots.filter(slot => slot.layer === "assets")).toHaveLength(49);
    expect(catalog.fills.filter(fill => !!fill.assets)).toHaveLength(89);
    expect(catalog.fills.filter(fill => !!fill.assets && metaOf(fill).source === "phosphor")).toHaveLength(40);
    expect(catalog.fills.filter(fill => !!fill.assets && metaOf(fill).source === "open-props")).toHaveLength(1);
    metaOf(catalog.fills.find(fill => !!fill.assets)!).license = "changed";
    expect(client.loadCatalog().fills.some(fill => metaOf(fill).license === "changed")).toBe(false);
  });

  it("runs asset checks only for an asset registry with consumer assets or a complete library", () => {
    const catalog = client.loadCatalog(); const library: LibraryData = { source: { id: "example", kind: "consumer", author: "consumer", license: "MIT" }, fills: [] };
    expect(client.check({ catalog, library }).findings.filter(finding => finding.rule === "asset")).toEqual([]);
    expect(client.check({ catalog, library: { ...library, complete: true } }).findings.some(finding => finding.code === "A12" && finding.severity === "error")).toBe(true);
    expect(client.check({ catalog: { ...catalog, slots: catalog.slots.filter(slot => slot.layer !== "assets") }, library: { ...library, complete: true } }).findings.filter(finding => finding.rule === "asset")).toEqual([]);
  });

  it("maps violated checks to errors and indeterminate checks to notices without claiming passes", () => {
    const input = assetLibrary();
    const wanted = client.checkAssetProfile(input.catalog, input.library).filter(finding => finding.verdict !== "satisfied").map(finding => ({ code: finding.code, rule: "asset", subject: finding.subject, severity: finding.verdict === "violated" ? "error" : "notice", message: finding.message }));
    const result = client.check(input);
    expect(result.findings.filter(finding => finding.rule === "asset")).toEqual(expect.arrayContaining(wanted));
    expect(result.findings.filter(finding => finding.rule === "asset")).toHaveLength(wanted.length);
    expect(result.findings.filter(finding => finding.code === "C10")).toEqual([]);
    expect(result.findings.some(finding => finding.code === "A6" && finding.severity === "notice")).toBe(true);
    const damaged = structuredClone(input.library);
    flatten(damaged.fills.find(fill => metaOf(fill).slot === "assets.mark")!)["assets.mark.positive"]!.$value = '<svg viewBox="0 0 24 24"><script/></svg>';
    expect(client.check({ ...input, library: damaged }).findings.some(finding => finding.code === "A2" && finding.subject === "assets.mark.positive" && finding.severity === "error")).toBe(true);
  });

  it("exports pure asset APIs from catalog and keeps raster output on catalog/server", async () => {
    expect(client.emitGlyphModule).toBeTypeOf("function"); expect(client.deriveIdentity).toBeTypeOf("function");
    expect(client).not.toHaveProperty("emitWebIcons"); expect(server.emitWebIcons).toBeTypeOf("function");
    const result = await catalogBrowserClosure();
    expect(result.outputFiles).toHaveLength(1);
  });
  it("rejects a foreign runtime dependency added to the public catalog browser graph", async () => {
    const foreign: Plugin = { name: "foreign-catalog-dependency", setup(builder) {
      builder.onLoad({ filter: /[/\\]catalog-core[/\\]index\.ts$/ }, ({ path }) => ({ contents: readFileSync(path, "utf8") + '\nexport { cva as foreignRuntime } from "class-variance-authority";', loader: "ts" }));
    } };
    await expect(catalogBrowserClosure([foreign])).rejects.toThrow();
  });
});
