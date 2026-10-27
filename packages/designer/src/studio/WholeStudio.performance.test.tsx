import { afterEach, expect, it, vi } from "vitest";
import { isValidElement } from "react";
import { Disclosure } from "../components/Disclosure.js";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "./__fixtures__/frame.js";
import { labels } from "./__fixtures__/studio.js";
import { Studio } from "./Studio.js";
import { StudioRightPanel } from "./StudioRightPanel.js";
import { WholeStudioProvider, useWholeStudio, type WholeStudioState } from "./WholeStudioProvider.js";
import { compositeBoardPrompt } from "./prepared-library-boards.js";
import { applyLibraryChange, loadBuildCatalog, loadCatalog, loadComponentRegistry, resolve, type BuildCatalogData, type PlacementNode } from "../catalog-core/index.js";
import { componentIntegration, adoptedComponentIntegration } from "../catalog-core/__fixtures__/component-integration.js";
import { standardM1FixtureEngine, standardM1Runtime } from "../catalog-core/__fixtures__/standard-m1-runtime.js";
import { boardOf, boardRow } from "./__fixtures__/library-board-dom.js";
import type { CompositeStudioAdapter, CompositeStudioLabels, CompositeStudioSnapshot, StudioCandidateWorkflow } from "./types.js";

vi.mock("./prepared-library-boards.js", async importOriginal => {
  const actual = await importOriginal<typeof import("./prepared-library-boards.js")>();
  return { ...actual, compositeBoardPrompt: vi.fn(actual.compositeBoardPrompt) };
});
vi.mock("../components/Disclosure.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../components/Disclosure.js")>();
  return { ...actual, Disclosure: vi.fn(actual.Disclosure) };
});
// Counts each preparation of the actual native Tree.Node; rendering delegates to the original RAC row.
const treeRows = vi.hoisted(() => ({ prepared: new Map<string, number>() }));
vi.mock("../components/Tree.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../components/Tree.js")>();
  const { createElement, forwardRef } = await import("react");
  const Node = forwardRef<HTMLDivElement, import("../components/Tree.js").TreeNodeProps>(function CountedNode(props, ref) {
    const id = String(props.id);
    treeRows.prepared.set(id, (treeRows.prepared.get(id) ?? 0) + 1);
    return createElement(actual.Tree.Node, { ...props, ref });
  });
  return { ...actual, Tree: Object.assign(forwardRef<HTMLDivElement, import("../components/Tree.js").TreeProps<object>>(function CountedTree(props, ref) { return createElement(actual.Tree, { ...props, ref }); }), { Node }) };
});
const wholeLabels: CompositeStudioLabels = { ...labels, whole: { signoff: "W-signoff", proposed: "W-proposed", contract: "W-contract", contentSlots: "W-slots", configurations: "W-config", unresolved: "W-unresolved", unassessed: "W-unassessed" } };
afterEach(() => { cleanup(); vi.clearAllMocks(); treeRows.prepared.clear(); window.history.replaceState(null, "", "/"); });
function contractsFor(...ids: string[]): BuildCatalogData {
  const contracts = loadBuildCatalog(), keep = new Set(ids);
  const prune = (node: PlacementNode): PlacementNode[] => {
    if ("children" in node) { const children = node.children.flatMap(prune); return children.length ? [{ ...node, children }] : []; }
    const leaves = node.leaves.filter(id => keep.has(id)); return leaves.length ? [{ ...node, leaves }] : [];
  };
  return { ...contracts, slots: contracts.slots.filter(slot => keep.has(slot.id)), placements: contracts.placements.map(placement => ({ ...placement, nodes: placement.nodes.flatMap(prune) })).filter(placement => placement.nodes.length) };
}
function fixture(selected = false, full = false) {
  const input = selected ? adoptedComponentIntegration() : componentIntegration();
  const catalog = full ? { values: loadCatalog(), components: { ...loadComponentRegistry(), fills: [] } } : input.catalog;
  let snapshot: CompositeStudioSnapshot = { library: full ? { ...input.library, values: { fills: [] } } : input.library, componentOptions: input.componentOptions };
  const load = vi.fn(async () => snapshot);
  const save = vi.fn(async (changes: Parameters<CompositeStudioAdapter["save"]>[0]) => {
    snapshot = { ...snapshot, library: applyLibraryChange(catalog, snapshot.library, changes) };
    return { ok: true as const, library: snapshot.library };
  });
  const adapter: CompositeStudioAdapter = { kind: "composite", catalog, contracts: full ? loadBuildCatalog() : contractsFor("components.button", "components.select"), load, save };
  return { adapter, save, load, replace: (next: CompositeStudioSnapshot) => { snapshot = next; }, get: () => snapshot };
}
function Surface({ adapter, labels = wholeLabels, workflow, onState, initial = "components.button" }: { adapter: CompositeStudioAdapter; labels?: CompositeStudioLabels; workflow?: StudioCandidateWorkflow; onState(state: WholeStudioState): void; initial?: string }) {
  function Probe() { onState(useWholeStudio()!); return null; }
  return <WholeStudioProvider adapter={adapter} labels={labels} initialSlotId={initial}><Probe /><Studio candidateWorkflow={workflow} /><StudioRightPanel /></WholeStudioProvider>;
}
const row = (id: string) => boardRow(id)!;
const board = (id: string) => boardOf(id)!;
const explorer = () => document.querySelector<HTMLElement>('[data-studio-panel="explorer"]')!;
function promptData(dialog: HTMLElement) { return JSON.parse(dialog.querySelector("code")!.textContent!.split("\n\n").slice(1).join("\n\n")); }

