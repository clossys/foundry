import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import componentSlots from "../catalog/slots/components.json" with { type: "json" };
import tokenSlots from "../catalog/slots/themes.json" with { type: "json" };
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
  it("reads an interpolated shadow size as the whole shadow slot, not as nothing", () => {
    expect(foundrySourceTokenReads("const s = (size) => `var(--shadow-${size})`;", index)).toEqual(["themes.shadow"]);
    expect(foundrySourceTokenReads("style={{ boxShadow: \"var(--shadow-xl)\" }}", index)).toEqual(["themes.shadow"]);
  });
  it("substitutes shared string constants and ignores a fallback var() nested inside the outer read", () => {
    const ring = { RING: "var(--ring, 0 0 0 2px var(--accent, oklch(0.4748 0 0)))" };
    expect(foundrySourceTokenReads("boxShadow: isFocusVisible ? RING : undefined", index, ring)).toEqual(["themes.ring"]);
  });
  it("maps named utilities through their theme namespace, past variant prefixes", () => {
    expect(foundrySourceTokenReads("<Label className=\"font-sans hover:shadow-md tracking-tight\" />", index))
      .toEqual(["themes.font-sans", "themes.shadow", "themes.tracking-tight"]);
  });
  it("declares every themes slot a controls-group Foundry fill's source consumes: TagGroup reads its focus ring", () => {
    const tagGroup = importFoundryComponents({ slots: componentSlots as unknown as readonly ComponentSlot[] }).fills.find(fill => fill.$extensions["com.clossys.fill"].slot === "components.tag-group")!;
    const reads = Object.values(tagGroup.components)[0]!.reads.themes;
    for (const read of derived()["tag-group"]!) expect(reads).toContain(read);
    expect(reads).toEqual(expect.arrayContaining(["themes.ring", "themes.radius", "themes.spacing"]));
  });
  it("commits the derivation for every mapped component (UPDATE_FOUNDRY_COMPONENT_FILLS=1 rewrites it)", () => {
    const bytes = JSON.stringify(derived(), null, 2) + "\n";
    if (process.env.UPDATE_FOUNDRY_COMPONENT_FILLS === "1") writeFileSync(resolve(here, "foundry-source-reads.json"), bytes);
    expect(readFileSync(resolve(here, "foundry-source-reads.json"), "utf8")).toBe(bytes);
  });
  it("color-picker and number-field fills carry every themes slot their source consumes, so neither offer is blocked", () => {
    const reads = derived();
    for (const leaf of ["color-picker", "number-field"]) {
      const doc = importFoundryComponents().fills.find(fill => fill.$extensions["com.clossys.fill"].slot === `components.${leaf}`)!;
      const candidate = Object.values(doc.components)[0]!;
      expect(candidate.reads.themes, leaf).toEqual(expect.arrayContaining(reads[leaf]!));
      expect(candidate.reads.themes, leaf).toEqual(expect.arrayContaining(["themes.font-sans", "themes.radius", "themes.spacing"]));
      expect(candidate.blockers, leaf).toBeUndefined();
    }
  });
  it("records, without blocking, a frozen read set that omits a themes slot its source consumes", () => {
    const original = (componentSlots as unknown as ComponentSlot[]).find(row => row.id === "components.number-field")!;
    const slot = structuredClone(original);
    (slot.contract as { allowedReads: { themes: string[] } }).allowedReads.themes = slot.contract.allowedReads.themes.filter(read => read !== "themes.radius");
    const mappings = { "number-field": FOUNDRY_COMPONENT_MAP["number-field"]! };
    const result = importFoundryComponents({ slots: [slot], mappings, sourceReads: { "number-field": ["themes.radius", "themes.font-sans"] } });
    expect(result.coverage[0]!.notes).toContain("Frozen reads omit source-consumed themes.radius; the contract's allowedReads must widen before this is enforced.");
    expect(Object.values(result.fills[0]!.components)[0]!.blockers).toBeUndefined();
    const clean = importFoundryComponents({ slots: [structuredClone(original)], mappings, sourceReads: { "number-field": ["themes.radius"] } });
    expect(clean.coverage[0]!.notes.some(note => note.includes("source-consumed"))).toBe(false);
  });
  it("pins which mapped components' frozen reads still omit source-consumed themes slots (owner ASK: widen contracts, then enforce)", () => {
    const omissions = Object.fromEntries(importFoundryComponents().coverage.flatMap(row => row.notes.filter(note => note.includes("source-consumed")).map(note => [row.slot.slice(11), note.replace(/^Frozen reads omit source-consumed (.*); .*$/, "$1")])));
    // Slider (Foundry slot added by the slider mapping) extends the ask list: its source consumes type, radius and text-colour
    // themes slots that the frozen contract's allowedReads do not yet list. It is a genuine omission of the same class as the rest.
    expect(Object.keys(omissions).sort()).toEqual(["chart-range", "chart-scatter", "chart-sparkline", "checkbox", "disclosure", "menu", "slider", "toast"]);
    expect(omissions["slider"]).toBe("themes.accent-foreground, themes.card-foreground, themes.font-heading, themes.font-mono, themes.font-sans, themes.foreground, themes.muted-foreground, themes.popover-foreground, themes.primary-foreground, themes.radius, themes.secondary-foreground, themes.sidebar-accent-foreground, themes.sidebar-foreground, themes.sidebar-primary-foreground");
    // tag-group: its contract lists the focus ring its TagGroup source consumes.
    expect(omissions["tag-group"]).toBeUndefined();
    expect(omissions["color-picker"]).toBeUndefined();
    expect(omissions["number-field"]).toBeUndefined();
  });
});
