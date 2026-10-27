import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { dsAttrs } from "../../catalog-core/provenance-attrs.js";
import { scanProvenance } from "../../catalog-core/provenance-scan.js";
import { runtimeHash, type RuntimeContentRef, type RuntimeJson } from "../../catalog-core/runtime-ports.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";
import { plainJson } from "./dataset-json.js";
import { groupASectionInput, type GroupAFillDocument, type GroupALeaf } from "./group-a-dataset.js";
import { GROUP_A_SECTION_RENDERERS } from "./group-a.js";

const here = dirname(fileURLToPath(import.meta.url));
const fill = (leaf: GroupALeaf): GroupAFillDocument => JSON.parse(readFileSync(resolve(here, `../../catalog/fills/foundry/sections.${leaf}.json`), "utf8")) as GroupAFillDocument;
const PAGE = dsAttrs("pages", "pages.sx-a-sections", "foundry/pages.sx-a-sections");
const S = specimenDataset.sections;

type Input = ReturnType<typeof groupASectionInput>;
const draw = (leaf: GroupALeaf, input: Input) => renderToStaticMarkup(<main {...PAGE}>{GROUP_A_SECTION_RENDERERS[`sections.${leaf}`]!(input)}</main>);
const placedFeatures = () => ({ body: [GROUP_A_SECTION_RENDERERS["sections.features"]!(groupASectionInput("features", fill("features")))] });
/** The leaf rendered from its generated fill and the dataset with the given members selected. */
function rendered(leaf: GroupALeaf, members?: readonly string[]): string {
  return draw(leaf, groupASectionInput(leaf, fill(leaf), { ...(members ? { members } : {}), ...(leaf === "band" ? { slots: placedFeatures() } : {}) }));
}
/** The input with extra resolved content slots, as the assembly hands them over (reference, value and hash). */
function withContent(input: Input, values: Readonly<Record<string, RuntimeJson>>): Input {
  const content = { ...input.content }, references: Record<string, RuntimeContentRef> = { ...input.selection.content };
  for (const [slot, value] of Object.entries(values)) {
    const reference: RuntimeContentRef = { kind: "region", ref: `dataset:${specimenDataset.seed}/sections.article.${slot}` };
    content[slot] = { reference, value, hash: runtimeHash(value) };
    references[slot] = reference;
  }
  return { ...input, content, selection: { ...input.selection, content: references } };
}
function mounted(html: string): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.append(container);
  return container;
}

/** The dataset's table of contents, and an article body whose headings carry the ids those links target. */
const TOC = plainJson(S.tableOfContents);
const BODY: RuntimeJson = [
  ...S.tableOfContents.items.map(item => ({ kind: "heading", id: item.id, text: item.label })),
  { kind: "paragraph", text: S.articleBody.body },
];

describe("group-a renderers pass the contract members and slots the blocks now take", () => {
  afterEach(() => { document.body.replaceChildren(); });

  it("sections.faq: layout.two-column splits the questions into two lists; layout.list is the default list", () => {
    const list = rendered("faq", ["layout.list"]);
    expect(rendered("faq", [])).toBe(list);
    expect(list).not.toContain("data-faq-columns");
    const twoColumn = rendered("faq", ["layout.two-column"]);
    expect(twoColumn).not.toBe(list);
    const columns = mounted(twoColumn).querySelector("[data-faq-columns]");
    expect(columns).not.toBeNull();
    expect(columns!.children).toHaveLength(2);
    expect(within(columns as HTMLElement).getAllByRole("button")).toHaveLength(S.faq.items.length);
  });

  it("sections.features: layout.list and layout.split each change the rendered grid; layout.grid is the default", () => {
    const grid = rendered("features", ["layout.grid"]);
    expect(rendered("features", [])).toBe(grid);
    const list = rendered("features", ["layout.list"]), split = rendered("features", ["layout.split"]);
    expect(new Set([grid, list, split]).size).toBe(3);
    expect(grid).toContain("desktop:grid-cols-3");
    expect(list).not.toContain("tablet:grid-cols-2");
    expect(split).toContain("tablet:grid-cols-2");
    expect(split).not.toContain("desktop:grid-cols-3");
  });

  it("sections.band: ground.transparent paints no surface or ink and keeps the selected measure", () => {
    const sunken = rendered("band", ["ground.sunken", "measure.content"]);
    const transparent = rendered("band", ["ground.transparent", "measure.content"]);
    expect(transparent).not.toBe(sunken);
    const band = mounted(transparent).querySelector('[data-ds-leaf="sections.band"]') as HTMLElement;
    expect(band.className).not.toMatch(/\bbg-/);
    expect(band.className).not.toMatch(/\btext-ink-/);
    expect(sunken).toContain("bg-surface-sunken");
    expect(within(band).getByText(S.featureGrid.items[0]!.heading)).toBeInTheDocument();
  });

  it("sections.article: the toc region composes the registered TableOfContents beside the body", () => {
    const plain = groupASectionInput("article", fill("article"));
    const html = draw("article", withContent(plain, { body: BODY, toc: TOC }));
    expect(html).not.toBe(draw("article", withContent(plain, { body: BODY })));
    const container = mounted(html);
    const region = container.querySelector("[data-article-toc]") as HTMLElement;
    expect(region).not.toBeNull();
    const nav = within(region).getByRole("navigation", { name: S.tableOfContents.label });
    expect(nav.closest('[data-ds-leaf="sections.table-of-contents"]')).not.toBeNull();
    for (const item of S.tableOfContents.items) {
      expect(within(region).getByRole("link", { name: item.label })).toHaveAttribute("href", `#${item.id}`);
      expect(container.querySelector(`[data-article-body] #${item.id}`)?.textContent).toBe(item.label);
    }
    // A route that selects both fills renders both stamps cleanly.
    expect(scanProvenance({
      html,
      route: { id: "sx-a-sections", binding: { frame: { leaf: "frames.app-shell" }, frameSlots: {}, sections: { main: [{ leaf: "sections.article", fill: "foundry/sections.article" }] } } },
      selection: { "sections.article": "foundry/sections.article", "sections.table-of-contents": "foundry/sections.table-of-contents" },
    }).findings).toEqual([]);
  });

  it("sections.article: no toc content keeps the dataset render, and a malformed toc is refused, never dropped", () => {
    const plain = groupASectionInput("article", fill("article"));
    expect(mounted(draw("article", plain)).querySelector("[data-article-toc]")).toBeNull();
    expect(() => draw("article", withContent(plain, { toc: { items: plainJson(S.tableOfContents.items) } }))).toThrow(/toc.label must be text/);
    expect(() => draw("article", withContent(plain, { toc: { label: "On this page", items: [{ id: "intro" }] } }))).toThrow(/toc.items.0.label must be text/);
    expect(() => draw("article", withContent(plain, { toc: { label: "On this page", items: [{ id: "intro", label: "Intro", level: 4 }, { id: "b", label: "B" }] } }))).toThrow(/level/);
  });

  it("refuses a member outside the axis the renderer declares", () => {
    expect(() => rendered("faq", ["layout.grid"])).toThrow(/layout.grid is not mapped/);
    expect(() => rendered("features", ["layout.two-column"])).toThrow(/layout.two-column is not mapped/);
    expect(() => rendered("faq", ["layout.list", "layout.two-column"])).toThrow(/more than one layout/);
  });
});
