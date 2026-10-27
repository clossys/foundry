import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { render, studioReady, chooseLayer, findLayerSelect } from "./__fixtures__/frame.js";
import { boardRow } from "./__fixtures__/library-board-dom.js";
import userEvent from "@testing-library/user-event";
import { applyLibraryChange, generateSelection, libraryHash, type ChangeSet } from "../catalog-core/index.js";
import { StudioProvider, StudioRightPanel } from "./index.js";
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
  return <StudioProvider catalog={smallCatalog} initialSlotId="tokens.surface-color" adapter={adapter} labels={labels}><Studio />{panel ? <aside aria-label="Details"><StudioRightPanel /></aside> : null}</StudioProvider>;
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
/** DESIGNER-RO (rail): the header and its layer links are gone; the undo shortcut with the panel unmounted never saves. */
it("renders no layer header or links, keeps status out of the rail, and the undo shortcut never saves with its panel unmounted", async () => {
  const adapter = hostAdapter(); const view = await mount(adapter);
  expect(document.querySelector("[data-studio-header]")).toBeNull(); expect(screen.queryAllByRole("link")).toEqual([]);
  expect(await findLayerSelect()).toBeVisible(); expect(document.querySelector("[data-studio-save-status]")).toBeNull();
  view.rerender(<Host adapter={adapter} panel={false} />);
  for (const key of ["z", "Z"]) await act(async () => { fireEvent.keyDown(document.body, { key, metaKey: true }); fireEvent.keyDown(document.body, { key, ctrlKey: true, shiftKey: true }); });
  expect(adapter.save).not.toHaveBeenCalled(); expect(adapter.load).toHaveBeenCalledTimes(1);
});
/** DESIGNER-RO (rail): the legacy fragment normalises to the canonical query; the layer select and a followed legacy link restore the layer. */
it("normalises a legacy layer fragment and restores the layer from the select and a followed legacy link", async () => {
  window.history.replaceState(null, "", "#studio-layer=assets"); const user = userEvent.setup(); await mount();
  const current = async () => (await findLayerSelect()).textContent?.trim();
  expect(window.location.search).toBe("?layer=assets"); expect(window.location.hash).toBe("");
  expect(await current()).toBe("Assets");
  await chooseLayer(labels, "Tokens", user);
  await waitFor(() => expect(window.location.search).toBe("?layer=tokens"));
  await act(async () => { window.location.hash = "#studio-layer=assets"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
  await waitFor(async () => expect(await current()).toBe("Assets"));
  expect(window.location.search).toBe("?layer=assets"); expect(window.location.hash).toBe("");
  await act(async () => { window.location.hash = "#unrelated"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
  expect(await current()).toBe("Assets"); expect(window.location.hash).toBe("#unrelated");
});
/**
 * DESIGNER-RO (rail): the layer select changes the layer at once, with no flush and no save. The host-router hooks
 * (`layerHref`, `onLayerNavigate`), the frame navigation data (`useStudioNavigation`) and the top bar's native link
 * activation tests went with the layer tabs: the select writes the canonical URL with replaceState instead.
 */
it("changes the layer from the explorer's layer select at once, with no flush and no save", async () => {
  const adapter = hostAdapter();
  render(<StudioProvider adapter={adapter} catalog={smallCatalog} labels={labels}><Studio /><StudioRightPanel /></StudioProvider>); await studioReady();
  await chooseLayer(labels, "Assets", userEvent.setup());
  await waitFor(() => expect(window.location.search).toBe("?layer=assets"));
  expect(adapter.save).not.toHaveBeenCalled();
});
