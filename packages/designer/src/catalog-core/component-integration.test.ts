/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import { readFileSync } from "node:fs";
import * as client from "./index.js";
import { adoptedComponentIntegration, componentIntegration } from "./__fixtures__/component-integration.js";
import { syntheticSource } from "./__fixtures__/component-engine/synthetic.js";
import { cssText, flatten, metaOf } from "./model.js";


async function componentBrowserClosure(plugins: Plugin[] = []) {
  const options = { bundle: true, write: false, format: "esm" as const, platform: "browser" as const, metafile: true, logLevel: "silent" as const };
  const parser = await build({ ...options, stdin: { contents: 'export * from "css-tree";', resolveDir: new URL("../../", import.meta.url).pathname } });
  const parserInputs = Object.keys(parser.metafile!.inputs).filter(path => path.includes("node_modules/")).sort();
  expect([...new Set(parserInputs.map(path => path.split("node_modules/").at(-1)!.split("/")[0]))].sort()).toEqual(["css-tree", "source-map-js"]);
  const result = await build({ ...options, entryPoints: [new URL("./index.ts", import.meta.url).pathname], plugins });
  expect(Object.keys(result.metafile!.inputs).filter(path => path.includes("node_modules/")).sort()).toEqual(parserInputs);
  expect(Object.values(result.metafile!.outputs).flatMap(output => output.imports)).toEqual([]);
  return result;
}

