// @vitest-environment jsdom
/**
 * DESIGNER-RO-B1 round 1: a layer change that swaps the value canvas (Tokens, Assets) for a contract canvas
 * (Components, Sections, Frames) mounts a new rail. A keyboard user's focus must land on the equivalent control
 * in the new rail, not fall to the document body with the unmounted one.
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render, studioReady, findLayerSelect, layerRows } from "../__fixtures__/frame.js";
import { labels, smallCatalog } from "../__fixtures__/studio.js";
import { componentIntegration } from "../../catalog-core/__fixtures__/component-integration.js";
import { Studio, WholeStudioProvider } from "../index.js";
import type { CompositeStudioLabels } from "../types.js";

afterEach(() => { cleanup(); try { localStorage.clear(); } catch { /* jsdom always has storage */ } window.history.replaceState(null, "", "/"); vi.restoreAllMocks(); });

const wholeLabels = { ...labels, whole: { signoff: "W-signoff", proposed: "W-proposed", contract: "W-contract", contentSlots: "W-slots", configurations: "W-config", unresolved: "W-unresolved", unassessed: "W-unassessed" } } as CompositeStudioLabels;
function composite() {
  const input = componentIntegration();
  const catalog = { ...input.catalog, values: smallCatalog };
  const library = { ...input.library, values: { fills: [] } };
  const adapter = { kind: "composite" as const, catalog, load: async () => ({ library, componentOptions: input.componentOptions }), save: vi.fn() };
  return <WholeStudioProvider adapter={adapter} labels={wholeLabels}><Studio /></WholeStudioProvider>;
}
const valueCanvas = () => document.querySelector("style[data-studio-candidates]");

it("keeps focus on the layer select when a keyboard choice swaps the value canvas for a contract canvas", async () => {
  const user = userEvent.setup();
  render(composite());
  await studioReady();
  const before = await findLayerSelect(wholeLabels);
  expect(before.textContent?.trim()).toBe(wholeLabels.layers.tokens);
  before.focus();
  await user.keyboard("{Enter}");
  const listbox = await screen.findByRole("listbox");
  for (let step = 0; step < 5 && document.activeElement?.textContent?.trim() !== wholeLabels.layers.components; step++) await user.keyboard("{ArrowUp}");
  expect(within(listbox).getByRole("option", { name: wholeLabels.layers.components })).toBe(document.activeElement);
  await user.keyboard("{Enter}");
  await waitFor(() => expect(valueCanvas()).toBeNull());
  // The value canvas's rail (and its select) unmounted; the contract canvas's select holds focus.
  expect(before.isConnected).toBe(false);
  const after = await findLayerSelect(wholeLabels);
  expect(after.textContent?.trim()).toBe(wholeLabels.layers.components);
  await waitFor(() => expect(document.activeElement).toBe(after));
}, 20_000);

it("keeps focus on the explorer row when a keyboard expand swaps the value canvas for a contract canvas", async () => {
  const user = userEvent.setup();
  render(composite());
  await studioReady();
  const before = layerRows(wholeLabels.treeLabel).find(row => row.dataset.key === "components")!;
  expect(before.getAttribute("aria-expanded")).toBe("false");
  before.focus();
  expect(document.activeElement).toBe(before);
  await user.keyboard("{ArrowRight}");
  await waitFor(() => expect(valueCanvas()).toBeNull());
  // The value canvas's tree unmounted; the contract canvas's tree focuses the same layer row.
  expect(before.isConnected).toBe(false);
  const after = await waitFor(() => { const row = layerRows(wholeLabels.treeLabel).find(row => row.dataset.key === "components"); if (!row) throw new Error("no components row"); return row; });
  expect(after.getAttribute("aria-expanded")).toBe("true");
  await waitFor(() => expect(document.activeElement).toBe(after));
}, 20_000);
