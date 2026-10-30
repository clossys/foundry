import { Suspense } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import selected from "../studio/__fixtures__/default-component-preview-profile.json" with { type: "json" };
import * as components from "../components/index.js";
import * as itemModule from "../components/item/item.js";
import { importShadcnAriaRail } from "../importers/shadcn-aria-rail.js";
import { importFoundrySections } from "../importers/foundry-sections.js";
import { packageSurfacePreview } from "../studio/planned-surface-previews.js";
import { specimenDataset } from "../studio/specimen-dataset.js";
import { componentDescriptorHash, type ResolvedComponents } from "../catalog-core/resolve-components.js";
import { ConsumerComponentProvider, type ConsumerComponentSelection } from "../runtime/component-leaf.client.js";
import { LogoCloud } from "./LogoCloud.js";

// Use the real registered, pinned source descriptor and compiled Item module.
// This fixture exercises dispatch; it does not claim consumer qualification.
function selection(override = false): ConsumerComponentSelection {
  const rail = importShadcnAriaRail();
  const descriptor = rail.fills.find(doc => doc.components.item)?.components.item!;
  const profile = structuredClone(selected) as unknown as ResolvedComponents;
  const item = { slot: "components.item", originKind: "adopted" as const,
    origin: { kind: "adopted" as const, source: descriptor.source, fill: "shadcn@aria/components.item", pin: descriptor.pin, license: descriptor.license, sha256: componentDescriptorHash(descriptor), adoptedAt: "2026-10-30" },
    impl: descriptor.impl as ResolvedComponents["components"][string]["impl"], propMap: descriptor.propMap, reads: { tokens: {}, assets: [], components: [] }, descriptor };
  const complete = { ...profile, components: { ...profile.components, "components.item": item }, files: [...profile.files, ...rail.files] };
  return { profile: { components: complete }, selectionHash: complete.selectionHash,
    descriptors: Object.fromEntries(Object.entries(complete.components).map(([id, value]) => [id, componentDescriptorHash(value.descriptor)])),
    modules: { "@clossys/designer/components": components, "components/item/item.tsx": override ? { ...itemModule, ItemTitle: (props: React.ComponentProps<typeof itemModule.ItemTitle>) => <itemModule.ItemTitle {...props} data-consumer-title="" /> } : itemModule } };
}

afterEach(cleanup);
describe("A270 registered logo-cloud specimen", () => {
  it.each([false, true])("renders the consumer's original Item parts and authored names (override=%s)", async override => {
    const names = ["Example Co. A", "Example Co. B", "Example Co. C"];
    const { container } = render(<ConsumerComponentProvider value={selection(override)}><Suspense fallback={null}><LogoCloud items={names.map((name, index) => ({ id: String(index), name, logo: name, href: `#example-${index}` }))} /></Suspense></ConsumerComponentProvider>);
    for (const name of names) expect(await screen.findByRole("link", { name })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(container.querySelectorAll('[data-slot="item-media"][aria-hidden="true"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-slot="item-title"]')).toHaveLength(3);
    expect(container.querySelectorAll("[data-consumer-title]")).toHaveLength(override ? 3 : 0);
  });
  it("renders the registered Studio specimen through the same consumer binding", async () => {
    const doc = importFoundrySections().fills.find(fill => fill.$extensions["com.clossys.fill"].slot === "sections.logo-cloud")!;
    const preview = packageSurfacePreview(doc);
    expect(preview).toMatchObject({ pointer: "@clossys/designer/blocks#LogoCloud" });
    if (!("render" in preview)) throw new Error(preview.reason);
    const { container } = render(<ConsumerComponentProvider value={selection()}><Suspense fallback={null}>{preview.render()}</Suspense></ConsumerComponentProvider>);
    for (const name of specimenDataset.sections.logoCloud.names) expect(await screen.findByText(name, { selector: '[data-slot="item-title"]' })).toBeInTheDocument();
    expect(container.querySelector('[data-ds-leaf="sections.logo-cloud"]')).toBeInTheDocument();
  });
});
