import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import componentSlots from "../catalog/slots/components.json" with { type: "json" };
import tokenSlots from "../catalog/slots/tokens.json" with { type: "json" };
import type { ComponentSlot } from "../catalog-core/types.js";
import { FOUNDRY_COMPONENT_MAP } from "./foundry-components.map.js";
import { importFoundryComponents } from "./foundry-components.js";
import { foundrySourceTokenReads, sourceConstants, tokenPropertyIndex, type EmittingSlot } from "./foundry-source-reads.js";

const here = dirname(fileURLToPath(import.meta.url));
const index = tokenPropertyIndex(tokenSlots as unknown as readonly EmittingSlot[]);
const constants = Object.assign({}, ...(["components", "charts", "shell"] as const).flatMap(subpath => {
  const dir = resolve(here, `../${subpath}/internal`);
  return readdirSync(dir).filter(name => /\.tsx?$/.test(name) && !name.includes(".test.")).map(name => sourceConstants(readFileSync(resolve(dir, name), "utf8")));
})) as Record<string, string>;
/** The module a mapping's primary export is re-exported from, read through its public barrel. */
function moduleSource(subpath: string, name: string): string {
  const barrel = readFileSync(resolve(here, `../${subpath}/index.ts`), "utf8");
  const from = [...barrel.matchAll(/export\s*\{([^}]+)\}\s*from\s*"([^"]+)"/g)].find(match => match[1]!.split(",").some(binding => binding.trim().split(/\s+as\s+/).at(-1) === name))?.[2];
  if (!from) throw new Error(`no barrel export ${subpath}#${name}`);
  const base = resolve(here, `../${subpath}`, from.replace(/\.js$/, ""));
  const file = [`${base}.tsx`, `${base}.ts`, resolve(base, "index.tsx"), resolve(base, "index.ts")].find(path => existsSync(path));
  if (!file) throw new Error(`no module for ${subpath}#${name}`);
  return readFileSync(file, "utf8");
}
const derived = (): Record<string, string[]> => Object.fromEntries(Object.entries(FOUNDRY_COMPONENT_MAP).sort(([a], [b]) => a < b ? -1 : 1)
  .map(([leaf, mapping]) => [leaf, foundrySourceTokenReads(moduleSource(mapping.subpath, mapping.export), index, constants)]));

