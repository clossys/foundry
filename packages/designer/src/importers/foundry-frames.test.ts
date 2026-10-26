import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { FrameSlot } from "../catalog-core/types.js";
import slots from "../catalog/slots/frames.json" with { type: "json" };
import { FOUNDRY_FRAME_MAP, type FoundryFrameMapping } from "./foundry-frames.map.js";
import { generatedFoundryFrameFiles, importFoundryFrames } from "./foundry-frames.js";
const here = dirname(fileURLToPath(import.meta.url));
const directory = resolve(here, "../catalog/fills/foundry");
const sources = {
  "@clossys/designer/shell/server": "../shell/server.ts",
  "@clossys/designer/blocks": "../blocks/index.ts",
  "@clossys/publisher/web": "../../../publisher/src/web/index.ts",
  "@clossys/designer/frames": "../frames/index.ts",
};
// Independent inventory: read actual public barrels and package export maps, never mapping values.
const exports = Object.fromEntries(Object.entries(sources).map(([module, file]) => {
  const text = readFileSync(resolve(here, file), "utf8");
  const names = [...text.matchAll(/export\s*\{([^}]+)\}/g)].flatMap(match => match[1]!.split(",").map(value => value.trim().split(/\s+as\s+/).at(-1)!));
  return [module, names];
}));
const result = () => importFoundryFrames({ exports });
const changed = (leaf: string, values: Partial<FoundryFrameMapping>) => ({ ...FOUNDRY_FRAME_MAP, [leaf]: { ...FOUNDRY_FRAME_MAP[leaf]!, ...values } });
describe("Foundry frame descriptors", () => {
  it("maps the two header position members to their actual public prop", () => {
    for (const leaf of ["app-header", "site-header"]) {
      const fill = result().fills.find(doc => doc.$extensions["com.clossys.fill"].slot === `frames.${leaf}`)!;
      const descriptor = fill.frames[leaf]!;
      expect(descriptor.propMap["position.sticky"]).toBe("position=sticky");
      expect(descriptor.propMap["position.static"]).toBe("position=static");
      expect(result().coverage.find(row => row.slot === `frames.${leaf}`)!.missing).not.toContain("position.static");
    }
  });

  it("accounts for exactly nine leaves and regenerates committed bytes", () => {
    const files = generatedFoundryFrameFiles({ exports });
    if (process.env.UPDATE_FOUNDRY_FRAME_FILLS === "1") for (const [name, bytes] of Object.entries(files)) writeFileSync(resolve(directory, name), bytes);
    expect(readdirSync(directory).filter(name => /^frames\..*\.json$/.test(name)).sort()).toEqual(Object.keys(files).sort());
    for (const [name, bytes] of Object.entries(files)) expect(readFileSync(resolve(directory, name), "utf8"), name).toBe(bytes);
    expect(result().coverage.map(row => row.slot)).toEqual(slots.map(slot => slot.id).sort());
    expect(result().coverage).toHaveLength(9);
    expect(result().fills).toHaveLength(8);
    expect(generatedFoundryFrameFiles({ slots: [...slots].reverse() as unknown as readonly FrameSlot[], exports })).toEqual(files);
  });
  it("pins independently available public exports at actual manifest versions", () => {
    for (const doc of result().fills) {
      const meta = doc.$extensions["com.clossys.fill"];
      const fill = Object.values(doc.frames)[0]!;
      const packageName = meta.pin!.package!;
      const packageDir = packageName.endsWith("designer") ? "designer" : "publisher";
      const manifest = JSON.parse(readFileSync(resolve(here, `../../../${packageDir}/package.json`), "utf8"));
      expect(meta.pin!.version).toBe(manifest.version);
      const subpath = fill.impl.module.slice(packageName.length + 1);
      expect(manifest.exports).toHaveProperty(`./${subpath}`);
      expect(exports[fill.impl.module]).toContain(fill.impl.export);
      expect(meta.pin!.export).toBe(`./${subpath}#${fill.impl.export}`);
      expect(meta.evidence).toEqual([]);
      expect(meta.conforms).toEqual([]);
      expect(fill).not.toHaveProperty("landmarks");
      expect(fill).not.toHaveProperty("rac");
      expect(fill).not.toHaveProperty("measurements");
    }
  });
  it("partitions members and every slot/state port without claiming missing anatomy", () => {
    for (const row of result().coverage) {
      const contract = slots.find(slot => slot.id === row.slot)!.contract;
      expect([...row.supported, ...row.missing].sort()).toEqual([...contract.members.names].sort());
      expect(row.supported.some(member => row.missing.includes(member))).toBe(false);
      const fill = result().fills.find(doc => doc.$extensions["com.clossys.fill"].slot === row.slot);
      const descriptor = fill && Object.values(fill.frames)[0]!;
      expect([...Object.keys(descriptor?.slots ?? {}), ...row.missingSlots].sort()).toEqual(contract.slots.map(item => item.id).sort());
      expect([...Object.keys(descriptor?.statePorts ?? {}), ...row.missingStatePorts].sort()).toEqual(contract.statePorts.map(item => item.id).sort());
      expect(row.missingRequiredSlots).toEqual(contract.slots.filter(item => item.required && row.missingSlots.includes(item.id)).map(item => item.id).sort());
      if (fill) expect(fill.$extensions["com.clossys.fill"].relation).toBe(row.missing.length + row.missingSlots.length + row.missingStatePorts.length ? "subset" : "same-contract");
    }
    const rows = new Map(result().coverage.map(row => [row.slot, row]));
    expect(rows.get("frames.inspector")).toMatchObject({ status: "unavailable", supported: [], missingRequiredSlots: ["content"] });
    expect(rows.get("frames.app-shell")!.missing).toEqual(["layout.immersive", "layout.standard", "stage.contained", "stage.full"]);
    expect(rows.get("frames.site-shell")!.missingSlots).toContain("toasts");
    expect(rows.get("frames.app-header")!.missingSlots).toContain("context");
    expect(rows.get("frames.command")!.missingRequiredSlots).toContain("search");
    expect(rows.get("frames.command")!.missing).toEqual(["shortcut.off", "shortcut.on"]);
  });
  it("pins supported configurations to named public API members", () => {
    const rows = new Map(result().coverage.map(row => [row.slot, row]));
    expect(rows.get("frames.sheet")!.supported).toEqual(["placement.bottom", "placement.end", "placement.start", "wide.dismiss", "wide.sheet"]);
    expect(rows.get("frames.site-header")!.supported).toEqual(["nav-placement.centered", "nav-placement.leading", "position.static", "position.sticky", "surface.glass", "surface.solid", "surface.transparent", "tone.base", "tone.inverse"]);
    expect(FOUNDRY_FRAME_MAP["app-header"]!.slots.brand).toBe("brand");
    expect(FOUNDRY_FRAME_MAP["app-header"]!.slots.trail).toBe("page.breadcrumb");
    expect(FOUNDRY_FRAME_MAP["site-shell"]!.slots["skip-link"]).toBe("shell.skipLink");
    const drawer = readFileSync(resolve(here, "../blocks/Drawer.tsx"), "utf8");
    expect(drawer).toContain('placement?: "start" | "end" | "bottom"');
    expect(drawer).toContain('wide?: "dismiss" | "sheet"');
    const pageBar = readFileSync(resolve(here, "../blocks/PageBar.tsx"), "utf8");
    expect(pageBar).toContain("brand?: ReactNode");
    expect(pageBar).toContain("breadcrumb?: readonly PageBarCrumb[]");
    const theme = readFileSync(resolve(here, "../theme/ThemeProvider.tsx"), "utf8");
    expect(theme).toContain("defaultPreference?: ThemePreference");
    expect(FOUNDRY_FRAME_MAP["app-shell"]!.members["theme.dark"]).toBe("theme.defaultPreference=dark");
  });
  it("rejects export and contract-member mutations", () => {
    expect(() => importFoundryFrames({ exports, mappings: changed("sheet", { export: "AbsentDrawer" }) })).toThrow("unavailable package export");
    expect(() => importFoundryFrames({ exports: { ...exports, "@clossys/designer/frames": [] } })).toThrow("unavailable package export");
    expect(() => importFoundryFrames({ mappings: changed("sheet", { members: { "placement.invented": "placement=invented" } }) })).toThrow("unknown or empty member");
    expect(() => importFoundryFrames({ mappings: changed("sheet", { members: { "placement.start": "" } }) })).toThrow("unknown or empty member");
    expect(() => importFoundryFrames({ mappings: changed("sheet", { slots: { invented: "children" } }) })).toThrow("unknown or empty slot");
    expect(() => importFoundryFrames({ mappings: changed("sheet", { statePorts: { invented: "isOpen" } }) })).toThrow("unknown or empty state port");
    expect(() => importFoundryFrames({ mappings: { ...FOUNDRY_FRAME_MAP, invented: FOUNDRY_FRAME_MAP.sheet! } })).toThrow("mapping has no contract");
  });
  it("keeps a removed required member and slot visible as subset gaps", () => {
    const { "placement.start": removed, ...members } = FOUNDRY_FRAME_MAP.sheet!.members;
    const mutant = importFoundryFrames({ mappings: changed("sheet", { members, slots: {} }) });
    expect(removed).toBe("placement=start");
    expect(mutant.coverage.find(row => row.slot === "frames.sheet")).toMatchObject({ status: "subset", missing: ["placement.start"], missingRequiredSlots: ["body", "heading"] });
    expect(mutant.fills.find(doc => doc.$extensions["com.clossys.fill"].slot === "frames.sheet")!.$extensions["com.clossys.fill"].unmapped).toContain("slot.heading");
  });
});
