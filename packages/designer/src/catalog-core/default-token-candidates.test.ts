/** @vitest-environment node */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import questions from "../library-cli/default-candidates.questions.json" with { type: "json" };
import { applyLibraryChange, check, importFoundryFrames, importFoundrySections, libraryHash, loadBuildCatalog, loadCatalog, resolve, type CatalogData, type DtcgToken, type LibraryData } from "./index.js";
import { flatten, metaOf } from "./model.js";
import { loadCatalogBundles } from "../catalog-bundles.js";
import { checkDefaultCandidates, type DefaultCandidatesInput } from "../library-cli/default-candidates-gate.js";
import { nativeDefaultSources } from "../library-cli/default-candidates-cli.js";
import { loadNativeCompositeCatalog } from "../library-cli/native-catalog.js";
import { applyAgentChange } from "../library-cli/reselect.js";
import { CONTRAST_PAIRS } from "../tokens/contrast-pairs.js";
import { contrastRatio } from "../tokens/color.js";
import { tokenCatalog } from "./__fixtures__/token-catalog.js";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const sourceHead = "458376cbb88de2e3e52704152c25b3fdcdafc334";
const source = "shadcn@aria", slots = new Set<string>(questions.scope);
const tailwindHash = "443d7af364200f8ec8352dc78e39485a118a1840d498c97967bf0ae402b39167";
function adopted(catalog = tokenCatalog(loadCatalog())) {
  const empty: LibraryData = { source: { id: "token-consumer", kind: "base", author: "foundry", license: "MIT" }, adoptedAt: "2026-10-30", fills: [], complete: true };
  const library = applyLibraryChange(catalog, empty, { baseHash: libraryHash(empty), changes: catalog.fills.filter(fill => metaOf(fill).source === source).map(fill => ({ op: "adopt", source, slot: metaOf(fill).slot })) });
  return { catalog, library };
}
function candidate(catalog: CatalogData, slot: string) { return catalog.fills.find(fill => metaOf(fill).source === source && metaOf(fill).slot === slot)!; }
function coverage(input: ReturnType<typeof adopted>) { return check(input).findings.filter(finding => finding.code === "C4" && finding.rule === "coverage" && [...slots].some(slot => finding.subject === slot || finding.subject.startsWith(slot + "."))); }

