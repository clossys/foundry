import { Suspense, type ReactNode } from "react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import * as components from "../components/index.js";
import * as blocks from "../blocks/index.js";
import * as frames from "../frames/index.js";
import * as charts from "../charts/index.js";
import { defaultSourceModules } from "../components/preview-runtime/modules.js";
import { loadCatalog, resolve, loadSectionRegistry, loadComponentRegistry, applyLibraryChange, libraryHash } from "../catalog-core/index.js";
import { componentDescriptorHash } from "../catalog-core/resolve-components.js";
import { isSurfacePackageEntry, surfaceEntryOf, surfacePrimary } from "../catalog-core/surface-library.js";
import type { CompositeCatalogData, CompositeResolved, FrameSlot } from "../catalog-core/types.js";
import type { SurfaceCandidateDocument, SurfaceSlot } from "../catalog-core/surface-types.js";
import { completedCatalogLibrary } from "../catalog-core/__fixtures__/completed-catalog-library.js";
import { importFoundrySections } from "../importers/foundry-sections.js";
import { importFoundryFrames } from "../importers/foundry-frames.js";
import { readSurfacePackageEvidence } from "../library-cli/surface-package-evidence.js";
import { ConsumerComponentProvider } from "../runtime/component-leaf.client.js";
import frameSlots from "../catalog/slots/frames.json" with { type: "json" };
import componentData from "./default-component-preview-profile.json" with { type: "json" };
import type { DesignerSpecimenContext } from "./DesignerSpecimen.js";
import { emittedDesignerSpecimenContext } from "./emitted-specimens.js";
import { surfaceSpecimenItems, SpecimenSectionViewports } from "./specimen-viewports.js";

let context: DesignerSpecimenContext;
const labels = { showAllVariants: (count: number) => `All ${count}` };
const need = ({ reason }: { leaf: string; reason: string }) => <components.SemanticContent as="p" role="status">{reason}</components.SemanticContent>;
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

beforeAll(async () => {
  const valuesCatalog = loadCatalog();
  const fills = [...importFoundrySections().fills, ...importFoundryFrames().fills].filter(doc => ["sections.content", "frames.auth-shell"].includes(doc.$extensions["com.clossys.fill"].slot));
  const catalog: CompositeCatalogData = { values: valuesCatalog, components: { slots: loadComponentRegistry().slots, fills: [] }, surfaces: { slots: [...loadSectionRegistry().slots, ...frameSlots as unknown as FrameSlot[]], fills: fills as unknown as SurfaceCandidateDocument[], transforms: [], rules: [], materializations: [] } };
  const values = completedCatalogLibrary(valuesCatalog, { id: "viewport-consumer", kind: "consumer", author: "consumer", license: "MIT" }, "2026-10-30");
  const { source, adoptedAt, ...portion } = values;
  const empty = { source, adoptedAt, values: portion, components: { fills: [], files: [] }, surfaces: { version: 1 as const, fills: [], files: [] } };
  const surfaceOptions = { packages: await readSurfacePackageEvidence(fills), measurements: [] };
  const library = applyLibraryChange(catalog, empty, { baseHash: libraryHash(empty), changes: fills.map(doc => ({ portion: "surfaces" as const, change: { op: "adopt" as const, slot: doc.$extensions["com.clossys.fill"].slot as SurfaceSlot, source: "foundry" } })) }, { surfaceOptions });
  const resolved = resolve({ catalog, library, surfaceOptions });
  const profile = { ...resolved, components: structuredClone(componentData) } as CompositeResolved;
  const namespaces: Record<string, Record<string, unknown>> = { "@clossys/designer/blocks": blocks, "@clossys/designer/frames": frames };
  // Use the native emitted surface-index convention and each selected package's actual export.
  const surfaces = Object.fromEntries(Object.values(profile.surfaces!.fills).map(selected => {
    const entry = surfaceEntryOf(selected.document);
    if (!isSurfacePackageEntry(entry)) throw new Error("The viewport fixture requires the selected native package surface.");
    const Component = namespaces[entry.impl.module]?.[entry.impl.export];
    if (!Component) throw new Error(`The selected surface export is unavailable: ${entry.impl.module}#${entry.impl.export}`);
    return [surfacePrimary(entry.slot), Component];
  }));
  const emitted = emittedDesignerSpecimenContext(profile, { components, surfaces });
  context = { profile, modules: { "@clossys/designer/components": components, "@clossys/designer/charts": charts, ...defaultSourceModules }, surfaces: emitted.surfaces };
});

function selected(children: ReactNode) {
  const descriptors = Object.fromEntries(Object.entries(context.profile.components.components).map(([leaf, chosen]) => [leaf, componentDescriptorHash(chosen.descriptor)]));
  return <ConsumerComponentProvider value={{ profile: context.profile, selectionHash: context.profile.components.selectionHash, modules: context.modules, descriptors }}><Suspense>{children}</Suspense></ConsumerComponentProvider>;
}

it("retains native case identities while applying the fixed viewport breakpoint references", () => {
  // The themes layer has no breakpoint leaf: viewport widths are the fixed Foundry breakpoint references.
  const section = surfaceSpecimenItems(context, "sections.content");
  expect(section.items.map(item => item.id)).toEqual(["sections.content/1280", "sections.content/375"]);
  expect(section.items.map(item => item.value.width)).toEqual(["var(--breakpoint-desktop)", "var(--breakpoint-mobile)"]);
  const frame = surfaceSpecimenItems(context, "frames.auth-shell");
  expect(frame.items.map(item => item.id)).toEqual(["frames.auth-shell/default"]);
  expect(frame.items[0]!.value.width).toBe("var(--breakpoint-desktop)");
});

it("refuses missing declared parts under the authenticated selected provider without mounting an iframe", async () => {
  const cases = surfaceSpecimenItems(context, "sections.content");
  const view = render(selected(<SpecimenSectionViewports items={cases.items.slice(0, 1)} context={context} need={need} labels={labels} />));
  expect(await screen.findByRole("status")).toHaveTextContent("The selected specimen section has no declared surface and viewport render parts.");
  expect(view.container.querySelector("iframe,[data-designer-specimen-frame]")).toBeNull();
});

// The live iframe measurement and surface-dispatch cases exercised the retired Producer viewport adapter (aa395d885).
