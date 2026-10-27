import { afterEach, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { render } from "./__fixtures__/frame.js";
import * as components from "../components/index.js";
import * as charts from "../charts/index.js";
import * as shell from "../shell/index.js";
import { toastQueue } from "../shell/internal/toast-queue.js";
import { loadBuildCatalog, resolve } from "../catalog-core/index.js";
import { loadCatalogBundles } from "../catalog-bundles.js";
import { adoptedComponentIntegration } from "../catalog-core/__fixtures__/component-integration.js";
import type { CompositeResolved, ResolvedComponent } from "../catalog-core/index.js";
import { componentSpecimenPreview, Studio as StudioView, StudioHeader, StudioRightPanel, WholeStudioProvider } from "./index.js";
import * as studioEntry from "./index.js";
import { componentSpecimenPreview as fromModule } from "./component-specimens.js";
import { labels } from "./__fixtures__/studio.js";
import { CandidateCell } from "./CandidateCell.js";
import type { CompositeStudioLabels, CompositeStudioSnapshot } from "./types.js";
import { specimenDataset } from "./specimen-dataset.js";

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

/** Every Foundry package-implemented component leaf, each as the only chosen leaf of an adopted profile. */
function foundryLeaves() {
  const slots = new Set(loadBuildCatalog().slots.map(slot => slot.id));
  return loadCatalogBundles().componentFills.flatMap(doc => Object.values(doc.components))
    .filter(fill => fill.source === "foundry" && fill.impl.kind === "package" && slots.has(fill.slot))
    .map(fill => {
      const component = { slot: fill.slot, originKind: "adopted", origin: { kind: "adopted", source: "foundry" }, impl: fill.impl, propMap: fill.propMap, reads: { tokens: {}, assets: [], components: [] }, descriptor: fill } as unknown as ResolvedComponent;
      return { leaf: fill.slot, profile: { selectionHash: `selection-${fill.slot}`, components: { components: { [fill.slot]: component } } } as unknown as CompositeResolved };
    });
}

it("host perspective: a chosen cell whose every specimen throws reads unavailable with a named reason, never live", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const Boom = () => { throw new Error("cannot draw"); };
  hostStudio(componentSpecimenPreview({ modules: { "@clossys/designer/components": { ...components, Button: Boom } } }).preview);
  await screen.findByText("L-saved");
  const [only] = chosenCells();
  await vi.waitFor(() => expect(only!.cell).toHaveAttribute("data-preview-state", "unavailable"));
  expect(only!.cell).toHaveAttribute("data-preview-reason", "specimen-error");
  expect(within(only!.cell).getByText(labels.previewUnavailable)).toBeVisible();
  errors.mockRestore();
});

it("a cell whose failing specimens are replaced by other host content reads live again", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const profile = resolve(adoptedComponentIntegration());
  const Boom = () => { throw new Error("cannot draw"); };
  const failing = componentSpecimenPreview({ modules: { "@clossys/designer/components": { ...components, Button: Boom } } }).preview("components.button", profile);
  const view = render(<CandidateCell labels={labels} preview={failing} />);
  const cell = () => document.querySelector<HTMLElement>("[data-candidate-cell]")!;
  await vi.waitFor(() => expect(cell()).toHaveAttribute("data-preview-reason", "specimen-error"));
  view.rerender(<CandidateCell labels={labels} preview={<span>Host preview</span>} />);
  await vi.waitFor(() => expect(cell()).toHaveAttribute("data-preview-state", "live"));
  expect(cell()).not.toHaveAttribute("data-preview-reason");
  errors.mockRestore();
});

it("a provider that throws leaves nothing drawn, so the cell reads unavailable with the same reason", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const profile = resolve(adoptedComponentIntegration());
  const provider = () => { throw new Error("provider unavailable"); };
  render(<CandidateCell labels={labels} preview={componentSpecimenPreview({ modules: hostModules, provider }).preview("components.button", profile)} />);
  const cell = document.querySelector<HTMLElement>("[data-candidate-cell]")!;
  await vi.waitFor(() => expect(cell).toHaveAttribute("data-preview-state", "unavailable"));
  expect(cell).toHaveAttribute("data-preview-reason", "specimen-error");
  errors.mockRestore();
});

it("stays live while at least one specimen renders", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const profile = resolve(adoptedComponentIntegration());
  const Partial = (props: Record<string, unknown>) => { if (props.variant) throw new Error("variant unsupported"); return <components.Button {...props} />; };
  const preview = componentSpecimenPreview({ modules: { "@clossys/designer/components": { ...components, Button: Partial } } }).preview("components.button", profile);
  render(<CandidateCell labels={labels} preview={preview} />);
  const cell = document.querySelector<HTMLElement>("[data-candidate-cell]")!;
  expect(cell.querySelectorAll("[data-specimen-error]").length).toBeGreaterThan(0);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(cell).toHaveAttribute("data-preview-state", "live");
  expect(cell).not.toHaveAttribute("data-preview-reason");
  expect(screen.getByRole("button", { name: "components.button" })).toBeVisible();
  errors.mockRestore();
});

