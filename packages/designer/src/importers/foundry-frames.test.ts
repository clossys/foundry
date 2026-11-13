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

  it("accounts for exactly eleven leaves and regenerates committed bytes", () => {
    const files = generatedFoundryFrameFiles({ exports });
    if (process.env.UPDATE_FOUNDRY_FRAME_FILLS === "1") for (const [name, bytes] of Object.entries(files)) writeFileSync(resolve(directory, name), bytes);
    expect(readdirSync(directory).filter(name => /^frames\..*\.json$/.test(name)).sort()).toEqual(Object.keys(files).sort());
    for (const [name, bytes] of Object.entries(files)) expect(readFileSync(resolve(directory, name), "utf8"), name).toBe(bytes);
    expect(result().coverage.map(row => row.slot)).toEqual(slots.map(slot => slot.id).sort());
    expect(result().coverage).toHaveLength(11);
    expect(result().fills).toHaveLength(11);
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
    expect(rows.get("frames.inspector")).toMatchObject({ status: "candidate", supported: ["presentation.collapsed", "presentation.docked", "presentation.overlay"], missingSlots: [], missingRequiredSlots: [], missingStatePorts: [] });
    expect(rows.get("frames.app-shell")!.missing).toEqual([]);
    expect(FOUNDRY_FRAME_MAP["app-shell"]!.members).toMatchObject({ "layout.immersive": "layout=immersive", "stage.full": "stage=full" });
    expect(FOUNDRY_FRAME_MAP["app-shell"]!.slots.header).toBe("context");
    expect(readFileSync(resolve(here, "../frames/app-frame-types.ts"), "utf8")).toMatch(/layout\?: AppFrameLayout;[\s\S]*stage\?: AppFrameStage;/);
    expect(rows.get("frames.site-shell")!.missingSlots).toEqual(["consent", "progress"]);
    expect(rows.get("frames.app-header")!.missingSlots).toEqual([]);
    expect(rows.get("frames.app-header")!.missing).toEqual([]);
    expect(rows.get("frames.command")!.missingRequiredSlots).toEqual([]);
    for (const leaf of ["app-shell", "command"]) expect(rows.get(`frames.${leaf}`)!.missingStatePorts, leaf).toEqual([]);
    expect(rows.get("frames.app-sidebar")!.missingStatePorts).toEqual([]);
    expect(rows.get("frames.command")!.missing).toEqual(["shortcut.off", "shortcut.on"]);
  });
  it("maps the app-header context slot and glass/opaque surface, and the site-shell toasts slot, to named public props", () => {
    const rows = new Map(result().coverage.map(row => [row.slot, row]));
    expect(FOUNDRY_FRAME_MAP["app-header"]!.slots.context).toBe("context");
    expect(FOUNDRY_FRAME_MAP["app-header"]!.members["surface.glass"]).toBe("surface=glass");
    expect(FOUNDRY_FRAME_MAP["app-header"]!.members["fallback.opaque"]).toBe("surface=glass");
    expect(FOUNDRY_FRAME_MAP["site-shell"]!.slots.toasts).toBe("toasts");
    expect(rows.get("frames.app-header")!.supported).toEqual(["fallback.opaque", "position.static", "position.sticky", "surface.glass"]);
    expect(rows.get("frames.app-header")!.status).toBe("candidate");
    const pageBar = readFileSync(resolve(here, "../blocks/PageBar.tsx"), "utf8");
    expect(pageBar).toContain('surface?: "solid" | "transparent" | "glass"');
    expect(readFileSync(resolve(here, "../../../designer/src/frames/site-frame/types.ts"), "utf8")).toContain("readonly toasts?: ReactNode");
  });

  it("keeps no descriptor note claiming a member or slot unmapped that is mapped", () => {
    for (const [leaf, mapping] of Object.entries(FOUNDRY_FRAME_MAP)) {
      const mapped = [...Object.keys(mapping.members), ...Object.keys(mapping.slots), ...Object.keys(mapping.statePorts)];
      for (const note of mapping.notes) {
        for (const name of mapped.flatMap(key => key.split("."))) {
          expect(note, `${leaf} note vs mapped ${name}`).not.toMatch(new RegExp(`\\b${name}\\b[^.]*\\b(?:remain unmapped|unmapped)\\b`, "i"));
          expect(note, `${leaf} note vs mapped ${name}`).not.toMatch(new RegExp(`\\bno\\b[^.]*\\b${name}\\b[^.]*\\bslot\\b`, "i"));
        }
      }
    }
  });

  it("pins supported configurations to named public API members", () => {
    const rows = new Map(result().coverage.map(row => [row.slot, row]));
    expect(rows.get("frames.sheet")!.supported).toEqual(["placement.bottom", "placement.end", "placement.start", "wide.dismiss", "wide.sheet"]);
    expect(rows.get("frames.site-header")!.supported).toEqual(["nav-placement.centered", "nav-placement.leading", "position.static", "position.sticky", "surface.glass", "surface.solid", "surface.transparent", "tone.base", "tone.inverse"]);
    expect(FOUNDRY_FRAME_MAP["app-header"]!.slots).not.toHaveProperty("brand");
    expect(FOUNDRY_FRAME_MAP["app-header"]!.slots.trail).toBe("page.breadcrumb");
    expect(FOUNDRY_FRAME_MAP["site-shell"]!.slots["skip-link"]).toBe("shell.skipLink");
    const drawer = readFileSync(resolve(here, "../blocks/Drawer.tsx"), "utf8");
    expect(drawer).toContain('placement?: "start" | "end" | "bottom"');
    expect(drawer).toContain('wide?: "dismiss" | "sheet"');
    const pageBar = readFileSync(resolve(here, "../blocks/PageBar.tsx"), "utf8");
    expect(pageBar).not.toContain("brand?: ReactNode");
    expect(pageBar).toContain("context?: ReactNode");
    expect(pageBar).toContain("breadcrumb?: readonly PageBarCrumb[]");
    const theme = readFileSync(resolve(here, "../theme/ThemeProvider.tsx"), "utf8");
    expect(theme).toContain("defaultPreference?: ThemePreference");
    expect(FOUNDRY_FRAME_MAP["app-shell"]!.members["theme.dark"]).toBe("theme.defaultPreference=dark");
  });
  it("owns every app-shell and command state port and the command search slot through named public props", () => {
    const read = (path: string) => readFileSync(resolve(here, path), "utf8");
    expect(FOUNDRY_FRAME_MAP["app-shell"]!.statePorts.width).toBe("rightPanel.value/rightPanel.onChange");
    expect(read("../frames/app-frame-types.ts")).toMatch(/value\?: number;[\s\S]*onChange\?: \(value: number\) => void;/);
    expect(FOUNDRY_FRAME_MAP["app-shell"]!.statePorts.theme).toBe("theme.preference/theme.onPreferenceChange");
    expect(read("../theme/ThemeProvider.tsx")).toContain("preference?: ThemePreference;");
    expect(read("../theme/ThemeProvider.tsx")).toContain("onPreferenceChange?: (preference: ThemePreference) => void;");
    expect(read("../frames/AppFrame.tsx")).toMatch(/<ThemeProvider[^>]*preference=\{props\.theme\?\.preference\}[^>]*onPreferenceChange=\{props\.theme\?\.onPreferenceChange\}/);
    expect(FOUNDRY_FRAME_MAP["app-sidebar"]!.statePorts.theme).toBeUndefined();
    // The app shell owns theme state; the sidebar contract declares no theme port, so its descriptor owns every port it has.
    const contract = (id: string) => (slots as unknown as FrameSlot[]).find(slot => slot.id === id)!.contract;
    expect(contract("frames.app-sidebar").statePorts.map(port => port.id)).toEqual(["collapsed"]);
    expect(contract("frames.app-shell").statePorts.map(port => port.id)).toContain("theme");
    expect(result().coverage.find(row => row.slot === "frames.app-sidebar")).toMatchObject({ status: "subset", missingSlots: ["account", "theme"], missingStatePorts: [], missingRequiredSlots: [] });
    expect(FOUNDRY_FRAME_MAP.command!.slots.search).toBe("searchLabel");
    expect(read("../blocks/command-menu-types.ts")).toMatch(/searchLabel: string/);
    expect(read("../blocks/CommandMenu.tsx")).toMatch(/<SearchField label=\{searchLabel\} value=\{query\} onChange=\{onQueryChange\}/);
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

it("maps scroll page regions, progress and main-state to public AppFrame props", () => {
  const mapping = FOUNDRY_FRAME_MAP["app-shell"]!;
  expect(mapping.slots).toMatchObject({ "page-module": "pageModule", progress: "progress", state: "stateViews" });
  expect(mapping.statePorts).toMatchObject({ navigating: "state.navigating", "main-state": "state.main" });
  const row = result().coverage.find(row => row.slot === "frames.app-shell")!;
  expect(row.missingSlots).toEqual([]);
  expect(row.missingStatePorts).toEqual([]);
});
