import { Suspense, type ReactNode } from "react";
import { beforeAll, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Panel } from "./Panel.js";
import { ResizablePane } from "./ResizablePane.js";
import { LeafCell } from "./library-board/LeafCell.js";
import * as nativeCard from "../components/preview-runtime/components/card/card.js";
import { SemanticContent } from "../components/SemanticContent.js";
import { ResizeHandle } from "../components/ResizeHandle.js";
import { ConsumerComponentProvider, type ConsumerComponentSelection } from "../runtime/component-leaf.client.js";
import { loadCatalogBundles, installedHeadlessLibrary } from "../catalog-bundles.js";
import { loadCatalog, loadComponentRegistry, type LibraryData } from "../catalog-core/index.js";
import { applyLibraryChange, libraryHash, resolve } from "../catalog-core/api.js";
import { emittedTokenProperties } from "../catalog-core/emit.js";
import { applyComponentLibraryChange } from "../catalog-core/changeset-components.js";
import { componentDescriptorHash, componentLibraryHash, resolveComponents, type ComponentLibrary } from "../catalog-core/resolve-components.js";

let selection: ConsumerComponentSelection;
beforeAll(() => {
  const values = loadCatalog(), bundles = loadCatalogBundles(), registry = loadComponentRegistry();
  const source: LibraryData["source"] = { kind: "consumer", author: "consumer", id: "native-card-callers", license: "MIT" };
  const empty: LibraryData = { source, fills: [], adoptedAt: "2026-10-30" };
  const changes = values.slots.filter(slot => slot.layer === "tokens").flatMap(slot => {
    const offers = values.fills.filter(doc => doc.$extensions["com.clossys.fill"].slot === slot.id && doc.$extensions["com.clossys.fill"].mode !== "reference");
    const chosen = offers.find(doc => doc.$extensions["com.clossys.fill"].source === "foundry") ?? offers[0];
    return chosen ? [{ op: "adopt" as const, slot: slot.id, source: chosen.$extensions["com.clossys.fill"].source }] : [];
  });
  const profile = resolve({ catalog: values, library: applyLibraryChange(values, empty, { baseHash: libraryHash(empty), changes }) });
  const tokens = Object.fromEntries([...emittedTokenProperties(profile)].map(([id, output]) => {
    let member = profile.members[id]!;
    while (member.alias.light) member = profile.members[member.alias.light]!;
    return [id, { property: output.property, light: member.css.light }];
  }));
  const catalog = { slots: registry.slots, fills: bundles.componentFills };
  const base: ComponentLibrary = { source, fills: [], files: [], adoptedAt: empty.adoptedAt };
  const library = applyComponentLibraryChange(catalog, base, { baseHash: componentLibraryHash(base), changes: [
    { op: "adopt", slot: "components.card", source: "shadcn@aria" },
    { op: "adopt", slot: "components.semantic-content", source: "foundry" },
    { op: "adopt", slot: "components.resize-handle", source: "foundry" },
  ] }, bundles.sourceBundles);
  const components = resolveComponents({ catalog, library, values: { tokens, assets: [] }, evidence: { observations: {}, installedRac: installedHeadlessLibrary() } });
  selection = { profile: { components }, selectionHash: components.selectionHash,
    descriptors: Object.fromEntries(Object.entries(components.components).map(([leaf, chosen]) => [leaf, componentDescriptorHash(chosen.descriptor)])),
    modules: { "components/card/card.tsx": nativeCard, "@clossys/designer/components": { SemanticContent, ResizeHandle } } };
});
const selected = (children: ReactNode) => <ConsumerComponentProvider value={selection}><Suspense>{children}</Suspense></ConsumerComponentProvider>;

it("keeps Panel roles and optional region presence through the adopted native Card parts", async () => {
  const view = render(selected(<Panel role="region" aria-label="Workspace panel" header={false} footer={0}>Content</Panel>));
  const panel = await screen.findByRole("region", { name: "Workspace panel" });
  expect(panel).toHaveAttribute("data-slot", "card");
  expect(panel.querySelector("[data-panel-region=header]")).toBeNull();
  expect(panel.querySelector("[data-panel-region=content]")).toHaveAttribute("data-slot", "card-content");
  expect(panel.querySelector("[data-panel-region=footer]")).toHaveTextContent("0");
  view.rerender(selected(<Panel header="Heading" footer="Footer">Content</Panel>));
  expect(await screen.findByText("Heading")).toHaveAttribute("data-slot", "card-header");
});

it("keeps LeafCell preview, status, and action content without the legacy plate ground policy", async () => {
  const action = vi.fn();
  const { container } = render(selected(<LeafCell previewState="live" preview="Preview" status="Ready" actions={<button onClick={action}>Inspect</button>} />));
  const button = await screen.findByRole("button", { name: "Inspect" });
  const cell = container.querySelector("[data-candidate-cell]")!;
  expect(cell).toHaveAttribute("data-slot", "card");
  expect(cell).not.toHaveAttribute("data-ground");
  expect(within(cell as HTMLElement).getByText("Preview")).toBeInTheDocument();
  expect(within(cell as HTMLElement).getByText("Ready")).toBeInTheDocument();
  await userEvent.click(button);
  expect(action).toHaveBeenCalledOnce();
});

it("keeps resize-handle ground semantics outside the native Card props", async () => {
  const { container } = render(selected(<ResizablePane ground="inverse" min={100} max={300} defaultValue={180} label="Tools" handleLabel="Resize tools">Content</ResizablePane>));
  expect(await screen.findByRole("separator", { name: "Resize tools" })).toHaveClass("focus-visible:outline-accent-on-inverse");
  const panel = container.querySelector("[data-panel]")!;
  expect(panel).toHaveAttribute("data-slot", "card");
  expect(panel).not.toHaveAttribute("ground");
});
