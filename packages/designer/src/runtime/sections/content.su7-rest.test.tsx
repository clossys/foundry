import { Suspense, type ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { renderContentSection } from "./content.js";
import { ConsumerComponentProvider } from "../component-leaf.client.js";
import { contentComponentSelection } from "../../blocks/__fixtures__/a270-content-components.js";
import { ContentSectionSpecimen, contentSectionContractContribution, contentSectionStudioContribution } from "../../studio/a270-content.contribution.js";
import descriptor from "../../catalog/fills/foundry/sections.content.json" with { type: "json" };
import slots from "../../catalog/slots/sections.json" with { type: "json" };

function input(values: Record<string, unknown>, members: string[] = [], readOnly = true) {
  return { fill: { leaf: "sections.content", slots: Object.keys(values), members }, selection: { leaf: "sections.content", members }, readOnly,
    content: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])) } as unknown as RuntimeRenderInput<ReactNode>;
}
function mount(node: ReactNode) {
  return render(<ConsumerComponentProvider value={contentComponentSelection()}><Suspense>{node}</Suspense></ConsumerComponentProvider>);
}
const body = [{ kind: "paragraph", text: "Caller body" }];

describe("Content section runtime and Studio contribution", () => {
  it("routes authored header, body, summary and footnote through the real selected section", async () => {
    const { container } = mount(renderContentSection(input({ header: { heading: "Caller title" }, body, aside: [{ id: "scope", label: "Scope", value: "ExampleCo" }], footnote: "Caller note" }, ["layout.split-end"])));
    await screen.findByText("ExampleCo");
    expect(screen.getByRole("heading", { name: "Caller title" })).toBeTruthy();
    expect(container.querySelector('aside [data-slot="card-content"] dd')?.textContent).toBe("ExampleCo");
    expect(screen.getByText("Caller body")).toBeTruthy();
    expect(screen.getByText("Caller note")).toBeTruthy();
    expect(container.querySelector("button,input,textarea")).toBeNull();
  });
  it("omits an empty rail and rejects malformed summary values with a path", async () => {
    const { container } = mount(renderContentSection(input({ body, aside: [] })));
    await screen.findByText("Caller body"); expect(container.querySelector("aside")).toBeNull();
    expect(() => renderContentSection(input({ body, aside: [{ label: "Scope", value: 4 }] }))).toThrow(/aside\.0\.value/);
  });
  it("renders the existing catalog entry's contributed Studio specimen", async () => {
    const contract = slots.find(slot => slot.id === contentSectionContractContribution.entryId);
    expect(contract?.id).toBe("sections.content");
    expect(descriptor.sections.content.slotMap.aside).toBe("./blocks#ContentSection.aside");
    expect(contentSectionStudioContribution.entryId).toBe(contract?.id);
    const { container } = mount(<ContentSectionSpecimen />);
    await screen.findByRole("heading", { name: "One place for every project" });
    expect(container.querySelector('[data-ds-leaf="sections.content"] aside [data-slot="card-content"]')).not.toBeNull();
  });
});
