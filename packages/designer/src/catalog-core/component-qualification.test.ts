/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCatalog } from "./index.js";
import { applyLibraryChange, check, libraryHash, resolve } from "./api.js";
import { emittedTokenProperties } from "./emit.js";
import { loadComponentRegistry } from "./component-registry.js";
import { loadComponentCompositionRules } from "./component-compositions.js";
import { componentOf, type ComponentCandidate, type ComponentCandidateDocument, type ComponentOrigin } from "./resolve-components.js";
import { componentSourceHash, componentTokensHash, ROOT_PROTOCOL, type ComponentMeasurement, type ComponentSourceFile } from "./check-components.js";
import { observeComponentSources, type ComponentBrowserArtifact, type ComponentObservationInput } from "./component-observations.js";
import { joinComponentQualification } from "./component-qualification.js";
import { componentRacDeclaration } from "../importers/component-rac.js";
import { completedCatalogLibrary } from "./__fixtures__/completed-catalog-library.js";
import type { ComponentContract, ComponentSlot, CompositeCatalogData, CompositeLibraryData, LibraryData } from "./types.js";

/**
 * SYNTHETIC qualification corpus: a fixture component library adopting one clean package fill for every
 * registered component slot, with per-slot browser artifacts generated from the adopted descriptors. It proves
 * the public observe -> check -> consumer join is satisfiable from Foundry-produced evidence, and that the join
 * refuses when the descriptor's RAC declaration, member-root measurements or size geometry are missing or forged.
 * It is never accessibility evidence for a shipped component.
 */
const src = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAC = JSON.parse(readFileSync(join(src, "..", "..", "..", "node_modules", "react-aria-components", "package.json"), "utf8")) as { version: string };
/** A consumer's realpath-resolved singleton: a descriptor can only name the package, never this path. */
const INSTALLED_RAC = { version: RAC.version, instance: "/consumer/app/node_modules/react-aria-components" };
/** Fixture contracts read exactly these token leaves; real contract read gaps are reported separately, not hidden here. */
const READS = ["themes.foreground", "themes.background", "themes.ring", "themes.spacing", "themes.font-sans"];
const TEXT = "themes.foreground.default", SURFACE = "themes.background.default", FOCUS = "themes.ring.default", CONTROL = "themes.spacing.default";
const KITS = ["@fixture/kit-a", "@fixture/kit-b"] as const;
/** Half of the controls group comes from the second kit, so controls mix sources and K11 geometry parity is load-bearing. */
const SECOND_KIT = new Set(["text-field", "checkbox", "switch", "combo-box", "tag-group", "slider"].map(leaf => `components.${leaf}`));

const pascal = (leaf: string): string => leaf.split("-").map(part => part[0]!.toUpperCase() + part.slice(1)).join("");
const leafOf = (slot: string): string => slot.slice("components.".length);
const rootNames = (root: string): string[] => root.startsWith("rac:") ? root.slice(4).split("+") : [];

/** A complete, check-clean consumer token and asset library (the completed-catalog fixture) and its resolved token values. */
function consumer() {
  const values = loadCatalog();
  const library = completedCatalogLibrary(values, { kind: "consumer", author: "consumer", id: "qualification-consumer", license: "MIT" } as LibraryData["source"], "2026-10-26");
  const profile = resolve({ catalog: values, library });
  const literal = (id: string, mode: "light" | "dark"): string => {
    let member = profile.members[id]!;
    while (member.alias[mode] ?? member.alias.light) member = profile.members[(member.alias[mode] ?? member.alias.light)!]!;
    return member.css[mode] ?? member.css.light;
  };
  const tokens = Object.fromEntries([...emittedTokenProperties(profile)].map(([id, output]) => [id, { property: output.property, light: literal(id, "light"), ...(profile.members[id]!.value.dark === undefined ? {} : { dark: literal(id, "dark") }) }]));
  const assets = [...new Set(Object.values(profile.members).filter(member => member.slot.startsWith("assets.")).map(member => member.slot))].sort();
  return { values, library, tokens, assets };
}

/** The registered component contracts with fixture token reads. Roots, member roots, members and props stay canonical. */
function fixtureSlots(): ComponentSlot[] {
  return loadComponentRegistry().slots.map(slot => ({ ...structuredClone(slot), contract: { ...structuredClone(slot.contract), allowedReads: { themes: [...READS], assets: [] } } }));
}
const contractMembers = (contract: ComponentContract): string[] => contract.members.mode === "closed" ? [...contract.members.names] : [...(contract.members.required ?? [])];

