import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { render } from "./__fixtures__/frame.js";
import userEvent from "@testing-library/user-event";
import { applyLibraryChange, generateSelection, libraryHash, type ChangeSet } from "../catalog-core/index.js";
import { StudioProvider, StudioHeader, useStudioNavigation, StudioRightPanel, type StudioSessionControls } from "./index.js";
import { StudioTopBar } from "./StudioTopBar.js";
import { Studio, StudioEditBoundary } from "./Studio.js";
import { useStudioSession } from "./StudioProvider.js";
import type { StudioAdapter } from "./types.js";
import { labels, smallCatalog, emptyLibrary, adopt } from "./__fixtures__/studio.js";
import { boardOf } from "./__fixtures__/library-board-dom.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); window.history.replaceState(null, "", "/"); });
const radio = (source = "foundry", target = "tokens.surface-color") => {
  const board = boardOf(target)!;
  if (board.dataset.boardMode === "view") fireEvent.click(within(board).getByRole("button", { name: labels.board.changeSelection }));
  return within(board).getByRole("radio", { name: labels.useSource(source, target) });
};
function hostAdapter() {
  let library = emptyLibrary();
  const load = vi.fn(async () => ({ library: structuredClone(library) }));
  const save = vi.fn<StudioAdapter["save"]>(async (changes: ChangeSet) => {
    if (changes.baseHash !== libraryHash(library)) return { ok: false, reason: "conflict" };
    library = applyLibraryChange(smallCatalog, library, changes); return { ok: true, library: structuredClone(library) };
  });
  return { load, save, read: () => library };
}
function Host({ adapter, panel = true }: { adapter: StudioAdapter; panel?: boolean }) {
  return <StudioProvider catalog={smallCatalog} initialSlotId="tokens.surface-color" adapter={adapter} labels={labels}><StudioHeader /><Studio header="external" />{panel ? <aside aria-label="Details"><StudioRightPanel /></aside> : null}</StudioProvider>;
}
async function mount(adapter: StudioAdapter = hostAdapter()) { const view = render(<Host adapter={adapter} />); await screen.findByText("L-saved"); return view; }
it("autosaves discrete edits immediately, reloads authoritative truth and uses the reloaded hash next", async () => {
  const user = userEvent.setup(), adapter = hostAdapter(); await mount(adapter);
  await user.click(radio()); await waitFor(() => expect(adapter.load).toHaveBeenCalledTimes(2)); await screen.findByText("L-saved");
  expect(adapter.save.mock.calls[0]?.[0]).toEqual({ baseHash: libraryHash(emptyLibrary()), changes: [{ op: "adopt", slot: "tokens.surface-color", source: "foundry" }] });
  expect(radio()).toBeChecked();
  await user.click(radio("shadcn@aria")); await waitFor(() => expect(adapter.load).toHaveBeenCalledTimes(3));
  expect(adapter.save.mock.calls[1]?.[0].baseHash).toBe(libraryHash(adopt()));
  expect(screen.queryByRole("button", { name: /^(Save|Discard|L-save|L-discard)$/ })).toBeNull();
});
it("loads authoritative fills even when the host's compatible selection is stale", async () => {
  await mount({ load: async () => ({ library: adopt(), selection: generateSelection(emptyLibrary()) }), save: vi.fn() });
  expect(document.querySelector("[data-studio-preview]")?.textContent).toContain("--color-surface-base");
});
it("retains a failed leaf with inline Retry and keeps the attempted value visible", async () => {
  const user = userEvent.setup(), adapter = hostAdapter(); adapter.save.mockResolvedValueOnce({ ok: false, reason: "failed" }); await mount(adapter);
  await user.click(radio()); await screen.findByText("L-failed");
  expect(radio()).toBeChecked();
  const feedback = document.querySelector('[data-studio-edit-error="tokens.surface-color"]') as HTMLElement;
  await user.click(within(feedback).getByRole("button", { name: "L-retry" })); await screen.findByText("L-saved"); expect(adapter.save).toHaveBeenCalledTimes(2);
});
it("retries only the load after an acknowledged save whose reload failed", async () => {
  const user = userEvent.setup(), adapter = hostAdapter(); await mount(adapter); adapter.load.mockRejectedValueOnce(new Error("offline"));
  await user.click(radio()); await screen.findByText("L-failed");
  const feedback = document.querySelector('[data-studio-edit-error="tokens.surface-color"]') as HTMLElement;
  await user.click(within(feedback).getByRole("button", { name: "L-retry" })); await screen.findByText("L-saved"); expect(adapter.save).toHaveBeenCalledTimes(1);
});
it("keeps status and score out of the real-link header, and history works with its panel unmounted", async () => {
  const user = userEvent.setup(), adapter = hostAdapter(); const view = await mount(adapter);
  const header = document.querySelector("[data-studio-header]") as HTMLElement;
  expect(within(header).getAllByRole("link")).toHaveLength(5); expect(header.textContent).toBe("TokensAssetsComponentsSectionsFrames");
  expect(within(header).queryByRole("button")).toBeNull(); expect(within(screen.getByRole("complementary", { name: "Details" })).getByText("L-saved")).toBeVisible();
  await user.click(radio()); await screen.findByText("L-saved"); view.rerender(<Host adapter={adapter} panel={false} />);
  fireEvent.keyDown(document.body, { key: "z", metaKey: true }); await waitFor(() => expect(adapter.save).toHaveBeenCalledTimes(2));
  expect(adapter.read().fills).toHaveLength(0);
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
function ContinuousField() {
  const state = useStudioSession();
  return <StudioEditBoundary><input aria-label="Value" onChange={event => state.apply([{ op: "author", slot: "tokens.surface-color", tokens: { base: { $type: "color", $value: event.currentTarget.value } } }], "continuous", "base")} /></StudioEditBoundary>;
}
it.each(["blur", "Enter"])("flushes an actual continuous field %s boundary exactly once before 500ms", async boundary => {
  const adapter = hostAdapter(); render(<StudioProvider adapter={adapter} catalog={smallCatalog} labels={labels}><ContinuousField /><StudioRightPanel /></StudioProvider>);
  await screen.findByText("L-saved"); vi.useFakeTimers(); const input = screen.getByRole("textbox", { name: "Value" });
  fireEvent.change(input, { target: { value: "#ffffff" } }); fireEvent.change(input, { target: { value: "#000000" } }); expect(adapter.save).not.toHaveBeenCalled();
  await act(async () => { if (boundary === "blur") fireEvent.blur(input); else fireEvent.keyDown(input, { key: "Enter" }); });
  expect(adapter.save).toHaveBeenCalledTimes(1); await act(async () => { await vi.advanceTimersByTimeAsync(1000); }); expect(adapter.save).toHaveBeenCalledTimes(1);
});
it("awaits a deferred host-leave flush and reports false when the actual save fails", async () => {
  const adapter = hostAdapter(), sessionRef = createRef<StudioSessionControls>(); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); adapter.save.mockImplementationOnce(async () => { await gate; return { ok: false, reason: "failed" }; });
  render(<StudioProvider adapter={adapter} catalog={smallCatalog} labels={labels} sessionRef={sessionRef}><ContinuousField /><StudioRightPanel /></StudioProvider>); await screen.findByText("L-saved");
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "#ffffff" } }); let complete = false;
  const leaving = sessionRef.current!.flush().then(saved => { complete = true; return saved; }); expect(complete).toBe(false);
  await act(async () => { release(); expect(await leaving).toBe(false); }); expect(screen.getByText("L-not-saved")).toBeVisible();
});
it("flushes the actual layer link before changing selection or calling the host router", async () => {
  const adapter = hostAdapter(); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); const save = adapter.save.getMockImplementation()!;
  adapter.save.mockImplementationOnce(async changes => { await gate; return save(changes); }); const navigate = vi.fn();
  render(<StudioProvider adapter={adapter} catalog={smallCatalog} labels={labels}><StudioHeader layerHref={id => `/designer?layer=${id}`} onLayerNavigate={navigate} /><ContinuousField /><StudioRightPanel /></StudioProvider>); await screen.findByText("L-saved");
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "#ffffff" } }); fireEvent.click(screen.getByRole("link", { name: "Assets" }));
  expect(adapter.save).toHaveBeenCalledTimes(1); expect(navigate).not.toHaveBeenCalled(); expect(screen.getByRole("link", { name: "Tokens" })).toHaveAttribute("aria-current", "page");
  await act(async () => { release(); }); await waitFor(() => expect(navigate).toHaveBeenCalledWith("assets", "/designer?layer=assets"));
  expect(screen.getByRole("link", { name: "Assets" })).toHaveAttribute("aria-current", "page");
});
it("keeps the layer, URL and edited field when the layer-link flush fails", async () => {
  const adapter = hostAdapter(); adapter.save.mockResolvedValueOnce({ ok: false, reason: "failed" }); const navigate = vi.fn();
  render(<StudioProvider adapter={adapter} catalog={smallCatalog} labels={labels}><StudioHeader onLayerNavigate={navigate} /><ContinuousField /><StudioRightPanel /></StudioProvider>); await screen.findByText("L-saved");
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "#ffffff" } }); fireEvent.click(screen.getByRole("link", { name: "Assets" })); await screen.findByText("L-not-saved");
  expect(navigate).not.toHaveBeenCalled(); expect(window.location.hash).toBe(""); expect(screen.getByRole("textbox")).toHaveValue("#ffffff"); expect(screen.getByRole("link", { name: "Tokens" })).toHaveAttribute("aria-current", "page");
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
