import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import { DS_ATTR } from "../../catalog-core/provenance-attrs.js";
import { scanProvenance } from "../../catalog-core/provenance-scan.js";
import { runtimeHash, runtimeSnapshot, type RuntimeContent, type RuntimeContentRef, type RuntimeFillDescriptor } from "../../catalog-core/runtime-ports.js";
import { loadSectionRegistry } from "../../catalog-core/sections-contract.js";
import type { CompositeResolved } from "../../catalog-core/types.js";
import { checkWiring } from "../../catalog-core/wiring.js";
import { GROUP_B_SECTIONS, groupBRenderers } from "./group-b.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";
import { groupBDataset } from "./group-b-dataset.js";
import type { SectionRenderInput } from "./group-b-support.js";

const here = dirname(fileURLToPath(import.meta.url));
const fillsDir = resolve(here, "../../catalog/fills/foundry");
const registry = loadSectionRegistry();
type Leaf = `sections.${string}`;

interface FillDoc { readonly $extensions: { readonly "com.clossys.fill": { readonly id: string; readonly unmapped?: readonly string[] } }; readonly sections: Readonly<Record<string, { readonly slotMap: Readonly<Record<string, string>> }>> }
const fillOf = (leaf: Leaf): FillDoc => JSON.parse(readFileSync(resolve(fillsDir, `${leaf}.json`), "utf8")) as FillDoc;
const slotMapOf = (leaf: Leaf) => Object.values(fillOf(leaf).sections)[0]!.slotMap;
const contractOf = (leaf: Leaf) => registry.slots.find(slot => slot.id === leaf)!.contract;

/** One runtime-assembly-shaped input: the leaf's fill, its dataset content keyed by slot, and one board cell. */
function inputFor(leaf: Leaf, state = "default"): SectionRenderInput {
  const contract = contractOf(leaf), slots = Object.keys(slotMapOf(leaf)).sort(), fill = fillOf(leaf).$extensions["com.clossys.fill"].id;
  const data = groupBDataset[leaf]!, content: Record<string, RuntimeContent> = {}, refs: Record<string, RuntimeContentRef> = {};
  for (const slot of slots) {
    if (!Object.hasOwn(data, slot)) continue;
    const reference: RuntimeContentRef = { kind: contract.slots.find(row => row.name === slot)!.type as RuntimeContentRef["kind"], ref: `dataset:${leaf}/${slot}` };
    const value = runtimeSnapshot(data[slot]!);
    content[slot] = { reference, value, hash: runtimeHash(value) };
    refs[slot] = reference;
  }
  const descriptor: RuntimeFillDescriptor = {
    kind: "section", library: "foundry", fill, leaf, config: null, slots, members: [], states: contract.states ?? [],
    renderer: { id: `${leaf}#test`, source: { entry: `${leaf}.tsx`, files: {}, dependencies: {} }, sourceHash: runtimeHash(leaf) },
  };
  return { path: "body/0", fill: descriptor, selection: { leaf, fill, config: null, members: [], content: refs }, cell: { theme: "light", state, width: 1280 }, content, slots: {}, profile: {} as CompositeResolved };
}

function renderLeaf(leaf: Leaf, state = "default") {
  const view = render(<>{groupBRenderers[leaf]!(inputFor(leaf, state))}</>);
  return { ...view, root: view.container.firstElementChild as HTMLElement };
}

/** Dataset records the block rendered: rows, list items, meters, tree items and selection checkboxes. */
function recordCount(root: HTMLElement): number {
  return root.querySelectorAll("[role=row], [role=rowheader], [role=listitem], li, [role=meter], [role=treeitem], dd").length;
}

/** The rendered markup under a page root, scanned the way a consumer route is: no chrome outside the Section. */
function provenanceOf(leaf: Leaf, html: string) {
  const page = `<main ${DS_ATTR.layer}="pages" ${DS_ATTR.leaf}="pages.preview" ${DS_ATTR.fill}="foundry/pages.preview">${html}</main>`;
  const scan = scanProvenance({ html: page, route: { id: "preview", binding: { frame: { leaf: "frames.none" }, frameSlots: {}, sections: { body: [{ leaf }] } } }, selection: { [leaf]: fillOf(leaf).$extensions["com.clossys.fill"].id } });
  return scan.findings.filter(row => row.code !== "WL7" || row.subject === leaf).map(row => `${row.code} ${row.subject} ${row.message}`);
}

