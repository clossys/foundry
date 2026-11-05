import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import globalRetired from "../catalog/retired.json" with { type: "json" };
import { loadCatalog } from "./index.js";
import { loadComponentRegistry } from "./component-registry.js";
import { isValidId } from "./ids.js";
import { loadSectionRegistry, sectionRegistryFindings, type SectionRegistry } from "./sections-contract.js";
import type { PlacementNode } from "./types.js";

// Audit inventory independent of the mutable placement and descriptor documents.
const families: Record<string, readonly string[]> = {
  parts: ["band", "section-header", "pagination"],
  explain: ["hero", "logo-hero", "logo-mark", "page-header", "content", "article", "legal-prose", "features", "testimonials", "logo-cloud", "people", "media", "gallery", "faq", "steps", "timeline", "call-to-action"],
  organize: ["cards", "resource-list", "task-list", "comparison", "pricing", "stats", "status-list", "usage", "account-summary", "data-table", "data-grid", "record-detail", "activity-feed", "audit-log"],
  collect: ["form", "newsletter", "sign-in-form", "wizard", "settings", "column-mapper", "access-matrix", "chat"],
  navigate: ["link-index", "table-of-contents", "explorer", "filter-builder"],
  respond: ["empty-state", "error-state", "boundary-message", "notices", "consent"],
};
const id = (leaf: string) => `sections.${leaf}`;
const waveOneIds = ["account-summary", "boundary-message", "error-message", "legal-prose", "logo-mark", "sign-in-form"].map(id);
const isWaveOne = (slot: { id: string }) => waveOneIds.includes(slot.id);
// The expressive amendment's surviving read is the marquee animation (its shift distance was deleted); retain every earlier field pin.
const withoutExpressiveMotionReads = (slots: SectionRegistry["slots"]): SectionRegistry["slots"] => slots.map(slot => ({
  ...slot, contract: { ...slot.contract, allowedReads: {
    ...slot.contract.allowedReads,
    themes: slot.contract.allowedReads.themes.filter(read => read !== "themes.animate-marquee"),
  } },
}));
const inventory = Object.values(families).flat().map(id).sort();
const leaves = (nodes: readonly PlacementNode[]): string[] => nodes.flatMap(node => "leaves" in node ? [...node.leaves] : leaves(node.children));
const changedPlacement = (mutate: (leaves: string[]) => string[]): SectionRegistry => {
  const registry = loadSectionRegistry();
  return { ...registry, placement: { layer: "sections", nodes: [{ id: "test", label: "Test", children: [{ id: "test-family", label: "Family", leaves: mutate(leaves(registry.placement.nodes)) }] }] } };
};

const reconciledComposes: Record<string, readonly string[]> = {
  "access-matrix": ["table", "checkbox", "tooltip", "button", "icon"],
  chat: ["text-field", "button", "file-trigger", "avatar", "spinner", "link", "tooltip"],
  comparison: ["table", "status-mark", "badge", "card", "icon", "radio-group", "tooltip", "button", "dialog", "menu", "link"],
  form: ["form", "field", "text-field", "button", "banner", "checkbox", "combo-box", "select"],
  "record-detail": ["card", "tabs", "badge", "skeleton", "button", "link", "disclosure"],
  "data-table": ["table", "toolbar", "checkbox", "menu", "button", "dialog", "icon", "popover", "select", "text-field", "badge", "status-mark", "tooltip", "link", "skeleton"],
  "link-index": ["link", "card", "icon", "badge", "button", "status-mark", "semantic-content"],
  newsletter: ["text-field", "button", "icon"],
  "table-of-contents": ["link", "disclosure"],
  "task-list": ["checkbox", "avatar", "badge", "icon", "status-mark"],
};

