import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import sectionSlots from "../../catalog/slots/sections.json" with { type: "json" };
import type { SectionSlot } from "../../catalog-core/sections-contract.js";
import { dsAttrs } from "../../catalog-core/provenance-attrs.js";
import { scanProvenance } from "../../catalog-core/provenance-scan.js";
import { checkWiring } from "../../catalog-core/wiring.js";
import { GROUP_A_CONTENT, GROUP_A_LEAVES, GROUP_A_MEMBERS, groupASectionInput, type GroupAFillDocument, type GroupALeaf } from "./group-a-dataset.js";
import { GROUP_A_SECTION_INPUTS, GROUP_A_SECTION_RENDERERS } from "./group-a.js";

const here = dirname(fileURLToPath(import.meta.url));
const fill = (leaf: GroupALeaf): GroupAFillDocument => JSON.parse(readFileSync(resolve(here, `../../catalog/fills/foundry/sections.${leaf}.json`), "utf8")) as GroupAFillDocument;
const contracts = sectionSlots as unknown as readonly SectionSlot[];
const PAGE = dsAttrs("pages", "pages.sx-a-sections", "foundry/pages.sx-a-sections");

/** The renderer's output from its generated fill and the dataset, inside a stamped page root, as SSR markup. */
function rendered(leaf: GroupALeaf, members?: readonly string[]): string {
  const input = groupASectionInput(leaf, fill(leaf), {
    ...(members ? { members } : {}),
    // The band hosts one placed Section; its own contract has no content slots.
    ...(leaf === "band" ? { slots: { body: [GROUP_A_SECTION_RENDERERS["sections.features"]!(groupASectionInput("features", fill("features")))] } } : {}),
  });
  return renderToStaticMarkup(<main {...PAGE}>{GROUP_A_SECTION_RENDERERS[`sections.${leaf}`]!(input)}</main>);
}
function mounted(html: string): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.append(container);
  return container;
}
function wiring(leaf: GroupALeaf, html: string) {
  return scanProvenance({
    html,
    route: { id: "sx-a-sections", binding: { frame: { leaf: "frames.app-shell" }, frameSlots: {}, sections: { main: [{ leaf: `sections.${leaf}`, fill: `foundry/sections.${leaf}` }] } } },
    selection: { [`sections.${leaf}`]: `foundry/sections.${leaf}` },
  }).findings;
}

/** Real registered component roles each leaf must render from its dataset content. */
const ROLES: Readonly<Record<GroupALeaf, (view: ReturnType<typeof within>, container: HTMLElement) => void>> = {
  article: view => { expect(view.getByRole("heading", { level: 2, name: "Summary" })).toBeInTheDocument(); expect(view.getByRole("list")).toBeInTheDocument(); },
  // FeatureGrid item headings are plain paragraphs under the grid's own heading level.
  band: view => { expect(view.getByText("Sync scheduled")).toBeInTheDocument(); },
  "call-to-action": view => { expect(view.getByRole("heading", { name: "Order details" })).toBeInTheDocument(); expect(view.getByRole("link", { name: "View order" })).toHaveAttribute("href", "#order-1001"); expect(view.getByRole("link", { name: "Orders" })).toBeInTheDocument(); },
  comparison: view => { expect(view.getByRole("table")).toBeInTheDocument(); expect(view.getAllByRole("columnheader").map(cell => cell.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("Monthly"), expect.stringContaining("Yearly")])); expect(view.getByRole("rowheader", { name: /Urgent/ })).toBeInTheDocument(); },
  content: view => { expect(view.getByRole("heading", { name: "Order #1001" })).toBeInTheDocument(); expect(view.getByRole("link", { name: "View order" })).toBeInTheDocument(); expect(view.getAllByText("Response time").length).toBeGreaterThan(0); },
  faq: view => { expect(view.getByRole("button", { name: "Shipping" })).toHaveAttribute("aria-expanded", "false"); expect(view.getByRole("button", { name: "Returns" })).toBeInTheDocument(); },
  features: view => { for (const name of ["Sync scheduled", "Order shipped", "Storage nearly full"]) expect(view.getByText(name)).toBeInTheDocument(); },
  gallery: view => { expect(view.getAllByRole("button").length).toBe(3); expect(view.getAllByText("Orders by region").length).toBeGreaterThan(0); },
  hero: view => { expect(view.getByRole("heading", { level: 1, name: "Northwind" })).toBeInTheDocument(); expect(view.getByRole("link", { name: "View order" })).toBeInTheDocument(); expect(view.getAllByText("Orders by region").length).toBeGreaterThan(0); },
  "logo-cloud": view => { expect(view.getAllByRole("listitem")).toHaveLength(4); expect(view.getByText("Northwind Labs")).toBeInTheDocument(); },
  // MediaFigure's own figure holds the chart, which is itself a labelled figure.
  media: (view, container) => { expect(view.getAllByRole("figure").length).toBeGreaterThan(0); expect([...container.querySelectorAll("figcaption")].map(caption => caption.textContent)).toContain("Orders by region"); },
  newsletter: view => { expect(view.getByRole("textbox", { name: /Email address/ })).toHaveAttribute("type", "email"); expect(view.getByRole("button", { name: "Submit" })).toBeInTheDocument(); },
  people: view => { expect(view.getAllByRole("listitem")).toHaveLength(4); expect(view.getByText("Ada Park")).toBeInTheDocument(); },
  pricing: view => { expect(view.getByText("Draft")).toBeInTheDocument(); expect(view.getByRole("link", { name: "Save changes" })).toBeInTheDocument(); expect(view.getByRole("link", { name: "Submit" })).toBeInTheDocument(); },
  testimonials: view => { expect(view.getAllByRole("listitem")).toHaveLength(3); expect(view.getByText("Ada Park")).toBeInTheDocument(); },
};

