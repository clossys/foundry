/** @vitest-environment node */
/**
 * Every Section's sample content is read from the one shared synthetic dataset (L7). A leaf with a
 * `specimenDataset.sections` record draws its content from that record; no leaf restates copy inline. A string
 * the dataset does not hold is a literal someone typed into a binding file, and fails here.
 */
import { isValidElement } from "react";
import { describe, expect, it } from "vitest";
import type { RuntimeJson } from "../../catalog-core/runtime-ports.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";
import { GROUP_A_CONTENT, GROUP_A_LEAVES } from "./group-a-dataset.js";
import { groupBDataset } from "./group-b-dataset.js";
import { GROUP_C_LEAVES, sectionDatasetC } from "./group-c.js";

const S = specimenDataset.sections;

/** Every string value and object key reachable from a dataset node (React elements and functions are not data). */
function stringsOf(value: unknown, out = new Set<string>(), seen = new Set<object>()): Set<string> {
  if (typeof value === "string") { out.add(value); return out; }
  if (!value || typeof value !== "object" || seen.has(value) || isValidElement(value)) return out;
  seen.add(value);
  for (const [key, item] of Object.entries(value)) {
    if (!Array.isArray(value)) out.add(key);
    stringsOf(item, out, seen);
  }
  return out;
}
const DATASET = stringsOf(specimenDataset);
/** Structural keys whose values name a renderer branch or a registered glyph, not copy or data. */
const STRUCTURAL = new Set(["kind", "chart", "type", "variant", "icon"]);
/**
 * Copy no dataset record carries yet (needs-from-L7): optional chrome regions the fill maps but the dataset has
 * no record for. Each entry is the exact string; anything else unbound fails.
 */
const UNBOUND: Readonly<Record<string, readonly string[]>> = {};

/** Paths of strings in `content` the dataset does not hold (an `#id` anchor counts when the id is dataset data). */
function unboundStrings(leaf: string, content: RuntimeJson, path = "", key = ""): string[] {
  if (typeof content === "string") {
    if (STRUCTURAL.has(key) || DATASET.has(content) || (content.startsWith("#") && DATASET.has(content.slice(1))) || UNBOUND[leaf]?.includes(content)) return [];
    return [`${path}=${JSON.stringify(content)}`];
  }
  if (!content || typeof content !== "object") return [];
  return Object.entries(content).flatMap(([name, item]) => unboundStrings(leaf, item as RuntimeJson, path ? `${path}.${name}` : name, Array.isArray(content) ? key : name));
}

const CONTENT: Readonly<Record<string, Readonly<Record<string, RuntimeJson>>>> = {
  ...Object.fromEntries(GROUP_A_LEAVES.map(leaf => [`sections.${leaf}`, GROUP_A_CONTENT[leaf]])),
  ...groupBDataset,
  ...Object.fromEntries(GROUP_C_LEAVES.map(leaf => [`sections.${leaf}`, sectionDatasetC[leaf](specimenDataset)])),
};

/** Leaf -> its `specimenDataset.sections` record: the content must draw from it. */
const RECORD: Readonly<Record<string, unknown>> = {
  "sections.article": S.articleBody, "sections.call-to-action": S.callToAction, "sections.comparison": S.comparison,
  "sections.content": S.content, "sections.faq": S.faq, "sections.features": S.featureGrid, "sections.gallery": S.gallery,
  "sections.hero": S.hero, "sections.logo-cloud": S.logoCloud, "sections.media": S.mediaFigure, "sections.newsletter": S.newsletter,
  "sections.people": S.peopleGrid, "sections.pricing": S.pricing, "sections.testimonials": S.testimonials,
  "sections.access-matrix": S.accessMatrix, "sections.activity-feed": S.activityFeed, "sections.audit-log": S.auditLog,
  "sections.column-mapper": S.columnMapper, "sections.data-grid": S.dataTable, "sections.data-table": S.dataTable,
  "sections.explorer": S.explorer, "sections.filter-builder": S.filterBuilder, "sections.record-detail": S.detailView,
  "sections.resource-list": S.resourceList, "sections.stats": S.statGroup, "sections.status-list": S.statusList,
  "sections.task-list": S.taskList, "sections.timeline": S.timeline, "sections.usage": S.usageSummary,
  "sections.cards": S.recordCards, "sections.chat": S.chat, "sections.consent": S.consentBanner, "sections.empty-state": S.emptyState,
  "sections.error-state": S.errorState, "sections.form": S.form, "sections.link-index": S.navGrid, "sections.notices": S.noticeList,
  "sections.page-header": S.pageHeader, "sections.pagination": S.pagination, "sections.section-header": S.sectionHeader,
  "sections.settings": S.settingsSection, "sections.steps": S.orderedSteps, "sections.table-of-contents": S.tableOfContents,
  "sections.wizard": S.formWizard,
};

/** Values the record holds that the leaf's content repeats: strings, plus numbers for numeric records. */
function shared(record: unknown, content: RuntimeJson): number {
  const values = new Set<unknown>();
  const walk = (value: unknown, seen = new Set<object>()): void => {
    if (typeof value === "string" || typeof value === "number") { values.add(value); return; }
    if (!value || typeof value !== "object" || seen.has(value) || isValidElement(value)) return;
    seen.add(value);
    for (const item of Object.values(value)) walk(item, seen);
  };
  walk(record);
  let count = 0;
  const visit = (value: RuntimeJson): void => {
    if (typeof value === "string" || typeof value === "number") { if (values.has(value)) count += 1; return; }
    if (value && typeof value === "object") for (const item of Object.values(value)) visit(item as RuntimeJson);
  };
  visit(content);
  return count;
}

describe("Section sample content binds to the shared dataset", () => {
  it("covers all 45 Sections, 44 with a sections record (band holds only nested Sections)", () => {
    expect(Object.keys(CONTENT)).toHaveLength(45);
    expect(Object.keys(RECORD)).toHaveLength(44);
    expect(CONTENT["sections.band"]).toEqual({});
  });

  it.each(Object.keys(CONTENT).sort())("%s holds no copy the dataset does not", leaf => {
    expect(unboundStrings(leaf, CONTENT[leaf]! as RuntimeJson)).toEqual([]);
  });

  it.each(Object.keys(RECORD).sort())("%s draws from its specimenDataset.sections record", leaf => {
    // At least two values of the record (an id alone is not a binding); the media figure's record holds one
    // value the contract has a slot for (its caption).
    expect(shared(RECORD[leaf], CONTENT[leaf]! as RuntimeJson)).toBeGreaterThanOrEqual(leaf === "sections.media" ? 1 : 2);
  });

  it("newsletter reads its email label and form destination from the dataset", () => {
    const newsletter = GROUP_A_CONTENT.newsletter as { email: { label: string }; submit: { action: string; label: string } };
    expect(newsletter.email.label).toBe(S.newsletter.emailLabel);
    expect(newsletter.submit.action).toBe(S.newsletter.action);
    expect(newsletter.submit.label).toBe(S.newsletter.submitLabel);
  });
});
