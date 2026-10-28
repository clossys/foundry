/** @vitest-environment jsdom */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PublisherCopyRef, PublisherCopyResolver } from "./copy.js";
import { PUBLISHER_VALUE_NAME_REFS, createPublisherValueNames, publisherValueRef } from "./value-names.js";
import { PUBLISHER_MENU, publisherMenuDisplay } from "../../planning/menu.js";
import { publisherConfigurationDisplay } from "../../planning/configuration.js";
import { publisherPlanItemDisplay } from "../../planning/plan.js";
import { ConfigurationSummary, ProductionSettingsForm } from "./ProductionSettingsForm.js";
import { instanceFixture } from "../../core/__fixtures__/instance-binding/fixtures.js";
import inventory from "../../../../writer/src/catalog/__fixtures__/admin-name-inventory.json" with { type: "json" };
import meta from "../../../../writer/src/catalog/records/admin-meta.r1.en.json" with { type: "json" };
import studio from "../../../../writer/src/catalog/records/admin-studio.r1.en.json" with { type: "json" };

// Explicit draft-review host: this does not approve records or use them on production.
const records = [...meta.records, ...studio.records];
const previewResolver: PublisherCopyResolver = ref => {
  const record = records.find(record => record.id === ref.id);
  return record ? { ref, text: record.text } : undefined;
};
const names = createPublisherValueNames(previewResolver, "en");
const rawValue = /\b(?:frames|layouts|tokens|pack|web|app|st|sl|stack|split|bento|sidebar-content)\.[a-z0-9_.-]+|\b(?:M[1-4]|LK\d+|[A-Z]{1,10}-\d+)\b/i;
function textNodes(markup: string): string[] {
  const root = new DOMParser().parseFromString(markup, "text/html").body;
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const values: string[] = [];
  while (walker.nextNode()) if (walker.currentNode.textContent?.trim()) values.push(walker.currentNode.textContent.trim());
  return values;
}
function refs(value: unknown): PublisherCopyRef[] {
  if (!value || typeof value !== "object") return [];
  if ("id" in value && typeof value.id === "string" && value.id.startsWith("st.") && Object.keys(value).every(key => ["id", "locale", "values"].includes(key))) return [value as PublisherCopyRef];
  return Object.values(value).flatMap(refs);
}

describe("Publisher value name binding", () => {
  it("maps the exact Writer packet with reference-only immutable entries", () => {
    expect(Object.values(PUBLISHER_VALUE_NAME_REFS).flatMap(Object.values)).toHaveLength(inventory.entries.length);
    for (const entry of inventory.entries) {
      const ref = publisherValueRef(entry.parent, entry.id);
      expect(ref, entry.cellId).toEqual({ id: entry.recordId });
      expect(Object.isFrozen(ref)).toBe(true);
      expect(names(entry.parent, entry.id)).toBe(entry.text);
      const record = records.find(record => record.id === entry.recordId)!;
      expect(record.status).toBe("draft");
      expect(record).not.toHaveProperty("approval");
    }
  });

  it.each(["/agents/designer", "/agents/writer", "/agents/publisher"])("renders no raw ids or ticket codes in %s planning display text nodes", routePath => {
    const fixture = instanceFixture();
    const menu = PUBLISHER_MENU.find(row => row.id === "app.ops")!;
    const configuration = menu.recommendations.find(row => row.lane === "Studio")!.configuration;
    const page = publisherPlanItemDisplay({ id: "FND-1042", menuRef: menu.id, lane: "Studio", answerIds: ["A-42"], openNeeds: [] }, routePath);
    const setup = publisherConfigurationDisplay(configuration);
    expect(page.needsInput).toEqual([]);
    expect(setup.needsInput).toEqual([]);
    const routeRecord = inventory.entries.find(entry => entry.parent === "publisher.planPage" && entry.id === routePath)!;
    const projection = [...refs(page), ...refs(publisherMenuDisplay(menu)), ...refs(setup)];
    const before = JSON.stringify(records);
    const markup = renderToStaticMarkup(<section data-page={routePath}>
      {projection.map((ref, index) => <p key={index}>{previewResolver(ref)!.text}</p>)}
      <ConfigurationSummary configuration={configuration} messages={{ valueNames: names }} />
      {configuration.kind === "web" && <ProductionSettingsForm initial={configuration} configured={false} registries={fixture.registries} messages={{ valueNames: names }} recommendationAnswerIds={["A-42", "FND-1042"]} onApply={() => {}} onReset={() => {}} />}
    </section>);
    const values = textNodes(markup);
    expect(values.length).toBeGreaterThan(20);
    expect(values).toContain(routeRecord.text);
    for (const value of values) expect(value, `text node: ${value}`).not.toMatch(rawValue);
    const doc = new DOMParser().parseFromString(markup, "text/html");
    for (const input of doc.querySelectorAll<HTMLInputElement>('input:not([type="hidden"])')) expect(input.value).not.toMatch(rawValue);
    expect(JSON.stringify(records)).toBe(before);
  });

  it("keeps unknown consumer values unbound and rejects unresolved or mismatched host resolutions", () => {
    expect(publisherValueRef("publisher.frame", "frames.consumer-private")).toBeUndefined();
    expect(names("publisher.answer", "FND-1042")).toBeUndefined();
    expect(publisherValueRef("__proto__", "constructor")).toBeUndefined();
    expect(() => createPublisherValueNames(() => undefined)("publisher.format", "web.page.responsive")).toThrow(/unresolved/);
    expect(() => createPublisherValueNames(ref => ({ ref: { id: "st.foreign" }, text: "Foreign" }))("publisher.format", "web.page.responsive")).toThrow(/unresolved/);
  });
});
