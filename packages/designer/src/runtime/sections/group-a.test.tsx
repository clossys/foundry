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
import { specimenDataset } from "../../studio/specimen-dataset.js";

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

const S = specimenDataset.sections;
/** Real registered component roles each leaf must render from its dataset content. */
const ROLES: Readonly<Record<GroupALeaf, (view: ReturnType<typeof within>, container: HTMLElement) => void>> = {
  article: view => { expect(view.getByRole("heading", { level: 2, name: S.articleBody.heading })).toBeInTheDocument(); expect(view.getByText(S.articleBody.body)).toBeInTheDocument(); },
  // FeatureGrid item headings are plain paragraphs under the grid's own heading level.
  band: view => { expect(view.getByText(S.featureGrid.items[0]!.heading)).toBeInTheDocument(); },
  "call-to-action": view => { expect(view.getByRole("heading", { name: S.callToAction.title })).toBeInTheDocument(); expect(view.getByRole("link", { name: S.callToAction.primary.label })).toHaveAttribute("href", S.callToAction.primary.href); expect(view.getByRole("link", { name: S.callToAction.secondary.label })).toBeInTheDocument(); },
  comparison: view => { expect(view.getByRole("table")).toBeInTheDocument(); expect(view.getAllByRole("columnheader").map(cell => cell.textContent)).toEqual(expect.arrayContaining(S.comparison.columns.map(column => expect.stringContaining(column.label as string)))); expect(view.getByRole("rowheader", { name: S.comparison.rows[0]!.label as string })).toBeInTheDocument(); expect(view.getAllByText(S.comparison.featuredLabel as string).length).toBeGreaterThan(0); },
  content: view => { expect(view.getByRole("heading", { name: S.content.heading })).toBeInTheDocument(); expect(view.getByText(S.content.body)).toBeInTheDocument(); expect(view.getByRole("link", { name: specimenDataset.text.link })).toBeInTheDocument(); expect(view.getAllByText(specimenDataset.charts.line.title).length).toBeGreaterThan(0); },
  faq: view => { expect(view.getByRole("button", { name: S.faq.items[0]!.question })).toHaveAttribute("aria-expanded", "false"); expect(view.getByRole("button", { name: S.faq.items[1]!.question })).toBeInTheDocument(); },
  features: view => { for (const item of S.featureGrid.items) expect(view.getByText(item.heading)).toBeInTheDocument(); },
  gallery: view => { expect(view.getAllByRole("button").length).toBe(S.gallery.images.length); expect(view.getAllByText(S.gallery.images[0]!.caption).length).toBeGreaterThan(0); },
  hero: view => { expect(view.getByRole("heading", { level: 1, name: S.hero.heading })).toBeInTheDocument(); expect(view.getByRole("link", { name: S.hero.primary })).toBeInTheDocument(); expect(view.getAllByText(specimenDataset.charts.bar.title).length).toBeGreaterThan(0); },
  "logo-cloud": view => { expect(view.getAllByRole("listitem")).toHaveLength(S.logoCloud.names.length); for (const name of S.logoCloud.names) expect(view.getByText(name)).toBeInTheDocument(); },
  // MediaFigure's own figure holds the chart, which is itself a labelled figure.
  media: (view, container) => { expect(view.getAllByRole("figure").length).toBeGreaterThan(0); expect([...container.querySelectorAll("figcaption")].map(caption => caption.textContent)).toContain(S.mediaFigure.caption); },
  newsletter: (view, container) => { expect(view.getByRole("textbox", { name: new RegExp(S.newsletter.emailLabel) })).toHaveAttribute("type", "email"); expect(view.getByRole("button", { name: S.newsletter.submitLabel })).toBeInTheDocument(); expect(container.querySelector("form")).toHaveAttribute("action", S.newsletter.action); },
  people: view => { expect(view.getAllByRole("listitem")).toHaveLength(S.peopleGrid.people.length); expect(view.getByText(S.peopleGrid.people[0].name)).toBeInTheDocument(); },
  pricing: view => { for (const tier of S.pricing.tiers) expect(view.getByRole("link", { name: tier.cta })).toHaveAttribute("href", `#${tier.id}`); expect(view.getByText(S.pricing.tiers[1]!.price)).toBeInTheDocument(); },
  testimonials: view => { expect(view.getAllByRole("listitem")).toHaveLength(S.testimonials.items.length); expect(view.getByText(S.testimonials.items[0]!.attributorName)).toBeInTheDocument(); },
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
    expect(rendered("logo-cloud", ["count.3", "monochrome.true"])).toContain("grayscale");
    expect(rendered("logo-cloud")).not.toContain("grayscale");
    expect(mounted(rendered("gallery", ["lightbox.disabled"])).querySelectorAll("button")).toHaveLength(0);
    expect(rendered("hero", ["layout.editorial", "size.compact"])).not.toBe(rendered("hero"));
    expect(() => rendered("logo-cloud", ["count.4"])).toThrow(/count/);
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
