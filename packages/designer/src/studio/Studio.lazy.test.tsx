import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { render } from "./__fixtures__/frame.js";
import { StudioProvider, useStudioSession } from "./StudioProvider.js";
import { Board } from "./Board.js";
import { useCanvasWorld } from "./useCanvasWorld.js";
import { visibleStudioRows } from "./visible-rows.js";
import userEvent from "@testing-library/user-event";
import { Studio } from "./Studio.js";
import { buildCandidates } from "./model.js";
import { activeCandidateSource } from "./candidate-display.js";
import { studioEngine } from "./engine.js";
import { labels, smallCatalog, adopt } from "./__fixtures__/studio.js";
import type { CatalogData } from "../catalog-core/index.js";

vi.mock("./engine.js", async importOriginal => {
  const actual = await importOriginal<typeof import("./engine.js")>();
  return { ...actual, studioEngine: { ...actual.studioEngine } };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function Controls() {
  const state = useStudioSession();
  return <>
    <output data-testid="ready">{state.summary ? "ready" : "loading"}</output>
    <button onClick={() => state.showRows(new Set(["tokens.surface-color"]))}>show leaf</button>
    <button onClick={() => state.showRows(new Set())}>hide leaf</button>
    <button onClick={() => state.setExpanded(new Set(["tokens.surface-color"]))}>expand leaf</button>
    <output data-testid="rows">{state.rows.filter(row => row.candidatesReady).map(row => row.id).join(",")}</output>
  </>;
}
it("checks only the unchanged library at collapsed mount, then evaluates requested leaves and expanded members", async () => {
  const apply = vi.spyOn(studioEngine, "applyLibraryChange");
  const resolve = vi.spyOn(studioEngine, "resolve"); const check = vi.spyOn(studioEngine, "check");
  const library = adopt();
  const adapter = { load: async () => ({ library }), save: async () => ({ ok: false as const, reason: "unavailable" as const }) };
  const mount = (catalog: CatalogData) => <StudioProvider catalog={catalog} adapter={adapter} labels={labels}><Controls /></StudioProvider>;
  const view = render(mount(smallCatalog)); await screen.findByText("ready");
  const counts = () => [apply.mock.calls.length, resolve.mock.calls.length, check.mock.calls.length];
  expect(counts()).toEqual([0, 1, 1]);
  expect(screen.getByTestId("rows")).toHaveTextContent("");
  fireEvent.click(screen.getByText("show leaf"));
  expect(counts()).toEqual([2, 3, 3]);
  expect(screen.getByTestId("rows").textContent).toBe("tokens.surface-color");
  expect(apply.mock.calls.every(([, , change]) => change.changes.length === 1 && change.changes[0]?.slot === "tokens.surface-color")).toBe(true);
  fireEvent.click(screen.getByText("hide leaf")); fireEvent.click(screen.getByText("show leaf"));
  expect(counts()).toEqual([2, 3, 3]);
  view.rerender(mount({ ...smallCatalog }));
  expect(counts()).toEqual([4, 6, 6]);
  fireEvent.click(screen.getByText("expand leaf"));
  expect(apply.mock.calls.some(([, , change]) => change.changes.some(change => change.op === "adopt" && change.members?.length === 1))).toBe(true);
  expect(apply.mock.calls.every(([, , change]) => change.changes.every(change => change.slot === "tokens.surface-color"))).toBe(true);
  const expanded = counts(); fireEvent.click(screen.getByText("expand leaf")); expect(counts()).toEqual(expanded);
});

it("renders a generic group > family > leaf tree with counts and working filter chips before requesting candidates", async () => {
  const catalog: CatalogData = { ...smallCatalog, placements: [
    { layer: "tokens", nodes: [{ id: "color", label: "Color", children: [{ id: "palette", label: "Palette", leaves: ["tokens.surface-color", "tokens.spacing"] }] }] },
    { layer: "assets", nodes: [{ id: "images", label: "Images", children: [{ id: "navigation", label: "Navigation", leaves: ["assets.icon-search"] }] }] },
  ] };
  const library = adopt(); const check = vi.spyOn(studioEngine, "check"); const apply = vi.spyOn(studioEngine, "applyLibraryChange");
  render(<Studio catalog={catalog} adapter={{ load: async () => ({ library }), save: async () => ({ ok: false, reason: "unavailable" }) }} labels={labels} initialSlotId="tokens.surface-color" />);
  await screen.findByRole("link", { name: "Tokens" });
  expect(check).toHaveBeenCalledTimes(1); expect(apply).not.toHaveBeenCalled();
  const tree = within(screen.getByRole("treegrid", { name: labels.treeLabel }));
  expect(tree.getByRole("row", { name: /^Color/ })).toHaveAttribute("aria-level", "1");
  expect(tree.getByRole("row", { name: /^Palette/ })).toHaveAttribute("aria-level", "2");
  expect(tree.getByRole("row", { name: /^tokens.surface-color \(L-count/ })).toHaveAttribute("aria-level", "3");
  expect(document.querySelector('[data-studio-domain="tokens/color"]')).not.toBeNull();
  expect(document.querySelector('[data-studio-board="tokens/palette"]')).not.toBeNull();
  expect(document.querySelector('[data-studio-zoom-summary]')?.textContent).not.toContain("foundry");
  expect(screen.queryAllByRole("radio")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: labels.canvas.filters.all }));
  fireEvent.click(screen.getByRole("menuitem", { name: labels.canvas.filters.warnings }));
  expect(screen.getByRole("button", { name: labels.canvas.filters.warnings })).toBeInTheDocument();
  expect(check).toHaveBeenCalledTimes(1); expect(apply).not.toHaveBeenCalled();
});

it("keeps checked current previews through delayed geometry and overview until explicit alternative demand", async () => {
  let measured = false; const notifications: (() => void)[] = [];
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { notifications.push(callback); } observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => measured ? 1200 : 0);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => measured ? 800 : 0);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ x: 0, y: 0, left: 0, top: 0, right: measured ? 1000 : 0, bottom: measured ? 600 : 0, width: measured ? 1000 : 0, height: measured ? 600 : 0, toJSON() {} }));
  const library = adopt();
  const synthetic = structuredClone(smallCatalog.fills.find(fill => fill.$extensions["com.clossys.fill"].slot === "tokens.surface-color" && fill.$extensions["com.clossys.fill"].source === "foundry")!);
  synthetic.$extensions["com.clossys.fill"] = { ...synthetic.$extensions["com.clossys.fill"], id: "fixture-complete/tokens.surface-color", source: "fixture-complete", author: "consumer", trust: "consumer", sourceAddress: "test-fixture/complete-surface-color" };
  const catalog: CatalogData = { ...smallCatalog, sources: [...smallCatalog.sources.filter(source => source.id === "foundry"), { id: "fixture-complete", kind: "consumer", author: "consumer", license: "MIT" }], fills: [...smallCatalog.fills.filter(fill => fill.$extensions["com.clossys.fill"].source === "foundry"), synthetic] };
  const contract = catalog.slots.find(slot => slot.id === "tokens.surface-color")!.contract;
  if (contract.members.mode !== "closed") throw new Error("Fixture requires the unchanged closed surface contract");
  const expectedMembers = contract.members.names.map(name => `tokens.surface-color.${name}`).sort();
  expect(expectedMembers).toHaveLength(11);
  const qualified = buildCandidates({ catalog, library, working: library, slotId: "tokens.surface-color", scope: "slot", target: "tokens.surface-color" });
  expect(activeCandidateSource(qualified)).toBe("foundry");
  for (const source of ["foundry", "fixture-complete"]) {
    const candidate = qualified.find(candidate => candidate.source === source)!;
    expect(candidate.usable).toBe(true); expect(candidate.errors).toBe(0);
    expect(candidate.members.map(member => member.id).sort()).toEqual(expectedMembers);
  }
  expect(qualified.find(candidate => candidate.source === "fixture-complete")!.members.every(({ member }) => member.origin?.kind === "adopted" && member.origin.source === "fixture-complete")).toBe(true);
  const apply = vi.spyOn(studioEngine, "applyLibraryChange"), resolve = vi.spyOn(studioEngine, "resolve"), check = vi.spyOn(studioEngine, "check");
  function MeasuredBoard() {
    const state = useStudioSession();
    const canvas = useCanvasWorld("tokens", pose => { if (canvas.surface.current) state.showRows(visibleStudioRows(canvas.surface.current, state.rowElements.current, pose.zoom)); });
    const board = state.boards.find(board => board.leaves.includes("tokens.surface-color"));
    return <><button onClick={() => canvas.setPose({ x: 0, y: 0, zoom: .2 })}>overview fixture</button><button onClick={() => state.showRows(new Set(["tokens.surface-color"]))}>demand fixture</button>
      <output data-testid="measured-ready">{state.ready ? "measured ready" : "loading"}</output>
      <output data-testid="selected-ready">{String(state.rows.find(row => row.id === "tokens.surface-color")?.candidatesReady)}</output>
      <div ref={canvas.onSurfaceElement}><div ref={canvas.onWorldElement}>{board && state.working && state.pending ? <Board board={board} boardRef={null} sources={state.sources} labels={labels} working={state.working} changes={state.pending} expanded={state.expanded} groupChoices={state.groupChoices} onExpand={() => {}} onUse={(row, source) => state.use(row, source)} onFocusCell={() => {}} onRequestRow={row => state.requestRow(row.id)} onRowElement={(id, element) => { if (element) state.rowElements.current.set(id, element); else state.rowElements.current.delete(id); }} /> : null}</div></div>
    </>;
  }
  const view = render(<StudioProvider catalog={catalog} adapter={{ load: async () => ({ library }), save: async () => ({ ok: false as const, reason: "unavailable" as const }) }} labels={labels}><MeasuredBoard /></StudioProvider>);
  await screen.findByText("measured ready");
  const preview = () => view.container.querySelector('[data-studio-row="tokens.surface-color"] [data-candidate-cell]');
  expect(preview()).not.toBeNull(); const content = preview()!.textContent;
  expect(screen.getByTestId("selected-ready")).toHaveTextContent("false");
  expect([apply.mock.calls.length, resolve.mock.calls.length, check.mock.calls.length]).toEqual([0, 1, 1]);
  measured = true; await act(async () => { notifications.forEach(notify => notify()); });
  expect(preview()!.textContent).toBe(content);
  fireEvent.click(screen.getByText("overview fixture"));
  expect(preview()!.textContent).toBe(content); expect(apply).not.toHaveBeenCalled();
  expect(screen.getByTestId("selected-ready")).toHaveTextContent("false");
  fireEvent.click(screen.getByText("demand fixture"));
  expect(screen.getByTestId("selected-ready")).toHaveTextContent("true"); expect(apply).toHaveBeenCalledTimes(2);
  expect(preview()!.textContent).toBe(content);
  await userEvent.setup().click(screen.getByRole("button", { name: labels.board.changeSelection }));
  const initial = screen.getByRole("radio", { name: labels.useSource("foundry", "tokens.surface-color") });
  const target = screen.getByRole("radio", { name: labels.useSource("fixture-complete", "tokens.surface-color") });
  expect(initial).toBeEnabled(); expect(initial).toBeChecked(); expect(target).toBeEnabled();
  const user = userEvent.setup(); await user.click(initial);
  expect(initial).toHaveFocus(); expect(initial).toBeChecked();
  await user.keyboard("{ArrowRight}");
  await waitFor(() => expect(target).toBeChecked()); expect(target).toHaveFocus();
  await user.click(screen.getByRole("button", { name: labels.board.done }));
  const selectedRow = view.container.querySelector<HTMLElement>('[data-studio-row="tokens.surface-color"]')!;
  expect([...selectedRow.querySelectorAll<HTMLElement>("[data-candidate-variant]")].map(element => element.dataset.candidateVariant).sort()).toEqual(expectedMembers);
  expect(within(selectedRow).queryByText(labels.board.notChosen)).toBeNull();
});
