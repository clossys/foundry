import { describe, expect, it } from "vitest";
import mapping from "./maps/blocks-to-sections.json" with { type: "json" };
import retired from "./retired/sections.json" with { type: "json" };
import slots from "./slots/sections.json" with { type: "json" };
import { BLOCK_ENTRIES } from "./blocks.js";

// Independent taxonomy inventory: aliases identify a home, never runtime equivalence.
const legacyByLeaf: Record<string, readonly string[]> = {
  "section-header": ["say.section-header", "say.section-intro"],
  pagination: ["form.pagination", "form.load-more"],
  hero: ["say.hero"], "page-header": ["say.page-header"],
  content: ["say.takeaway", "say.chapter"], article: ["prose.article"],
  features: ["items.features", "items.statement", "items.feature-grid"],
  testimonials: ["say.testimonial", "say.testimonial-set"],
  "logo-cloud": ["items.logo-cloud"], people: ["items.people-grid"],
  media: ["say.media-figure"], gallery: ["items.media-gallery"],
  faq: ["items.faq", "items.legacy-faq"],
  steps: ["items.steps", "items.ordered-step-sequence"], timeline: ["items.timeline"],
  cards: ["items.cards"], "resource-list": ["items.resource-list"], "task-list": ["items.task-list"],
  comparison: ["matrix.comparison"], pricing: ["matrix.pricing"],
  stats: ["items.stat", "items.stat-grid"], "status-list": ["items.status-list"], usage: ["items.usage-meter"],
  "data-table": ["matrix.data-table", "matrix.grouped-table"], "data-grid": ["matrix.data-grid"],
  "record-detail": ["matrix.detail", "items.record-ledger"],
  "activity-feed": ["items.activity-feed", "items.event-item"], "audit-log": ["matrix.audit-log"],
  form: ["form.form"], newsletter: ["form.newsletter-band"], wizard: ["form.form-wizard"],
  settings: ["form.settings-section", "form.save-bar"], "column-mapper": ["form.column-mapper"],
  "access-matrix": ["matrix.access-matrix"], chat: ["form.chat"],
  "link-index": ["items.link-index", "items.topics", "items.nav-grid"],
  "table-of-contents": ["prose.table-of-contents"], explorer: ["items.explorer"],
  "filter-builder": ["form.filter-builder"], "empty-state": ["say.empty-state"],
  "error-state": ["say.error-state"], notices: ["say.notice-stack"],
};
const expected = Object.fromEntries(Object.entries(legacyByLeaf).flatMap(([leaf, ids]) => ids.map(id => [id, `sections.${leaf}`])));
const unmapped = [
  "say.info-tip", "say.lockup", "items.item", "matrix.panel", "form.field-group", "form.file-field",
  "items.tree", "form.toolbar", "form.bulk-action-bar", "form.confirm-dialog",
  "items.app-navigation", "form.account-menu", "form.command-menu", "items.page-bar", "matrix.drawer",
  "matrix.resizable-pane", "form.consent-banner", "items.notification-center",
  "items.specimen-stack", "say.specimen", "matrix.specimen-panel", "say.anatomy-callouts", "matrix.scene",
  "matrix.catalog-workspace", "matrix.flow-canvas", "matrix.catalog-browser", "matrix.canvas-surface",
  "items.raw", "matrix.raw", "items.relation-graph", "form.refresh-status",
];

describe("legacy block section homes", () => {
  it("maps exactly 57 legacy addresses to 42 of the 45 section leaves", () => {
    expect(mapping).toEqual(expected);
    expect(Object.keys(mapping)).toHaveLength(57);
    expect(new Set(Object.values(mapping)).size).toBe(42);
    const targets = new Set(slots.map(slot => slot.id));
    expect(targets.size).toBe(45);
    for (const target of Object.values(mapping)) expect(targets.has(target), target).toBe(true);
    expect([...targets].filter(target => !Object.values(mapping).includes(target)).sort()).toEqual(["sections.band", "sections.call-to-action", "sections.consent"]);
  });

  it("agrees with existing retirement aliases without replacing legacy IDs", () => {
    expect(mapping).toEqual(Object.fromEntries(retired.map(row => [row.id, row.replacedBy])));
    expect(BLOCK_ENTRIES).toHaveLength(88);
    expect(BLOCK_ENTRIES.map(block => block.id).sort()).toEqual([...Object.keys(expected), ...unmapped].sort());
  });

  it("attaches homes to mapped entries and leaves the other 31 addresses absent", () => {
    const mapped = BLOCK_ENTRIES.filter(block => block.sectionLeaf !== undefined);
    expect(Object.fromEntries(mapped.map(block => [block.id, block.sectionLeaf]))).toEqual(expected);
    expect(BLOCK_ENTRIES.filter(block => block.sectionLeaf === undefined).map(block => block.id).sort()).toEqual([...unmapped].sort());
    for (const block of BLOCK_ENTRIES.filter(block => unmapped.includes(block.id))) expect(block).not.toHaveProperty("sectionLeaf");
  });

  it("keeps recipes and unbuilt specs distinct from public implementations", () => {
    const recipes = ["items.features", "items.statement", "items.cards", "items.faq", "items.steps", "items.stat-grid", "matrix.comparison", "items.link-index", "items.topics"];
    for (const id of recipes) {
      const block = BLOCK_ENTRIES.find(block => block.id === id);
      expect(block?.export, id).toBeNull();
      expect(block?.recipeOf, id).toBe(id === "matrix.comparison" ? "matrix.raw" : "items.raw");
    }
    for (const id of ["items.media-gallery", "items.timeline", "matrix.data-grid", "items.activity-feed", "matrix.audit-log", "form.form-wizard", "form.settings-section", "form.save-bar", "form.filter-builder", "say.error-state", "say.notice-stack", "form.load-more"]) {
      const block = BLOCK_ENTRIES.find(block => block.id === id);
      expect(block?.export, id).toBeNull();
      expect(block?.built, id).toBe("no");
    }
    for (const [id, name] of [["items.stat", "Stat"], ["items.usage-meter", "UsageMeter"], ["items.event-item", "EventItem"], ["say.testimonial", "Testimonial"], ["matrix.grouped-table", "GroupedTable"], ["items.record-ledger", "RecordLedger"]]) {
      expect(BLOCK_ENTRIES.find(block => block.id === id)?.export, id).toBe(name);
    }
  });
});
