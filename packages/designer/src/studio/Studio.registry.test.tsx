import { afterEach, expect, it } from "vitest";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { render } from "./__fixtures__/frame.js";
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
it.each(layers)("preserves %s canonical registry leaves and exposes choices only in an edited board", async layer => {
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
  const board = boards.find(board => board.querySelector("tr [data-leaf-id]"))!;
  const boardLeaves = [...board.querySelectorAll<HTMLElement>("tr")].flatMap(row => boardRowLeaf(row) ?? []);
  const filledSources = new Set(catalog.fills.filter(doc => boardLeaves.includes(doc.$extensions["com.clossys.fill"].slot)).map(doc => doc.$extensions["com.clossys.fill"].source));
  await act(async () => { fireEvent.click(within(board).getByRole("button", { name: labels.board.changeSelection })); });
  // Columns follow the leaf's library roster: a token board's is Custom only; other layers add each roster
  // source that has a previewable fill (members or a source address), and never an unfilled one.
  const CUSTOM = "library-board-custom-actions";
  const cardSources = new Set([...board.querySelectorAll<HTMLElement>("td[data-studio-card]")].map(cell => cell.dataset.studioCard!));
  expect(cardSources.has(CUSTOM)).toBe(true);
  const sourceColumns = [...cardSources].filter(source => source !== CUSTOM);
  if (layer === "tokens") expect(sourceColumns).toEqual([]);
  for (const source of sourceColumns) expect(filledSources.has(source), source).toBe(true);
  for (const other of boards.filter(other => other !== board)) expect(within(other).queryAllByRole("radio")).toHaveLength(0);
  expect(sorted([...board.querySelectorAll<HTMLElement>("[data-studio-row]")].map(row => row.dataset.studioRow!))).toEqual(sorted(boardLeaves));
  // A source column's radio reveals its cell in the inspector; a Custom-only board reveals its row from the Custom cell.
  const radio = within(board).queryAllByRole("radio")[0];
  // Choices appear exactly when the edited board has a source column.
  expect(radio !== undefined).toBe(sourceColumns.length > 0);
  if (radio) fireEvent.focus(radio);
  else fireEvent.focus(board.querySelector<HTMLElement>(`td[data-studio-card="${CUSTOM}"]`)!);
  expect(view.container.querySelector('[data-frame-module="value-inspector"] [data-studio-panel="inspector"]')).not.toBeNull();
  fireEvent.click(view.getByRole("button", { name: labels.scorecard.title }));
  expect(view.getByRole("region", { name: labels.scorecard.title })).toBeInTheDocument();
  fireEvent.click(within(view.getByRole("region", { name: labels.scorecard.title })).getByRole("button", { name: labels.scorecard.close }));
  fireEvent.click(within(board).getByRole("button", { name: labels.board.done }));
  expect(view.queryAllByRole("radio")).toHaveLength(0);
}, 20_000);
