import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { render, studioReady } from "./__fixtures__/frame.js";
import { boardRow } from "./__fixtures__/library-board-dom.js";
import userEvent from "@testing-library/user-event";
import { applyLibraryChange, generateSelection, libraryHash, type ChangeSet } from "../catalog-core/index.js";
import { StudioProvider, StudioHeader, useStudioNavigation, StudioRightPanel } from "./index.js";
import { StudioTopBar } from "./StudioTopBar.js";
import { Studio } from "./Studio.js";
import type { StudioAdapter } from "./types.js";
import { labels, smallCatalog, emptyLibrary, adopt } from "./__fixtures__/studio.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); window.history.replaceState(null, "", "/"); });
/*
 * DESIGNER-RO (deleted): the autosave, inline Retry, reload-retry and continuous-field flush tests (blur, Enter,
 * host-leave flush, layer-link flush and its failure) asserted write behaviour the read-only Designer no longer has
 * (inventory rows 10, 11 and 13: EditFeedback, StudioStatus, the autosave flush and StudioEditBoundary).
 */
function hostAdapter() {
  let library = emptyLibrary();
  const load = vi.fn(async () => ({ library: structuredClone(library) }));
  const save = vi.fn<NonNullable<StudioAdapter["save"]>>(async (changes: ChangeSet) => {
    if (changes.baseHash !== libraryHash(library)) return { ok: false, reason: "conflict" };
    library = applyLibraryChange(smallCatalog, library, changes); return { ok: true, library: structuredClone(library) };
  });
  return { load, save, read: () => library };
}
function Host({ adapter, panel = true }: { adapter: StudioAdapter; panel?: boolean }) {
  return <StudioProvider catalog={smallCatalog} initialSlotId="tokens.surface-color" adapter={adapter} labels={labels}><StudioHeader /><Studio header="external" />{panel ? <aside aria-label="Details"><StudioRightPanel /></aside> : null}</StudioProvider>;
}
async function mount(adapter: StudioAdapter = hostAdapter()) { const view = render(<Host adapter={adapter} />); await studioReady(); return view; }
/** DESIGNER-RO (converted): the live preview of unsaved state is gone, so the board row shows the authoritative fill. */
it("loads authoritative fills even when the host's compatible selection is stale", async () => {
  await mount({ load: async () => ({ library: adopt(), selection: generateSelection(emptyLibrary()) }), save: vi.fn() });
  await waitFor(() => expect(boardRow("tokens.surface-color")).toBeDefined());
  expect(boardRow("tokens.surface-color")!.textContent).not.toContain(labels.board.notChosen);
  expect(boardRow("tokens.surface-color")!.textContent).toContain("--color-surface-raised");
  expect(document.querySelector("style[data-studio-preview]")).toBeNull();
});
/** DESIGNER-RO (converted): the header half is unchanged; the undo shortcut with the panel unmounted now never saves. */
it("keeps status and score out of the real-link header, and the undo shortcut never saves with its panel unmounted", async () => {
  const adapter = hostAdapter(); const view = await mount(adapter);
  const header = document.querySelector("[data-studio-header]") as HTMLElement;
  expect(within(header).getAllByRole("link")).toHaveLength(5); expect(header.textContent).toBe("TokensAssetsComponentsSectionsFrames");
  expect(within(header).queryByRole("button")).toBeNull(); expect(document.querySelector("[data-studio-save-status]")).toBeNull();
  view.rerender(<Host adapter={adapter} panel={false} />);
  for (const key of ["z", "Z"]) await act(async () => { fireEvent.keyDown(document.body, { key, metaKey: true }); fireEvent.keyDown(document.body, { key, ctrlKey: true, shiftKey: true }); });
  expect(adapter.save).not.toHaveBeenCalled(); expect(adapter.load).toHaveBeenCalledTimes(1);
});
it("uses fragment mount, keyboard activation and back/forward to restore the selected layer", async () => {
  window.history.replaceState(null, "", "#studio-layer=assets"); const user = userEvent.setup(); await mount();
  expect(screen.getByRole("link", { name: "Assets" })).toHaveAttribute("aria-current", "page");
  const tokens = screen.getByRole("link", { name: "Tokens" }); tokens.focus(); await user.keyboard("{Enter}");
  await waitFor(() => expect(window.location.hash).toBe("#studio-layer=tokens"));
  await act(async () => { window.location.hash = "#studio-layer=assets"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
  expect(screen.getByRole("link", { name: "Assets" })).toHaveAttribute("aria-current", "page");
  await act(async () => { window.location.hash = "#unrelated"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
  expect(screen.getByRole("link", { name: "Assets" })).toHaveAttribute("aria-current", "page");
});
/** DESIGNER-RO (converted): with no unsaved edit to flush, the layer link changes selection and calls the host router at once. */
it("changes the layer and calls the host router at once, with no flush and no save", async () => {
  const adapter = hostAdapter(); const navigate = vi.fn();
  render(<StudioProvider adapter={adapter} catalog={smallCatalog} labels={labels}><StudioHeader layerHref={id => `/designer?layer=${id}`} onLayerNavigate={navigate} /><Studio header="external" /><StudioRightPanel /></StudioProvider>); await studioReady();
  fireEvent.click(screen.getByRole("link", { name: "Assets" }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith("assets", "/designer?layer=assets"));
  expect(screen.getByRole("link", { name: "Assets" })).toHaveAttribute("aria-current", "page"); expect(adapter.save).not.toHaveBeenCalled();
});

it("supplies frame navigation data matching the mounted header and provider selection", async () => {
  const user = userEvent.setup();
  const layerHref = (id: import("../catalog-core/index.js").LayerId) => `#studio-layer=${id}`;
  function Probe() { const nav = useStudioNavigation({ layerHref }); return <output data-testid="frame-nav">{JSON.stringify(nav)}</output>; }
  render(<StudioProvider catalog={smallCatalog} adapter={hostAdapter()} labels={labels}><StudioHeader layerHref={layerHref} /><Probe /></StudioProvider>);
  const tokens = await screen.findByRole("link", { name: "Tokens" });
  const read = () => JSON.parse(screen.getByTestId("frame-nav").textContent!);
  expect(read().label).toBe(labels.layers.label); expect(read().activeId).toBe("tokens");
  const enabled = screen.getAllByRole("link").filter(link => link.getAttribute("aria-disabled") !== "true");
  expect(read().items).toEqual(enabled.map(link => ({ id: link.getAttribute("href")!.split("=")[1], label: link.textContent, href: link.getAttribute("href") })));
  expect(tokens).toHaveAttribute("aria-current", "page");
  await user.click(screen.getByRole("link", { name: "Assets" }));
  await waitFor(() => expect(read().activeId).toBe("assets"));
});

it.each([
  ["Control", { ctrlKey: true }, undefined],
  ["Meta", { metaKey: true }, undefined],
  ["Shift", { shiftKey: true }, undefined],
  ["Alt", { altKey: true }, undefined],
  ["middle button", { button: 1 }, undefined],
  ["download", {}, ["download", ""]],
  ["new target", {}, ["target", "_blank"]],
  ["parent target", {}, ["target", "_parent"]],
] as const)("preserves native %s activation without flushing or host routing", (_name, mouse, attribute) => {
  const onLayer = vi.fn(async () => true), navigate = vi.fn();
  render(<StudioTopBar labels={labels} layers={["tokens", "assets"]} onLayer={onLayer} onLayerNavigate={navigate} />);
  const link = screen.getByRole("link", { name: "Assets" });
  if (attribute) link.setAttribute(attribute[0], attribute[1]);
  // A middle-button browser activation is auxclick. Fragment hrefs stay inside JSDOM;
  // no external navigation or application launch is attempted by these native events.
  const event = new MouseEvent("button" in mouse ? "auxclick" : "click", { bubbles: true, cancelable: true, button: 0, ...mouse });
  fireEvent(link, event);
  expect(event.defaultPrevented).toBe(false); expect(link).toHaveAttribute("href", "#studio-layer=assets");
  expect(onLayer).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled();
});
it("respects an already prevented native link event", () => {
  const onLayer = vi.fn(async () => true), navigate = vi.fn();
  render(<StudioTopBar labels={labels} layers={["tokens", "assets"]} onLayer={onLayer} onLayerNavigate={navigate} />);
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }); event.preventDefault();
  fireEvent(screen.getByRole("link", { name: "Assets" }), event);
  expect(event.defaultPrevented).toBe(true); expect(onLayer).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled();
});