/** Clean package source: imports and renders every RAC root the contract names, styled only through read token properties. */
function moduleSource(slot: ComponentSlot, tokens: Record<string, { property: string }>): ComponentSourceFile[] {
  const name = pascal(leafOf(slot.id));
  const roots = [...new Set([...rootNames(slot.contract.root), ...Object.values(slot.contract.memberRoots ?? {}).flatMap(rootNames)])];
  const style = `{{ color: "var(${tokens[TEXT]!.property})", background: "var(${tokens[SURFACE]!.property})" }}`;
  const body = roots.length ? roots.reduceRight((inner, root, index) => index === 0 ? `<${root} {...props} style=${style}>${inner}</${root}>` : `<${root}>${inner}</${root}>`, "{props.children}") : `<div {...props} style=${style}>{props.children}</div>`;
  const imports = roots.length ? `import { ${roots.join(", ")} } from "react-aria-components";\n` : "";
  return [{ path: `components/${leafOf(slot.id)}.tsx`, content: `${imports}export function ${name}(props) { return ${body}; }\n` }];
}

function candidateDocument(slot: ComponentSlot): ComponentCandidateDocument {
  const kit = SECOND_KIT.has(slot.id) ? KITS[1] : KITS[0];
  const source = kit.slice("@fixture/".length);
  const name = pascal(leafOf(slot.id));
  const members = contractMembers(slot.contract);
  const fill = {
    slot: slot.id, source, root: slot.contract.root, members, props: [...slot.contract.props],
    propMap: Object.fromEntries(members.map(member => [member, `./components#${name}.${member.replace(".", "=")}`])),
    reads: { themes: [...READS], assets: [], components: [] }, composes: [],
    impl: { kind: "package" as const, module: `${kit}/components`, export: name }, license: "MIT",
    pin: { package: kit, version: "1.0.0", export: `./components#${name}` }, deps: [],
  } as unknown as ComponentCandidate;
  fill.rac = componentRacDeclaration(fill, { peer: true });
  return { $extensions: { "com.clossys.fill": {
    id: `${source}/${slot.id}`, slot: slot.id, source, mode: "implementation", sourceAddress: `./components#${name}`, relation: "same-contract", builtOn: [], conforms: [], evidence: [],
    author: "third-party", trust: "pinned-upstream", license: "MIT", pin: fill.pin, status: "draft",
  } }, components: { [leafOf(slot.id)]: fill } } as unknown as ComponentCandidateDocument;
}

function matrix(contract: ComponentContract): { states: string[]; grounds: string[] } {
  const members = contractMembers(contract);
  const values = (prefix: string, fallback: string) => { const found = members.filter(member => member.startsWith(`${prefix}.`)).map(member => member.slice(prefix.length + 1)); return found.length ? [...new Set(found)] : [fallback]; };
  return { states: values("state", "default"), grounds: values("ground", "base") };
}

/** What a browser runner records for one rendered root: every protocol role and key (a disabled state handles no activation key), bound focus, legible forced colours, a text contrast pair. */
function measure(contract: ComponentContract, root: string): ComponentMeasurement[] {
  const protocols = rootNames(root).map(name => ROOT_PROTOCOL[name]).filter(protocol => !!protocol);
  const roles = [...new Set(protocols.flatMap(protocol => protocol.roles))], keyboard = [...new Set(protocols.flatMap(protocol => protocol.keys))];
  const { states, grounds } = matrix(contract);
  return states.flatMap(state => (["light", "dark"] as const).flatMap(mode => grounds.map(ground => ({
    state, mode, ground, roles, keyboard: state === "disabled" ? keyboard.filter(key => key !== "Enter" && key !== "Space") : keyboard, axeViolations: [], focusTokens: [FOCUS],
    forcedColors: { foreground: "ButtonText", background: "ButtonFace" }, target: { width: 32, height: 32 },
    contrast: [{ foreground: TEXT, background: SURFACE, kind: "text" as const }],
  }))));
}

