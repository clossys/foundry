// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { LogoHero } from "../../blocks/LogoHero.js";
import { BLOCK_ENTRIES } from "../../catalog/blocks.js";
import { loadSectionRegistry } from "../../catalog-core/sections-contract.js";
import { FOUNDRY_SECTION_MAP } from "../../importers/foundry-sections.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";
import { sectionRenderers } from "./index.js";
import type { RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import type { ReactNode } from "react";

afterEach(cleanup);
const mark = specimenDataset.assets.mark;
const renderer = sectionRenderers["sections.logo-hero"]!;
function input(values: Record<string, string> = { mark: mark.src, name: mark.name }): RuntimeRenderInput<ReactNode> {
  return { fill: { leaf: renderer.leaf, slots: ["mark", "name"], members: [] }, selection: { leaf: renderer.leaf, members: [] }, content: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])) } as unknown as RuntimeRenderInput<ReactNode>;
}

describe("logo-only public hero", () => {
  it("renders existing artwork with one accessible name and no visible prose or actions", () => {
    const { container } = render(<LogoHero mark={mark.src} name={mark.name} />);
    expect(screen.getByRole("img", { name: mark.name })).toHaveAttribute("dir", "auto");
    expect(container.querySelector("img")).toHaveAttribute("src", mark.src);
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
    expect(container.textContent).toBe("");
    expect(container.querySelector("h1,h2,p,a,button")).toBeNull();
    expect(container.querySelector("section")).toHaveAttribute("data-ds-leaf", "sections.logo-hero");
    expect(renderToStaticMarkup(<LogoHero mark={mark.src} name={mark.name} />)).toContain('aria-label=');
  });
  it("is a registered draft section with a block id, package fill and runtime renderer", () => {
    expect(BLOCK_ENTRIES.find(row => row.id === "say.logo-hero")).toMatchObject({ export: "LogoHero", sectionLeaf: "sections.logo-hero", lifecycle: "draft" });
    expect(loadSectionRegistry().slots.find(row => row.id === renderer.leaf)).toMatchObject({ status: "draft", contract: { surface: "site", passageSchema: "passages.logo-hero" } });
    expect(FOUNDRY_SECTION_MAP["logo-hero"]).toMatchObject({ export: "LogoHero", slotMap: { mark: "./blocks#LogoHero.mark", name: "./blocks#LogoHero.name" } });
    expect(renderer.sample(specimenDataset)).toEqual({ mark: mark.src, name: mark.name });
    render(<>{renderer.render(input())}</>);
    expect(screen.getByRole("img", { name: mark.name })).toBeInTheDocument();
  });
  it("refuses absent artwork, name and unsupported additional copy", () => {
    expect(() => renderer.render(input({ name: mark.name }))).toThrow(/mark/);
    expect(() => renderer.render(input({ mark: mark.src, name: "" }))).toThrow(/name/);
    expect(() => renderer.render(input({ mark: mark.src, name: mark.name, description: "Extra" }))).toThrow(/description/);
  });
});
