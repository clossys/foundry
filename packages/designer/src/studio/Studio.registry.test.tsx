import { afterEach, expect, it } from "vitest";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { render } from "./__fixtures__/frame.js";
import userEvent from "@testing-library/user-event";
import { loadBuildCatalog, type LayerId } from "../catalog-core/index.js";
import { Studio } from "./Studio.js";
import { StudioProvider } from "./StudioProvider.js";
import { StudioRightPanel } from "./StudioRightPanel.js";
import { catalogStudioAdapter } from "./catalog-adapter.js";
import { labels } from "./__fixtures__/studio.js";
import { boardRowLeaf } from "./canvas-boards.js";

afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });
const layers: readonly LayerId[] = ["tokens", "assets", "components", "sections", "frames"];
const sorted = (ids: readonly string[]) => [...ids].sort();
it.each(layers)("preserves %s canonical registry leaves and exposes no choice on any board", async layer => {
  const catalog = catalogStudioAdapter.catalog!;
  const build = loadBuildCatalog();
  const available = catalog.placements.some(placement => placement.layer === layer);
  const view = await act(async () => render(<StudioProvider adapter={catalogStudioAdapter} labels={labels} livePreview={false}><Studio /><StudioRightPanel /></StudioProvider>));
  const header = within(view.container.querySelector<HTMLElement>("[data-studio-header]")!);
  const tab = header.getByRole("link", { name: new RegExp(`^${labels.layers[layer]}(?:[ :]|$)`) });
  expect(build.slots.length).toBeGreaterThan(catalog.slots.length);
  expect(catalog.slots).toEqual(catalogStudioAdapter.catalog!.slots);
  if (!available) {
    expect(build.slots.some(slot => slot.layer === layer)).toBe(true);
    expect(tab).toHaveAttribute("aria-disabled", "true");
    expect(view.container.querySelector(`[data-studio-domain^="${layer}/"]`)).toBeNull();
    return;
  }
  expect(tab).not.toHaveAttribute("aria-disabled", "true");
  if (layer !== "tokens") await act(async () => { fireEvent.click(tab); });
  const leaves = catalog.slots.filter(slot => slot.layer === layer).map(slot => slot.id);
  // Every board is the library-board Section; its view rows name their leaf in the shared leaf label.
  const rowLeaves = [...view.container.querySelectorAll<HTMLElement>("[data-studio-canvas-board] tr")].flatMap(row => boardRowLeaf(row) ?? []);
  expect(sorted(rowLeaves)).toEqual(sorted(leaves));
  expect(view.queryAllByRole("radio")).toHaveLength(0);
  const families = catalog.placements.filter(placement => placement.layer === layer).flatMap(placement => placement.nodes.flatMap(node => "children" in node ? node.children.map(child => `${layer}/${child.id}`) : [`${layer}/${node.id}`]));
  const boards = [...view.container.querySelectorAll<HTMLElement>("[data-studio-canvas-board]")];
  expect(sorted(boards.map(board => board.dataset.studioCanvasBoard!))).toEqual(sorted(families));
  expect(view.getByRole("treegrid", { name: labels.treeLabel }).closest('[data-frame-module="explorer"]')).not.toBeNull();
  // DESIGNER-RO (converted): boards have no edit mode (rows 2-3, 8-9), so no board offers Change selection, a source
  // column or a radio; selecting a row reveals it in the read-only inspector instead.
  const board = boards.find(board => board.querySelector("tr [data-leaf-id]"))!;
  for (const each of boards) expect(within(each).queryByRole("button", { name: labels.board.changeSelection, hidden: true })).toBeNull();
  expect(view.container.querySelectorAll("td[data-studio-card]").length).toBe(0);
  const row = [...board.querySelectorAll<HTMLElement>("tbody tr")].find(row => boardRowLeaf(row))!;
  await userEvent.click(within(row).getByText(boardRowLeaf(row)!));
  await waitFor(() => expect(view.container.querySelector('[data-frame-module="value-inspector"] [data-studio-panel="inspector"]')).not.toBeNull());
  fireEvent.click(view.getByRole("button", { name: labels.scorecard.title }));
  expect(view.getByRole("region", { name: labels.scorecard.title })).toBeInTheDocument();
  fireEvent.click(within(view.getByRole("region", { name: labels.scorecard.title })).getByRole("button", { name: labels.scorecard.close }));
  expect(view.queryAllByRole("radio", { hidden: true })).toHaveLength(0);
}, 20_000);