describe("S2-1 bounded section composition reconciliation", () => {
  it.each(Object.entries(reconciledComposes))("pins the exact component permissions for %s", (leaf, components) => {
    expect(loadSectionRegistry().slots.find(slot => slot.id === id(leaf))!.contract.allowedComposes)
      .toEqual(components.map(component => `components.${component}`));
  });

  it("preserves every other accepted contract field and limits parts to the three locked parts", () => {
    const slots = withoutExpressiveMotionReads(loadSectionRegistry().slots);
    for (const slot of slots) {
      for (const part of slot.contract.parts) expect(families.parts!.map(id)).toContain(part);
      for (const component of slot.contract.allowedComposes) expect(component).toMatch(/^components\./);
    }
    // SCROLL-1 A158/A159/A161: stats, TOC label, typed table cells and native band header are the exact new contract delta; keep existing normalization and unrelated pins unchanged.
    const invariant = slots.filter(slot => !isWaveOne(slot) && slot.id !== "sections.logo-hero").map(slot => {
      const { substrates: _substrates, substrateTests: _tests, copy: _copy, passageSchema: _passage, ...rest } = slot.contract;
      const base = slot.id === "sections.table-of-contents" ? { ...rest, slots: rest.slots.map(item => item.name === "active-id" ? { ...item, type: "copy" } : item) } : rest;
      const original = slot.id === "sections.comparison" ? { ...base, surface: "site", slots: base.slots.filter(item => item.name !== "controls"), members: { ...base.members, names: [] } } : base;
      if (!Object.hasOwn(reconciledComposes, slot.id.slice("sections.".length))) return { ...slot, contract: original };
      const { allowedComposes: _permissions, ...contract } = original;
      return { ...slot, contract };
    });
    expect(createHash("sha256").update(JSON.stringify(invariant)).digest("hex"))
      .toBe("84bd4fafa1e157ef1a7092bb3360decb1b502e93e780a989e6b39b545cf27721");
  });

  it("preserves all 46 base rows exactly and pins the six new draft contracts separately", () => {
    const slots = withoutExpressiveMotionReads(loadSectionRegistry().slots);
    const original = slots.filter(slot => !isWaveOne(slot));
    expect(original).toHaveLength(46);
    // SCROLL-1 A158/A159/A161 updates only section-header, table-of-contents and data-table; all 46 rows remain pinned, with no field projected out.
    expect(createHash("sha256").update(JSON.stringify(original)).digest("hex"))
      .toBe("4d59000a56e5d89cf1281a80800c8e78931edb850ba157182b6e7d130989de1e");
    // Preserve the original contracts while allowing the three copy-only sign-in
    // configurations covered by sections/sign-in-copy.test.tsx.
    const signInConfigs = ["sign-in.password", "sign-in.provider", "sign-in.verify"];
    const additions = slots.filter(isWaveOne).map(slot => slot.id === "sections.sign-in-form" ? {
      ...slot, contract: { ...slot.contract, members: {
        ...slot.contract.members, names: slot.contract.members.names.filter(name => !signInConfigs.includes(name)),
      } },
    } : slot).sort((a, b) => a.id.localeCompare(b.id));
    expect(additions.map(slot => slot.id)).toEqual(waveOneIds.filter(slotId => slotId !== id("error-message")));
    expect(createHash("sha256").update(JSON.stringify(additions)).digest("hex"))
      .toBe("a007a3bb8e41f57372a3b3b3bb9066965fda134103bf9d3f8037b99b11c360ee");
  });
});

