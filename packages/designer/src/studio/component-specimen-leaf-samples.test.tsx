import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import * as components from "../components/index.js";
import type { CompositeResolved } from "../catalog-core/index.js";
import { glyphs } from "../components/preview-runtime/adapters/glyphs.js";
import componentProfile from "./default-component-preview-profile.json" with { type: "json" };
import { defaultComponentPreviews } from "./default-component-previews.js";
import { componentSpecimenPreview } from "./component-specimens.js";
import { SPECIMEN_SHOW_ALL_COPY } from "./component-specimen-leaf-samples.js";
import { specimenDataset } from "./specimen-dataset.js";
import { loadCatalogBundles } from "../catalog-bundles.js";

const writerRecords = (file: string) => JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), `../../../writer/src/catalog/records/${file}`), "utf8")) as {
  records: { id: string; context: string; text?: string }[]; aliases?: Record<string, string>;
};
const profile = { selectionHash: componentProfile.selectionHash, components: componentProfile, values: { members: Object.fromEntries(Object.entries(glyphs).map(([slot, value]) => [slot, { slot, value: { light: value } }])) } } as unknown as CompositeResolved;

// The registered section each specimen leaf draws at rest, with its own dataset recipe.
const sections = {
  "components.specimen-swatch": "sections.specimen-swatch",
  "components.specimen-ladder": "sections.specimen-type-ladder",
  "components.specimen-player": "sections.specimen-motion-player",
  "components.specimen-grid": "sections.specimen-asset-grid",
  "components.specimen-matrix": "sections.specimen-variant-matrix",
  "components.specimen-viewport": "sections.specimen-section-viewports",
  "components.specimen-passage": "sections.specimen-rich-passage",
  "components.specimen-copy-in-context": "sections.specimen-copy-in-context",
} as const;

it.each(Object.entries(sections))("draws %s as its %s section with dataset items, never a NEED", (leaf, section) => {
  const html = renderToStaticMarkup(<>{defaultComponentPreviews.preview(leaf, profile)}</>);
  const document = new DOMParser().parseFromString(html, "text/html");
  expect(document.querySelector(`[data-ds-specimen-section="${section}"]`), leaf).not.toBeNull();
  expect(document.querySelectorAll("[data-ds-specimen-item]").length, leaf).toBeGreaterThan(0);
  expect(document.querySelector("[data-specimen-unavailable], [data-specimen-error], [data-ds-specimen-need]"), leaf).toBeNull();
});

it("draws the section viewports with the selected Foundry surface at each breakpoint", () => {
  const html = renderToStaticMarkup(<>{defaultComponentPreviews.preview("components.specimen-viewport", profile)}</>);
  const document = new DOMParser().parseFromString(html, "text/html");
  expect([...document.querySelectorAll("[data-specimen-viewport]")].map(node => node.getAttribute("data-specimen-width"))).toEqual(["var(--breakpoint-desktop)", "var(--breakpoint-mobile)"]);
  for (const viewport of document.querySelectorAll("[data-specimen-viewport]")) expect(viewport.textContent?.trim()).not.toBe("");
});

it("takes Writer-owned copy from the Writer snapshot, unchanged from the catalogue", () => {
  const site = writerRecords("site.en.json");
  for (const [id, row] of Object.entries(specimenDataset.writer)) {
    const record = site.records.find(candidate => candidate.id === id);
    expect(record, id).toBeDefined();
    expect({ context: record!.context, text: record!.text }, id).toEqual(row);
  }
  const html = renderToStaticMarkup(<>{componentSpecimenPreview({ modules: { "@clossys/designer/components": components } }).preview("components.media-player", mediaPlayerProfile())}</>);
  expect(html).toContain(specimenDataset.writer["st.7mpayr0001"].text);
  expect(html).not.toMatch(/data-specimen-(?:unavailable|error)=/);
});

it("resolves the show-all action through the host's Writer resolver only", () => {
  const pages = writerRecords("admin-pages.r1.en.json");
  expect(pages.aliases?.["strings.admin.action.showAll"]).toBe(SPECIMEN_SHOW_ALL_COPY.id);
  expect(pages.records.some(record => record.id === SPECIMEN_SHOW_ALL_COPY.id)).toBe(true);
});

/** The registered Foundry media-player fill alone, as a host that selected only that leaf passes it. */
function mediaPlayerProfile(): CompositeResolved {
  const fill = loadCatalogBundles().componentFills.flatMap(doc => Object.values(doc.components)).find(fill => fill.source === "foundry" && fill.slot === "components.media-player")!;
  const component = { slot: fill.slot, originKind: "adopted", origin: { kind: "adopted", source: "foundry" }, impl: fill.impl, propMap: fill.propMap, reads: { themes: {}, assets: [], components: [] }, descriptor: fill };
  return { selectionHash: "selection-media-player", components: { components: { [fill.slot]: component } } } as unknown as CompositeResolved;
}