describe("Foundry source token reads", () => {
  it("reads an interpolated control height as every emitted control-size member, not as nothing", () => {
    expect(foundrySourceTokenReads("const h = (size) => `var(--ui-control-h-${size})`;", index)).toEqual(["tokens.control-size"]);
    expect(foundrySourceTokenReads("style={{ minBlockSize: \"var(--ui-control-mark)\" }}", index)).toEqual(["tokens.control-size"]);
  });
  it("substitutes shared string constants and ignores a fallback var() nested inside the outer read", () => {
    const ring = { UI_RING_FOCUS: "var(--ui-ring-focus, 0 0 0 2px var(--color-accent, oklch(0.4748 0 0)))" };
    expect(foundrySourceTokenReads("boxShadow: isFocusVisible ? UI_RING_FOCUS : undefined", index, ring)).toEqual(["tokens.focus-shadow"]);
  });
  it("maps named utilities through their theme namespace, past variant prefixes", () => {
    expect(foundrySourceTokenReads("<Label className=\"text-caption font-body focus-visible:text-ink-primary rounded-control px-md\" />", index))
      .toEqual(["tokens.caption-size", "tokens.control-radius", "tokens.spacing", "tokens.text-color", "tokens.typeface"]);
  });
  it("reads the named control-height utilities as the control-size slot they consume (theme-keys @utility control-h-*)", () => {
    expect(foundrySourceTokenReads("<Tag className=\"control-h-md inline-flex\" />", index)).toEqual(["tokens.control-size"]);
    expect(foundrySourceTokenReads("cx(\"hover:control-h-sm\", \"control-h-lg\")", index)).toEqual(["tokens.control-size"]);
    expect(foundrySourceTokenReads("<div className=\"control-h-xl\" />", index)).toEqual([]);
  });
  it("declares every token a controls-group Foundry fill's source consumes: TagGroup reads its control height and focus outline", () => {
    const tagGroup = importFoundryComponents({ slots: componentSlots as unknown as readonly ComponentSlot[] }).fills.find(fill => fill.$extensions["com.clossys.fill"].slot === "components.tag-group")!;
    const reads = Object.values(tagGroup.components)[0]!.reads.tokens;
    for (const read of derived()["tag-group"]!) expect(reads).toContain(read);
    expect(reads).toEqual(expect.arrayContaining(["tokens.control-size", "tokens.focus-outline", "tokens.focus-color"]));
  });
  it("declares the control height DateField and SearchField consume through control-h-md, matching the other Foundry fields", () => {
    const fills = importFoundryComponents({ slots: componentSlots as unknown as readonly ComponentSlot[] }).fills;
    for (const leaf of ["date-field", "search-field"]) {
      expect(derived()[leaf]).toContain("tokens.control-size");
      const fill = fills.find(row => row.$extensions["com.clossys.fill"].slot === `components.${leaf}`)!;
      expect(Object.values(fill.components)[0]!.reads.tokens).toContain("tokens.control-size");
    }
  });
  it("commits the derivation for every mapped component (UPDATE_FOUNDRY_COMPONENT_FILLS=1 rewrites it)", () => {
    const bytes = JSON.stringify(derived(), null, 2) + "\n";
    if (process.env.UPDATE_FOUNDRY_COMPONENT_FILLS === "1") writeFileSync(resolve(here, "foundry-source-reads.json"), bytes);
    expect(readFileSync(resolve(here, "foundry-source-reads.json"), "utf8")).toBe(bytes);
  });
  it("color-picker and number-field sources consume geometry, type and focus tokens their frozen reads carry, so neither offer is blocked", () => {
    const reads = derived();
    for (const leaf of ["color-picker", "number-field"]) {
      expect(reads[leaf], leaf).toEqual(expect.arrayContaining(["tokens.control-size", "tokens.body-size", "tokens.caption-size", "tokens.typeface", "tokens.focus-shadow"]));
      const doc = importFoundryComponents().fills.find(fill => fill.$extensions["com.clossys.fill"].slot === `components.${leaf}`)!;
      const candidate = Object.values(doc.components)[0]!;
      expect(candidate.reads.tokens, leaf).toEqual(expect.arrayContaining(reads[leaf]!));
      expect(candidate.blockers, leaf).toBeUndefined();
    }
  });
  it("records, without blocking, a frozen read set that omits a token slot its source consumes", () => {
    const original = (componentSlots as unknown as ComponentSlot[]).find(row => row.id === "components.number-field")!;
    const slot = structuredClone(original);
    (slot.contract as { allowedReads: { tokens: string[] } }).allowedReads.tokens = slot.contract.allowedReads.tokens.filter(read => read !== "tokens.control-size");
    const mappings = { "number-field": FOUNDRY_COMPONENT_MAP["number-field"]! };
    const result = importFoundryComponents({ slots: [slot], mappings, sourceReads: { "number-field": ["tokens.control-size", "tokens.typeface"] } });
    expect(result.coverage[0]!.notes).toContain("Frozen reads omit source-consumed tokens.control-size; the contract's allowedReads must widen before this is enforced.");
    expect(Object.values(result.fills[0]!.components)[0]!.blockers).toBeUndefined();
    const clean = importFoundryComponents({ slots: [structuredClone(original)], mappings, sourceReads: { "number-field": ["tokens.control-size"] } });
    expect(clean.coverage[0]!.notes.some(note => note.includes("source-consumed"))).toBe(false);
  });
  it("pins which mapped components' frozen reads still omit source-consumed tokens (owner ASK: widen contracts, then enforce)", () => {
    const omissions = Object.fromEntries(importFoundryComponents().coverage.flatMap(row => row.notes.filter(note => note.includes("source-consumed")).map(note => [row.slot.slice(11), note.replace(/^Frozen reads omit source-consumed (.*); .*$/, "$1")])));
    // Slider (Foundry slot added by the slider mapping) and tag-group (mapped with its craft record) extend the ask list: their sources consume type, radius,
    // text-colour and focus tokens that the frozen contracts' allowedReads do not yet list. Both are genuine omissions of the same class as the rest.
    expect(Object.keys(omissions).sort()).toEqual(["chart-range", "chart-scatter", "chart-sparkline", "checkbox", "disclosure", "grid-list", "menu", "slider", "tabs", "toast", "tree"]);
    expect(omissions["slider"]).toBe("tokens.body-size, tokens.radius, tokens.text-color, tokens.typeface");
    // tag-group: its contract now lists the control-size and focus-outline/colour its TagGroup source consumes.
    expect(omissions["tag-group"]).toBeUndefined();
    expect(omissions["color-picker"]).toBeUndefined();
    expect(omissions["number-field"]).toBeUndefined();
  });
});