const S = specimenDataset.sections;
/** Real component roles each leaf's composed block renders from the dataset. */
const ROLES: Readonly<Record<Leaf, (root: HTMLElement) => void>> = {
  "sections.access-matrix": root => {
    expect(within(root).getByRole("table", { name: S.accessMatrix["aria-label"] })).toBeTruthy();
    expect(within(root).getAllByText(S.accessMatrix.labels.permissionHeader).length).toBeGreaterThan(0);
    expect(within(root).getAllByRole("checkbox").length).toBeGreaterThanOrEqual(3);
  },
  "sections.activity-feed": root => {
    expect(within(root).getAllByLabelText(S.activityFeed["aria-label"]).length).toBeGreaterThan(0);
    expect(within(root).getAllByRole("listitem").length).toBeGreaterThanOrEqual(groupBDataset["sections.activity-feed"]!.events!.length as number);
    for (const group of S.activityFeed.groups ?? []) expect(within(root).getByRole("link", { name: group.label as string })).toHaveAttribute("href", `#${group.id}`);
  },
  "sections.audit-log": root => {
    expect(within(root).getByRole("grid")).toBeTruthy();
    expect(within(root).getAllByRole("columnheader").length).toBeGreaterThanOrEqual(4);
    expect(within(root).getByRole("searchbox", { name: specimenDataset.searchField.label })).toBeTruthy();
    expect(within(root).getByRole("grid", { name: S.auditLog["aria-label"] })).toBeTruthy();
    expect(within(root).getByRole("button", { name: S.auditLogExport.label })).toBeTruthy();
  },
  "sections.column-mapper": root => {
    expect(within(root).getAllByRole("button").length).toBeGreaterThanOrEqual(4);
    expect(within(root).getByText(S.columnMapper.targets[0]!.label as string)).toBeTruthy();
    expect(within(root).getByText(S.columnMapper.labels.legend)).toBeTruthy();
  },
  "sections.data-grid": root => {
    expect(within(root).getByRole("grid", { name: S.dataGrid.label })).toBeTruthy();
    expect(within(root).getAllByRole("columnheader")[0]!.textContent).toMatch(new RegExp(`^${S.dataTable.headers.id}`));
  },
  "sections.data-table": root => {
    expect(within(root).getByRole("grid", { name: S.dataTable.label })).toBeTruthy();
    expect(within(root).getByRole("navigation", { name: S.dataTable.paginationLabel })).toBeTruthy();
    expect(within(root).getByRole("textbox", { name: specimenDataset.searchField.label })).toBeTruthy();
    for (const row of S.dataTable.rows) expect(within(root).getAllByText(row.customer).length).toBeGreaterThan(0);
    expect(within(root).getAllByRole("checkbox").length).toBeGreaterThanOrEqual(1);
  },
  "sections.explorer": root => {
    expect(within(root).getByRole("tree")).toBeTruthy();
    expect(within(root).getAllByRole("treeitem").length).toBeGreaterThanOrEqual(2);
    expect(within(root).getByRole("grid")).toBeTruthy();
  },
  "sections.filter-builder": root => {
    expect(within(root).getAllByRole("group").length).toBeGreaterThanOrEqual(1);
    expect(within(root).getAllByRole("button").length).toBeGreaterThanOrEqual(3);
    expect(within(root).getByText(S.filterBuilder.labels.legend)).toBeTruthy();
  },
  "sections.record-detail": root => {
    expect(within(root).getByRole("heading", { name: new RegExp(`^${S.detailView.title}`) })).toBeTruthy();
    expect(within(root).getAllByRole("term").length).toBe(groupBDataset["sections.record-detail"]!.fields!.length as number);
    for (const item of specimenDataset.menu.items.slice(0, 2)) expect(within(root).getByRole("button", { name: item.label })).toBeTruthy();
    for (const field of S.detailView.fields) expect(within(root).getAllByText(field.value as string).length).toBeGreaterThan(0);
  },
  "sections.resource-list": root => {
    expect(within(root).getByRole("grid", { name: S.resourceList["aria-label"] })).toBeTruthy();
    expect(within(root).getByRole("toolbar", { name: S.resourceListChrome.toolbar.label })).toBeTruthy();
    for (const toggle of S.resourceListChrome.toolbar.toggles) expect(within(root).getByRole("checkbox", { name: toggle.label })).toBeTruthy();
    expect(within(root).getByRole("navigation", { name: S.resourceListChrome.paginationLabel })).toBeTruthy();
    expect(within(root).getAllByRole("row").length).toBeGreaterThanOrEqual(2);
    expect(within(root).getAllByRole("checkbox").length).toBeGreaterThanOrEqual(2);
  },
  "sections.stats": root => {
    expect(within(root).getByRole("list", { name: S.statGroup["aria-label"] })).toBeTruthy();
    expect(within(root).getAllByRole("listitem").length).toBe(S.statGroup.items.length);
  },
  "sections.status-list": root => {
    expect(within(root).getAllByRole("list").length).toBeGreaterThanOrEqual(1);
    // The heading and every group heading come from the dataset; a grouped record never flattens away its heading.
    expect(within(root).getByRole("heading", { name: S.statusList.heading })).toBeTruthy();
    for (const group of S.statusList.groups ?? []) expect(within(root).getByRole("heading", { name: group.heading as string })).toBeTruthy();
    expect(within(root).getByRole("list", { name: S.statusList.legendLabel })).toBeTruthy();
    for (const group of S.statusList.groups ?? []) for (const item of group.items) expect(within(root).getByText(item.label as string)).toBeTruthy();
  },
  "sections.task-list": root => {
    expect(within(root).getAllByRole("listitem").length).toBeGreaterThanOrEqual(S.taskList.items.length);
    expect(within(root).getAllByLabelText(S.taskList["aria-label"]).length).toBeGreaterThan(0);
    expect(within(root).getByRole("meter", { name: S.taskList.progressText })).toBeTruthy();
  },
  "sections.timeline": root => {
    expect(within(root).getByRole("list", { name: S.timeline["aria-label"] })).toBeTruthy();
    expect(within(root).getAllByRole("heading").length).toBe(S.timeline.events.length);
  },
  "sections.usage": root => {
    expect(within(root).getAllByRole("meter").length).toBe(S.usageSummary.meters.length);
    expect(within(root).getAllByLabelText(S.usageSummary["aria-label"]).length).toBeGreaterThan(0);
  },
};

