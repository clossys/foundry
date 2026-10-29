import { describe, expect, it } from "vitest";
import { pages as source, adminCopyFixture } from "./__fixtures__/copy.mjs";
import { readFileSync } from "node:fs";
import { createAdminPageRegistry, adminPageRef, adminPageStaticContent, ADMIN_PAGE_COPY_REFS } from "./index.js";
import { createDesignerPageRecords } from "./designer.page.js";
import { createWriterPageRecords } from "./writer.page.js";
import { createPublisherPageRecords } from "./publisher.page.js";
import { projectPageOutline } from "../../content/taxonomy.js";
import { normalizeRegionPageRoute } from "../../core/route-registry.js";

const copy = adminCopyFixture();
const skeleton = { l0: [{ id: "strings", label: {id: "strings.admin.group.writer.strings"}, count: 2, estimate: 300, partition: "l1" as const, l1: [{ id: "names", label: {id: "strings.admin.ia.writer.strings.identity-names"}, count: 2, estimate: 250, l2: [{ id: "primary", label: {id: "strings.admin.item.details"}, count: 2, estimate: 200 }] }] }] };
const publication = { id: "admin", mainSlot: "body", frame: { leaf: "frames.app-shell" as const }, layout: { leaf: "layouts.stack" as const, config: "stack.workspace" }, format: "web.page.responsive" as const, surface: "app" as const, context: { consumer: "example", medium: "web" as const }, packIds: ["pack.admin"] };

describe("native scroll admin page records", () => {
  it("passes count to Writer's ICU formatter and uses its complete stat label", () => {
    const contents = adminPageStaticContent("writer", skeleton, copy);
    expect(contents.find(row => row.reference.ref === "admin.writer/strings/stats")?.value).toEqual([{ id: "count", label: "2 records" }]);
    expect(copy.provenance().some(row => row.ref.id === source.aliases["strings.admin.stats.total"] && row.ref.values?.count === 2)).toBe(true);
    expect(() => adminPageStaticContent("writer", skeleton, (() => "suffix") as never)).toThrow(/Writer copy source/);
  });
  it("uses the consumer's resolved item name consistently in the trail, record and outline", () => {
    const result = createAdminPageRegistry({ publication, copy, manifests: { designer: skeleton, writer: skeleton, publisher: skeleton }, itemTitles: { writer: {id: "strings.admin.page.writer"} } });
    const page = result.pages.writer;
    expect(page.item.title).toBe("Writer");
    expect(page.item.composition.header.data.title).toBe("Writer");
    expect(page.item.composition.binding.label).toBe("Writer");
    expect(page.itemManifest.l0[0]?.label).toBe("Writer");
    expect(page.list.title).toBe("Writer");
    expect(() => createWriterPageRecords({ publicationId: "admin", manifest: skeleton, copy, itemTitle: {id: "missing"} })).toThrow(/Writer/);
  });
  it("wires exactly six region pages to one publication, without complete bodies", () => {
    const result = createAdminPageRegistry({ publication, copy, manifests: { designer: skeleton, writer: skeleton, publisher: skeleton } });
    expect(result.registry.routes.map(route => route.path)).toEqual(["/agents/designer", "/agents/designer/[l0]/[id]", "/agents/writer", "/agents/writer/[l0]/[id]", "/agents/publisher", "/agents/publisher/[l0]/[id]"]);
    for (const route of result.registry.routes) {
      expect(route.composition).not.toHaveProperty("complete");
      expect(route.composition.binding).not.toHaveProperty("frame");
      expect(route.composition.binding.regions["page-module"]?.[0]?.section).toBe("sections.table-of-contents");
      const native = normalizeRegionPageRoute(result.registry, route).composition.binding;
      expect(native.frame.leaf).toBe("frames.app-shell");
      expect(native.frame.slotFills).not.toHaveProperty("inspector");
    }
    expect(result.registry.publication?.inspector?.section).toBe("sections.chat");
  });
  it.each([createDesignerPageRecords, createWriterPageRecords, createPublisherPageRecords])("projects the consumer skeleton into native h2/h3/h4 placements and lazy partitions", create => {
    const records = create({ publicationId: "admin", manifest: skeleton, copy });
    const outline = projectPageOutline(records.list.composition.binding, records.manifest);
    expect(outline.anchors).toEqual(["strings", "strings--names", "strings--names--primary"]);
    const main = records.list.composition.binding.regions.main;
    expect(main[0]).toMatchObject({ section: "sections.section-header", config: "level-2", content: { heading: { kind: "copy", ref: expect.stringContaining("strings/heading") } } });
    expect(main[0]?.content.heading).not.toHaveProperty("lazy");
    expect(main[1]).toMatchObject({ section: "sections.band", members: { ground: "sunken" }, children: [{ section: "sections.section-header", config: "level-3" }, { section: "sections.data-table", repeat: { key: "id" } }] });
    expect(main[1]?.repeat?.over.lazy?.args).toEqual({ l0: "strings", l1: "names" });
    expect(records.item.composition.binding.regions.main[1]?.section).toBe("sections.record-detail");
  });
  it("keeps labels as Writer references and unknown item data outside page records", () => {
    expect(ADMIN_PAGE_COPY_REFS.showAll).toEqual({ kind: "copy", ref: "strings.admin.action.showAll" });
    expect(adminPageRef("writer", "columns")).toEqual({ kind: "records", ref: "admin.writer/columns" });
    const records = createWriterPageRecords({ publicationId: "admin", manifest: { l0: [{ id: "lexicon", label: {id: "strings.admin.group.writer.lexicon"}, count: 0, estimate: 80, l1: [] }] }, copy });
    expect(records.list.composition.binding.regions.main[1]).toMatchObject({ section: "sections.empty-state", members: { kind: "empty", scope: "region" } });
    expect(JSON.stringify(records)).not.toContain("English-store");
  });
  it("has no imports from frozen paths or retired route bodies", () => {
    for (const file of ["index.ts", "admin-page.ts", "designer.page.ts", "writer.page.ts", "publisher.page.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).not.toMatch(/(?:from|import\s*\()[^\n]*(?:blocks\/canvas|CanvasMap|CanvasZoom|studio\/(?:canvas|useCanvasWorld|CanvasDomain|canvas-boards|canvas-model|visible-rows|system-canvas)|PublisherBoard|ItemAssemblyView|LeafCell|DesignerRoutePage|WriterRoutePage|PublisherRoutePage|PublisherPage)/);
    }
  });
});
