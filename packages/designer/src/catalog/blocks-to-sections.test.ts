import { describe, expect, it } from "vitest";
import mapping from "./maps/blocks-to-sections.json" with { type: "json" };
import retired from "./retired/sections.json" with { type: "json" };
import retiredLeaves from "./retired.json" with { type: "json" };
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
  "resource-list": ["items.resource-list"], "task-list": ["items.task-list"],
  comparison: ["matrix.comparison"], pricing: ["matrix.pricing"],
  stats: ["items.stat", "items.stat-grid"], "status-list": ["items.status-list"], usage: ["items.usage-meter"],
  "data-table": ["matrix.data-table", "matrix.grouped-table"], "data-grid": ["matrix.data-grid"],
  "activity-feed": ["items.activity-feed", "items.event-item"], "audit-log": ["matrix.audit-log"],
  form: ["form.form"], wizard: ["form.form-wizard"],
  settings: ["form.settings-section", "form.save-bar"], "column-mapper": ["form.column-mapper"],
  "access-matrix": ["matrix.access-matrix"], chat: ["form.chat"],
  // sections.cards retired by merge into sections.link-index, so items.cards follows it there.
  "link-index": ["items.link-index", "items.topics", "items.nav-grid", "items.cards"],
  "table-of-contents": ["prose.table-of-contents"], explorer: ["items.explorer"],
  "filter-builder": ["form.filter-builder"], "empty-state": ["say.empty-state"],
  "error-state": ["say.error-state"], notices: ["say.notice-stack"],
};
const expected = Object.fromEntries(Object.entries(legacyByLeaf).flatMap(([leaf, ids]) => ids.map(id => [id, `sections.${leaf}`])));
// Legacy blocks whose section home was retired with no successor (sections.newsletter, sections.record-detail).
const homeless = ["form.newsletter-band", "items.record-ledger", "matrix.detail"];
// A retired section home follows its replacedBy; one with no successor leaves the block without a home.
const liveHome = (leaf: string): string | undefined => {
  const row = (retiredLeaves as { id: string; replacedBy?: string }[]).find(entry => entry.id === leaf);
  return row ? (row.replacedBy ? liveHome(row.replacedBy) : undefined) : leaf;
};
const unmapped = [
  "say.info-tip", "say.lockup", "items.item", "matrix.panel", "form.field-group", "form.file-field",
  "items.tree", "form.toolbar", "form.bulk-action-bar", "form.confirm-dialog",
  "items.app-navigation", "form.account-menu", "form.command-menu", "items.page-bar", "matrix.drawer",
  "matrix.resizable-pane", "form.consent-banner", "items.notification-center",
  "items.specimen-stack", "say.specimen", "matrix.specimen-panel", "say.anatomy-callouts", "matrix.scene",
  "matrix.catalog-workspace", "matrix.flow-canvas", "matrix.catalog-browser", "matrix.canvas-surface",
  "items.raw", "matrix.raw", "items.relation-graph", "form.refresh-status", "say.call-to-action", "items.usage-summary",
];