describe("section build IA registry", () => {
  it("loads exactly the 51 permanent draft ids without claiming a freeze or runtime fill", () => {
    const registry = loadSectionRegistry();
    expect(registry.status).toBe("build-unfrozen");
    expect(registry.slots.map(slot => slot.id)).toEqual(inventory);
    expect(registry.slots).toHaveLength(51);
    expect(new Set(registry.slots.map(slot => slot.id)).size).toBe(51);
    for (const slot of registry.slots) {
      expect(isValidId("slot", slot.id)).toBe(true);
      expect(slot.layer).toBe("sections");
      expect(slot.status).toBe("draft");
      expect(slot).not.toHaveProperty("signoff");
      expect(slot).not.toHaveProperty("fill");
      expect(slot.contract.kind).toBe("section");
      expect(slot.contract.data).toBe("host-injected");
    }
    expect(sectionRegistryFindings(registry)).toEqual([]);
  });

  it("pins scroll header stats, native band placement and the supplied outline label", () => {
    const rows = new Map(loadSectionRegistry().slots.map(slot => [slot.id, slot.contract]));
    expect(rows.get(id("section-header"))?.anatomy).toEqual({ band: id("band"), header: null });
    expect(rows.get(id("section-header"))?.parts).toEqual([id("band")]);
    expect(rows.get(id("section-header"))?.slots.find(slot => slot.name === "stats")).toEqual({ name: "stats", type: "records", required: false });
    expect(rows.get(id("section-header"))?.slots.find(slot => slot.name === "actions")?.max).toBe(2);
    expect(rows.get(id("table-of-contents"))?.slots.find(slot => slot.name === "label")).toEqual({ name: "label", type: "copy", required: false });
  });

  it("pins the owner-decided site, app and shared section surfaces", () => {
    const registry = loadSectionRegistry();
    // Site content and visitor communication.
    const site = ["hero", "logo-hero", "logo-mark", "legal-prose", "features", "testimonials", "logo-cloud", "people", "pricing", "gallery", "timeline", "newsletter", "steps", "article", "table-of-contents", "status-list", "call-to-action", "consent"];
    // Authenticated records, workflows and operational tools.
    const app = ["access-matrix", "audit-log", "activity-feed", "data-grid", "data-table", "resource-list", "record-detail", "task-list", "column-mapper", "filter-builder", "settings", "chat", "explorer", "usage", "sign-in-form", "boundary-message", "account-summary"];
    // Shared structure, content, input and feedback work on either surface.
    const both = ["band", "section-header", "pagination", "page-header", "content", "media", "faq", "cards", "stats", "form", "wizard", "link-index", "empty-state", "error-state", "notices", "comparison"];
    const expected = Object.fromEntries([
      ...site.map(leaf => [id(leaf), "site"]),
      ...app.map(leaf => [id(leaf), "app"]),
      ...both.map(leaf => [id(leaf), "both"]),
    ]);
    expect(Object.keys(expected).sort()).toEqual(inventory);
    expect(Object.fromEntries(registry.slots.map(slot => [slot.id, slot.contract.surface]))).toEqual(expected);
    expect(Object.fromEntries(["site", "app", "both"].map(surface => [surface, registry.slots.filter(slot => slot.contract.surface === surface).length]))).toEqual({ site: 18, app: 17, both: 16 });
  });

  it("declares consent as a site contract with host copy and lower-layer composition", () => {
    const consent = loadSectionRegistry().slots.find(slot => slot.id === id("consent"));
    expect(consent).toMatchObject({ layer: "sections", status: "draft", requires: [], contract: {
      kind: "section", data: "host-injected", surface: "site",
      allowedComposes: ["components.button", "components.link", "components.card"],
      slots: [
        { name: "copy", type: "copy", required: true },
        { name: "actions", type: "action", required: true, max: 2 },
        { name: "policy", type: "action", required: true, max: 1 },
      ],
    } });
    expect(consent).not.toHaveProperty("fill");
    expect(consent).not.toHaveProperty("signoff");
  });

  it("does not read illustration assets for empty and error states", () => {
    for (const leaf of ["empty-state", "error-state"]) {
      const contract = loadSectionRegistry().slots.find(slot => slot.id === id(leaf))!.contract;
      expect(contract.allowedReads.assets).not.toContain("assets.illustration-*");
    }
  });

  it("places each leaf once under the six function roots, including shared Parts", () => {
    const registry = loadSectionRegistry();
    expect(registry.placement.layer).toBe("sections");
    expect(registry.placement.nodes.map(node => node.id)).toEqual(Object.keys(families));
    for (const node of registry.placement.nodes) {
      expect("children" in node && leaves(node.children).sort()).toEqual(families[node.id]?.map(id).sort());
    }
    expect(leaves(registry.placement.nodes).sort()).toEqual(inventory);
  });

  it("reports a missing placement and a duplicate placement rather than collapsing either into a set", () => {
    expect(sectionRegistryFindings(changedPlacement(values => values.filter(value => value !== id("hero"))))).toEqual(["placement: missing section slot sections.hero"]);
    expect(sectionRegistryFindings(changedPlacement(values => [...values, id("hero")]))).toEqual(["placement: sections.hero appears 2 times"]);
    expect(sectionRegistryFindings(changedPlacement(values => [...values, "sections.unregistered"]))).toEqual(["placement: unknown section slot sections.unregistered"]);
  });

  it("shares band and header without cycles, with pagination as a same-layer part", () => {
    const registry = loadSectionRegistry();
    const slots = new Map(registry.slots.map(slot => [slot.id, slot]));
    const visit = (key: string, path: readonly string[]): void => {
      expect(path.includes(key), [...path, key].join(" -> ")).toBe(false);
      const slot = slots.get(key);
      expect(slot, key).toBeDefined();
      for (const part of slot?.contract.parts ?? []) visit(part, [...path, key]);
    };
    for (const slot of registry.slots) {
      const part = families.parts?.map(id).includes(slot.id);
      expect(slot.contract.anatomy.band).toBe(slot.id !== id("section-header") && (part || ["sign-in-form", "boundary-message", "error-message"].map(id).includes(slot.id)) ? null : id("band"));
      expect(slot.contract.anatomy.header).toBe(part || isWaveOne(slot) || [id("table-of-contents"), id("logo-hero")].includes(slot.id) ? null : id("section-header"));
      for (const target of Object.values(slot.contract.anatomy)) if (target) expect(slot.contract.parts).toContain(target);
      visit(slot.id, []);
    }
    expect(slots.get(id("pagination"))?.contract.members.names).toEqual(["mode.pages", "mode.load-more", "mode.cursor"]);
    expect(slots.get(id("data-table"))?.contract.parts).toContain(id("pagination"));
    expect(slots.get(id("page-header"))?.contract.members.names).toContain("config.record");
    expect(slots.get(id("band"))?.contract.unresolvedMemberAxes).toEqual(["rhythm"]);
  });

  it("declares typed host slots, closed members and resolvable lower-layer dependencies", () => {
    const registry = loadSectionRegistry();
    const runtime = loadCatalog();
    const componentIds = new Set(loadComponentRegistry().slots.map(slot => slot.id));
    const lowerIds = new Set(runtime.slots.map(slot => slot.id));
    for (const slot of registry.slots) {
      const contract = slot.contract;
      expect(contract.members.mode).toBe("closed");
      expect(new Set(contract.members.names).size).toBe(contract.members.names.length);
      expect(new Set(contract.slots.map(content => content.name)).size).toBe(contract.slots.length);
      for (const content of contract.slots) {
        expect(["copy", "media", "records", "action", "region"]).toContain(content.type);
        if (content.name === "actions") {
          const waveOneActionMax: Record<string, number | undefined> = {
            "sections.sign-in-form": undefined, "sections.boundary-message": 2, "sections.error-message": 1, "sections.account-summary": undefined,
          };
          expect(content.max).toBe(isWaveOne(slot) ? waveOneActionMax[slot.id] : 2);
        }
      }
      for (const target of contract.allowedComposes) expect(componentIds.has(target), `${slot.id} composes ${target}`).toBe(true);
      for (const target of contract.allowedReads.themes) expect(lowerIds.has(target), `${slot.id} reads ${target}`).toBe(true);
      for (const target of contract.allowedReads.assets) {
        // Families are contract permissions, not assertions that an illustration fill exists.
        expect(target.endsWith("*") ? ["assets.icon-*", "assets.illustration-*"].includes(target) : lowerIds.has(target), `${slot.id} reads ${target}`).toBe(true);
      }
    }
  });

  it("records legacy aliases separately without changing global retirement history", () => {
    const registry = loadSectionRegistry();
    expect(registry.retired).toHaveLength(58);
    expect(new Set(registry.retired.map(entry => entry.id)).size).toBe(58);
    for (const entry of registry.retired) {
      expect(inventory).toContain(entry.replacedBy);
      expect(entry.retiredAt).toBe(entry.id === id("error-message") ? "2026-10-29" : "2026-10-23");
      expect(registry.aliases).toContainEqual({ id: entry.id, target: entry.replacedBy });
    }
    const targets = Object.fromEntries(registry.retired.map(entry => [entry.id, entry.replacedBy]));
    expect(targets).toMatchObject({
      "say.chapter": id("content"), "items.feature-grid": id("features"),
      "items.legacy-faq": id("faq"), "items.ordered-step-sequence": id("steps"),
      "say.section-intro": id("section-header"), "items.stat": id("stats"),
      "matrix.grouped-table": id("data-table"), "items.record-ledger": id("record-detail"),
      "items.event-item": id("activity-feed"), "form.save-bar": id("settings"),
      "items.topics": id("link-index"), "items.nav-grid": id("link-index"), "form.load-more": id("pagination"),
      "sections.error-message": id("error-state"),
    });
    for (const outside of ["items.raw", "matrix.raw", "form.toolbar", "items.app-navigation", "matrix.drawer", "items.specimen-stack", "items.relation-graph", "form.refresh-status"]) expect(targets).not.toHaveProperty(outside);
    expect(globalRetired).toEqual([]);
    expect(loadCatalog().retired).toEqual(globalRetired);
  });

  it("returns owned data on each load", () => {
    const registry = loadSectionRegistry();
    (registry.slots as unknown as unknown[]).pop();
    (registry.aliases as unknown as unknown[]).pop();
    expect(loadSectionRegistry().slots).toHaveLength(51);
    expect(loadSectionRegistry().aliases).toHaveLength(58);
  });
});