/** One per-slot browser artifact generated from the adopted descriptor, observed source bytes, consumer tokens and installed RAC. */
function artifactFor(fill: ComponentCandidate, slot: ComponentSlot, files: readonly ComponentSourceFile[], tokens: ComponentObservationInput["themes"]): ComponentBrowserArtifact {
  const sizes = fill.members.filter(member => member.startsWith("size."));
  const memberRoots = Object.entries(slot.contract.memberRoots ?? {});
  return {
    slot: fill.slot, descriptorHash: (fill as ComponentCandidate & { origin: ComponentOrigin & { sha256: string } }).origin.sha256,
    sourceHash: componentSourceHash(files), tokensHash: componentTokensHash(tokens), rac: { ...INSTALLED_RAC },
    forwardsRef: true, forwardsRenderProps: true, measurements: measure(slot.contract, slot.contract.root),
    ...(memberRoots.length ? { memberMeasurements: Object.fromEntries(memberRoots.map(([member, root]) => [member, measure(slot.contract, root)])) } : {}),
    ...(sizes.length ? { geometry: Object.fromEntries(sizes.map(size => [size, CONTROL])) } : {}),
  };
}

/** `edit` changes a catalog candidate before adoption, as an older importer would have produced it. */
function qualification(edit: (doc: ComponentCandidateDocument) => void = () => {}) {
  const { values, library: valueLibrary, tokens, assets } = consumer();
  const slots = fixtureSlots();
  const sources = new Map(slots.map(slot => [slot.id, moduleSource(slot, tokens)]));
  const catalog: CompositeCatalogData = { values, components: { slots, fills: slots.map(slot => { const doc = candidateDocument(slot); edit(doc); return doc; }), rules: loadComponentCompositionRules() } } as CompositeCatalogData;
  const source = { kind: "consumer", author: "consumer", id: "qualification-consumer", license: "MIT" } as CompositeLibraryData["source"];
  const empty: CompositeLibraryData = { source, adoptedAt: "2026-10-26", values: (({ source: _source, adoptedAt: _adoptedAt, ...portion }) => portion)(valueLibrary), components: { fills: [], files: [] } };
  const library = applyLibraryChange(catalog, empty, { baseHash: libraryHash(empty), changes: slots.map(slot => ({ portion: "components" as const, change: { op: "adopt" as const, slot: slot.id, source: SECOND_KIT.has(slot.id) ? "kit-b" : "kit-a" } })) });
  const fills = library.components.fills.map(doc => componentOf(doc) as ComponentCandidate);
  const bySlot = new Map(slots.map(slot => [slot.id, slot]));
  const packageSource = (module: string, name: string): ComponentSourceFile[] | undefined => {
    const fill = fills.find(fill => fill.impl.kind === "package" && fill.impl.module === module && fill.impl.export === name);
    return fill ? sources.get(fill.slot) : undefined;
  };
  const packageExports = Object.fromEntries(KITS.map(kit => [`${kit}/components`, fills.filter(fill => fill.impl.kind === "package" && fill.impl.module === `${kit}/components`).map(fill => (fill.impl as { export: string }).export).sort()]));
  const artifacts = () => Object.fromEntries(fills.map(fill => [fill.slot, artifactFor(fill, bySlot.get(fill.slot)!, sources.get(fill.slot)!, tokens)]));
  const observe = (overrides: Pick<ComponentObservationInput, "probes"> & { artifacts?: Record<string, ComponentBrowserArtifact | undefined> } = {}) => observeComponentSources({
    slots, fills, files: library.components.files, bundles: [], tokens, installedRac: INSTALLED_RAC, packageSource, racPeers: [...KITS], artifacts: overrides.artifacts ?? artifacts(), probes: overrides.probes,
  });
  /** A consumer's accept step: one public check, then the public per-slot join (identity only, one record per slot) over the artifacts it qualified. */
  const accept = (observed: ReturnType<typeof observe>, checked: CompositeLibraryData = library, supplied: Record<string, ComponentBrowserArtifact | undefined> = artifacts()) => {
    const result = check({ catalog, library: checked, componentOptions: { packageExports, evidence: observed.evidence } });
    const joined = joinComponentQualification({ fills: checked.components.fills.map(doc => componentOf(doc) as ComponentCandidate), observations: observed.evidence.observations, artifacts: supplied });
    const join = joined.records.filter(record => !record.joined).map(record => ({ code: "QUALIFICATION_JOIN", subject: record.slot, reasons: record.reasons }));
    return { result, join, records: joined.records, errors: result.findings.filter(finding => finding.severity === "error") };
  };
  return { slots, fills, library, catalog, tokens, assets, artifacts, observe, accept };
}

let cached: ReturnType<typeof qualification> | undefined;
const fixture = () => (cached ??= qualification());
const histogram = (rows: readonly { code: string; subject: string }[]) => rows.reduce<Record<string, number>>((counts, row) => ({ ...counts, [row.code]: (counts[row.code] ?? 0) + 1 }), {});