describe("legacy block section homes", () => {
  it("maps 54 legacy addresses and the new logo block to 39 of the 71 section leaves", () => {
    expect(mapping).toEqual({ ...expected, "say.logo-hero": "sections.hero" });
    expect(Object.keys(mapping)).toHaveLength(55);
    expect(new Set(Object.values(mapping)).size).toBe(39);
    const targets = new Set(slots.map(slot => slot.id));
    // Five live wave-one Sections extend the old 46-leaf inventory without adding legacy aliases; R2F-11: the
    // 14 Studio specimen sections and the native sectioned document are new leaves with no legacy block home.
    // foundry-build-0048 (A3): the five admin record sections read clossys records and have no legacy block home.
    expect(targets.size).toBe(71);
    for (const target of Object.values(mapping)) expect(targets.has(target), target).toBe(true);
    expect([...targets].filter(target => !Object.values(mapping).includes(target)).sort()).toEqual(["sections.account-summary", "sections.band", "sections.boundary-message", "sections.call-to-action", "sections.candidate-preview", "sections.cards", "sections.consent", "sections.legal-prose", "sections.logo-hero", "sections.logo-mark", "sections.newsletter", "sections.question-packet", "sections.queue-list", "sections.record-detail", "sections.sectioned-document", "sections.sign-in-form", "sections.slot-detail", "sections.slot-gallery", ...["swatch", "color-ramp", "type-ladder", "spacing-ladder", "radius-ladder", "motion-player", "asset-grid", "icon-grid", "variant-matrix", "section-viewports", "frame-viewports", "rich-passage", "copy-in-context", "page-viewports"].map(leaf => `sections.specimen-${leaf}`)].sort());
  });

  it("agrees with existing retirement aliases, followed through retired section leaves, without replacing legacy IDs", () => {
    const followed = retired.filter(row => row.id !== "sections.error-message").flatMap(row => {
      const home = liveHome(row.replacedBy);
      return home ? [[row.id, home] as const] : [];
    });
    expect(mapping).toEqual({ ...Object.fromEntries(followed), "say.logo-hero": "sections.hero" });
    expect(retired.filter(row => row.id !== "sections.error-message" && !liveHome(row.replacedBy)).map(row => row.id).sort()).toEqual(homeless);
    expect(BLOCK_ENTRIES).toHaveLength(91);
    expect(BLOCK_ENTRIES.map(block => block.id).sort()).toEqual([...Object.keys(expected), "say.logo-hero", ...homeless, ...unmapped].sort());
  });

  it("attaches homes to mapped entries and leaves the other 36 addresses absent", () => {
    const mapped = BLOCK_ENTRIES.filter(block => block.sectionLeaf !== undefined);
    expect(Object.fromEntries(mapped.map(block => [block.id, block.sectionLeaf]))).toEqual({ ...expected, "say.logo-hero": "sections.hero" });
    expect(BLOCK_ENTRIES.filter(block => block.sectionLeaf === undefined).map(block => block.id).sort()).toEqual([...homeless, ...unmapped].sort());
    for (const block of BLOCK_ENTRIES.filter(block => [...homeless, ...unmapped].includes(block.id))) expect(block).not.toHaveProperty("sectionLeaf");
  });

  it("keeps recipes and unbuilt specs distinct from public implementations", () => {
    const recipes = ["items.features", "items.statement", "items.faq", "items.steps", "matrix.comparison", "items.link-index", "items.topics"];
    for (const id of recipes) {
      const block = BLOCK_ENTRIES.find(block => block.id === id);
      expect(block?.export, id).toBeNull();
      expect(block?.recipeOf, id).toBe(id === "matrix.comparison" ? "matrix.raw" : "items.raw");
    }
    for (const id of ["matrix.data-grid", "form.save-bar", "form.load-more"]) {
      const block = BLOCK_ENTRIES.find(block => block.id === id);
      expect(block?.export, id).toBeNull();
      expect(block?.built, id).toBe("no");
    }
    for (const [id, name] of [["items.stat", "Stat"], ["items.usage-meter", "UsageMeter"], ["items.event-item", "EventItem"], ["say.testimonial", "Testimonial"], ["matrix.grouped-table", "GroupedTable"], ["items.record-ledger", "RecordLedger"], ["form.filter-builder", "FilterBuilder"], ["form.form-wizard", "FormWizard"], ["form.settings-section", "SettingsSection"], ["items.cards", "RecordCards"], ["items.stat-grid", "StatGroup"], ["items.media-gallery", "Gallery"], ["say.error-state", "ErrorState"], ["say.notice-stack", "NoticeList"], ["say.call-to-action", "CallToAction"], ["items.timeline", "Timeline"], ["items.activity-feed", "ActivityFeed"], ["matrix.audit-log", "AuditLog"]]) {
      expect(BLOCK_ENTRIES.find(block => block.id === id)?.export, id).toBe(name);
    }
  });
});
