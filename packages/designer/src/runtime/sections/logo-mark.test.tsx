// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import type { RuntimeJson, RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { dsAttrs } from "../../catalog-core/provenance-attrs.js";
import { scanProvenance } from "../../catalog-core/provenance-scan.js";
import { loadSectionRegistry } from "../../catalog-core/sections-contract.js";
import { FOUNDRY_SECTION_MAP, importFoundrySections } from "../../importers/foundry-sections.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";
import { sectionRenderers } from "./index.js";
import { logoMarkRenderer } from "./logo-mark.js";

afterEach(cleanup);
const asset = specimenDataset.assets.mark;
const media = { slot: asset.slot, member: asset.member, src: asset.src };
const leaf = "sections.logo-mark";

function input(values: Readonly<Record<string, RuntimeJson>> = { mark: media }): RuntimeRenderInput<ReactNode> {
  return {
    fill: { leaf, slots: ["mark"], members: [] },
    selection: { leaf, members: [] },
    content: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])),
  } as unknown as RuntimeRenderInput<ReactNode>;
}

describe("sections.logo-mark", () => {
  it("uses the consumer artwork without requiring a name or rendering authored copy", () => {
    const { container } = render(<>{logoMarkRenderer.render(input())}</>);
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(container.querySelector("img")).toHaveAttribute("src", asset.src);
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
    expect(container.textContent).toBe("");
    expect(container.querySelector("h1,h2,h3,p,a,button,svg")).toBeNull();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.querySelector("section")).toHaveAttribute("data-designer-section-frame", "");
  });

  it("uses only the asset's optional accessible metadata, including non-Latin names", () => {
    const name = "علامة";
    const { container } = render(<>{logoMarkRenderer.render(input({ mark: { ...media, name } }))}</>);
    expect(screen.getByRole("img", { name })).toHaveAttribute("dir", "auto");
    expect(container.textContent).toBe("");
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
    expect(container.querySelectorAll("[aria-label]")).toHaveLength(1);
  });

  it("draws sample artwork and metadata from the supplied dataset", () => {
    const replacement = { ...specimenDataset, assets: { ...specimenDataset.assets, mark: { ...asset, src: "/consumer-mark.svg", name: "Consumer" } } };
    expect(logoMarkRenderer.sample(replacement)).toEqual({ mark: { slot: asset.slot, member: asset.member, src: "/consumer-mark.svg", name: "Consumer" } });
  });

  it("registers a media-only draft section with an empty DG1 copy schema", () => {
    expect(sectionRenderers[leaf]).toBe(logoMarkRenderer);
    const slot = loadSectionRegistry().slots.find(row => row.id === leaf)!;
    expect(slot).toMatchObject({ status: "draft", contract: { surface: "site", passageSchema: "passages.logo-mark", slots: [{ name: "mark", type: "media", required: true }], copy: { sourceLocale: "en", fields: [] } } });
    expect(slot.contract.slots).toHaveLength(1);
    expect(FOUNDRY_SECTION_MAP["logo-mark"]).toMatchObject({ export: "SectionFrame", slotMap: { mark: "./blocks#SectionFrame.children" } });
    const imported = importFoundrySections({ slots: [slot], mappings: { "logo-mark": FOUNDRY_SECTION_MAP["logo-mark"]! }, exports: ["SectionFrame"] });
    expect(imported.coverage[0]).toMatchObject({ slot: leaf, status: "candidate", supportedSlots: ["mark"], missingRequiredSlots: [] });
    expect(imported.fills[0]?.sections["logo-mark"]).toMatchObject({ impl: { export: "SectionFrame" }, configs: {} });
  });

  it("emits the selected logo-mark section and fill provenance", () => {
    const html = renderToStaticMarkup(<main {...dsAttrs("pages", "pages.logo-mark-test", "foundry/pages.logo-mark-test")}>{logoMarkRenderer.render(input())}</main>);
    expect(html).toContain('data-ds-leaf="sections.logo-mark"');
    expect(html).toContain('data-ds-fill="foundry/sections.logo-mark"');
    expect(html).not.toContain('data-ds-leaf="sections.logo-hero"');
    expect(scanProvenance({ html,
      route: { id: "logo-mark-test", binding: { frame: { leaf: "frames.app-shell" }, frameSlots: {}, sections: { main: [{ leaf, fill: "foundry/sections.logo-mark" }] } } },
      selection: { [leaf]: "foundry/sections.logo-mark" },
    }).findings).toEqual([]);
  });

  it.each([
    [{}, /mark/],
    [{ mark: asset.src }, /mark must be an object/],
    [{ mark: { ...media, slot: "assets.wordmark" } }, /assets.mark/],
    [{ mark: { ...media, member: "invented" } }, /mark.member/],
    [{ mark: { ...media, src: " " } }, /mark.src/],
    [{ mark: { ...media, name: 1 } }, /mark.name/],
    [{ mark: { ...media, description: "Extra" } }, /mark.description/],
    [{ mark: media, name: "Authored copy" }, /name/],
    [{ mark: media, heading: "Placeholder" }, /heading/],
  ] satisfies readonly [Readonly<Record<string, RuntimeJson>>, RegExp][])("refuses unsupported media or copy %#", (values, message) => {
    expect(() => logoMarkRenderer.render(input(values))).toThrow(message);
  });

  it("refuses a foreign leaf, an unmapped media slot and undeclared members", () => {
    const value = input();
    expect(() => logoMarkRenderer.render({ ...value, selection: { ...value.selection, leaf: "sections.logo-hero" } })).toThrow(/renderer received/);
    expect(() => logoMarkRenderer.render({ ...value, fill: { ...value.fill, slots: [] } })).toThrow(/mark/);
    expect(() => logoMarkRenderer.render({ ...value, selection: { ...value.selection, members: ["layout.split"] } })).toThrow(/layout.split/);
  });
});