const adopt = { portion: "components" as const, change: { op: "adopt" as const, slot: "components.button", source: "test-kit" } };
describe("SYNTHETIC components through the public composite facade", () => {
  it("dispatches public operations and emits consumer CSS, checked components, glyphs and both notices", () => {
    const input = adoptedComponentIntegration();
    expect(input.library.components.fills).toHaveLength(1);
    const profile = client.resolve(input);
    expect(profile.components.check.findings).toEqual([]);
    expect(profile.check.findings.filter(f => f.severity === "error")).toEqual([]);
    expect(client.check(input).ok).toBe(true);
    expect(profile.check.findings.some(f => f.code === "A6" && f.severity === "notice" && f.message.includes("optical"))).toBe(true);
    expect(profile.selectionHash).toBe(client.libraryHash(input.library));
    expect(profile.components.components["components.button"]!.reads.themes["themes.foreground.default"]).toBe(profile.values.members["themes.foreground.default"]!.emit);
    expect(() => client.emit(profile, ["component-index"])).not.toThrow();
    const files = client.emit(profile, ["css-brand", "component-index", "components-consumption", "notices"]);
    for (const name of ["brand.css", "component-index.ts", "components/button/index.ts", "components-consumption.json", "notices.json", "notices/components.json", "adapters/glyphs.ts"]) expect(files.some(f => f.path === name), name).toBe(true);
    const report = JSON.parse(files.find(f => f.path === "components-consumption.json")!.contents);
    expect(report.selectionHash).toBe(profile.selectionHash);
    const combined = JSON.parse(files.find(f => f.path === "notices.json")!.contents);
    expect(combined.values.origins.some((origin: {source: string}) => origin.source === "lucide")).toBe(true);
    expect(combined.components.origins[0].origin.source).toBe("test-kit");
    const glyphs = files.find(f => f.path === "adapters/glyphs.ts")!.contents;
    expect(glyphs).toContain('"assets.icon-close"');
    expect(glyphs).not.toContain('"icon-close":');
    expect(glyphs).not.toContain('"assets.icon-check"');
    expect(files.find(f => f.path === "notices.json")!.contents).toContain("lucide");
    expect(files.find(f => f.path === "notices/components.json")!.contents).toContain("test-kit");
  });
  it("hashes every portion including source bytes and rejects whole-library stale CAS", () => {
    const input = adoptedComponentIntegration(); const hash = client.libraryHash(input.library);
    for (const change of [
      (lib: client.CompositeLibraryData) => { lib.components.files = [{ path: "components/button/local.ts", content: "changed" }]; },
      (lib: client.CompositeLibraryData) => { lib.components.fills[0]!.components.button!.license = "ISC"; },
      (lib: client.CompositeLibraryData) => { lib.values.rationale = { test: "changed" }; },
      (lib: client.CompositeLibraryData) => { lib.source.license = "ISC"; },
      (lib: client.CompositeLibraryData) => { lib.values.fills = []; },
    ]) {
      const lib = structuredClone(input.library); change(lib);
      expect(client.libraryHash(lib)).not.toBe(hash);
      expect(() => client.applyLibraryChange(input.catalog, lib, { baseHash: hash, changes: [] })).toThrow(/baseHash/);
    }
    const reordered = structuredClone(input.library); reordered.values.fills = [...reordered.values.fills].reverse();
    expect(client.libraryHash(reordered)).toBe(hash);
  });
  it("keeps all portions atomic on a late component failure and rejects member operations", () => {
    const input = componentIntegration(); const before = structuredClone(input.library);
    expect(() => client.applyLibraryChange(input.catalog, input.library, { baseHash: client.libraryHash(input.library), changes: [
      { portion: "values", change: { op: "author", slot: "themes.foreground", tokens: { default: { $type: "color", $value: "#333333" } } } },
      { ...adopt, change: { ...adopt.change, members: [] } },
    ] })).toThrow(/slot-scope/);
    expect(input.library).toEqual(before);
    const adopted = client.applyLibraryChange(input.catalog, input.library, { baseHash: client.libraryHash(input.library), changes: [adopt] });
    expect(() => client.applyLibraryChange(input.catalog, adopted, { baseHash: client.libraryHash(adopted), changes: [
      { portion: "components", change: { op: "remove", slot: "components.button" } },
      { portion: "values", change: { op: "adopt", slot: "tokens.unknown", source: "foundry" } },
    ] })).toThrow();
    expect(adopted.components.fills).toHaveLength(1);
    expect(before.components.fills).toEqual([]);
  });
  it("uses fresh consumer values, never candidate values, and retains K and CC findings", () => {
    const input = adoptedComponentIntegration();
    const initial = client.resolve(input);
    const candidates = structuredClone(input.catalog);
    const candidate = candidates.values.fills.find(fill => metaOf(fill).slot === "themes.foreground")!;
    Object.values(flatten(candidate))[0]!.$value = "#ff00ff";
    expect(client.resolve({ ...input, catalog: candidates }).components.check).toEqual(initial.components.check);
    const changed = client.applyLibraryChange(input.catalog, input.library, { baseHash: client.libraryHash(input.library), changes: [{ portion: "values", change: { op: "author", slot: "themes.foreground", tokens: { default: { $type: "color", $value: "#ffffff" } } } }] });
    const result = client.check({ ...input, library: changed });
    expect(result.ok).toBe(false);
    expect(result.findings.some(f => f.code === "K5")).toBe(true);
    const evidence = structuredClone(input.componentOptions!);
    evidence.evidence!.observations["components.button"]!.forwardsRef = false;
    evidence.evidence!.installedRac.instance = "other-rac";
    const findings = client.check({ ...input, componentOptions: evidence }).findings;
    expect(findings.some(f => f.code.startsWith("K"))).toBe(true);
    expect(findings.some(f => "compatibility" in f && f.compatibility?.startsWith("CC"))).toBe(true);
    expect(client.check(input).ok).toBe(true);
  });
  it("uses resolved mode bindings for light aliases, explicit dark values and missing dark fallbacks", () => {
    const cases: { name: string; primary: client.DtcgToken; light: string; dark: string; throughLightOnly?: boolean }[] = [
      { name: "light alias with explicit dark literal", primary: { $type: "color", $value: "{themes.ring.default}", $extensions: { "com.clossys.modes": { dark: "#eeeeee" } } }, light: "#000000", dark: "#eeeeee" },
      { name: "direct light with dark alias", primary: { $type: "color", $value: "#000000", $extensions: { "com.clossys.css": { raw: "#000000" }, "com.clossys.modes": { dark: "{themes.ring.default}" } } }, light: "#000000", dark: "#ffffff" },
      { name: "light alias without a dark override keeps requested mode", primary: { $type: "color", $value: "{themes.ring.default}" }, light: "#000000", dark: "#ffffff" },
      { name: "direct literal without a dark override", primary: { $type: "color", $value: "#767676", $extensions: { "com.clossys.css": { raw: "#767676" } } }, light: "#767676", dark: "#767676" },
      { name: "requested dark mode crosses a light-only alias contract", primary: { $type: "color", $value: "{themes.ring.default}" }, light: "#000000", dark: "#eeeeee", throughLightOnly: true },
    ];
    for (const item of cases) {
      const input = adoptedComponentIntegration();
      if (item.throughLightOnly) input.catalog.values.slots = input.catalog.values.slots.map(slot => slot.id === "themes.ring" && slot.contract.kind === "token" ? { ...slot, contract: { ...slot.contract, modes: ["light"] } } : slot);
      const extra: client.CompositeLibraryOperation[] = item.throughLightOnly ? [
        { portion: "values", change: { op: "author", slot: "themes.ring", tokens: { default: { $type: "color", $value: "{themes.background.default}" } } } },
        { portion: "values", change: { op: "author", slot: "themes.background", tokens: { default: { $type: "color", $value: "#000000", $extensions: { "com.clossys.css": { raw: "#000000" }, "com.clossys.modes": { dark: "#eeeeee" } } } } } },
      ] : [];
      const library = client.applyLibraryChange(input.catalog, input.library, { baseHash: client.libraryHash(input.library), changes: [...extra, { portion: "values", change: { op: "author", slot: "themes.foreground", tokens: { default: item.primary } } }] });
      const { source, adoptedAt, values } = library;
      const fresh = client.resolve({ catalog: input.catalog.values, library: { ...values, source, adoptedAt } });
      const foreground = fresh.members["themes.foreground.default"]!;
      expect(foreground.value.light, item.name).toBe(item.light);
      expect(foreground.value.dark, item.name).toBe(item.dark);
      // Every aliased mode uses the engine's materialized value; direct CSS keeps its spelling.
      const tokens = Object.fromEntries(Object.entries(fresh.members).filter(([id, member]) => id.startsWith("themes.") && member.emit).map(([id, member]) => [id, {
        property: member.emit!, light: member.alias.light ? cssText(member.$type, member.value.light) : member.css.light,
        ...(member.value.dark === undefined ? {} : { dark: member.alias.dark ? cssText(member.$type, member.value.dark) : member.css.dark! }),
      }]));
      const componentOptions = structuredClone(input.componentOptions!);
      componentOptions.evidence!.observations["components.button"]!.tokensHash = client.componentTokensHash(tokens);
      const checked = client.check({ ...input, library, componentOptions });
      const legacy = client.check({ catalog: input.catalog.values, library: { ...values, source, adoptedAt } });
      expect(checked.findings.filter(f => f.code.startsWith("K")), item.name).toEqual([]);
      expect(checked.findings, item.name).toEqual(legacy.findings);
      expect(checked.ok, item.name).toBe(legacy.ok);
      if (item.name === "light alias with explicit dark literal") {
        expect(checked.ok).toBe(false);
        expect(checked.findings.filter(f => f.severity === "error").map(f => f.code)).toEqual(["C1", "C9"]);
      }
    }
  });
  it("refuses emission on value or component errors, including contradictory ok flags", () => {
    const input = adoptedComponentIntegration();
    const profile = client.resolve(input);
    profile.check.findings = [...profile.check.findings, { code: "C1", rule: "test", severity: "error", subject: "test", message: "broken" }];
    expect(() => client.emit(profile, ["component-index"])).toThrow(/findings/);
    // Absent evidence is runtime-pending, not refused: the same code emits, reported as runtime-pending.
    const noEvidence = client.resolve({ ...input, componentOptions: { ...input.componentOptions, evidence: { ...input.componentOptions!.evidence!, observations: {} } } });
    expect(noEvidence.components.check.ok).toBe(true);
    expect(noEvidence.components.check.findings.length).toBeGreaterThan(0);
    expect(noEvidence.components.check.findings.every(finding => finding.severity === "notice")).toBe(true);
    expect(client.emit(noEvidence, ["component-index"])).toEqual(client.emit(client.resolve(input), ["component-index"]));
    expect(JSON.parse(client.emit(noEvidence, ["components-consumption"])[0]!.contents).status).toBe("runtime-pending");
    expect(() => client.emit(client.resolve(input), ["component-index"], {})).not.toThrow();
    const noGlyph = structuredClone(input.library); noGlyph.values.fills = noGlyph.values.fills.filter(f => metaOf(f).slot !== "assets.icon-close");
    expect(client.check({ ...input, library: noGlyph }).ok).toBe(false);
  });
  it("keeps the required favicon A6 failure visible through checking and emission", () => {
    const input = adoptedComponentIntegration();
    const library = client.applyLibraryChange(input.catalog, input.library, { baseHash: client.libraryHash(input.library), changes: [{ portion: "values", change: { op: "remove", slot: "assets.favicon" } }] });
    const result = client.check({ ...input, library });
    expect(result.ok).toBe(false);
    expect(result.findings.some(f => f.code === "A6" && f.severity === "error")).toBe(true);
    expect(() => client.emit(client.resolve({ ...input, library }), ["component-index"])).toThrow(/findings/);
  });
  it("forwards verified source bundles intact and leaves originals unchanged on tampering", async () => {
    const input = componentIntegration(true); const source = syntheticSource();
    const bundle = await client.materializeSourceFill(source.candidate, async () => source.upstream.content, [{ id: "synthetic@1", run: () => ({ files: [source.file, source.notice], blockers: [] }) }]);
    const cs: client.CompositeChangeSet = { baseHash: client.libraryHash(input.library), changes: [adopt], bundles: [bundle] };
    expect(() => client.applyLibraryChange(input.catalog, input.library, cs)).not.toThrow();
    const next = client.applyLibraryChange(input.catalog, input.library, cs);
    expect(next.components.files).toEqual([source.file, source.notice]);
    expect(next.values).toEqual(input.library.values);
    const corrupt = structuredClone(cs); corrupt.bundles![0]!.files[0]!.content += "tampered";
    expect(() => client.applyLibraryChange(input.catalog, input.library, corrupt)).toThrow(/hash/);
    expect(() => client.applyLibraryChange(input.catalog, input.library, { ...cs, bundles: [] })).toThrow(/bundle/);
    expect(input.library.components).toEqual({ fills: [], files: [] });
  });
  it("dispatches component author, derive, compose and remove without changing value ownership", () => {
    const input = componentIntegration(); const candidate = input.catalog.components.fills[0]!.components.button!;
    let library = client.applyLibraryChange(input.catalog, input.library, { baseHash: client.libraryHash(input.library), changes: [{ portion: "components", change: { op: "author", slot: candidate.slot, fill: candidate, files: [] } }] });
    expect(library.components.fills[0]!.components.button!.origin.kind).toBe("authored");
    for (const kind of ["derive", "compose"] as const) {
      const slot = "components.select";
      const catalog = { ...input.catalog, components: { ...input.catalog.components, slots: [...input.catalog.components.slots, { ...input.catalog.components.slots[0]!, id: slot }], rules: [{ id: `synthetic:${kind}@1`, kind, slot, inputs: [candidate.slot], template: { ...candidate, slot }, files: [] }] } };
      library = client.applyLibraryChange(catalog, library, { baseHash: client.libraryHash(library), changes: [{ portion: "components", change: kind === "derive" ? { op: kind, slot, rule: `synthetic:${kind}@1`, inputs: [candidate.slot] } : { op: kind, slot, rule: `synthetic:${kind}@1` } }] });
      expect(library.components.fills.find(doc => doc.components.select)!.components.select!.origin.kind).toBe(kind === "derive" ? "derived" : "composed");
      library = client.applyLibraryChange(catalog, library, { baseHash: client.libraryHash(library), changes: [{ portion: "components", change: { op: "remove", slot } }] });
    }
    expect(library.values).toEqual(input.library.values);
  });
  it("keeps the public barrel browser safe with only the exact pinned parser dependency graph", async () => {
    await componentBrowserClosure();
    // The independent rail inventory proof checks the complete new join.
    const added = new Set(["assets.icon-panel-left", ...["command", "dropdown-menu", "empty", "item", "scroll-area", "sheet", "sidebar"].map(leaf => `components.${leaf}`)]);
    expect(client.loadCatalog().slots.filter(slot => !added.has(slot.id))).toHaveLength(98);
    expect(client.loadBuildCatalog().slots.filter(slot => !added.has(slot.id))).toHaveLength(210);
  });
});

it("retains legacy value findings when selected component resolution throws",()=>{const input=componentIntegration();input.library.values.complete=true;input.library.components.files=[{path:"../unsafe.ts",content:"invalid"}];const result=client.check(input);expect(result.findings.some(finding=>finding.rule!=="components")).toBe(true);expect(result.findings.some(finding=>finding.code==="R"&&finding.rule==="components")).toBe(true);expect(result.ok).toBe(false);});

for (const runtime of ["class-variance-authority", "node:fs"]) it(`refuses an added ${runtime} runtime in the component catalog browser graph`, async () => {
  const injected: Plugin = { name: "unexpected-component-runtime", setup(builder) {
    builder.onLoad({ filter: /[/\\]catalog-core[/\\]index\.ts$/ }, ({ path }) => ({ contents: readFileSync(path, "utf8") + `\nexport * as unexpectedRuntime from "${runtime}";`, loader: "ts" }));
  } };
  await expect(componentBrowserClosure([injected])).rejects.toThrow();
});
