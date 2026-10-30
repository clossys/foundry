import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { MarketingComponentProvider } from "../../studio/marketing-component-selection.js";
import { createCopyResolver } from "../../../../writer/src/resolve.js";
import type { CopyRegistry } from "../../../../writer/src/types.js";
import type { RuntimeJson } from "../../catalog-core/runtime-ports.js";
import sections from "../../catalog/slots/sections.json";
import passages from "../../../../writer/src/catalog/slots/passages.json";
import { renderFeaturesSection, featuresInputs } from "./features.js";
import { sectionRenderers } from "./index.js";
import type { SectionRenderInput } from "./group-a-content.js";

afterEach(cleanup);
const descriptor = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../catalog/fills/foundry/sections.features.json"), "utf8")).sections.features;
const resource = { kind: "illustration", src: "/feature.webp", width: 960, height: 600, alt: "Feature illustration" };
const items = [
  { id: "first", heading: "First capability", description: "First supporting detail", figure: { kind: "image", resource } },
  { id: "second", heading: "Second capability", description: "Second supporting detail", figure: { kind: "image", resource: { ...resource, src: "/second.webp", alt: "Second illustration" } } },
];
function input(values: Record<string, RuntimeJson>, member: string): SectionRenderInput {
  return { fill: { leaf: "sections.features", slots: Object.keys(descriptor.slotMap), members: Object.keys(descriptor.propMap) },
    selection: { leaf: "sections.features", members: [member] },
    content: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])) } as unknown as SectionRenderInput;
}
describe("sections.features member runtime", () => {
  it.each(["bento", "tabs", "alternating", "scroll"])("renders layout.%s through the selected Card and existing media leaf", async layout => {
    expect(sectionRenderers["sections.features"]!.render).toBe(renderFeaturesSection);
    const view = render(<MarketingComponentProvider><Suspense>{renderFeaturesSection(input({ items, header: { heading: "Capabilities" } }, `layout.${layout}`))}</Suspense></MarketingComponentProvider>);
    await screen.findByRole("heading", { name: "Capabilities" });
    expect(view.container.querySelector("[data-features-layout]")).toHaveAttribute("data-features-layout", layout);
    expect(view.container.querySelector('[data-ds-leaf="sections.features"]')).toHaveAttribute("data-ds-fill", "foundry/sections.features");
    expect(view.container.querySelector('[data-slot="card"]')).toHaveClass("group/card");
    if (layout === "tabs") {
      expect(await screen.findByRole("tablist")).toHaveAccessibleName("Capabilities");
      expect(view.container.querySelector('[data-slot="tabs"]')).not.toBeNull();
    }
    expect(screen.getByRole("img", { name: resource.alt })).toHaveAttribute("src", resource.src);
    expect(view.container.querySelector('[data-ds-leaf="sections.media"]')).not.toBeNull();
  });
  it("keeps generated members and Writer copy fields joined to the existing leaf", () => {
    const contract = sections.find(row => row.id === "sections.features")!.contract;
    expect(contract.members.names).toEqual(expect.arrayContaining(["layout.bento", "layout.tabs", "layout.alternating", "layout.scroll"]));
    expect([...featuresInputs.slots].sort()).toEqual(Object.keys(descriptor.slotMap).sort());
    expect([...featuresInputs.members].sort()).toEqual(Object.keys(descriptor.propMap).sort());
    expect(passages.find(row => row.id === "passages.features")!.contract.copy).toEqual(contract.copy);
  });
  it("uses approved Writer CopyRefs for the existing header and item fields", async () => {
    const registry: CopyRegistry = { id: "features-copy", locale: "en", revision: "1", source: { kind: "consumer", reference: "editorial/features" }, entries: [
      { id: "features.title", text: "Writer capabilities", context: "feature heading", status: "approved" },
      { id: "features.item", text: "Writer capability", context: "item heading", status: "approved" },
      { id: "features.detail", text: "Writer supporting detail", context: "item description", status: "approved" },
    ] };
    const resolver = createCopyResolver(registry);
    const copy = (id: string) => resolver({ id, locale: "en" })!.text;
    render(<MarketingComponentProvider><Suspense>{renderFeaturesSection(input({ header: { heading: copy("features.title") }, items: items.map(item => ({ ...item, heading: copy("features.item"), description: copy("features.detail") })) }, "layout.alternating"))}</Suspense></MarketingComponentProvider>);
    expect(await screen.findByRole("heading", { name: copy("features.title") })).toBeVisible();
    expect(screen.getAllByText(copy("features.detail"))).toHaveLength(items.length);
  });
  it("refuses invalid media, unknown spans and spans outside the bento member", () => {
    expect(() => renderFeaturesSection(input({ items: [{ ...items[0], figure: { kind: "image", resource: { ...resource, width: 0 } } }] }, "layout.scroll"))).toThrow(/registered image resource/);
    expect(() => renderFeaturesSection(input({ items: [{ ...items[0], span: "invented" }] }, "layout.bento"))).toThrow(/canonical bento/);
    expect(() => renderFeaturesSection(input({ items: [{ ...items[0], span: "half" }] }, "layout.alternating"))).toThrow(/requires layout.bento/);
  });
});