it("draws every Foundry package component live from designer sample content when the host passes none", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const specimens = componentSpecimenPreview({ modules: hostModules });
  const leaves = foundryLeaves();
  expect(leaves.length).toBeGreaterThan(50);
  const blank: string[] = [], unavailableCells: Record<string, string | undefined> = {}, unavailableMembers: Record<string, string> = {};
  for (const { leaf, profile } of leaves) {
    render(<CandidateCell labels={labels} preview={specimens.preview(leaf, profile)} />);
    const cell = document.querySelector<HTMLElement>("[data-candidate-cell]")!;
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(cell.querySelector("[data-specimen-error]"), leaf).toBeNull();
    for (const node of cell.querySelectorAll<HTMLElement>("[data-component-specimen]")) {
      const marker = node.querySelector<HTMLElement>("[data-specimen-unavailable]");
      if (marker && cell.dataset.previewState === "live") unavailableMembers[`${leaf}/${node.dataset.componentSpecimen}`] = marker.dataset.specimenUnavailable!;
    }
    const drawn = [...cell.querySelectorAll<HTMLElement>("[data-component-specimen]")].filter(node => !node.querySelector("[data-specimen-error], [data-specimen-unavailable]") && node.childElementCount > 0);
    if (cell.dataset.previewState === "unavailable") unavailableCells[leaf] = cell.dataset.previewReason;
    else if (cell.dataset.previewState !== "live" || drawn.length === 0) blank.push(leaf);
    cleanup();
  }
  // Live means drawn: no cell reads live over an empty plate.
  expect(blank).toEqual([]);
  // Every cell draws: the toast region renders a cell-owned queue in place (see the Toaster test below).
  expect(unavailableCells).toEqual({});
  // A member that needs the host's own brand assets says so instead of throwing; the leaf's other specimens draw.
  expect(unavailableMembers).toEqual({ "components.logo/content.lockup": "needs-brand-asset" });
  errors.mockRestore();
});

it("draws the shell Toaster's own toast in its cell from a cell queue, dismisses it by its close button and shows it again", async () => {
  const user = userEvent.setup();
  const { title, description } = specimenDataset.toasts[specimenDataset.toaster.variant];
  const leaf = foundryLeaves().find(entry => entry.leaf === "components.toast")!;
  render(<CandidateCell labels={labels} preview={componentSpecimenPreview({ modules: hostModules }).preview(leaf.leaf, leaf.profile)} />);
  const cell = document.querySelector<HTMLElement>("[data-candidate-cell]")!;
  await vi.waitFor(() => expect(cell).toHaveAttribute("data-preview-state", "live"));
  const host = cell.querySelector<HTMLElement>(`[data-component-specimen="components.toast"] [data-specimen-contained-host="toast"]`)!;
  expect(host).not.toBeNull();
  // In place: the stack is the Toaster's container placement inside the cell, never the fixed, portalled viewport.
  const shown = within(host).getByRole("status");
  expect(shown).toHaveTextContent(title);
  expect(shown).toHaveTextContent(description);
  expect(host.querySelector("ol")).not.toHaveClass("fixed");
  expect(document.querySelector("[data-toaster-placement]")).toBeNull();
  expect(screen.getAllByText(title).every(node => cell.contains(node))).toBe(true);
  // The cell's queue is its own: the app-wide queue stays empty, and a page toast never draws in the cell.
  expect(toastQueue.visibleToasts).toEqual([]);
  const page = shell.toast("Page toast");
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(within(cell).queryByText("Page toast")).toBeNull();
  page.dismiss();
  // Dismissed through the toast's own close button, then queued again from the cell's show action.
  await user.click(within(host).getByRole("button", { name: "Close" }));
  await vi.waitFor(() => expect(within(host).queryByText(title)).toBeNull());
  await user.click(within(host).getByRole("button", { name: specimenDataset.toaster.trigger }));
  await vi.waitFor(() => expect(within(host).getByRole("status")).toHaveTextContent(title));
  expect(toastQueue.visibleToasts).toEqual([]);
});

it("host specimens override designer sample content", () => {
  const leaf = foundryLeaves().find(entry => entry.leaf === "components.chart-bar")!;
  const specimens = componentSpecimenPreview({ modules: hostModules, specimens: { "components.chart-bar": binding => <p data-testid="host-chart">{binding.exportName}</p> } });
  render(<>{specimens.preview(leaf.leaf, leaf.profile)}</>);
  expect(screen.getByTestId("host-chart")).toHaveTextContent("BarChart");
  expect(document.querySelector("svg")).toBeNull();
});
