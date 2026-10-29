/** @vitest-environment node */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCatalogBundles } from "../catalog-bundles.js";
import { loadCatalog } from "./index.js";
import { applyLibraryChange, libraryHash, resolve } from "./api.js";
import { emittedTokenProperties } from "./emit.js";
import { loadComponentRegistry } from "./component-registry.js";
import { loadComponentCompositionRules } from "./component-compositions.js";
import { planComponentDefaults, DEFAULT_COMPONENT_PREFERENCE, DEFAULT_COMPONENT_PICKS, DEFAULT_COMPONENT_FALLBACK } from "./component-defaults.js";
import { applyDecisions } from "../library-cli/apply-decisions.js";
import { componentOf, resolveComponents, type ComponentCandidate } from "./resolve-components.js";
import { componentSourceHash, OBSERVATIONS_UNAVAILABLE, type ComponentSourceFile } from "./check-components.js";
import { exportSource, observeComponentSources, type ComponentObservationInput } from "./component-observations.js";
import { stableStringify } from "./stable.js";
import type { CompositeCatalogData, CompositeLibraryData, LibraryData } from "./types.js";

const src = join(dirname(fileURLToPath(import.meta.url)), "..");
const PREFERENCE = DEFAULT_COMPONENT_PREFERENCE;
const PICKS = DEFAULT_COMPONENT_PICKS;
const FALLBACK = DEFAULT_COMPONENT_FALLBACK;
/** The 17 slots whose product status carried K2/K4/K5/K6/K7/K10/K12 "Source and runtime observations are unavailable". */
const AFFECTED = ["badge", "banner", "date-field", "field", "file-trigger", "icon", "link", "logo", "meter", "progress-bar", "radio-group", "resize-handle",
  "search-field", "skeleton", "spinner", "status-mark", "text-field"].map(leaf => `components.${leaf}`);
const RAC = JSON.parse(readFileSync(join(src, "..", "..", "..", "node_modules", "react-aria-components", "package.json"), "utf8")) as { version: string };

/** A real consumer (same construction as component-defaults.test.ts): every token leaf and icon glyph adopts Foundry first. */
function consumer() {
  const values = loadCatalog();
  const offers = (slot: string) => values.fills.filter(doc => doc.$extensions["com.clossys.fill"].slot === slot && doc.$extensions["com.clossys.fill"].mode !== "reference").map(doc => doc.$extensions["com.clossys.fill"].source);
  const changes = values.slots.filter(slot => slot.layer === "tokens" || slot.id.startsWith("assets.icon-")).flatMap(slot => {
    const sources = offers(slot.id);
    const source = ["foundry", "tailwind-default"].find(name => sources.includes(name)) ?? sources[0];
    return source ? [{ op: "adopt" as const, slot: slot.id, source }] : [];
  });
  let library: LibraryData = { source: { kind: "consumer", author: "consumer", id: "observations-consumer" } as LibraryData["source"], fills: [], adoptedAt: "2026-10-26" };
  library = applyLibraryChange(values, library, { baseHash: libraryHash(library), changes });
  const profile = resolve({ catalog: values, library });
  const literal = (id: string, mode: "light" | "dark"): string => {
    let member = profile.members[id]!;
    while (member.alias[mode] ?? member.alias.light) member = profile.members[(member.alias[mode] ?? member.alias.light)!]!;
    return member.css[mode] ?? member.css.light;
  };
  const tokens = Object.fromEntries([...emittedTokenProperties(profile)].map(([id, output]) => [id, { property: output.property, light: literal(id, "light"), ...(profile.members[id]!.value.dark === undefined ? {} : { dark: literal(id, "dark") }) }]));
  const assets = [...new Set(Object.values(profile.members).filter(member => member.slot.startsWith("assets.")).map(member => member.slot))].sort();
  return { values, tokens, assets };
}

