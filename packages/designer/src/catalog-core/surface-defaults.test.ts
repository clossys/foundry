/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import frameSlots from "../catalog/slots/frames.json" with { type: "json" };
import sectionCoverage from "../catalog/fills/foundry/sections.coverage.json" with { type: "json" };
import frameCoverage from "../catalog/fills/foundry/frames.coverage.json" with { type: "json" };
import { importFoundrySections } from "../importers/foundry-sections.js";
import { importFoundryFrames } from "../importers/foundry-frames.js";
import { loadSectionRegistry } from "./sections-contract.js";
import { loadCatalog } from "./index.js";
import { loadComponentRegistry } from "./component-registry.js";
import { applyLibraryChange, libraryHash } from "./api.js";
import { planSurfaceDefaults, type SurfaceDefaultCandidateDocument, type SurfaceDefaultsInput } from "./surface-defaults.js";
import type { CompositeCatalogData, CompositeLibraryData, FrameSlot } from "./types.js";

/** The real catalog: every Sections and Frames contract and every Foundry surface candidate. */
function setup(overrides: Partial<SurfaceDefaultsInput> = {}) {
  const slots = [...loadSectionRegistry().slots, ...structuredClone(frameSlots) as unknown as FrameSlot[]];
  const fills: SurfaceDefaultCandidateDocument[] = [...importFoundrySections().fills, ...importFoundryFrames().fills];
  const input: SurfaceDefaultsInput = { catalog: { slots, fills }, slots: slots.map(slot => slot.id), preference: ["foundry"], ...overrides };
  return input;
}
const ledger = (plan: ReturnType<typeof planSurfaceDefaults>) => Object.fromEntries(plan.rows.map(row => [row.slot, row.status === "not-chosen" ? "-" : row.source!]));
const reasons = (plan: ReturnType<typeof planSurfaceDefaults>, slot: string) => plan.rows.find(row => row.slot === slot)!.reasons.join(" || ");

const SECTION_DEFAULTS = ["access-matrix", "activity-feed", "article", "audit-log", "band", "call-to-action", "cards", "column-mapper", "comparison", "consent", "content", "data-grid",
  "data-table", "empty-state", "error-state", "faq", "features", "filter-builder", "form", "gallery", "link-index", "logo-cloud", "media", "notices", "page-header",
  "pagination", "people", "pricing", "record-detail", "resource-list", "section-header", "settings", "stats", "status-list", "steps", "table-of-contents", "task-list", "testimonials", "timeline", "usage", "wizard"].map(leaf => `sections.${leaf}`);
/** A Foundry candidate exists but leaves a required content slot unmapped. */
const SECTION_INELIGIBLE = { "sections.chat": ["composer"], "sections.explorer": ["list"], "sections.hero": ["header"], "sections.newsletter": ["email"] };
const SECTION_NO_CANDIDATE: string[] = [];
const FRAME_DEFAULTS = ["app-header", "inspector", "sheet", "site-footer", "site-header", "site-shell"].map(leaf => `frames.${leaf}`);
const FRAME_NOT_CHOSEN = ["app-shell", "app-sidebar", "command"].map(leaf => `frames.${leaf}`);

