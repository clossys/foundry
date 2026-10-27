// @vitest-environment jsdom
/**
 * DESIGNER-RO: the Designer UI has no write path. Every change routes through a coding agent, so no rendered
 * control (and no keyboard shortcut or blur) may reach the host's save adapter, and the removed write controls
 * are absent by role, name and data attribute on every layer.
 */
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "./__fixtures__/frame.js";
import { Studio, StudioRightPanel } from "./index.js";
import { StudioProvider } from "./StudioProvider.js";
import { WholeStudioProvider } from "./WholeStudioProvider.js";
import { adopt, emptyLibrary, labels, smallCatalog } from "./__fixtures__/studio.js";
import { findLayerSelect, chooseLayer } from "./__fixtures__/rail.js";
import { boardRowLeaf } from "./canvas-boards.js";
import { componentIntegration } from "../catalog-core/__fixtures__/component-integration.js";
import type { CompositeStudioLabels, StudioLabels } from "./types.js";

afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

/** Fixture copy for the one read-only "how to change" line; the Studio has no English of its own. */
const HOW_TO_CHANGE = "L-how-to-change: ask your coding agent to run the designer skill";
const roLabels = { ...labels, howToChange: HOW_TO_CHANGE } as StudioLabels;
const wholeLabels = { ...roLabels, whole: { signoff: "W-signoff", proposed: "W-proposed", contract: "W-contract", contentSlots: "W-slots", configurations: "W-config", unresolved: "W-unresolved", unassessed: "W-unassessed" } } as CompositeStudioLabels;

/** Removed write controls, by accessible name (labels copy, including the identity-kit default). */
const REMOVED_NAMES = [labels.board.changeSelection, labels.board.done, labels.board.choose, labels.resetToDefault, labels.autosave.undo, labels.autosave.redo, labels.autosave.retry, labels.autosave.keepMine, labels.autosave.takeTheirs, "Generate starter"];
/** Removed write controls and unsaved-state preview, by data attribute. */
const REMOVED_SELECTORS = ['[data-studio-control="edit-mode"]', "[data-studio-generate-starter]", "[data-studio-save-status]", "style[data-studio-preview]", '[data-board-mode="edit"]', "section[data-library-board] [role=radiogroup]", "section[data-library-board] [role=radio]"];

function expectNoWriteControls(where: string) {
  for (const name of REMOVED_NAMES) expect(screen.queryAllByRole("button", { name, hidden: true }), `${where}: ${name}`).toEqual([]);
  expect(screen.queryAllByRole("radio", { name: /^L-use /, hidden: true }), `${where}: use radio`).toEqual([]);
  for (const selector of REMOVED_SELECTORS) expect(document.querySelectorAll(selector).length, `${where}: ${selector}`).toBe(0);
}