/** Foundry package source: the module file that declares the pinned export (following re-exports), read from this package's own tree. */
function packageSource(module: string, name: string): ComponentSourceFile[] | undefined {
  const dir = { "@clossys/designer/components": "components", "@clossys/designer/charts": "charts", "@clossys/designer/shell": "shell" }[module];
  if (!dir) return undefined;
  const read = (path: string) => existsSync(join(src, path)) ? readFileSync(join(src, path), "utf8") : undefined;
  const direct = `${dir}/${name}.tsx`;
  const candidates = existsSync(join(src, direct)) ? [direct] : readdirSync(join(src, dir)).filter(file => /\.tsx?$/.test(file) && !/\.(?:test|server)\./.test(file)).map(file => `${dir}/${file}`);
  return exportSource(read, candidates, name);
}

let cached: ReturnType<typeof build> | undefined;
function build(picks: Readonly<Record<string, string>> = PICKS) {
  const bundles = loadCatalogBundles();
  const registry = loadComponentRegistry();
  const { values, tokens, assets } = consumer();
  const catalog = { slots: registry.slots, fills: bundles.componentFills, rules: loadComponentCompositionRules() };
  const installedRac = { version: RAC.version, instance: "react-aria-components" };
  const plan = planComponentDefaults({ catalog, slots: registry.slots.map(slot => slot.id), tokens, assets, installedRac, bundles: bundles.sourceBundles, preference: PREFERENCE, picks, fallback: FALLBACK });
  const source = { kind: "consumer", author: "consumer", id: "observations-consumer" } as CompositeLibraryData["source"];
  const empty: CompositeLibraryData = { source, adoptedAt: "2026-10-26", values: { fills: [] }, components: { fills: [], files: [] } };
  const adopted = applyDecisions({ values, components: catalog } as CompositeCatalogData, empty, plan.decisions, { bundles: bundles.sourceBundles });
  const library = { ...adopted.components, source, adoptedAt: "2026-10-26" };
  const fills = library.fills.map(doc => componentOf(doc) as ComponentCandidate);
  const input: ComponentObservationInput = { slots: registry.slots, fills, files: library.files, bundles: bundles.sourceBundles, tokens, installedRac, packageSource, racPeers: ["@clossys/designer"] };
  const check = (evidence?: Parameters<typeof resolveComponents>[0]["evidence"]) => resolveComponents({ catalog, library, values: { tokens, assets }, evidence: evidence ?? { observations: {}, installedRac } }).check.findings;
  return { input, check, fills };
}
const real = () => (cached ??= build());
const unavailable = (findings: ReturnType<ReturnType<typeof build>["check"]>) => new Set(findings.filter(finding => finding.message === OBSERVATIONS_UNAVAILABLE || finding.message.endsWith(`: ${OBSERVATIONS_UNAVAILABLE}`)).map(finding => finding.subject));

describe("exportSource", () => {
  const tree: Record<string, string> = {
    "c/Direct.tsx": "export function Direct() { return null }\n",
    "c/Local.tsx": "function Local() { return null }\nexport { Local, LocalItem }\n",
    "c/Rac.tsx": 'export { Tabs, TabList } from "react-aria-components"\n',
    "c/Shim.ts": 'export { Shim, ShimItem } from "./v/shim.js"\nexport type ShimProps = never\n',
    "c/v/shim.tsx": "function Shim() { return null }\nfunction ShimItem() { return null }\nexport { Shim, ShimItem }\n",
    "c/Renamed.ts": 'export { Inner as Renamed } from "./v/inner.js"\n',
    "c/v/inner.tsx": "export const Inner = () => null\n",
    "c/Chain.ts": 'export { Chain } from "./Hop.js"\n',
    "c/Hop.ts": 'export { Chain } from "../d/chain.js"\n',
    "d/chain.tsx": "export class Chain {}\n",
    "c/CycleA.ts": 'export { Cycle } from "./CycleB.js"\n',
    "c/CycleB.ts": 'export { Cycle } from "./CycleA.js"\n',
    "c/Dangling.ts": 'export { Dangling } from "./nowhere.js"\n',
    "c/Bare.ts": 'export { Bare } from "some-package"\n',
  };
  const read = (path: string) => tree[path];
  it("returns the declaring file for a direct declaration, a local export list and a react-aria passthrough", () => {
    expect(exportSource(read, ["c/Direct.tsx"], "Direct")?.map(file => file.path)).toEqual(["c/Direct.tsx"]);
    expect(exportSource(read, ["c/Local.tsx"], "Local")?.map(file => file.path)).toEqual(["c/Local.tsx"]);
    expect(exportSource(read, ["c/Rac.tsx"], "Tabs")?.map(file => file.path)).toEqual(["c/Rac.tsx"]);
  });
  it("follows a relative re-export to the defining file, not the shim, with that file's bytes", () => {
    const found = exportSource(read, ["c/Shim.ts"], "Shim")!;
    expect(found.map(file => file.path)).toEqual(["c/v/shim.tsx"]);
    expect(found[0]!.content).toBe(tree["c/v/shim.tsx"]);
    expect(exportSource(read, ["c/Shim.ts"], "ShimItem")?.map(file => file.path)).toEqual(["c/v/shim.tsx"]);
  });
  it("follows a rename and a chain of re-exports across directories", () => {
    expect(exportSource(read, ["c/Renamed.ts"], "Renamed")?.map(file => file.path)).toEqual(["c/v/inner.tsx"]);
    expect(exportSource(read, ["c/Chain.ts"], "Chain")?.map(file => file.path)).toEqual(["d/chain.tsx"]);
  });
  it("stays unresolved for a name nothing exports, a cycle, a dangling re-export and a bare package", () => {
    expect(exportSource(read, ["c/Shim.ts"], "Absent")).toBeUndefined();
    expect(exportSource(read, ["c/CycleA.ts"], "Cycle")).toBeUndefined();
    expect(exportSource(read, ["c/Dangling.ts"], "Dangling")).toBeUndefined();
    expect(exportSource(read, ["c/Bare.ts"], "Bare")).toBeUndefined();
  });
});

