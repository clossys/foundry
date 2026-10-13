import { describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { desugarRecipe } from "../../core/content-contract.js";
import { resolveSectionedViewDocument, validateSectionedViewDocument, type SectionedViewDocument } from "../../core/sectioned-view.js";
import { SectionedView } from "../../web/views/SectionedView.js";
import { SectionedView as ServerSectionedView } from "../../web/views/SectionedView.server.js";
import { deriveCatalogFunction, readerCopyResolver } from "./reader-data.js";
import { READER_PAGES, readerConfigCells } from "./reader-renderer.js";
import { buildCatalogFunctionPages } from "../render-content-catalog.js";

function source(): SectionedViewDocument {
  const example = readerConfigCells("Index").find(cell => cell.id === "status-list");
  expect(example, "Index needs a status-list configuration example").toBeDefined();
  return { id: "status-list-example", sections: [structuredClone(example!.fixture.section)] };
}

describe("Index status-list configuration contract", () => {
  it("uses topics rows with status badges inside the existing Index budget", () => {
    const doc = source();
    expect(validateSectionedViewDocument(doc)).toEqual([]);
    const section = doc.sections[0]!;
    expect(deriveCatalogFunction(section)).toBe("Index");
    if (section.kind !== "content-section" || section.block?.type !== "items") throw new Error("Expected canonical Items");
    expect(section.block.recipe).toBe("topics");
    expect(desugarRecipe(section.block)).toMatchObject({ arrangement: "rows", columns: 1, order: "none", reveal: "all", treatment: "rule", scale: "item" });
    expect(section.block.items).toHaveLength(3);
    expect(section.block.items.every(item => item.badge !== undefined)).toBe(true);
    const axes = READER_PAGES.find(page => page.label === "Index")!.axes;
    expect(axes.map(axis => [axis.name, axis.values])).toEqual([
      ["shape", ["rows-1", "rows-2", "tiles"]], ["reveal", ["all", "disclose"]], ["groups", ["off", "on"]],
    ]);
    for (const page of READER_PAGES) {
      expect(page.axes.length).toBeLessThanOrEqual(3);
      expect(page.axes.every(axis => axis.values.length <= 4)).toBe(true);
    }
  });

  it.each([["client", SectionedView], ["server", ServerSectionedView]] as const)("resolves status copy into canonical %s rows", (_entry, View) => {
    const doc = source();
    const resolved = resolveSectionedViewDocument(doc, readerCopyResolver);
    const root = new JSDOM(renderToStaticMarkup(createElement(View, { document: resolved }))).window.document;
    const rows = [...root.querySelectorAll("[data-items] > li")];
    expect(rows).toHaveLength(3);
    expect(rows.map(row => row.querySelector("[data-item-heading]")?.textContent)).toEqual(["Search", "Imports", "Exports"]);
    expect(rows.map(row => row.querySelector("[data-item-meta]")?.textContent)).toEqual(["Live", "In progress", "Planned"]);
    expect(root.querySelector("[data-items]")?.tagName).toBe("UL");
    expect(root.querySelector("ol, dl, details, [data-item-ordinal], [aria-live]")).toBeNull();
    if (doc.sections[0]!.kind !== "content-section" || doc.sections[0]!.block?.type !== "items") throw new Error("Expected Items");
    for (const item of doc.sections[0]!.block.items) expect(resolved.resolutions.some(resolution => resolution.ref.id === item.badge!.label.id)).toBe(true);
  });

  it("fails the document when a status label cannot resolve", () => {
    const doc = source();
    const section = doc.sections[0]!;
    if (section.kind !== "content-section" || section.block?.type !== "items") throw new Error("Expected Items");
    const missing = section.block.items[1]!.badge!.label.id;
    expect(() => resolveSectionedViewDocument(doc, ref => ref.id === missing ? undefined : readerCopyResolver(ref))).toThrow(/could not resolve a CopyRef/);
  });

  it.each(["tone", "color", "label", "order", "count"])("refuses invalid %s before resolving copy", invalid => {
    const doc = source();
    const section = doc.sections[0]!;
    if (section.kind !== "content-section" || section.block?.type !== "items") throw new Error("Expected Items");
    const badge = section.block.items[0]!.badge!;
    if (invalid === "tone") Object.assign(badge, { tone: "purple" });
    if (invalid === "color") Object.assign(badge, { color: "custom" });
    if (invalid === "label") Object.assign(badge, { label: "Live" });
    if (invalid === "order") section.block.order = "connected";
    if (invalid === "count") section.block.items = section.block.items.slice(0, 1);
    expect(validateSectionedViewDocument(doc).length).toBeGreaterThan(0);
    const resolver = vi.fn(readerCopyResolver);
    expect(() => resolveSectionedViewDocument(doc, resolver)).toThrow();
    expect(resolver).not.toHaveBeenCalled();
  });

  it("renders the example on the Index reader page with its configuration witnesses", () => {
    const pages = buildCatalogFunctionPages({ designerTokens: "tokens.css", utilities: "preview.css", brand: null });
    const index = new JSDOM(pages.find(page => page.file === "catalog/index-function.html")!.content).window.document;
    const example = index.querySelector('[data-catalog-config-cell="status-list"]')!;
    expect(example).not.toBeNull();
    expect(example.querySelector("[data-config-caption]")?.textContent).toContain("Index › status list");
    expect(example.querySelectorAll("[data-catalog-axis-witness]")).toHaveLength(3);
    expect(example.querySelectorAll("[data-config-native] [data-items] > li")).toHaveLength(3);
    expect(example.textContent).toContain("In progress");
    for (const page of pages.filter(page => page.file !== "catalog/index-function.html")) expect(page.content).not.toContain('data-catalog-config-cell="status-list"');
  });
});