describe("surface default fills", () => {
  it("defaults every Section and Frame whose candidate passes the static contract rule, and only those", () => {
    const input = setup();
    const plan = planSurfaceDefaults(input);
    expect(plan.rows.map(row => row.slot)).toEqual(input.slots);
    expect(input.slots.filter(slot => slot.startsWith("sections.")).length).toBe(45);
    expect(input.slots.filter(slot => slot.startsWith("frames.")).length).toBe(9);
    const expected = Object.fromEntries(input.slots.map(slot => [slot, [...SECTION_DEFAULTS, ...FRAME_DEFAULTS].includes(slot) ? "foundry" : "-"]));
    expect(ledger(plan)).toEqual(expected);
    expect(Object.values(ledger(plan)).filter(value => value !== "-")).toHaveLength(47);
    expect(plan.findings).toEqual([]);
    expect(plan.rows.find(row => row.slot === "frames.site-header")).toEqual({ slot: "frames.site-header", status: "default", basis: "preference", source: "foundry", fill: "foundry/frames.site-header", reasons: [] });
  });

  it("keeps every unchosen leaf visible with its precise reason", () => {
    const plan = planSurfaceDefaults(setup());
    for (const slot of [...Object.keys(SECTION_INELIGIBLE), ...SECTION_NO_CANDIDATE, ...FRAME_NOT_CHOSEN]) {
      const row = plan.rows.find(candidate => candidate.slot === slot)!;
      expect(row.status, slot).toBe("not-chosen");
      expect(row.source ?? row.fill, slot).toBeUndefined();
      expect(row.reasons.length, slot).toBeGreaterThan(0);
    }
    expect(reasons(plan, "sections.hero")).toBe("foundry: S5 content/member mapping differs: required slot header is not mapped");
    expect(reasons(plan, "sections.gallery")).toBe("no implementation candidate");
    expect(reasons(plan, "frames.app-shell")).toBe("foundry: S5 frame rendering/state ownership differs: state port width is not owned, state port theme is not owned");
    expect(reasons(plan, "frames.command")).toBe("foundry: S5 content/member mapping differs: required slot search is not mapped");
    expect(plan.rows.find(row => row.slot === "frames.inspector")).toEqual({ slot: "frames.inspector", status: "default", basis: "preference", source: "foundry", fill: "foundry/frames.inspector", reasons: [] });
    for (const leaf of ["filter-builder", "settings", "wizard"]) expect(plan.rows.find(row => row.slot === `sections.${leaf}`), leaf).toMatchObject({ status: "default", source: "foundry", fill: `foundry/sections.${leaf}`, reasons: [] });
  });

  it("agrees with the importer's committed coverage for every leaf", () => {
    const plan = planSurfaceDefaults(setup());
    for (const row of [...sectionCoverage.coverage, ...frameCoverage.coverage]) {
      const planned = plan.rows.find(candidate => candidate.slot === row.slot)!;
      const ports = "missingStatePorts" in row ? row.missingStatePorts : [];
      if (row.status === "unavailable") { expect(planned.reasons, row.slot).toEqual(["no implementation candidate"]); continue; }
      expect(planned.status === "default", row.slot).toBe(!row.missingRequiredSlots.length && !ports.length);
      for (const name of row.missingRequiredSlots) expect(reasons(plan, row.slot), row.slot).toContain(`required slot ${name} is not mapped`);
      for (const port of ports) expect(reasons(plan, row.slot), row.slot).toContain(`state port ${port} is not owned`);
    }
    expect(Object.keys(SECTION_INELIGIBLE).map(slot => sectionCoverage.coverage.find(row => row.slot === slot)!.missingRequiredSlots)).toEqual(Object.values(SECTION_INELIGIBLE));
  });

  it("shows what a subset default leaves unmapped, and nothing for a same-contract default", () => {
    const plan = planSurfaceDefaults(setup());
    expect(plan.rows.find(row => row.slot === "sections.band")).toMatchObject({ status: "default", unmapped: ["ground.transparent", "axis.rhythm"] });
    expect(plan.rows.find(row => row.slot === "frames.site-shell")).toMatchObject({ status: "default", unmapped: ["chrome.full", "chrome.minimal", "slot.consent", "slot.progress"] });
    expect(plan.rows.find(row => row.slot === "sections.access-matrix")!.unmapped).toBeUndefined();
  });

  it("an owner pick or a choice is exclusive and never falls back", () => {
    const picked = planSurfaceDefaults(setup({ picks: { "sections.hero": "foundry", "sections.faq": "other" } }));
    expect(picked.rows.find(row => row.slot === "sections.hero")!.status).toBe("not-chosen");
    expect(reasons(picked, "sections.hero")).toContain("owner pick foundry is not eligible; another source needs the owner's choice");
    expect(reasons(picked, "sections.faq")).toBe("other: no implementation candidate || owner pick other is not eligible; another source needs the owner's choice");
    const chosen = planSurfaceDefaults(setup({ choices: { "frames.sheet": "foundry", "frames.site-header": "other" }, picks: { "frames.sheet": "other" } }));
    expect(chosen.rows.find(row => row.slot === "frames.sheet")).toMatchObject({ status: "chosen", basis: "choose", source: "foundry" });
    expect(chosen.rows.find(row => row.slot === "frames.site-header")).toMatchObject({ status: "not-chosen", reasons: ["other: no implementation candidate"] });
    expect(planSurfaceDefaults(setup({ picks: { "sections.faq": "foundry" } })).rows.find(row => row.slot === "sections.faq")).toMatchObject({ status: "default", basis: "owner-pick" });
  });

  it("never defaults a source the preference does not list", () => {
    const plan = planSurfaceDefaults(setup({ preference: ["shadcn@aria"] }));
    expect(plan.rows.every(row => row.status === "not-chosen")).toBe(true);
    expect(plan.decisions).toEqual([]);
    expect(reasons(plan, "sections.faq")).toBe("no eligible candidate");
  });

  it("refuses a candidate with a retained blocker, an unknown content slot or member, or a reference-mode document", () => {
    const input = setup();
    const edit = (slot: string, change: (doc: SurfaceDefaultCandidateDocument) => void) => {
      const fills = input.catalog.fills.map(doc => {
        if (doc.$extensions["com.clossys.fill"].slot !== slot) return doc;
        const copy = structuredClone(doc); change(copy); return copy;
      });
      return planSurfaceDefaults({ ...input, catalog: { ...input.catalog, fills } });
    };
    const entry = (doc: SurfaceDefaultCandidateDocument) => Object.values(doc.sections ?? doc.frames ?? {})[0] as unknown as Record<string, unknown>;
    expect(reasons(edit("sections.faq", doc => { entry(doc).blockers = [{ code: "S4", message: "dependency missing" }]; }), "sections.faq")).toBe("foundry: S5 S4: dependency missing");
    expect(reasons(edit("sections.faq", doc => { (entry(doc).slotMap as Record<string, string>).invented = "./blocks#Faq.x"; }), "sections.faq")).toBe("foundry: S5 content/member mapping differs: slot invented is outside the contract");
    expect(reasons(edit("frames.sheet", doc => { (entry(doc).propMap as Record<string, string>)["placement.invented"] = "placement=x"; }), "frames.sheet")).toBe("foundry: S5 content/member mapping differs: member placement.invented is outside the contract");
    expect(reasons(edit("frames.sheet", doc => { (entry(doc).statePorts as Record<string, string>).invented = "x/y"; }), "frames.sheet")).toBe("foundry: S5 frame rendering/state ownership differs: state port invented is outside the contract");
    expect(reasons(edit("frames.sheet", doc => { entry(doc).rendering = "server"; }), "frames.sheet")).toBe("foundry: S5 frame rendering/state ownership differs: rendering server differs from client");
    expect(reasons(edit("sections.faq", doc => { doc.$extensions["com.clossys.fill"].mode = "reference"; }), "sections.faq")).toBe("no implementation candidate");
  });

  it("reports a cross-kind primary-name collision in the selected set", () => {
    const input = setup();
    const frame = input.catalog.slots.find(slot => slot.id === "frames.sheet")!;
    const form = { ...structuredClone(frame), id: "frames.form" } as FrameSlot;
    const doc = structuredClone(input.catalog.fills.find(row => row.$extensions["com.clossys.fill"].slot === "frames.sheet")!);
    doc.$extensions["com.clossys.fill"] = { ...doc.$extensions["com.clossys.fill"], id: "foundry/frames.form", slot: "frames.form" };
    doc.frames = { form: { ...Object.values(doc.frames!)[0]!, slot: "frames.form" } };
    const plan = planSurfaceDefaults({ ...input, catalog: { slots: [...input.catalog.slots, form], fills: [...input.catalog.fills, doc] }, slots: [...input.slots, "frames.form"] });
    expect(plan.findings).toEqual([{ code: "S1", rule: "surfaces", severity: "error", subject: "frames.form", message: "cross-kind primary collision" }]);
  });

  it("emits one adopt decision per default, which the source apply path refuses without a verified surface source bundle", () => {
    const input = setup();
    const plan = planSurfaceDefaults(input);
    expect(plan.decisions.map(row => row.slot)).toEqual(plan.rows.filter(row => row.status !== "not-chosen").map(row => row.slot));
    expect(plan.decisions.find(row => row.slot === "sections.faq")).toEqual({ slot: "sections.faq", kind: "adopt", source: "foundry", fill: "foundry/sections.faq", note: "Default fill (preference)" });
    const values = loadCatalog();
    const registry = loadComponentRegistry();
    const catalog: CompositeCatalogData = { values, components: { slots: registry.slots, fills: [] }, surfaces: { slots: input.catalog.slots, fills: [], transforms: [], rules: [], materializations: [] } };
    const source = { kind: "consumer", author: "consumer", id: "defaults-consumer" } as CompositeLibraryData["source"];
    const empty: CompositeLibraryData = { source, adoptedAt: "2026-10-26", values: { fills: [] }, components: { fills: [], files: [] } };
    const decision = plan.decisions[0]!;
    expect(() => applyLibraryChange(catalog, empty, { baseHash: libraryHash(empty), changes: [{ portion: "surfaces", change: { op: "adopt", slot: decision.slot, source: decision.source } }] }, { surfaceOptions: { packages: [], measurements: [] } })).toThrow(/S2 unique bundle required/);
  });
});