describe("observeComponentSources on the real catalog", () => {
  it("clears 'observations unavailable' for every adopted slot whose run bytes exist, including the 17 named slots", () => {
    const { input, check, fills } = real();
    const before = unavailable(check());
    const result = observeComponentSources(input);
    const after = unavailable(check(result.evidence));
    expect(before.size).toBe(fills.length);
    expect(result.unobserved).toEqual([]);
    expect([...after]).toEqual([]);
    const adoptedAffected = AFFECTED.filter(slot => fills.some(fill => fill.slot === slot));
    expect(adoptedAffected.filter(slot => before.has(slot))).toEqual(adoptedAffected);
    expect(adoptedAffected.filter(slot => after.has(slot))).toEqual([]);
  }, 120_000);
  it("binds every observation to the inspected bytes and current consumer tokens (no stale-evidence findings)", () => {
    const { input, check } = real();
    const result = observeComponentSources(input);
    for (const [slot, observation] of Object.entries(result.evidence.observations)) expect(observation!.sourceHash, slot).toBe(componentSourceHash(observation!.files));
    expect(check(result.evidence).filter(finding => /evidence is stale/.test(finding.message))).toEqual([]);
  }, 120_000);
  it("observes source fills from their receipted output and joins the pinned upstream bytes (no K8 pin findings)", () => {
    const { input, check, fills } = real();
    const result = observeComponentSources(input);
    const sourceFills = fills.filter(fill => fill.impl.kind === "source" && fill.pin?.files?.length);
    expect(sourceFills.length).toBeGreaterThan(0);
    for (const fill of sourceFills) {
      const observation = result.evidence.observations[fill.slot]!;
      expect(observation.files.map(file => file.path), fill.slot).toEqual(fill.outputSha256!.map(receipt => receipt.path).sort());
      expect(observation.upstreamFiles?.map(file => file.path), fill.slot).toEqual(fill.pin!.files!.map(pin => pin.path).sort());
      expect(observation.rac.dependency).toBe("source");
    }
    expect(check(result.evidence).filter(finding => finding.code === "K8")).toEqual([]);
  }, 120_000);
  it("materializes the shadcn@aria combo-box and select input-group part, so observed source clears their pending K9", () => {
    const leaves = ["components.combo-box", "components.select"];
    const { input, check, fills } = build({ ...PICKS, ...Object.fromEntries(leaves.map(slot => [slot, "shadcn@aria"])) });
    const picked = fills.filter(fill => leaves.includes(fill.slot));
    expect(picked.map(fill => [fill.slot, fill.item])).toEqual([["components.combo-box", "combobox"], ["components.select", "select"]]);
    for (const fill of picked) for (const dep of fill.deps.filter(dep => dep.registryItem)) {
      if (dep.slot && fill.composes.includes(dep.slot)) continue;
      expect(fill.parts?.map(part => part.item), `${fill.slot} ${dep.registryItem}`).toContain(dep.registryItem);
      const module = `components/_parts/${dep.registryItem}/${dep.registryItem}.tsx`;
      expect(fill.outputSha256?.map(receipt => receipt.path), `${fill.slot} ${dep.registryItem}`).toContain(module);
      expect(input.files.find(file => file.path === module)?.content, `${fill.slot} ${dep.registryItem}`).toMatch(/export \{[^}]*\bInputGroup\b/);
    }
    const k9 = (findings: ReturnType<typeof check>) => findings.filter(finding => finding.code === "K9" && leaves.includes(finding.subject));
    expect(k9(check()).map(finding => finding.severity)).toEqual(["notice", "notice"]);
    expect(k9(check(observeComponentSources(input).evidence))).toEqual([]);
  }, 120_000);
  it("is deterministic", () => {
    const { input } = real();
    expect(stableStringify(observeComponentSources(input))).toBe(stableStringify(observeComponentSources(input)));
  }, 120_000);
});