describe("bounded renderer substrate declarations", () => {
  it("declares only the named comparison and six Publisher render proofs", () => {
    const slots = loadSectionRegistry().slots;
    expect(slots.filter(slot => slot.contract.substrates).map(slot => slot.id).sort()).toEqual([
      "sections.comparison", "sections.data-table", "sections.empty-state", "sections.error-state", "sections.form", "sections.notices", "sections.record-detail",
    ]);
    const comparison = slots.find(slot => slot.id === "sections.comparison")!.contract;
    expect(comparison.surface).toBe("both");
    expect(comparison.members).toEqual({ mode: "closed", names: ["arrangement.library-board"] });
    expect(comparison.slots.find(slot => slot.name === "controls")).toEqual({ name: "controls", type: "records", required: false });
    expect(comparison.substrates).toEqual(["flow", "canvas"]);
    expect(comparison.substrateTests).toEqual([
      { substrate: "flow", file: "packages/designer/src/blocks/library-board/LibraryBoardSection.test.tsx", name: "renders actual checked library board in flow" },
      { substrate: "canvas", file: "packages/designer/src/blocks/library-board/LibraryBoardSection.test.tsx", name: "renders actual checked library board in canvas and retains Edit through fallback" },
    ]);
    for (const leaf of ["data-table", "empty-state", "error-state", "form", "notices", "record-detail"]) {
      const contract = slots.find(slot => slot.id === `sections.${leaf}`)!.contract;
      expect(contract.substrates).toEqual(["flow"]);
      expect(contract.substrateTests).toEqual([{ substrate: "flow", file: "packages/publisher/src/web/publisher/PublisherSection.test.tsx", name: `renders typed Publisher ${leaf} in flow` }]);
    }
    expect(slots.find(slot => slot.id === "sections.record-detail")!.contract.slots.find(slot => slot.name === "actions")!.max).toBe(2);
  });
});