const INTERACTIVE = 'button, [role="button"], [role="radio"], [role="switch"], [role="checkbox"], [role="menuitem"], [role="option"], [role="row"], [role="gridcell"], [role="treeitem"], [role="slider"], [role="tab"], select';
const press = (control: HTMLElement) => act(async () => {
  fireEvent.click(control);
  for (const key of ["Enter", " "]) { fireEvent.keyDown(control, { key }); fireEvent.keyUp(control, { key }); }
  fireEvent.blur(control);
});
/** Drive every control inside an open dialog (Copy, Check candidates, Open in), then close it. */
async function driveDialogs() {
  for (const dialog of [...document.querySelectorAll<HTMLElement>('[role="dialog"]')]) {
    for (const control of [...dialog.querySelectorAll<HTMLElement>("button")]) if (control.isConnected && control.textContent !== labels.board.close) await press(control);
    const close = within(dialog).queryAllByRole("button", { name: labels.board.close, hidden: true })[0];
    await act(async () => { if (close) fireEvent.click(close); else fireEvent.keyDown(dialog, { key: "Escape" }); });
  }
}
/** Click, Enter, Space and blur on every remaining control (twice, so controls revealed by the first pass are driven too), then the undo/redo shortcuts. */
async function driveEveryControl() {
  for (let pass = 0; pass < 2; pass++) {
    for (const control of [...document.querySelectorAll<HTMLElement>(INTERACTIVE)]) {
      if (!control.isConnected || control.closest('[role="dialog"]')) continue;
      await press(control);
      await driveDialogs();
      await act(async () => { fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" }); });
    }
  }
  for (const modifiers of [{ metaKey: true }, { ctrlKey: true }, { metaKey: true, shiftKey: true }, { ctrlKey: true, shiftKey: true }]) {
    await act(async () => { fireEvent.keyDown(document.body, { key: "z", ...modifiers }); fireEvent.keyDown(document.activeElement ?? document.body, { key: "Z", ...modifiers }); });
  }
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
}

const boardsReady = () => waitFor(() => expect(document.querySelector("section[data-library-board] tr")).not.toBeNull(), { timeout: 15_000 });
const firstLeafRow = () => [...document.querySelectorAll<HTMLElement>("section[data-library-board] tbody tr")].find(row => boardRowLeaf(row));

function compositeAdapter() {
  const input = componentIntegration();
  const catalog = { ...input.catalog, values: smallCatalog };
  const library = { ...input.library, values: { fills: [] } };
  const save = vi.fn(async () => ({ ok: false as const, reason: "unavailable" as const }));
  return { adapter: { kind: "composite" as const, catalog, load: async () => ({ library, componentOptions: input.componentOptions }), save }, save };
}

it("legacy tokens and assets layers render no write control, and driving every control never saves", async () => {
  const save = vi.fn(async () => ({ ok: false as const, reason: "unavailable" as const }));
  const library = adopt(emptyLibrary(), "tokens.surface-color", "foundry");
  render(<StudioProvider catalog={smallCatalog} adapter={{ load: async () => ({ library }), save }} labels={roLabels}><Studio header="internal" /><StudioRightPanel /></StudioProvider>);
  await findLayerSelect();
  for (const layer of ["Tokens", "Assets"]) {
    if (layer !== "Tokens") await chooseLayer(labels, layer);
    await boardsReady();
    expectNoWriteControls(layer);
    await driveEveryControl();
    expectNoWriteControls(`${layer} after driving`);
  }
  expect(save).not.toHaveBeenCalled();
}, 120_000);

it("the whole Designer renders no write control on any layer, and driving every control never saves", async () => {
  const { adapter, save } = compositeAdapter();
  render(<WholeStudioProvider adapter={adapter} labels={wholeLabels}><Studio header="external" /><StudioRightPanel /></WholeStudioProvider>);
  await findLayerSelect();
  for (const layer of ["Tokens", "Assets", "Components", "Sections", "Frames"]) {
    if (layer !== "Tokens") await chooseLayer(labels, layer);
    await boardsReady();
    expectNoWriteControls(layer);
    await driveEveryControl();
    expectNoWriteControls(`${layer} after driving`);
  }
  expect(save).not.toHaveBeenCalled();
}, 180_000);

/** The inspector is read-only: disclosure and prompt-dialog triggers only, never a radio, select or switch. */
async function expectReadOnlyInspector(save: ReturnType<typeof vi.fn>, leaf: string) {
  const inspector = await waitFor(() => { const panel = document.querySelector<HTMLElement>('[data-studio-panel="inspector"]'); expect(panel?.textContent).toContain(leaf); return panel!; });
  expect(within(inspector).getByText(HOW_TO_CHANGE)).toBeInTheDocument();
  expect(inspector.textContent).toContain(labels.inspector.representedLeaf);
  expect(inspector.textContent).toContain(labels.inspector.source);
  expect(inspector.textContent).toContain(labels.inspector.findings);
  for (const role of ["radio", "radiogroup", "switch", "combobox", "listbox", "slider", "checkbox"]) expect(within(inspector).queryAllByRole(role, { hidden: true }), role).toEqual([]);
  expect(inspector.querySelectorAll("select, input, textarea").length).toBe(0);
  const prompts = new Set([labels.board.create, labels.board.refresh, labels.board.askAgent]);
  for (const button of within(inspector).queryAllByRole("button", { hidden: true })) {
    expect(button.hasAttribute("aria-expanded") || prompts.has(button.textContent ?? ""), `inspector button ${button.textContent}`).toBe(true);
  }
  for (const button of within(inspector).queryAllByRole("button", { hidden: true })) { await press(button); await driveDialogs(); }
  expect(save).not.toHaveBeenCalled();
}

it("selecting an L3 row opens the read-only inspector with the how-to-change line (whole Designer, components)", async () => {
  const { adapter, save } = compositeAdapter();
  render(<WholeStudioProvider adapter={adapter} labels={wholeLabels}><Studio header="external" /><StudioRightPanel /></WholeStudioProvider>);
  await chooseLayer(wholeLabels, "Components");
  await boardsReady();
  const row = firstLeafRow()!, leaf = boardRowLeaf(row)!;
  expect(leaf.startsWith("components.")).toBe(true);
  await userEvent.click(within(row).getByText(leaf));
  await expectReadOnlyInspector(save, leaf);
}, 60_000);

it("selecting an L3 row opens the read-only inspector with the how-to-change line (legacy tokens)", async () => {
  const save = vi.fn(async () => ({ ok: false as const, reason: "unavailable" as const }));
  const library = adopt(emptyLibrary(), "tokens.surface-color", "foundry");
  render(<StudioProvider catalog={smallCatalog} adapter={{ load: async () => ({ library }), save }} labels={roLabels}><Studio header="internal" /></StudioProvider>);
  await boardsReady();
  const row = [...document.querySelectorAll<HTMLElement>("section[data-library-board] tbody tr")].find(row => boardRowLeaf(row) === "tokens.surface-color")!;
  await userEvent.click(within(row).getByText("tokens.surface-color"));
  await expectReadOnlyInspector(save, "tokens.surface-color");
}, 60_000);
