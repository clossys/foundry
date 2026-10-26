import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import sectionSlots from "../catalog/slots/sections.json" with { type: "json" };
import type { SectionSlot } from "../catalog-core/sections-contract.js";
import {
  FOUNDRY_SECTION_MAP, generatedFoundrySectionFiles, importFoundrySections,
} from "./foundry-sections.js";

const here = dirname(fileURLToPath(import.meta.url));
const directory = resolve(here, "../catalog/fills/foundry");
const barrel = readFileSync(resolve(here, "../blocks/index.ts"), "utf8");
const exports = [...barrel.matchAll(/export\s*\{([^}]+)\}/g)].flatMap(match => match[1]!.split(",").map(binding => binding.trim().split(/\s+as\s+/).at(-1)!));
const slots = sectionSlots as unknown as readonly SectionSlot[];
const imported = () => importFoundrySections({ exports });
const change = (leaf: string, patch: Partial<(typeof FOUNDRY_SECTION_MAP)[string]>) => ({ ...FOUNDRY_SECTION_MAP, [leaf]: { ...FOUNDRY_SECTION_MAP[leaf]!, ...patch } });

describe("Foundry section package descriptors", () => {
  it("regenerates exactly 30 descriptors and coverage for all 45 leaves", () => {
    const files = generatedFoundrySectionFiles({ exports });
    if (process.env.UPDATE_FOUNDRY_SECTION_FILLS === "1") for (const [name, bytes] of Object.entries(files)) writeFileSync(resolve(directory, name), bytes);
    expect(readdirSync(directory).filter(name => name.startsWith("sections.") && name.endsWith(".json")).sort()).toEqual(Object.keys(files).sort());
    for (const [name, bytes] of Object.entries(files)) expect(readFileSync(resolve(directory, name), "utf8"), name).toBe(bytes);
    expect(imported().fills).toHaveLength(30);
    expect(imported().coverage.map(row => row.slot)).toEqual(slots.map(slot => slot.id).sort());
    expect(imported().coverage).toHaveLength(45);
    expect(generatedFoundrySectionFiles({ exports, slots: [...slots].reverse() })).toEqual(files);
  });

  it("pins public package pointers without source copying or conformance claims", () => {
    for (const doc of imported().fills) {
      const meta = doc.$extensions["com.clossys.fill"];
      const descriptor = Object.values(doc.sections)[0]!;
      expect(exports).toContain(descriptor.impl.export);
      expect(meta.pin).toEqual({ package: "@clossys/designer", version: "0.12.0", export: `./blocks#${descriptor.impl.export}` });
      expect(descriptor.impl).toEqual({ kind: "package", module: "@clossys/designer/blocks", export: descriptor.impl.export });
      expect(meta.status).toBe("draft");
      expect(meta.originKinds).toEqual(["adopted"]);
      expect(meta.conforms).toEqual([]);
      expect(meta.evidence).toEqual([]);
      expect(descriptor).not.toHaveProperty("observations");
      expect(descriptor).not.toHaveProperty("measurements");
      expect(descriptor).not.toHaveProperty("reads");
      expect(descriptor).not.toHaveProperty("files");
      expect(descriptor.notes.join(" ")).toContain("unmeasured");
    }
  });

  it("accounts for content slots, closed members and unresolved axes independently", () => {
    for (const row of imported().coverage) {
      const slot = slots.find(slot => slot.id === row.slot)!;
      expect([...row.supportedMembers, ...row.missingMembers].sort()).toEqual([...slot.contract.members.names].sort());
      expect([...row.supportedSlots, ...row.missingSlots].sort()).toEqual(slot.contract.slots.map(item => item.name).sort());
      expect(row.supportedMembers.some(member => row.missingMembers.includes(member))).toBe(false);
      expect(row.supportedSlots.some(name => row.missingSlots.includes(name))).toBe(false);
      expect(row.missingRequiredSlots).toEqual(slot.contract.slots.filter(item => item.required && row.missingSlots.includes(item.name)).map(item => item.name).sort());
      expect(row.unresolvedMemberAxes).toEqual([...(slot.contract.unresolvedMemberAxes ?? [])].sort());
      const doc = imported().fills.find(fill => fill.$extensions["com.clossys.fill"].slot === row.slot);
      if (!doc) { expect(row.status).toBe("unavailable"); continue; }
      const descriptor = Object.values(doc.sections)[0]!;
      expect(Object.keys(descriptor.slotMap).sort()).toEqual(row.supportedSlots);
      expect(Object.keys(descriptor.propMap).sort()).toEqual(row.supportedMembers);
      expect(row.status).toBe(row.missingSlots.length || row.missingMembers.length || row.unresolvedMemberAxes.length ? "subset" : "candidate");
      expect(doc.$extensions["com.clossys.fill"].relation).toBe(row.status === "subset" ? "subset" : "same-contract");
    }
  });

  it("keeps unavailable sections and aggregate recipes explicit", () => {
    expect(imported().coverage.filter(row => row.status === "unavailable").map(row => row.slot)).toEqual([
      "activity-feed", "audit-log", "call-to-action", "cards", "consent", "data-grid", "error-state", "filter-builder", "gallery", "notices", "settings", "stats", "timeline", "usage", "wizard",
    ].map(leaf => `sections.${leaf}`));
    const docs = imported().fills.flatMap(doc => Object.values(doc.sections));
    for (const name of ["EventItem", "Stat", "UsageMeter", "Items"]) expect(docs.some(doc => doc.impl.export === name)).toBe(false);
    expect(docs.find(doc => doc.slot === "sections.comparison")!.configs).toEqual({ arrangement: "grid" });
  });

  it("does not infer absent APIs from contract names or matching legacy labels", () => {
    const rows = new Map(imported().coverage.map(row => [row.slot, row]));
    expect(rows.get("sections.band")!.missingMembers).toContain("ground.transparent");
    expect(rows.get("sections.band")!.unresolvedMemberAxes).toEqual(["rhythm"]);
    expect(rows.get("sections.pagination")!.missingMembers).toEqual(["mode.cursor", "mode.load-more"]);
    expect(rows.get("sections.section-header")!.supportedMembers).toEqual([]);
    expect(rows.get("sections.hero")!.missingRequiredSlots).toEqual([]);
    expect(rows.get("sections.page-header")!.missingMembers).toEqual(["config.record", "config.standard"]);
    expect(rows.get("sections.features")!.missingMembers).toEqual(["layout.list", "layout.split"]);
    expect(rows.get("sections.faq")!.missingMembers).toEqual(["layout.two-column"]);
    expect(rows.get("sections.logo-cloud")!.missingMembers).toEqual([]);
    expect(rows.get("sections.testimonials")!.missingMembers).toEqual([]);
    expect(rows.get("sections.chat")!.missingMembers).toEqual(["part.attachment", "part.questionnaire", "part.trace"]);
    expect(rows.get("sections.empty-state")!.supportedMembers).toEqual([]);
  });

  it("binds mappings to actual source props and keeps anatomy declarations empty", () => {
    for (const mapping of Object.values(FOUNDRY_SECTION_MAP)) {
      const source = mapping.propFiles.map(path => readFileSync(resolve(here, "../blocks", path), "utf8")).join("\n");
      for (const pointer of [...Object.values(mapping.slotMap), ...Object.values(mapping.propMap)]) {
        const target = /^\.\/blocks#[A-Za-z][A-Za-z0-9]*\.([A-Za-z][A-Za-z0-9]*)/.exec(pointer);
        expect(target, pointer).not.toBeNull();
        expect(source, pointer).toMatch(new RegExp(`\\b${target![1]}\\??\\s*:`));
      }
    }
    for (const doc of imported().fills.flatMap(fill => Object.values(fill.sections))) {
      expect(doc.parts).toEqual([]);
      expect(doc.notes.join(" ")).toContain("anatomy");
    }
  });

  it("maps every required region to the block part that implements it, and records which are built in", () => {
    const rows = new Map(imported().coverage.map(row => [row.slot, row]));
    for (const leaf of ["chat", "explorer", "hero", "newsletter"]) expect(rows.get(`sections.${leaf}`)!.missingRequiredSlots, leaf).toEqual([]);
    expect(FOUNDRY_SECTION_MAP.chat!.slotMap.composer).toBe("./blocks#Chat.onSend");
    expect(FOUNDRY_SECTION_MAP.explorer!.slotMap.list).toBe("./blocks#Explorer.list");
    expect(FOUNDRY_SECTION_MAP.hero!.slotMap.header).toBe("./blocks#Hero.heading");
    expect(FOUNDRY_SECTION_MAP.newsletter!.slotMap.email).toBe("./blocks#NewsletterBand.emailLabel");
    const source = (path: string) => readFileSync(resolve(here, "../blocks", path), "utf8");
    // Built-in regions: the block renders the contract's composed component itself.
    expect(source("chat/Chat.tsx")).toMatch(/<Textarea label=\{composerLabel\}/);
    expect(source("NewsletterBand.tsx")).toMatch(/<TextField\s+type="email"/);
    expect(source("Hero.tsx")).toMatch(/<SectionIntro[\s\S]*heading=/);
    // The list pane is a host region the Explorer lays out beside its tree.
    expect(source("Explorer.tsx")).toMatch(/list\?: ReactNode/);
    for (const leaf of ["chat", "hero", "newsletter"]) expect(FOUNDRY_SECTION_MAP[leaf]!.notes!.join(" "), leaf).toMatch(/built.in/i);
  });

  it("grounds fixed layouts and data-count members in source branches", () => {
    const source = (path: string) => readFileSync(resolve(here, "../blocks", path), "utf8");
    expect(source("LogoCloud.tsx")).toContain("Object.hasOwn(COLUMN_CLASSES, items.length)");
    for (const count of [3, 4, 6, 8, 12]) expect(source("LogoCloud.tsx")).toMatch(new RegExp(`\\b${count}:`));
    expect(source("TestimonialSet.tsx")).toContain("Object.hasOwn(COUNT_CLASSES, items.length)");
    expect(source("TestimonialSet.tsx")).toContain('1: "mx-auto');
    for (const count of [2, 3, 4, 6]) expect(source("TestimonialSet.tsx")).toMatch(new RegExp(`\\b${count}: "grid`));
    expect(source("items/compat-features.tsx")).toContain("grid grid-cols-1");
    expect(source("items/compat-nav.tsx")).toContain("grid grid-cols-1");
    expect(source("Faq.server.tsx")).toContain('list: "flex flex-col');
    expect(source("Matrix.tsx")).toContain('arrangement: "grid"');
  });

  it("kills missing-export and invented-member mutants", () => {
    expect(() => importFoundrySections({ exports: exports.filter(name => name !== "Hero") })).toThrow("unavailable package export");
    expect(() => importFoundrySections({ exports, mappings: change("hero", { export: "AbsentHero" }) })).toThrow("unavailable package export");
    expect(() => importFoundrySections({ mappings: change("hero", { propMap: { "layout.invented": "./blocks#Hero.composition=invented" } }) })).toThrow("unknown or empty member");
  });

  it("rejects unknown, blank, foreign, orphan and duplicate bindings", () => {
    expect(() => importFoundrySections({ mappings: change("hero", { slotMap: { invented: "./blocks#Hero.heading" } }) })).toThrow("unknown or empty content slot");
    expect(() => importFoundrySections({ mappings: change("hero", { slotMap: { header: "" } }) })).toThrow("unknown or empty content slot");
    expect(() => importFoundrySections({ mappings: change("hero", { propMap: { "layout.split": "./shell#Hero.composition=split" } }) })).toThrow("invalid package pointer");
    expect(() => importFoundrySections({ mappings: { ...FOUNDRY_SECTION_MAP, invented: FOUNDRY_SECTION_MAP.hero! } })).toThrow("mapping has no contract");
    expect(() => importFoundrySections({ slots: [...slots, slots[0]!] })).toThrow("invalid or duplicate slot");
  });
});