it("retains signoff disclosure content and expansion without rendering it again for leaf selection", async () => {
  const f = fixture(false, true); let state!: WholeStudioState;
  const onState = (value: WholeStudioState) => { state = value; };
  const mounted = performance.now();
  const view = render(<Surface adapter={f.adapter} initial="sections.hero" onState={onState} />);
  await screen.findByText(labels.autosave.saved);
  const mountMs = Math.round(performance.now() - mounted);
  const inspector = () => document.querySelector<HTMLElement>('[data-studio-panel="inspector"]')!;
  const ids = f.adapter.contracts!.slots.filter(slot => slot.layer === "sections" || slot.layer === "frames").map(slot => slot.id);
  const signoffCalls = () => vi.mocked(Disclosure).mock.calls.filter(([props]) => isValidElement<{ children?: unknown }>(props.title) && ids.includes(String(props.title.props.children))).length;
  const collapsed = within(inspector()).getByRole("button", { name: ids.at(-1)!, exact: true });
  const hidden = document.getElementById(collapsed.getAttribute("aria-controls")!)!;
  expect(hidden.querySelector("pre")!.textContent).toBe(JSON.stringify(f.adapter.contracts!.slots.find(slot => slot.id === ids.at(-1))!.contract, null, 2));
  expect(hidden).not.toBeVisible();
  const trigger = within(inspector()).getByRole("button", { name: "sections.hero", exact: true });
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  const initial = signoffCalls(), started = performance.now(), session = state.session;
  expect(initial).toBe(ids.length);
  for (const id of ids.slice(1, 6)) act(() => state.setLeaf(id));
  const after = signoffCalls();
  console.info("PERF5 signoff traversal", JSON.stringify({ leaves: 5, mountMs, initialRenders: initial, additionalRenders: after - initial, elapsedMs: Math.round(performance.now() - started) }));
  expect(within(inspector()).getByRole("heading", { level: 2 })).toHaveTextContent(ids[5]!);
  expect(state.session).toBe(session);
  expect(within(inspector()).getByRole("button", { name: "sections.hero", exact: true })).toBe(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(signoffCalls()).toBe(initial);
  const nextLabels = { ...wholeLabels, whole: { ...wholeLabels.whole, signoff: "Current signoff", proposed: "Current proposal", unresolved: "Current unresolved" } };
  view.rerender(<Surface adapter={f.adapter} labels={nextLabels} initial="sections.hero" onState={onState} />);
  expect(within(inspector()).getByRole("heading", { name: "Current signoff" })).toBeVisible();
  expect(within(inspector()).getByText("Current proposal")).toBeVisible();
  expect(inspector().textContent).toContain("Current unresolved");
  expect(signoffCalls()).toBeGreaterThan(initial);
  const nextNone = { ...nextLabels, inspector: { ...nextLabels.inspector, none: "No unresolved axes" } };
  view.rerender(<Surface adapter={f.adapter} labels={nextNone} initial="sections.hero" onState={onState} />);
  expect(inspector().textContent).toContain("Current unresolved: No unresolved axes");
  const next = { ...f.adapter, contracts: { ...f.adapter.contracts!, slots: f.adapter.contracts!.slots.map(slot => slot.id === "sections.hero" ? { ...slot, contract: { ...slot.contract, description: "Current contract content" } } : slot) } };
  view.rerender(<Surface adapter={next} labels={nextNone} initial="sections.hero" onState={onState} />);
  await waitFor(() => expect(state.session).not.toBe(session));
  expect(inspector().textContent).toContain("Current contract content");
  expect(within(inspector()).getByRole("button", { name: "sections.hero", exact: true })).toHaveAttribute("aria-expanded", "true");
  view.unmount();
  vi.mocked(Disclosure).mockClear();
  const second = performance.now();
  render(<Surface adapter={f.adapter} initial="sections.hero" onState={onState} />);
  await screen.findByText(labels.autosave.saved);
  expect(signoffCalls()).toBe(ids.length);
  expect(state.session).not.toBe(session);
  console.info("PERF5 second fresh source mount", JSON.stringify({ mountMs: Math.round(performance.now() - second), signoffRenders: signoffCalls(), qualifier: "warm module source fixture; not installed Admin qualification" }));
});

it("keeps contract board preparation stable when native Tree blur advances the original session revision", async () => {
  const f = fixture(false, true), user = userEvent.setup(); let state!: WholeStudioState;
  render(<Surface adapter={f.adapter} onState={value => { state = value; }} />);
  await screen.findByText(labels.autosave.saved);
  await user.click(within(explorer()).getByRole("button", { name: "Actions", exact: true }));
  const first = within(explorer()).getByRole("button", { name: "Buttons", exact: true });
  await user.click(first);
  const before = { revision: state.sessionState!.revision, session: state.session, library: state.input!.library, edits: state.sessionState!.edits, profile: state.evaluated!.value!.profile, prompts: vi.mocked(compositeBoardPrompt).mock.calls.length };
  expect(before.prompts).toBeGreaterThan(0);
  await user.click(within(explorer()).getByRole("button", { name: "Menus", exact: true }));
  expect(state.sessionState!.revision).toBeGreaterThan(before.revision);
  expect(state.session).toBe(before.session); expect(state.input!.library).toBe(before.library);
  expect(state.sessionState!.edits).toBe(before.edits); expect(state.evaluated!.value!.profile).toBe(before.profile);
  expect(compositeBoardPrompt).toHaveBeenCalledTimes(before.prompts);
  expect(f.save).not.toHaveBeenCalled();
  // Explorer state and native keyboard navigation remain outside the board boundary.
  await user.click(within(explorer()).getByRole("row", { name: "components.button", exact: true }));
  expect(state.leaf).toBe("components.button");
  expect(within(explorer()).getByRole("row", { name: "components.button", exact: true })).toHaveAttribute("aria-selected", "true");
  await user.keyboard("{ArrowDown}{Enter}");
  expect(state.leaf).not.toBe("components.button");
});

// Expands every canonical branch of one layer through the native chevron (as the installed Admin
// traversal probe does), then advances the original session revision without an edit.
async function canonicalTraversal(layer: "components" | "sections", initial: string) {
  const f = fixture(false, true); let state!: WholeStudioState;
  const mountedAt = performance.now();
  render(<Surface adapter={f.adapter} initial={initial} onState={value => { state = value; }} />);
  await screen.findByText(labels.autosave.saved);
  const mountMs = Math.round(performance.now() - mountedAt);
  const contracts = f.adapter.contracts!, placement = contracts.placements.find(entry => entry.layer === layer)!;
  const expected = contracts.slots.filter(slot => slot.layer === layer).map(slot => slot.id);
  const tree = within(explorer()).getByRole("treegrid", { name: wholeLabels.treeLabel });
  const total = () => [...treeRows.prepared.values()].reduce((sum, count) => sum + count, 0);
  const mounted = total(), started = performance.now(); let branches = 0;
  for (const domain of placement.nodes) for (const branch of [domain, ...("children" in domain ? domain.children : [])]) {
    const button = [...tree.querySelectorAll<HTMLButtonElement>("button")].find(candidate => candidate.getAttribute("aria-label") === branch.label);
    expect(button, branch.id).toBeDefined();
    const row = button!.closest('[role="row"]')!;
    if (row.getAttribute("aria-expanded") !== "false") continue;
    act(() => button!.click()); branches++;
    expect(row.getAttribute("aria-expanded"), branch.id).toBe("true");
  }
  const expanded = total(), traversalMs = Math.round(performance.now() - started);
  const session = state.session, revision = state.sessionState!.revision, library = state.input!.library;
  fireEvent.focusOut(tree.querySelector('[role="row"]')!);
  await act(async () => { await state.session!.flush(); });
  expect(state.sessionState!.revision).toBeGreaterThan(revision + 1);
  expect(state.session).toBe(session); expect(state.input!.library).toBe(library); expect(f.save).not.toHaveBeenCalled();
  const rows = [...tree.querySelectorAll<HTMLElement>('[role="row"]')];
  for (const id of expected) {
    const leafRow = rows.find(candidate => candidate.textContent?.trim() === id);
    expect(leafRow, id).toBeDefined(); expect(leafRow!.getAttribute("aria-disabled"), id).not.toBe("true");
  }
  const counts = [...treeRows.prepared.values()];
  const result = { layer, leaves: expected.length, branches, identities: counts.length, mounted, afterExpansion: expanded, afterRevision: total(), maxPerIdentity: Math.max(...counts), mountMs, traversalMs, qualifier: "warm module jsdom source fixture; not installed Admin qualification" };
  console.info("PERF6 explorer row preparation", JSON.stringify(result));
  return result;
}

it("PERF6 canonical traversal prepares each explorer row once per node identity", async () => {
  const components = await canonicalTraversal("components", "components.button");
  // The user query still re-projects the explorer rows.
  fireEvent.change(screen.getByRole("searchbox", { name: labels.canvas.search }), { target: { value: "button" } });
  const tree = within(explorer()).getByRole("treegrid", { name: wholeLabels.treeLabel });
  const leafRows = [...tree.querySelectorAll<HTMLElement>('[role="row"]')].map(leafRow => leafRow.textContent?.trim() ?? "").filter(id => id.startsWith("components."));
  expect(leafRows).toContain("components.button"); expect(leafRows).not.toContain("components.select");
  expect(leafRows.length).toBeGreaterThan(0); expect(leafRows.filter(id => !id.includes("button"))).toEqual([]);
  cleanup(); treeRows.prepared.clear();
  const sections = await canonicalTraversal("sections", "sections.hero");
  // Floors are the C14 canonical counts; the current catalog may only grow.
  expect(components.leaves).toBeGreaterThanOrEqual(57); expect(components.branches).toBeGreaterThanOrEqual(26);
  expect(sections.leaves).toBeGreaterThanOrEqual(45);
  for (const layer of [components, sections]) {
    expect(layer.maxPerIdentity, layer.layer).toBe(1);
    expect(layer.afterRevision, layer.layer).toBe(layer.identities);
  }
});

it("updates contract labels and the complete workflow including real prompt callbacks", async () => {
  const f = fixture(), firstCheck = vi.fn(async () => ({ status: "checked" as const, candidates: [] })), nextCheck = vi.fn(async () => ({ status: "checked" as const, candidates: [] }));
  const onState = () => {}, workflow = { returnStep: "First return", guidelines: { "components.button": ["First guideline"] }, checkCandidates: firstCheck };
  const view = render(<Surface adapter={f.adapter} onState={onState} workflow={workflow} />);
  await screen.findByText(labels.autosave.saved);
  const nextLabels = { ...wholeLabels, board: { ...labels.board, askAgent: "Updated ask", promptInstruction: "Updated instruction" } };
  view.rerender(<Surface adapter={f.adapter} onState={onState} labels={nextLabels} workflow={workflow} />);
  expect(within(row("components.button")).getByRole("button", { name: "Updated ask" })).toBeVisible();
  const launch = vi.fn(() => "dispatched" as const);
  const nextWorkflow = { returnStep: "Next return", guidelines: { "components.button": ["Next guideline"] }, checkCandidates: nextCheck,
    actions: { projectPath: "fixture-project", viewHref: "#fixture", openWithTargets: [{ id: "editor", label: "Fixture", href: () => "https://example.test/editor" }], labels: { openIn: "Open editor", chooseTarget: "Choose editor", copyPrompt: "Copy task", copyLink: "Copy view" }, onNotice: vi.fn(), launch } };
  view.rerender(<Surface adapter={f.adapter} onState={onState} labels={nextLabels} workflow={nextWorkflow} />);
  fireEvent.click(within(row("components.button")).getByRole("button", { name: "Updated ask" }));
  const dialog = await screen.findByRole("dialog");
  expect(dialog.querySelector("code")!.textContent).toContain("Updated instruction");
  expect(promptData(dialog)).toMatchObject({ guidelines: ["Next guideline"], returnStep: "Next return" });
  fireEvent.click(within(dialog).getByRole("button", { name: labels.board.checkCandidates }));
  await waitFor(() => expect(nextCheck).toHaveBeenCalledWith("components.button"));
  expect(firstCheck).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Open editor Fixture" }));
  await waitFor(() => expect(launch).toHaveBeenCalledWith("https://example.test/editor", nextWorkflow.actions.openWithTargets[0]));
});

it("refreshes selected previews and prompt token context after actual library edits and host preview replacement", async () => {
  const f = fixture(true); let state!: WholeStudioState;
  const preview = vi.fn((leaf: string, profile: Parameters<NonNullable<CompositeStudioSnapshot["preview"]>>[1]) => <output data-testid={`preview-${leaf}`}>{profile.values.members["tokens.surface-color.base"]?.css.light}</output>);
  f.replace({ ...f.get(), preview });
  render(<Surface adapter={f.adapter} onState={value => { state = value; }} />);
  await screen.findByText(labels.autosave.saved);
  const selected = screen.getByTestId("preview-components.button"); expect(selected).toHaveTextContent("#ffffff");
  const originalProfile = state.evaluated!.value!.profile, originalLibrary = state.input!.library;
  const originalPreviewCalls = preview.mock.calls.length;
  await act(async () => { await state.session!.flush(); });
  expect(preview).toHaveBeenCalledTimes(originalPreviewCalls);
  act(() => state.session!.edit("tokens.surface-color", [{ portion: "values", change: { op: "author", slot: "tokens.surface-color", tokens: { base: { $type: "color", $value: "#123456", $extensions: { "com.clossys.css": { raw: "#123456" } } } } } }]));
  await waitFor(() => expect(screen.getByTestId("preview-components.button")).toHaveTextContent("#123456"));
  await waitFor(() => expect(state.sessionState!.status).toBe("saved"));
  expect(f.save).toHaveBeenCalledOnce(); expect(state.input!.library).not.toBe(originalLibrary); expect(state.evaluated!.value!.profile).not.toBe(originalProfile);
  fireEvent.click(within(row("components.select")).getByRole("button", { name: labels.board.askAgent }));
  const dialog = await screen.findByRole("dialog");
  expect(promptData(dialog).tokens).toContainEqual({ id: "tokens.surface-color.base", value: "#123456" });
  fireEvent.click(within(dialog).getByRole("button", { name: labels.board.close }));
  const nextPreview = vi.fn((leaf: string) => <output data-testid={`replacement-${leaf}`}>Replacement preview</output>);
  f.replace({ ...f.get(), preview: nextPreview });
  const session = state.session;
  await act(async () => { await state.session!.takeTheirs("components.button"); });
  expect(state.session).toBe(session); expect(screen.getByTestId("replacement-components.button")).toHaveTextContent("Replacement preview");
  // Query changes still alter the actual board rows.
  fireEvent.change(screen.getByRole("searchbox", { name: labels.canvas.search }), { target: { value: "select" } });
  expect(boardRow("components.button")).toBeUndefined(); expect(boardRow("components.select")).toBeDefined();
});

it("keeps Choose, native candidate save and Done bound to the original session", async () => {
  const f = fixture(), user = userEvent.setup(); let state!: WholeStudioState;
  const onState = (value: WholeStudioState) => { state = value; };
  const view = render(<Surface adapter={f.adapter} onState={onState} />);
  await screen.findByText(labels.autosave.saved); const session = state.session;
  await user.click(within(row("components.button")).getByRole("button", { name: labels.board.choose }));
  expect(board("components.button")).toHaveAttribute("data-board-mode", "edit");
  await user.click(screen.getByRole("radio", { name: labels.useSource("test-kit", "components.button") }));
  await waitFor(() => expect(f.save).toHaveBeenCalledOnce());
  await waitFor(() => expect(state.sessionState!.status).toBe("saved"));
  expect(state.session).toBe(session);
  expect(f.save.mock.calls[0]![0].changes).toEqual([{ portion: "components", change: { op: "adopt", slot: "components.button", source: "test-kit" } }]);
  await user.click(within(board("components.button")).getByRole("button", { name: labels.board.done }));
  expect(board("components.button")).toHaveAttribute("data-board-mode", "view");
  expect(state.evaluated!.value!.profile.components.components["components.button"]?.descriptor.source).toBe(f.get().library.source.id);
  const next = fixture();
  next.adapter.contracts = { ...next.adapter.contracts!, placements: next.adapter.contracts!.placements.map(placement => ({ ...placement, nodes: placement.nodes.map(node => node.id === "actions" ? { ...node, label: "Updated actions" } : node) })) };
  view.rerender(<Surface adapter={next.adapter} onState={onState} />);
  await waitFor(() => { expect(state.session).toBeDefined(); expect(state.session).not.toBe(session); });
  expect(within(explorer()).getByRole("button", { name: "Updated actions" })).toBeVisible();
  fireEvent.click(within(row("components.button")).getByRole("button", { name: labels.board.choose }));
  fireEvent.click(screen.getByRole("radio", { name: labels.useSource("test-kit", "components.button") }));
  await waitFor(() => expect(next.save).toHaveBeenCalledOnce());
  expect(f.save).toHaveBeenCalledOnce();
});

it("updates real runtime selection and preview content when the host reloads runtime ports", async () => {
  const engine = standardM1FixtureEngine();
  const runtime = standardM1Runtime({ engine, identity: { kind: "git", head: "1".repeat(40), tree: "2".repeat(40) }, source: { entry: "fixture.tsx", files: { "fixture.tsx": "// SYNTHETIC runtime source descriptor; no browser qualification" }, dependencies: {} }, css: [] });
  const ports = { ...runtime.ports, manifest: { ...runtime.ports.manifest, fills: runtime.ports.manifest.fills.filter(fill => fill.leaf === "sections.hero"), selectionHash: resolve(engine).selectionHash as `sha256:${string}` } };
  let snapshot: CompositeStudioSnapshot = { library: engine.library, runtime: { ...ports, manifest: { ...ports.manifest, fills: [] } }, preview: leaf => <span data-testid="runtime-preview">{leaf}</span> };
  let state!: WholeStudioState;
  const adapter: CompositeStudioAdapter = { kind: "composite", catalog: engine.catalog, contracts: contractsFor("sections.hero"), load: async () => snapshot, save: async () => ({ ok: false, reason: "unavailable" }) };
  render(<Surface adapter={adapter} initial="sections.hero" onState={value => { state = value; }} />);
  await screen.findByText(labels.autosave.saved);
  expect(screen.queryByTestId("runtime-preview")).toBeNull();
  snapshot = { ...snapshot, runtime: ports };
  await act(async () => { await state.session!.takeTheirs("sections.hero"); });
  expect(state.evaluated!.value!.runtime).toEqual({ status: "valid", findings: [] });
  expect(screen.getByTestId("runtime-preview")).toHaveTextContent("sections.hero");
});

it("retains the original optional-consumer refresh controls while the host snapshot is loading", async () => {
  const f = fixture(); let finish!: (value: CompositeStudioSnapshot) => void;
  const adapter = { ...f.adapter, load: () => new Promise<CompositeStudioSnapshot>(resolve => { finish = resolve; }) };
  render(<Surface adapter={adapter} onState={() => {}} />);
  fireEvent.click(within(row("components.button")).getByRole("button", { name: labels.board.choose }));
  fireEvent.click(within(row("components.button")).getByRole("button", { name: labels.board.refresh }));
  const dialog = await screen.findByRole("dialog");
  expect(promptData(dialog).consumer).toBe("");
  expect(promptData(dialog)).not.toHaveProperty("currentCandidate");
  fireEvent.click(within(dialog).getByRole("button", { name: labels.board.close }));
  await act(async () => finish(f.get()));
});
