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
  it("regenerates exactly 51 descriptors and coverage for all 51 leaves", () => {
    const files = generatedFoundrySectionFiles({ exports });
    if (process.env.UPDATE_FOUNDRY_SECTION_FILLS === "1") for (const [name, bytes] of Object.entries(files)) writeFileSync(resolve(directory, name), bytes);
    expect(readdirSync(directory).filter(name => name.startsWith("sections.") && name.endsWith(".json")).sort()).toEqual(Object.keys(files).sort());
    for (const [name, bytes] of Object.entries(files)) expect(readFileSync(resolve(directory, name), "utf8"), name).toBe(bytes);
    expect(imported().fills).toHaveLength(51);
    expect(imported().coverage.map(row => row.slot)).toEqual(slots.map(slot => slot.id).sort());
    expect(imported().coverage).toHaveLength(51);
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
      expect(descriptor.reads).toEqual({ tokens: descriptor.consumption.scannedReads.tokens, assets: descriptor.consumption.scannedReads.assets });
      expect(descriptor.composes).toEqual(descriptor.consumption.scannedComposes);
      expect(descriptor.consumption.scanStatus).toBe("lower-bound");
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
    ].map(leaf => `sections.${leaf}`));
    const docs = imported().fills.flatMap(doc => Object.values(doc.sections));
    for (const name of ["EventItem", "Stat", "UsageMeter", "Items"]) expect(docs.some(doc => doc.impl.export === name)).toBe(false);
    expect(docs.find(doc => doc.slot === "sections.comparison")!.configs).toEqual({ arrangement: "grid" });
  });

  it("maps the comparison library-board member and controls records to the real Matrix library-board API", () => {
    const row = imported().coverage.find(candidate => candidate.slot === "sections.comparison")!;
    expect(row).toMatchObject({ status: "candidate", supportedSlots: ["columns", "controls", "highlight", "rows"], missingSlots: [], supportedMembers: ["arrangement.library-board"], missingMembers: [] });
    const doc = imported().fills.find(candidate => candidate.$extensions["com.clossys.fill"].slot === "sections.comparison")!;
    expect(doc.$extensions["com.clossys.fill"].relation).toBe("same-contract");
    expect(doc.$extensions["com.clossys.fill"]).not.toHaveProperty("unmapped");
    expect(doc.sections.comparison!.slotMap.controls).toBe("./blocks#Matrix.records.controls");
    expect(doc.sections.comparison!.propMap["arrangement.library-board"]).toBe("./blocks#Matrix.arrangement=library-board");
    // The bindings name real public API: LIBRARY_BOARD_CONFIG selects arrangement=library-board and LibraryBoardRecords carries controls.
    const matrix = readFileSync(resolve(here, "../blocks/Matrix.tsx"), "utf8");
    expect(matrix).toContain('LIBRARY_BOARD_CONFIG = { id: "library-board", members: ["arrangement.library-board"], props: { arrangement: "library-board" } }');
    expect(readFileSync(resolve(here, "../blocks/library-board/model.ts"), "utf8")).toMatch(/interface LibraryBoardRecords \{[\s\S]*readonly controls:/);
  });

  it("gives consent, error-state, stats, data-grid, cards, call-to-action, notices and gallery a Foundry export with every required slot mapped", () => {
    const rows = new Map(imported().coverage.map(row => [row.slot, row]));
    const exportOf = (leaf: string) => Object.values(imported().fills.find(doc => doc.$extensions["com.clossys.fill"].slot === `sections.${leaf}`)!.sections)[0]!.impl.export;
    expect(Object.fromEntries(["consent", "error-state", "stats", "data-grid", "cards", "call-to-action", "notices", "gallery"].map(leaf => [leaf, exportOf(leaf)]))).toEqual({
      consent: "ConsentBanner", "error-state": "ErrorState", stats: "StatGroup", "data-grid": "DataTable", cards: "RecordCards", "call-to-action": "CallToAction", notices: "NoticeList", gallery: "Gallery",
    });
    for (const leaf of ["consent", "error-state", "stats", "data-grid", "cards", "call-to-action", "notices", "gallery"]) expect(rows.get(`sections.${leaf}`)!.missingRequiredSlots, leaf).toEqual([]);
    for (const leaf of ["consent", "error-state", "stats", "cards", "call-to-action", "gallery"]) expect(rows.get(`sections.${leaf}`)!.status, leaf).toBe("candidate");
    expect(rows.get("sections.notices")).toMatchObject({ status: "subset", missingMembers: ["legal.draft"] });
    expect(rows.get("sections.data-grid")!.missingSlots).toEqual([]);
    expect(FOUNDRY_SECTION_MAP["data-grid"]!.slotMap.pinning).toBe("./blocks#DataTable.model.pinnedColumns");
  });

  it("maps activity-feed, audit-log, timeline and usage to their list blocks with every content slot", () => {
    const docs = new Map(imported().fills.flatMap(doc => Object.values(doc.sections)).map(doc => [doc.slot, doc]));
    const rows = new Map(imported().coverage.map(row => [row.slot, row]));
    expect(Object.fromEntries(["activity-feed", "audit-log", "timeline", "usage"].map(leaf => [leaf, [docs.get(`sections.${leaf}`)!.impl.export, docs.get(`sections.${leaf}`)!.slotMap]]))).toEqual({
      "activity-feed": ["ActivityFeed", { events: "./blocks#ActivityFeed.events", filters: "./blocks#ActivityFeed.filters", grouping: "./blocks#ActivityFeed.groups" }],
      "audit-log": ["AuditLog", { entries: "./blocks#AuditLog.entries", export: "./blocks#AuditLog.exportAction", filter: "./blocks#AuditLog.filter" }],
      timeline: ["Timeline", { events: "./blocks#Timeline.events" }],
      usage: ["UsageSummary", { meters: "./blocks#UsageSummary.meters" }],
    });
    for (const leaf of ["activity-feed", "audit-log", "timeline", "usage"]) expect(rows.get(`sections.${leaf}`)!.status, leaf).toBe("candidate");
  });

  it("does not infer absent APIs from contract names or matching legacy labels", () => {
    const rows = new Map(imported().coverage.map(row => [row.slot, row]));
    expect(rows.get("sections.band")!.missingMembers).toEqual([]);
    expect(rows.get("sections.band")!.unresolvedMemberAxes).toEqual(["rhythm"]);
    expect(rows.get("sections.pagination")!.missingMembers).toEqual(["mode.cursor", "mode.load-more"]);
    expect(rows.get("sections.section-header")!.supportedMembers).toEqual(["align.center", "align.start", "density.compact", "density.display", "density.standard"]);
    expect(rows.get("sections.hero")!.missingRequiredSlots).toEqual([]);
    expect(rows.get("sections.page-header")!.missingMembers).toEqual(["config.record", "config.standard", "contact.header"]);
    expect(rows.get("sections.features")!.missingMembers).toEqual(["about.features"]);
    expect(rows.get("sections.faq")!.missingMembers).toEqual(["about.faq"]);
    expect(rows.get("sections.article")!.missingSlots).toEqual([]);
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
    expect(source("Hero.tsx")).toContain('import { HeroIntro } from "./hero/HeroIntro.js"');
    expect(source("Hero.tsx")).toMatch(/<HeroIntro[\s\S]*heading=[\s\S]*description=\{description\}[\s\S]*actions=\{actions\}/);
    const heroIntro = source("hero/HeroIntro.tsx");
    expect(heroIntro).toContain('import { SemanticContent } from "../../components/SemanticContent.js"');
    expect(heroIntro).toMatch(/<SemanticContent as=\{HeadingTag\}[\s\S]*\{heading\}[\s\S]*<\/SemanticContent>/);
    expect(heroIntro).toMatch(/<SemanticContent as="p"[\s\S]*\{description\}[\s\S]*<\/SemanticContent>/);
    expect(heroIntro).toMatch(/data-section-intro-actions=""[\s\S]*\{actions\}/);
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