describe("approved native token defaults", () => {
  it("registers every decided family exactly once and adopts all 171 rows through the real engine", () => {
    const input = adopted(), profile = resolve(input);
    expect(coverage(input)).toEqual([]);
    const fills = input.catalog.fills.filter(fill => metaOf(fill).source === source && slots.has(metaOf(fill).slot));
    expect(fills).toHaveLength(34);
    expect(new Set(fills.map(fill => metaOf(fill).slot)).size).toBe(34);
    expect(fills.flatMap(fill => Object.keys(flatten(fill)))).toHaveLength(171);
    for (const fill of fills) for (const [id, token] of Object.entries(flatten(fill))) {
      expect(profile.members[id], id).toBeDefined();
      expect(profile.members[id]!.css.light, id).toBeTruthy();
      const provenance = token.$extensions?.["com.clossys.provenance"];
      expect(["shadcn", "Tailwind4.3.3", "Foundry-authored"]).toContain(provenance?.sourceLabel);
      expect(provenance?.pin?.sha256, id).toMatch(/^[a-f0-9]{64}$/);
      if (provenance?.sourceLabel === "Tailwind4.3.3") expect(provenance.pin?.sha256).toBe(tailwindHash);
      expect(flatten(input.library.fills.find(doc => metaOf(doc).slot === metaOf(fill).slot)!)[id]!.$extensions?.["com.clossys.provenance"]).toEqual(provenance);
    }
  });

  it("resolves the approved role values, both color modes, and equal aliases", () => {
    const input = adopted(), p = resolve(input).members;
    for (const [id, light, dark] of [
      ["tokens.text-color.on-accent", "oklch(0.985 0 0)", "oklch(0.205 0 0)"],
      ["tokens.accent-color.default", "oklch(0.205 0 0)", "oklch(0.922 0 0)"],
      ["tokens.categorical-color.6", "#002d9c", "#4589ff"],
      ["tokens.categorical-color.7", "#012749", "#bae6ff"],
      ["tokens.categorical-color.8", "#8a3800", "#ba4e00"],
    ]) expect(p[id!]!.css).toMatchObject({ light, dark });
    for (const [id, value] of Object.entries({ "tokens.code-size.block": .875, "tokens.display-size.m": 3, "tokens.display-size.l": 3.75, "tokens.display-size.xl": 4.5, "tokens.display-size.2xl": 6, "tokens.heading-size.h0": 2.25, "tokens.heading-size.h1": 1.875, "tokens.heading-size.h2": 1.5, "tokens.heading-size.h3": 1.25, "tokens.heading-size.2xl": 3.75, "tokens.icon-size.sm": 1, "tokens.icon-size.md": 1.25, "tokens.icon-size.lg": 1.5, "tokens.radius.default": .625, "tokens.surface-radius.default": .625, "tokens.surface-radius.overlay": .875, "tokens.control-radius.default": .5 })) expect(p[id]!.value.light, id).toEqual({ unit: "rem", value });
    expect(p["tokens.duration.default"]!.value.light).toEqual({ unit: "ms", value: 240 });
    expect(p["tokens.easing.default"]!.value.light).toEqual([.2, 0, 0, 1]);
    expect(p["tokens.behavior-timing.tooltip-delay"]!.value.light).toEqual({ unit: "ms", value: 0 });
    const members = Object.assign({}, ...input.library.fills.map(flatten)) as Record<string, DtcgToken>;
    expect(members["tokens.surface-radius.panel"]!.$value).toBe("{tokens.surface-radius.default}");
    expect(members["tokens.chart-color.axis"]!.$value).toBe("{tokens.border-color.strong}");
    expect(members["tokens.diverging-color.neutral"]!.$value).toBe("{tokens.border-color.base}");
    expect(members["tokens.elevation.panel"]!.$value).not.toBe("{tokens.elevation.floating}");
    expect(p["tokens.elevation.panel"]!.css.light).not.toBe(p["tokens.elevation.floating"]!.css.light);
    for (const [id, member] of Object.entries(p)) if (id.startsWith("tokens.sequential-color.") || ["tokens.diverging-color.negative", "tokens.diverging-color.positive"].includes(id)) expect(member.css.dark).toBe(member.css.light);
  });

  it("retains prior family values except the three explicit focus and quiet corrections", () => {
    const paths = execFileSync("git", ["ls-tree", "-r", "--name-only", sourceHead, "packages/designer/src/catalog/fills/shadcn-aria"], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(path => !slots.has(path.split("/").at(-1)!.slice(0, -5)));
    expect(paths).toHaveLength(16);
    const overrides: Record<string, string[]> = { "tokens.control-color": ["quiet"], "tokens.focus-color": ["default", "on-inverse"] };
    for (const path of paths) {
      const previous = execFileSync("git", ["show", `${sourceHead}:${path}`], { cwd: root }), current = readFileSync(pathResolve(root, path));
      const slot = path.split("/").at(-1)!.slice(0, -5), approved = overrides[slot];
      if (!approved) { expect(current).toEqual(previous); continue; }
      const before = JSON.parse(previous.toString()), after = JSON.parse(current.toString());
      for (const member of approved) {
        expect(after.tokens[slot.slice(7)][member]).not.toEqual(before.tokens[slot.slice(7)][member]);
        delete before.tokens[slot.slice(7)][member]; delete after.tokens[slot.slice(7)][member];
      }
      expect(after).toEqual(before);
    }
  });

  it("passes every declared focus and quiet pair in both modes using the native profile", () => {
    const input = adopted(), profile = resolve(input), properties = new Set(["--color-control-quiet", "--color-focus-ring", "--color-focus-ring-on-inverse"]);
    const members = new Map(Object.values(profile.members).filter(member => member.emit).map(member => [member.emit!, member]));
    const pairs = CONTRAST_PAIRS.filter(pair => properties.has(pair.foreground));
    expect(pairs).toHaveLength(9);
    for (const pair of pairs) for (const mode of ["light", "dark"] as const) {
      const foreground = members.get(pair.foreground)!, background = members.get(pair.background)!;
      expect(contrastRatio(foreground.css[mode] ?? foreground.css.light, background.css[mode] ?? background.css.light), `${pair.id}/${mode}`).toBeGreaterThanOrEqual(pair.minimumRatio);
    }
    expect(check(input).findings.filter(finding => finding.code === "C9" && properties.has(finding.subject))).toEqual([]);
    expect(profile.members["tokens.control-color.quiet"]!.css).toMatchObject({ light: "oklch(0.439 0 0)", dark: "oklch(0.708 0 0)" });
    expect(profile.members["tokens.focus-color.default"]!.css).toMatchObject({ light: "oklch(0.556 0 0)", dark: "oklch(0.556 0 0)" });
    // Adjacent published neutral stops fail the actual native ground; these corrections do not invent a shade.
    const published = readFileSync(pathResolve(root, "node_modules/tailwindcss/theme.css"), "utf8");
    expect(createHash("sha256").update(published).digest("hex")).toBe(tailwindHash);
    for (const [slot, member, mode, step, scalar, property] of [
      ["tokens.control-color", "quiet", "light", "500", "0.556", "--color-control-quiet"],
      ["tokens.control-color", "quiet", "dark", "500", "0.556", "--color-control-quiet"],
      ["tokens.focus-color", "default", "light", "400", "0.708", "--color-focus-ring"],
      ["tokens.focus-color", "default", "dark", "600", "0.439", "--color-focus-ring"],
    ] as const) {
      const percent = String(Number((Number(scalar) * 100).toFixed(3)));
      expect(published).toContain(`--color-neutral-${step}: oklch(${percent}% 0 none)`);
      const c = tokenCatalog(loadCatalog()), token = flatten(candidate(c, slot))[`${slot}.${member}`]!, value = `oklch(${scalar} 0 0)`;
      if (mode === "light") { token.$value = value; token.$extensions!["com.clossys.css"] = { raw: value }; }
      else token.$extensions!["com.clossys.modes"]!.dark = value;
      expect(check(adopted(c)).findings.some(finding => finding.code === "C9" && finding.subject === property && finding.message.includes(`in ${mode}`))).toBe(true);
    }
  });

  it("reselects focus and quiet over separately owned text without malformed inverse colors", async () => {
    const catalog = tokenCatalog(loadCatalog());
    const empty: LibraryData = { source: { id: "reselect-consumer", kind: "consumer", author: "consumer", license: "MIT" }, adoptedAt: "2026-10-30", fills: [] };
    const library = applyLibraryChange(catalog, empty, { baseHash: libraryHash(empty), changes: [{ op: "adopt", slot: "tokens.surface-color", source }, { op: "adopt", slot: "tokens.text-color", source: "foundry" }] });
    for (const leaf of ["tokens.control-color", "tokens.focus-color"]) {
      const result = await applyAgentChange({ root: "", catalog: loadNativeCompositeCatalog(catalog), leaf, write: false }, library, { op: "adopt", slot: leaf, source }, { command: "designer-library reselect", inputs: { leaf, source } });
      expect(result.verdict.findings.filter(finding => ["C1", "C9"].includes(finding.code))).toEqual([]);
    }
    const profile = resolve({ catalog, library: applyLibraryChange(catalog, library, { baseHash: libraryHash(library), changes: [{ op: "adopt", slot: "tokens.focus-color", source }] }) });
    expect(profile.members["tokens.focus-color.on-inverse"]!.css).toMatchObject({ light: "oklch(0.9702 0 0)", dark: "oklch(0.2178 0 0)" });
    const inverse = flatten(candidate(catalog, "tokens.focus-color"))["tokens.focus-color.on-inverse"]!;
    expect(inverse.$value).toBe("{tokens.text-color.on-inverse}");
    expect(inverse.$extensions!["com.clossys.modes"]!.dark).toBe("{tokens.text-color.on-inverse}");
    const raw = inverse.$extensions!["com.clossys.css"]!;
    expect(raw.raw).toBe("oklch(0.9702 0 0)");
    delete inverse.$extensions!["com.clossys.css"];
    const damaged = await applyAgentChange({ root: "", catalog: loadNativeCompositeCatalog(catalog), leaf: "tokens.focus-color", write: false }, library, { op: "adopt", slot: "tokens.focus-color", source }, { command: "designer-library reselect", inputs: { leaf: "tokens.focus-color", source } });
    expect(damaged.verdict.findings.some(finding => finding.code === "C1" && finding.message.includes("tokens.focus-color.on-inverse has a malformed color value"))).toBe(true);
    inverse.$extensions!["com.clossys.css"] = raw;
  });

  it("keeps the Carbon scalar receipt reachable through exact pinned evidence", () => {
    const c = loadCatalog();
    for (const member of ["6", "7", "8"]) {
      const token = flatten(candidate(c, "tokens.categorical-color"))[`tokens.categorical-color.${member}`]!;
      const evidence = token.$extensions!["com.clossys.provenance"]!;
      expect(evidence.sourceLabel).toBe("Foundry-authored");
      const bytes = readFileSync(pathResolve(root, evidence.sourceAddress));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(evidence.pin!.sha256);
      const upstream = JSON.parse(bytes.toString()).$extensions["com.clossys.fill"].pin;
      expect(upstream.commit).toBe("6568a3389c2a82348c693b167b511dea66b7b269");
      expect(upstream.sha256).toBe("20b19b199cc0b77d6f49c626e2eb03fb48f02f2d2282a7291d93644242d644ef");
    }
  });

  it("detects required member removal after real adoption and restores exact findings", () => {
    const input = adopted(), baseline = check(input), fill = input.library.fills.find(doc => metaOf(doc).slot === "tokens.control-size")!;
    const group = fill.tokens!["control-size"]!, original = group.mark;
    delete group.mark;
    expect(coverage(input).some(finding => finding.subject === "tokens.control-size.mark")).toBe(true);
    group.mark = original!;
    expect(check(input)).toEqual(baseline);
  });

  it("detects removal of a newly supplied default through the native gate and restores its exact report", () => {
    const buildCatalog = loadBuildCatalog(), bundles = loadCatalogBundles();
    const input: DefaultCandidatesInput = { catalog: loadNativeCompositeCatalog(), buildCatalog, defaultSources: nativeDefaultSources(buildCatalog), componentBundles: bundles.sourceBundles,
      surfaceCoverage: [...bundles.foundryCoverage, ...importFoundrySections().coverage, ...importFoundryFrames().coverage], sourceHead,
      sourceHash(path) { return createHash("sha256").update(readFileSync(pathResolve(root, path))).digest("hex"); },
    };
    const baseline = checkDefaultCandidates(input), original = input.catalog.values.fills;
    expect(baseline.report.missing.filter(row => slots.has(row.slot))).toEqual([]);
    input.catalog.values.fills = original.filter(fill => metaOf(fill).id !== source + "/tokens.code-size");
    const mutated = checkDefaultCandidates(input);
    expect(mutated.report.missing.find(row => row.slot === "tokens.code-size")).toMatchObject({ source, reasons: ["no implementation candidate in the default source"] });
    expect(mutated.report.invalid).toEqual(baseline.report.invalid);
    input.catalog.values.fills = original;
    expect(checkDefaultCandidates(input)).toEqual(baseline);
  });

  it("refuses adoption when a decided default candidate is removed", () => {
    const c = tokenCatalog(loadCatalog()), before = structuredClone(c), fill = candidate(c, "tokens.code-size");
    c.fills = c.fills.filter(doc => metaOf(doc).id !== metaOf(fill).id);
    const empty: LibraryData = { source: { id: "token-consumer", kind: "base", author: "foundry", license: "MIT" }, adoptedAt: "2026-10-30", fills: [] };
    expect(() => applyLibraryChange(c, empty, { baseHash: libraryHash(empty), changes: [{ op: "adopt", slot: "tokens.code-size", source }] })).toThrow("has no candidate");
    c.fills = before.fills;
    expect(c).toEqual(before);
  });
});
