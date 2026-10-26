import { expect, it } from "vitest";
import { loadCatalog, check, stableStringify, type CatalogData, type DtcgToken, type FillDoc, type FillMeta, type LegacySelection, type Slot, type Source } from "./index.js";
const baseSource: Source = { id: "foundry", kind: "base", author: "foundry", license: "MIT" };
const baseSlot: Slot = { id: "tokens.sample", layer: "tokens", contract: { kind: "token", tier: "scale", $type: "number", members: { mode: "open", pattern: "^[a-z0-9-]+$" }, modes: ["light"] }, requires: [], status: "draft" };
const meta: FillMeta = { id: "foundry/tokens.sample", slot: "tokens.sample", source: "foundry", mode: "implementation", sourceAddress: "fixture", relation: "same-contract", builtOn: [], conforms: [], evidence: [], author: "foundry", trust: "foundry", license: "MIT", status: "draft" };
function fixture() {
  const fill: FillDoc = { $extensions: { "com.clossys.fill": { ...meta } }, tokens: { sample: { default: { $type: "number", $value: 1 } } } };
  const catalog: CatalogData = { slots: [structuredClone(baseSlot)], fills: [fill], sources: [baseSource], standards: [], placements: [], retired: [] };
  const selection: LegacySelection = { version: 1, consumer: "foundry", defaultChain: ["foundry"], picks: [] };
  const library = { source: baseSource, fills: [] as FillDoc[] };
  Object.defineProperty(library,"fills",{enumerable:true,get:()=>catalog.fills});
  (fill.tokens!.sample!.default as DtcgToken).$extensions={"com.clossys.origin":{kind:"authored",license:"MIT"}};
  fill.$extensions["com.clossys.fill"].originKinds=["authored"];
  return { catalog, library, selection };
}
type Fixture = ReturnType<typeof fixture>;
const token = (f: Fixture) => f.catalog.fills[0]!.tokens!.sample!.default as DtcgToken;
const metadata = (f: Fixture) => f.catalog.fills[0]!.$extensions["com.clossys.fill"];
const cases: [string, (f: Fixture) => void][] = [];
for (const id of ["tokens_sample", "tokens.Sample", "tokens.sample.", "tokens..sample", "tokens.sаmple"]) cases.push([`slot-id:${id}`, f => { f.catalog.slots[0]!.id = id; }]);
for (const source of ["Foundry", "foundry/other", "fоundry"]) cases.push([`source-id:${source}`, f => { metadata(f).source = source; }]);
for (const value of [null, "#fff", { value: 2, unit: "em" }, { value: 2, unit: "%" }]) cases.push([`dimension:${JSON.stringify(value)}`, f => { const t = token(f); t.$type = "dimension"; t.$value = value; }]);
for (const css of ["red;}", "red}", "</style>", "\\3c", "/*x*/", "url(x)", "expression(x)", "!important", "\0"]) cases.push([`unsafe:${JSON.stringify(css)}`, f => { const t = token(f); t.$value = css; t.$extensions = { "com.clossys.css": { raw: css } }; }]);
for (const alias of ["{a.b", "{ a.b }", "{a.b}}", "｛tokens.sample.default｝", "{tokens.sample.default}", "{tokens.sample}", "{tokens.missing.default}"]) cases.push([`alias:${alias}`, f => { token(f).$value = alias; }]);
for (const length of [16, 17]) cases.push([`alias-depth:${length}`, f => {
  const values: Record<string, DtcgToken> = {}; for (let n = 0; n <= length; n++) values[`m${n}`] = { $type: "number", $value: n === length ? 1 : `{tokens.sample.m${n + 1}}`, $extensions:{"com.clossys.origin":{kind:"authored",license:"MIT"}} };
  f.catalog.fills = [{ ...f.catalog.fills[0]!, tokens: { sample: values } }];
}]);
for (const license of ["mit", "MIT ", "MIT OR Apache-2.0", "GPL-3.0", undefined]) cases.push([`license:${String(license)}`, f => {
  token(f).$extensions = { "com.clossys.origin": {kind:"authored",license:license as string} };
}]);
for (const signoff of [undefined, { by: "planner", date: "2026-10-23", ref: "fixture" }, { by: "owner", date: "today", ref: "fixture" }, { by: "owner", date: "2026-10-23", ref: "" }]) cases.push([`status:${JSON.stringify(signoff)}`, f => { Object.assign(f.catalog.slots[0]!, { status: "stable", signoff }); }]);
cases.push(
  ["missing-root", f => { delete (f.catalog.fills[0] as unknown as Record<string, unknown>).tokens; }],
  ["root-array", f => { (f.catalog.fills[0] as unknown as Record<string, unknown>).tokens = []; }],
  ["extra-root", f => { (f.catalog.fills[0] as unknown as Record<string, unknown>).extra = {}; }],
  ["group-type", f => { (f.catalog.fills[0]!.tokens!.sample as unknown as Record<string, unknown>).$type = "number"; }],
  ["outside-slot", f => { f.catalog.fills = [{ ...f.catalog.fills[0]!, tokens: { other: { default: token(f) } } }]; }],
  ["missing-value", f => { delete (token(f) as unknown as Record<string, unknown>).$value; }],
  ["missing-type", f => { delete (token(f) as unknown as Record<string, unknown>).$type; }],
  ["closed-member", f => { f.catalog.slots[0]!.contract.members = { mode: "closed", names: ["another"] }; }],
  ["pattern-neighbor", f => { f.catalog.slots[0]!.contract.members = { mode: "open", pattern: "^[0-9]+$" }; }],
  ["dark-forbidden", f => { token(f).$extensions = { "com.clossys.modes": { dark: 2 } }; }],
  ["duplicate-fill", f => { f.catalog.fills = [f.catalog.fills[0]!, structuredClone(f.catalog.fills[0]!)]; }],
  ["unknown-clause", f => { metadata(f).conforms = ["dtcg#types"]; }],
  ["missing-evidence", f => { f.catalog.standards = [{ id: "example", title: "Example", version: "1", url: "https://example.org", clauses: [{ id: "rule", title: "Rule" }] }]; metadata(f).conforms = ["example#rule"]; }],
  ["pin-mismatch", f => { f.catalog.sources = [baseSource, { id: "upstream", kind: "external", author: "third-party", license: "MIT", pin: { version: "1" } }]; Object.assign(metadata(f), { id: "upstream/tokens.sample", source: "upstream", pin: { version: "2" } }); }],
  ["pin-absent", f => { f.catalog.sources = [baseSource, { id: "upstream", kind: "external", author: "third-party", license: "MIT" }]; Object.assign(metadata(f), { id: "upstream/tokens.sample", source: "upstream" }); }]
);
it("checks the generated near-miss corpus with exact, stable message sets", async () => {
  const results: Record<string, string[]> = {};
  for (const [name, mutate] of cases) {
    const value = fixture(); mutate(value);
    results[name] = check(value).findings.filter(f => f.rule !== "binding").map(f => f.message);
  }
  expect(cases.length).toBeGreaterThan(50);
  await expect(stableStringify(results)).toMatchFileSnapshot("__golden__/check.corpus.json");
});
it("checks file evidence, contrast in both modes and all fixed binding rules", () => {
  const value = fixture(); const s = value.catalog.slots[0]!;
  s.requires = ["example#rule"]; value.catalog.standards = [{ id: "example", title: "Example", version: "1", url: "https://example.org", clauses: [{ id: "rule", title: "Rule" }] }];
  metadata(value).conforms = ["example#rule"]; metadata(value).evidence = [{ clause: "example#rule", path: "missing.test.ts" }];
  expect(check({ ...value, fileExists: () => false }).findings.filter(f => f.rule !== "binding").map(f => f.message)).toEqual(["standards: foundry/tokens.sample evidence for example#rule not found at missing.test.ts"]);
  const binding = check(value).findings.filter(f => f.rule === "binding"); expect(binding.length).toBe(217);
});

it("measures contrast using each mode's actual selected values", () => {
  const catalog = loadCatalog();
  const black = { colorSpace: "srgb", components: [0, 0, 0], hex: "#000000" };
  const white = { colorSpace: "srgb", components: [1, 1, 1], hex: "#FFFFFF" };
  const focus = catalog.fills.find(f => f.$extensions["com.clossys.fill"].slot === "tokens.focus-color")!;
  (focus.tokens!["focus-color"]!.default as DtcgToken).$value = black;
  (focus.tokens!["focus-color"]!.default as DtcgToken).$extensions = { "com.clossys.modes": { dark: white } };
  const surface = catalog.fills.find(f => f.$extensions["com.clossys.fill"].slot === "tokens.surface-color")!;
  (surface.tokens!["surface-color"]!.base as DtcgToken).$value = white;
  (surface.tokens!["surface-color"]!.base as DtcgToken).$extensions = {};
  const result = check({ catalog, library: { source: baseSource, fills: catalog.fills } });
  expect(result.findings.filter(f => f.code === "C9" && f.message.includes("--color-focus-ring on --color-surface-base")).map(f => f.message)).toEqual(["contrast: --color-focus-ring on --color-surface-base is 1.00:1 in dark, needs 3:1"]);
});