beforeEach(() => {
  // ModelTable's view options read the viewport through matchMedia, which jsdom does not provide.
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: true, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("group-b Section runtime renderers", () => {
  it("covers exactly the fifteen group-b leaves, each a registered Section contract", () => {
    expect(GROUP_B_SECTIONS.map(section => section.leaf)).toEqual(Object.keys(ROLES));
    for (const section of GROUP_B_SECTIONS) expect(contractOf(section.leaf), section.leaf).toBeDefined();
  });

  for (const section of GROUP_B_SECTIONS) describe(section.leaf, () => {
    it("reads exactly its fill's slot map, and the dataset fills those slots with contract-named content", () => {
      expect(section.slots).toEqual(Object.keys(slotMapOf(section.leaf)).sort());
      const names = contractOf(section.leaf).slots.map(row => row.name);
      for (const slot of section.slots) expect(names, slot).toContain(slot);
      expect(Object.keys(groupBDataset[section.leaf]!).sort()).toEqual(section.slots);
    });

    it("renders its composed block from the fill with dataset data, stamped with the leaf", () => {
      const { root, container } = renderLeaf(section.leaf);
      expect(root.getAttribute(DS_ATTR.layer)).toBe("sections");
      expect(root.getAttribute(DS_ATTR.leaf)).toBe(section.leaf);
      expect(root.getAttribute(DS_ATTR.fill)).toBe(fillOf(section.leaf).$extensions["com.clossys.fill"].id);
      ROLES[section.leaf]!(container);
    });

    it("draws nothing outside its Section stamp (WL1, WL5, WL6, WL7 clean)", () => {
      const { container } = renderLeaf(section.leaf);
      expect(provenanceOf(section.leaf, container.innerHTML)).toEqual([]);
    });

    for (const state of contractOf(section.leaf).states ?? []) it(`renders the contract ${state} state inside its stamp`, () => {
      const filled = recordCount(renderLeaf(section.leaf).root);
      cleanup();
      const { root } = renderLeaf(section.leaf, state);
      expect(root.getAttribute(DS_ATTR.leaf)).toBe(section.leaf);
      if (state === "empty") expect(recordCount(root), "empty renders fewer records").toBeLessThan(filled);
    });
  });

  it("keeps renderer sources free of headless imports and raw values (WL3, WL4)", () => {
    const owned = new Set(GROUP_B_SECTIONS.map(section => `${section.leaf.slice("sections.".length)}.tsx`));
    const sources = readdirSync(here).filter(name => /\.tsx?$/.test(name) && !name.includes(".test.") && (name.startsWith("group-b") || owned.has(name))).map(name => ({ path: `src/runtime/sections/${name}`, content: readFileSync(resolve(here, name), "utf8"), layer: "sections" as const }));
    expect(sources.length).toBeGreaterThanOrEqual(GROUP_B_SECTIONS.length);
    const result = checkWiring({ sources, tokens: [], now: "2026-10-27" });
    expect(result.findings.filter(row => row.code === "WL3" || row.code === "WL4").map(row => `${row.code} ${row.file}:${row.line} ${row.evidence}`)).toEqual([]);
  });
});