const errorsFor = (errors: readonly { code: string; subject: string; message: string; compatibility?: string }[], slot: string) => errors.filter(error => error.subject === slot).map(error => error.compatibility ?? error.code);

describe("component qualification join (SYNTHETIC fixture library)", () => {
  it("qualifies every registered slot from per-slot browser artifacts bound to the adopted descriptors", () => {
    const { slots, fills, observe, accept } = fixture();
    expect(slots).toHaveLength(66); expect(fills).toHaveLength(66);
    expect(fills.every(fill => fill.rac?.instance === "react-aria-components" && fill.rac.peer)).toBe(true);
    const observed = observe();
    expect(observed.refused).toEqual([]); expect(observed.unobserved).toEqual([]);
    // Member-root slots carry their own measurements, and size members carry geometry.
    const memberRooted = slots.filter(slot => slot.contract.memberRoots).map(slot => slot.id);
    expect(memberRooted.length).toBeGreaterThan(0);
    for (const slot of memberRooted) expect(Object.values(observed.evidence.observations[slot]!.memberObservations!).every(member => member.measurements.length > 0)).toBe(true);
    expect(fills.filter(fill => fill.members.some(member => member.startsWith("size."))).every(fill => !!observed.evidence.observations[fill.slot]!.geometry)).toBe(true);
    const { result, join, records, errors } = accept(observed);
    expect(records.map(record => record.slot)).toEqual(slots.map(slot => slot.id).sort());
    expect(records.every(record => record.joined && record.descriptorHash && record.observationHash)).toBe(true);
    expect(errors.map(error => `${error.code} ${error.subject} ${error.message}`)).toEqual([]);
    expect(result.findings.filter(finding => finding.subject.startsWith("components.") && /unavailable/.test(finding.message))).toEqual([]);
    expect(result.ok).toBe(true);
    expect(histogram(join)).toEqual({});
  }, 300_000);

  it("QUALIFICATION_JOIN emits one record per slot and the join passes while a K-code finding (CC3) remains a check finding", () => {
    const dropped = qualification(doc => { for (const fill of Object.values(doc.components)) if (fill.slot === "components.button") delete fill.rac; });
    const { errors, join, records, result } = dropped.accept(dropped.observe());
    expect(errorsFor(errors, "components.button")).toEqual(["CC3"]);
    expect(result.ok).toBe(false);
    expect(records).toHaveLength(66);
    expect(new Set(records.map(record => record.slot)).size).toBe(66);
    expect(join).toEqual([]);
    // A forged descriptor on the same library is a join failure for exactly that slot, with its reason.
    const supplied = dropped.artifacts(); supplied["components.button"] = { ...supplied["components.button"]!, descriptorHash: "0".repeat(64) };
    const forged = dropped.accept(dropped.observe({ artifacts: dropped.artifacts() }), undefined, supplied);
    expect(forged.records).toHaveLength(66);
    expect(forged.join).toEqual([{ code: "QUALIFICATION_JOIN", subject: "components.button", reasons: expect.arrayContaining(["Artifact was measured for a different descriptor", "Observation does not carry the artifact's descriptor"]) }]);
  }, 300_000);

  it("refuses tampered geometry at the artifact and at the check", () => {
    const { observe, accept, artifacts } = fixture();
    for (const forged of ["themes.spacing.absent", "themes.foreground.default", "--spacing"]) {
      const supplied = artifacts(); supplied["components.select"] = { ...supplied["components.select"]!, geometry: Object.fromEntries(Object.keys(supplied["components.select"]!.geometry!).map(size => [size, forged])) };
      const observed = observe({ artifacts: supplied });
      expect(observed.refused).toEqual([{ slot: "components.select", reason: expect.stringMatching(/geometry/) }]);
      const { errors, join } = accept(observed, undefined, supplied);
      expect(errorsFor(errors, "components.select")).toEqual(expect.arrayContaining(["K10", "K11"]));
      expect(join.map(row => row.subject)).toContain("components.select");
    }
    const missing = artifacts(); const { geometry: _geometry, ...rest } = missing["components.select"]!; missing["components.select"] = rest;
    const observed = observe({ artifacts: missing });
    expect(observed.refused).toEqual([]);
    expect(errorsFor(accept(observed, undefined, missing).errors, "components.select")).toContain("K11");
  }, 300_000);

  it("keeps empty member-root measurements a K10 finding, never a join failure", () => {
    const { observe, accept, artifacts, slots } = fixture();
    for (const slot of slots.filter(slot => slot.contract.memberRoots)) {
      const supplied = artifacts(); const artifact = supplied[slot.id]!;
      supplied[slot.id] = { ...artifact, memberMeasurements: Object.fromEntries(Object.keys(artifact.memberMeasurements!).map(member => [member, []])) };
      const { errors, join } = accept(observe({ artifacts: supplied }), undefined, supplied);
      expect(errorsFor(errors, slot.id)).toContain("K10");
      expect(join).toEqual([]);
      const omitted = artifacts(); const { memberMeasurements: _members, ...bare } = omitted[slot.id]!; omitted[slot.id] = bare;
      expect(observe({ artifacts: omitted }).refused).toEqual([{ slot: slot.id, reason: expect.stringMatching(/member-root/) }]);
    }
  }, 300_000);

  it("refuses forged, mismatched and synthetic artifacts and keeps no runtime evidence for them", () => {
    const { observe, accept, artifacts, fills } = fixture();
    const slot = "components.button";
    const forge = (change: (artifact: ComponentBrowserArtifact) => ComponentBrowserArtifact) => { const supplied = artifacts(); supplied[slot] = change(supplied[slot]!); return supplied; };
    const cases: [string, Record<string, ComponentBrowserArtifact | undefined>, RegExp][] = [
      ["forged descriptor", forge(artifact => ({ ...artifact, descriptorHash: "0".repeat(64) })), /descriptor/],
      ["another slot's artifact", forge(() => artifacts()["components.link"]!), /slot/],
      ["synthetic source bytes", forge(artifact => ({ ...artifact, sourceHash: componentSourceHash([{ path: "components/button.tsx", content: "export const Button = () => null;" }]) })), /source/],
      ["stale tokens", forge(artifact => ({ ...artifact, tokensHash: componentTokensHash({}) })), /tokens/],
      ["mismatched RAC version", forge(artifact => ({ ...artifact, rac: { ...artifact.rac, version: "0.0.1" } })), /react-aria-components/],
      ["bundled RAC instance", forge(artifact => ({ ...artifact, rac: { ...artifact.rac, instance: "/consumer/app/node_modules/@fixture/kit-a/node_modules/react-aria-components" } })), /react-aria-components/],
    ];
    for (const [name, supplied, reason] of cases) {
      const observed = observe({ artifacts: supplied });
      expect(observed.refused, name).toEqual([{ slot, reason: expect.stringMatching(reason) }]);
      expect(observed.evidence.observations[slot]!.measurements, name).toEqual([]);
      expect(observed.evidence.observations[slot]!.forwardsRef, name).toBe(false);
      const { errors, join } = accept(observed, undefined, supplied);
      expect(errorsFor(errors, slot), name).toContain("K10");
      expect(join.map(row => row.subject), name).toContain(slot);
    }
    const stray = artifacts(); stray["components.unknown"] = { ...stray[slot]!, slot: "components.unknown" };
    expect(observe({ artifacts: stray }).refused).toEqual([{ slot: "components.unknown", reason: expect.stringMatching(/no adopted descriptor/) }]);
    expect(observe({ probes: { [slot]: { forwardsRef: true, forwardsRenderProps: true, measurements: artifacts()[slot]!.measurements } } }).refused).toEqual([{ slot, reason: expect.stringMatching(/both a probe and a browser artifact/) }]);
    const absent = artifacts(); delete absent[slot];
    const unjoined = accept(observe({ artifacts: absent }), undefined, absent);
    expect(errorsFor(unjoined.errors, slot)).toContain("K10");
    expect(unjoined.join).toEqual([{ code: "QUALIFICATION_JOIN", subject: slot, reasons: ["No browser artifact for the slot"] }]);
    // An observation persisted from one artifact never joins a different artifact for the same descriptor.
    const remeasured = artifacts(); remeasured[slot] = { ...remeasured[slot]!, measurements: remeasured[slot]!.measurements.slice(1) };
    expect(accept(observe(), undefined, remeasured).join).toEqual([{ code: "QUALIFICATION_JOIN", subject: slot, reasons: ["Observation measurements differ from the artifact"] }]);
    expect(joinComponentQualification({ fills, observations: observe().evidence.observations, artifacts: stray }).stray).toEqual(["components.unknown"]);
    expect(fills.find(fill => fill.slot === slot)).toBeDefined();
  }, 300_000);
});
