import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import type { RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { renderContentSection } from "./content.js";
import { logoMarkRenderer } from "./logo-mark.js";
import { logoHeroRenderer } from "./logo-hero.js";
function input(leaf: string, values: Record<string, unknown>, members: string[] = []) {
  return { fill: { leaf, slots: Object.keys(values), members }, selection: { leaf, members }, content: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])) } as unknown as RuntimeRenderInput<ReactNode>;
}
describe("SU7 cell adapters", () => {
  it("routes summary pairs from the content cell without an empty column", () => {
    const body = [{ kind: "paragraph", text: "Example copy." }];
    expect(renderToStaticMarkup(<>{renderContentSection(input("sections.content", { body, aside: [{ id: "one", label: "Scope", value: "Example Co." }] }))}</>)).toContain("<dt");
    expect(renderToStaticMarkup(<>{renderContentSection(input("sections.content", { body, aside: [] }))}</>)).not.toContain("data-content-aside");
  });
  it("renders the permanent logo-mark cell through the same mark-only hero", () => {
    const mark = logoMarkRenderer.render(input("sections.logo-mark", { mark: { slot: "assets.mark", member: "mono", src: "/mark.svg", name: "Example Co." } }));
    const hero = logoHeroRenderer.render(input("sections.logo-hero", { mark: "/mark.svg", name: "Example Co." }, ["brand.mark-only"]));
    const presentation = (node: ReactNode) => renderToStaticMarkup(<>{node}</>).replace(/data-ds-(?:leaf|fill)="[^"]*"/g, "");
    expect(presentation(mark)).toBe(presentation(hero));
    expect(renderToStaticMarkup(<>{mark}</>)).toContain('data-ds-leaf="sections.logo-mark"');
  });
});
