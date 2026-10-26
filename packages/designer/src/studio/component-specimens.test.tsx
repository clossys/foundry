import { afterEach, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { render } from "./__fixtures__/frame.js";
import * as components from "../components/index.js";
import * as charts from "../charts/index.js";
import * as shell from "../shell/index.js";
import { loadBuildCatalog, resolve } from "../catalog-core/index.js";
import { loadCatalogBundles } from "../catalog-bundles.js";
import { adoptedComponentIntegration } from "../catalog-core/__fixtures__/component-integration.js";
import type { CompositeResolved, ResolvedComponent } from "../catalog-core/index.js";
import { componentSpecimenPreview, Studio as StudioView, StudioHeader, StudioRightPanel, WholeStudioProvider } from "./index.js";
import * as studioEntry from "./index.js";
import { componentSpecimenPreview as fromModule } from "./component-specimens.js";
import { labels } from "./__fixtures__/studio.js";
import type { CompositeStudioLabels, CompositeStudioSnapshot } from "./types.js";

const wholeLabels: CompositeStudioLabels = { ...labels, whole: { signoff: "W-signoff", proposed: "W-proposed", contract: "W-contract", contentSlots: "W-slots", configurations: "W-config", unresolved: "W-unresolved", unassessed: "W-unassessed" } };
const hostModules = { "@clossys/designer/components": components, "@clossys/designer/charts": charts, "@clossys/designer/shell": shell };
afterEach(cleanup);

/** The host's whole wiring: its own adapter, with `preview` built from the modules it already imports. */
function hostStudio(preview: CompositeStudioSnapshot["preview"]) {
  const input = adoptedComponentIntegration();
  const load = vi.fn(async (): Promise<CompositeStudioSnapshot> => ({ library: input.library, componentOptions: input.componentOptions, preview }));
  render(<WholeStudioProvider adapter={{ kind: "composite", catalog: input.catalog, load, save: async () => ({ ok: false, reason: "unavailable" }) }} labels={wholeLabels} initialSlotId="components.button">
    <StudioHeader /><StudioView header="external" /><StudioRightPanel />
  </WholeStudioProvider>);
  return { input, profile: resolve(input) };
}
const chosenCells = () => [...document.querySelectorAll<HTMLElement>("[data-studio-zoom-full] [data-studio-row]")]
  .map(row => ({ id: row.dataset.studioRow!, cell: row.querySelector<HTMLElement>("[data-candidate-cell]")! }))
  .filter(({ cell }) => cell && cell.dataset.previewState !== "not-chosen" && cell.dataset.previewState !== "planned");

it("is the public studio entry", () => {
  expect(studioEntry.componentSpecimenPreview).toBe(fromModule);
});

it("host perspective: an adopted component library passed as modules renders every chosen component cell live", async () => {
  const specimens = componentSpecimenPreview({ modules: hostModules });
  const { profile } = hostStudio(specimens.preview);
  await screen.findByText("L-saved");
  const chosen = Object.keys(profile.components.components);
  expect(chosen).toEqual(["components.button"]);
  const cells = chosenCells();
  expect(cells.map(cell => cell.id)).toEqual(chosen);
  for (const { id, cell } of cells) {
    expect(cell).toHaveAttribute("data-preview-state", "live");
    expect(within(cell).queryByText(labels.previewUnavailable)).toBeNull();
    const specimen = cell.querySelector<HTMLElement>(`[data-component-specimens="${id}"]`)!;
    expect(specimen).toHaveAttribute("data-specimen-source", "test-kit");
    expect(specimen.querySelector("[data-specimen-error]")).toBeNull();
    // The implementation export renders once, then once per mapped literal-valued member with its mapped prop.
    const mapped = profile.components.components[id]!.descriptor.members.filter(member => profile.components.components[id]!.propMap[member]);
    expect(mapped.length).toBeGreaterThan(1);
    // Each member dispatches the prop its pointer names, as the emitted adapter would (`./components#Button.variant=primary`).
    const bound = specimens.bind(id, profile);
    expect("binding" in bound && bound.binding.members.map(({ member, props, drawn }) => ({ member, props, drawn }))).toEqual(mapped.map(member => ({ member, props: { [member.slice(0, member.indexOf("."))]: member.slice(member.indexOf(".") + 1) }, drawn: true })));
    expect([...specimen.querySelectorAll<HTMLElement>("[data-component-specimen]")].map(node => node.dataset.componentSpecimen)).toEqual([id, ...mapped]);
    for (const node of specimen.querySelectorAll<HTMLElement>("[data-component-specimen]")) expect(within(node).getByRole("button", { name: node.dataset.componentSpecimen })).toBeVisible();
  }
});

it("a host without the library's modules keeps the chosen cell unavailable and bind() names the missing module", async () => {
  const specimens = componentSpecimenPreview({ modules: {} });
  const { profile } = hostStudio(specimens.preview);
  await screen.findByText("L-saved");
  const [only] = chosenCells();
  expect(only!.cell).toHaveAttribute("data-preview-state", "unavailable");
  expect(within(only!.cell).getByText(labels.previewUnavailable)).toBeVisible();
  expect(specimens.bind("components.button", profile)).toEqual({ refusal: { leaf: "components.button", code: "module-unavailable", detail: "@clossys/designer/components" } });
});

it("names every other refusal and never substitutes a placeholder", () => {
  const profile = resolve(adoptedComponentIntegration());
  const missingExport = componentSpecimenPreview({ modules: { "@clossys/designer/components": { GlyphProvider: components.GlyphProvider } } });
  expect(missingExport.bind("components.button", profile)).toEqual({ refusal: { leaf: "components.button", code: "export-unavailable", detail: "@clossys/designer/components#Button" } });
  expect(missingExport.preview("components.button", profile)).toBeUndefined();
  const notRenderable = componentSpecimenPreview({ modules: { "@clossys/designer/components": { Button: "Button" } } });
  expect(notRenderable.bind("components.button", profile)).toMatchObject({ refusal: { code: "export-unavailable" } });
  const specimens = componentSpecimenPreview({ modules: hostModules });
  expect(specimens.bind("components.select", profile)).toEqual({ refusal: { leaf: "components.select", code: "not-chosen", detail: "components.select" } });
  expect(specimens.bind("tokens.text-color", profile)).toEqual({ refusal: { leaf: "tokens.text-color", code: "not-a-component", detail: "tokens.text-color" } });
  expect(specimens.preview("tokens.text-color", profile)).toBeUndefined();
  const button = profile.components.components["components.button"]!;
  // A pointer the dispatcher cannot express drops that member, named, and keeps the leaf bound.
  const first = button.descriptor.members[0]!;
  const unsupported = { ...profile, components: { ...profile.components, components: { "components.button": { ...button, propMap: { ...button.propMap, [first]: "[prose note]" } } } } } as CompositeResolved;
  const bound = specimens.bind("components.button", unsupported);
  if (!("binding" in bound)) throw new Error("expected a binding");
  expect(bound.binding.unbound).toEqual([{ member: first, detail: `components: unsupported propMap components.button.${first}` }]);
  expect(bound.binding.members.map(member => member.member)).not.toContain(first);
  expect(bound.binding.Component).toBe(components.Button);
});

it("draws host specimens inside the provider and contains a throwing implementation to its own marker", () => {
  const profile = resolve(adoptedComponentIntegration());
  const Boom = () => { throw new Error("needs data"); };
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const provider = ({ children }: { children?: ReactNode }) => <section data-testid="library-provider">{children}</section>;
  const drawn = componentSpecimenPreview({ modules: hostModules, provider, specimens: { "components.button": ({ Component }) => <Component>Host specimen</Component> } });
  render(<>{drawn.preview("components.button", profile)}</>);
  expect(within(screen.getByTestId("library-provider")).getByRole("button", { name: "Host specimen" })).toBeVisible();
  cleanup();
  const throwing = componentSpecimenPreview({ modules: { "@clossys/designer/components": { ...components, Button: Boom } } });
  render(<>{throwing.preview("components.button", profile)}</>);
  const markers = document.querySelectorAll("[data-specimen-error]");
  expect(markers.length).toBe(1 + profile.components.components["components.button"]!.descriptor.members.length);
  expect(document.querySelector('[data-component-specimens="components.button"]')).not.toBeNull();
  errors.mockRestore();
});

it("binds every Foundry package-implemented component from the three public component entries", () => {
  const specimens = componentSpecimenPreview({ modules: hostModules });
  const slots = new Set(loadBuildCatalog().slots.map(slot => slot.id));
  const fills = loadCatalogBundles().componentFills.flatMap(doc => Object.values(doc.components))
    .filter(fill => fill.source === "foundry" && fill.impl.kind === "package" && slots.has(fill.slot));
  expect(fills.length).toBeGreaterThan(50);
  const refusals = fills.flatMap(fill => {
    const component = { slot: fill.slot, originKind: "adopted", origin: { kind: "adopted", source: "foundry" }, impl: fill.impl, propMap: fill.propMap, reads: { tokens: {}, assets: [], components: [] }, descriptor: fill } as unknown as ResolvedComponent;
    const profile = { components: { components: { [fill.slot]: component } } } as unknown as CompositeResolved;
    const bound = specimens.bind(fill.slot, profile);
    return "refusal" in bound ? [bound.refusal] : [];
  });
  expect(refusals).toEqual([]);
});

it("draws literal-valued and state-flag members; interaction and data members wait for a host specimen", () => {
  const profile = resolve(adoptedComponentIntegration());
  const button = profile.components.components["components.button"]!;
  const members = ["state.disabled", "state.hovered", "size.sm", "content.label"];
  const propMap = { "state.disabled": "Button.isDisabled", "state.hovered": "Button[data-hovered]", "size.sm": "./components#Button.size=sm", "content.label": "Button.children" };
  const shaped = { ...profile, components: { ...profile.components, components: { "components.button": { ...button, propMap, descriptor: { ...button.descriptor, members, propMap } } } } } as CompositeResolved;
  const specimens = componentSpecimenPreview({ modules: hostModules });
  const bound = specimens.bind("components.button", shaped);
  expect("binding" in bound && bound.binding.members.map(({ member, props, interaction, drawn }) => ({ member, props, interaction, drawn }))).toEqual([
    { member: "state.disabled", props: { isDisabled: true }, interaction: false, drawn: true },
    { member: "state.hovered", props: {}, interaction: true, drawn: false },
    { member: "size.sm", props: { size: "sm" }, interaction: false, drawn: true },
    { member: "content.label", props: { children: true }, interaction: false, drawn: false },
  ]);
  render(<>{specimens.preview("components.button", shaped)}</>);
  expect([...document.querySelectorAll<HTMLElement>("[data-component-specimen]")].map(node => node.dataset.componentSpecimen)).toEqual(["components.button", "state.disabled", "size.sm"]);
  expect(screen.getByRole("button", { name: "state.disabled" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "components.button" })).toBeEnabled();
});