describe("group-a Section runtime renderers", () => {
  afterEach(() => { document.body.replaceChildren(); });

  it("registers exactly the 15 group-a leaves, each with declared inputs", () => {
    expect(Object.keys(GROUP_A_SECTION_RENDERERS).sort()).toEqual(GROUP_A_LEAVES.map(leaf => `sections.${leaf}`).sort());
    expect(Object.keys(GROUP_A_SECTION_INPUTS).sort()).toEqual(Object.keys(GROUP_A_SECTION_RENDERERS).sort());
    for (const renderer of Object.values(GROUP_A_SECTION_RENDERERS)) expect(typeof renderer).toBe("function");
  });

  it.each(GROUP_A_LEAVES)("sections.%s reads exactly its fill's slot and member keys, and the dataset fills every mapped required slot", leaf => {
    const entry = fill(leaf).sections[leaf]!;
    const inputs = GROUP_A_SECTION_INPUTS[`sections.${leaf}`]!;
    expect([...inputs.slots].sort()).toEqual(Object.keys(entry.slotMap).sort());
    expect([...inputs.members].sort()).toEqual(Object.keys(entry.propMap).sort());
    const required = contracts.find(slot => slot.id === `sections.${leaf}`)!.contract.slots.filter(slot => slot.required).map(slot => slot.name);
    for (const slot of required.filter(name => inputs.slots.includes(name))) expect(GROUP_A_CONTENT[leaf], slot).toHaveProperty([slot]);
    for (const slot of Object.keys(GROUP_A_CONTENT[leaf])) expect(inputs.slots).toContain(slot);
    for (const member of GROUP_A_MEMBERS[leaf]) expect(inputs.members).toContain(member);
  });

  it.each(GROUP_A_LEAVES)("sections.%s renders its real stamped block with component roles and no wiring finding", leaf => {
    const html = rendered(leaf);
    expect(wiring(leaf, html), "WL1/WL5/WL6/WL7 provenance findings").toEqual([]);
    const container = mounted(html), view = within(container);
    const root = container.querySelector(`[data-ds-leaf="sections.${leaf}"]`);
    expect(root, "stamped Section root").not.toBeNull();
    expect(root!.getAttribute("data-ds-fill")).toBe(`foundry/sections.${leaf}`);
    expect(container.querySelector("main")!.firstElementChild).toBe(root);
    ROLES[leaf](view, container);
  });

  it("selects members through the fill's propMap", () => {
    expect(rendered("logo-cloud", ["count.4", "monochrome.true"])).toContain("grayscale");
    expect(rendered("logo-cloud")).not.toContain("grayscale");
    expect(mounted(rendered("gallery", ["lightbox.disabled"])).querySelectorAll("button")).toHaveLength(0);
    expect(rendered("hero", ["layout.editorial", "size.compact"])).not.toBe(rendered("hero"));
    expect(() => rendered("logo-cloud", ["count.3"])).toThrow(/count/);
    expect(() => rendered("testimonials", ["layout.single"])).toThrow(/layout/);
  });

  it("refuses content the fill does not map and members outside it", () => {
    const article = groupASectionInput("article", fill("article"));
    const toc = { ...article, content: { ...article.content, toc: { ...article.content.body!, reference: { kind: "region" as const, ref: "dataset:toc" } } } };
    expect(() => GROUP_A_SECTION_RENDERERS["sections.article"]!(toc)).toThrow(/toc is not mapped/);
    const band = groupASectionInput("band", fill("band"), { members: ["ground.transparent"] });
    expect(() => GROUP_A_SECTION_RENDERERS["sections.band"]!(band)).toThrow(/ground.transparent is not mapped/);
    const comparison = groupASectionInput("comparison", fill("comparison"), { members: ["arrangement.library-board"] });
    expect(() => GROUP_A_SECTION_RENDERERS["sections.comparison"]!(comparison)).toThrow(/library-board/);
  });

  it("renderer sources pass the static wiring scan (no headless engine, no raw values)", () => {
    const files = [...GROUP_A_LEAVES.map(leaf => `${leaf}.tsx`), "group-a.ts", "group-a-content.tsx"];
    const result = checkWiring({ sources: files.map(file => ({ path: `src/runtime/sections/${file}`, content: readFileSync(resolve(here, file), "utf8"), layer: "sections" as const })) });
    expect(result.findings.filter(row => row.severity === "error")).toEqual([]);
  });
});