describe("observeComponentSources claims nothing it did not observe", () => {
  it("leaves a package fill unobserved without its module source", () => {
    const { input, fills } = real();
    const pkg = fills.find(fill => fill.impl.kind === "package")!;
    const result = observeComponentSources({ ...input, packageSource: undefined });
    expect(result.evidence.observations[pkg.slot]).toBeUndefined();
    expect(result.unobserved).toContainEqual({ slot: pkg.slot, reason: expect.stringMatching(/^No module source for /) });
  }, 120_000);
  it("reports ref/render-prop forwarding only from a probe and passes probe measurements through", () => {
    const { input, fills } = real();
    const slot = fills[0]!.slot;
    expect(observeComponentSources(input).evidence.observations[slot]).toMatchObject({ forwardsRef: false, forwardsRenderProps: false, measurements: [] });
    const probed = observeComponentSources({ ...input, probes: { [slot]: { forwardsRef: true, forwardsRenderProps: true } } });
    expect(probed.evidence.observations[slot]).toMatchObject({ forwardsRef: true, forwardsRenderProps: true });
  }, 120_000);
  it("observes a RAC root only when it is imported from react-aria-components and rendered", () => {
    const { input, fills } = real();
    const fill = fills.find(fill => fill.slot === "components.button")!;
    const observed = observeComponentSources(input).evidence.observations[fill.slot]!;
    expect(observed.root).toBe("rac:Button");
    const withoutButtonRoot = (file: ComponentSourceFile) => ({ ...file, content: file.content.replace(/(<\/?)(?:ButtonPrimitive|\w*Button)\b/g, "$1Other") });
    const stripped = observeComponentSources({ ...input, files: input.files.map(withoutButtonRoot), packageSource: (module, name) => input.packageSource!(module, name)?.map(withoutButtonRoot) }).evidence.observations[fill.slot]!;
    expect(stripped.root).toBe("engine:none");
    // A module that re-exports the RAC root unchanged is that root.
    expect(observeComponentSources(input).evidence.observations["components.form"]?.root).toBe("rac:Form");
  }, 120_000);
  it("records a call site for each composed leaf that is rendered, and only those", () => {
    const { input, fills } = real();
    const result = observeComponentSources(input);
    const composers = fills.filter(fill => fill.composes.length && fill.impl.kind !== "composed");
    expect(composers.length).toBeGreaterThan(0);
    for (const fill of composers) for (const call of result.evidence.observations[fill.slot]?.calls ?? []) expect(fill.composes, fill.slot).toContain(call.target);
    const fill = composers[0]!;
    const blank = observeComponentSources({ ...input, files: input.files.map(file => ({ ...file, content: file.content.replace(/<([A-Z])/g, "<x$1") })), packageSource: (module, name) => input.packageSource!(module, name)?.map(file => ({ ...file, content: file.content.replace(/<([A-Z])/g, "<x$1") })) });
    expect(blank.evidence.observations[fill.slot]?.calls ?? []).toEqual([]);
  }, 120_000);
});
