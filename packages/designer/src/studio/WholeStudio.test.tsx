import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { render } from "./__fixtures__/frame.js";
import userEvent from "@testing-library/user-event";
import { applyLibraryChange, libraryHash, loadBuildCatalog, loadCatalog, loadComponentRegistry } from "../catalog-core/index.js";
import { componentIntegration, adoptedComponentIntegration } from "../catalog-core/__fixtures__/component-integration.js";
import { Studio as StudioView, StudioHeader, StudioRightPanel, useStudioNavigation } from "./index.js";
import { Banner } from "../components/Banner.js";
import type { PlacementNode } from "../catalog-core/index.js";
import { labels, smallCatalog } from "./__fixtures__/studio.js";
import { evaluateWhole, placedLeaves, wholeSignoff } from "./whole-model.js";
import type { CompositeStudioAdapter, CompositeStudioLabels, CompositeStudioSnapshot, CompositeStudioProps, StudioCanvasProps } from "./types.js";
import { useState } from 'react';
import { WholeStudioProvider, useWholeStudio, useDesignerLayerBoardProjection } from './WholeStudioProvider.js';
import { useStudioSession } from './StudioProvider.js';
import { deriveDesignerLayerBoardsV1, DESIGNER_LAYER_BOARDS_QUERY } from './designer-layer-boards.js';
import { runtimeHash } from '../catalog-core/runtime-ports.js';
import { valueLibraryBoardRecords, valueLibraryBoardPreviews } from './library-board-adapter.js';

const wholeLabels: CompositeStudioLabels = { ...labels, whole: { signoff: "W-signoff", proposed: "W-proposed", contract: "W-contract", contentSlots: "W-slots", configurations: "W-config", unresolved: "W-unresolved", unassessed: "W-unassessed" } };
it('state-only original provider keeps children mounted while loading and uses one shared value session', async () => {
  const f = adapterFixture(); let finish!: (snapshot: CompositeStudioSnapshot) => void;
  const load = vi.fn(() => new Promise<CompositeStudioSnapshot>(resolve => { finish = resolve; }));
  function Probe() {
    const whole = useWholeStudio()!, values = useStudioSession(), { projection } = useDesignerLayerBoardProjection();
    const [edit, setEdit] = useState(false);
    return <section data-testid="original-provider-probe"><button onClick={() => setEdit(true)}>{edit ? 'Local Edit retained' : 'Local Edit'}</button><output>{projection.phase}</output><span>{values.phase.status}</span><span>{whole.sessionState?.status}</span></section>;
  }
  render(<WholeStudioProvider adapter={{ ...f.adapter, load }} labels={wholeLabels}><Probe /></WholeStudioProvider>);
  const child = screen.getByTestId('original-provider-probe');
  expect(within(child).getByText('loading', { selector: 'output' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Local Edit' }));
  const snapshot = await f.load(); await act(async () => finish(snapshot));
  expect(screen.getByTestId('original-provider-probe')).toBe(child);
  expect(screen.getByRole('button', { name: 'Local Edit retained' })).toBeVisible();
  expect(within(child).getByText('ready', { selector: 'output' })).toBeVisible();
  expect(load).toHaveBeenCalledOnce(); expect(f.save).not.toHaveBeenCalled();
  expect(document.querySelector('[data-studio-canvas]')).toBeNull();
});
it('state-only load error retains the original child and exposes registered state facts without a raw loading page', async () => {
  const f = adapterFixture();
  function Probe() { const { projection } = useDesignerLayerBoardProjection(); return <output data-testid="provider-error-phase">{projection.phase}</output>; }
  render(<WholeStudioProvider adapter={{ ...f.adapter, load: async () => { throw new Error('Actual load failed'); } }} labels={wholeLabels}><Probe /></WholeStudioProvider>);
  const child = screen.getByTestId('provider-error-phase');
  await waitFor(() => expect(child).toHaveTextContent('error'));
  expect(screen.getByTestId('provider-error-phase')).toBe(child);
  expect(screen.queryByText(labels.loading)).toBeNull(); expect(screen.queryByText(labels.loadFailed)).toBeNull();
  expect(document.querySelector('[data-studio-canvas]')).toBeNull();
});
it('refuses state refs crossing two actual original provider sessions', async () => {
  const f = adapterFixture();
  const catalog = { ...f.adapter.catalog, values: { ...smallCatalog, slots: [], fills: [], placements: [] } };
  const states = new Map<string, { whole: NonNullable<ReturnType<typeof useWholeStudio>>; projected: ReturnType<typeof useDesignerLayerBoardProjection> }>();
  function Probe({ id }: { id: string }) { const whole = useWholeStudio()!, projected = useDesignerLayerBoardProjection(); states.set(id, { whole, projected }); return <output data-testid={id}>{projected.projection.phase}</output>; }
  render(<><WholeStudioProvider adapter={{ ...f.adapter, catalog }} labels={wholeLabels}><Probe id="first-session" /></WholeStudioProvider><WholeStudioProvider adapter={{ ...f.adapter, catalog }} labels={wholeLabels}><Probe id="second-session" /></WholeStudioProvider></>);
  await waitFor(() => { expect(screen.getByTestId('first-session')).toHaveTextContent('ready'); expect(screen.getByTestId('second-session')).toHaveTextContent('ready'); });
  const a = states.get('first-session')!, b = states.get('second-session')!;
  expect(a.whole.session).not.toBe(b.whole.session); expect(a.projected.projection.session.id).not.toBe(b.projected.projection.session.id);
  const reference = { kind: 'action' as const, ref: 'SYNTHETIC-empty-return' }, value = { command: 'SYNTHETIC-return' };
  const section = { sessionId: a.projected.projection.session.id, fill: { section: 'sections.empty-state' as const, content: { actions: reference } }, content: [{ reference, value, hash: runtimeHash(value) }], layout: { leaf: 'layouts.stack' as const, config: 'stack.workspace', members: { align: 'start', measure: 'full' }, slot: 'body' } };
  const input = { query: DESIGNER_LAYER_BOARDS_QUERY, ...a.projected, records: [], arrangement: { kind: 'grid' as const, columns: 2, gap: { x: 12, y: 8 } }, stateSections: { empty: section } };
  expect(deriveDesignerLayerBoardsV1(input).status).toBe('materialized');
  expect(() => deriveDesignerLayerBoardsV1({ ...input, stateSections: { empty: { ...section, sessionId: b.projected.projection.session.id } } })).toThrow(/different original session/);
});
it('failed original flush keeps the active layer, same EditSession and unsaved edit identity', async () => {
  const f = adapterFixture();
  const save = vi.fn(async () => ({ ok: false as const, reason: 'unavailable' as const }));
  let current!: { whole: NonNullable<ReturnType<typeof useWholeStudio>>; values: ReturnType<typeof useStudioSession> };
  function Probe() { current = { whole: useWholeStudio()!, values: useStudioSession() }; return <output>{current.whole.sessionState?.status ?? 'loading'}</output>; }
  render(<WholeStudioProvider adapter={{ ...f.adapter, save }} labels={wholeLabels}><Probe /></WholeStudioProvider>);
  await screen.findByText('saved');
  const session = current.whole.session;
  const row = current.values.rows.find(row => row.id === 'tokens.surface-color')!;
  act(() => current.values.use(row, 'foundry'));
  await screen.findByText('not-saved');
  const edits = current.whole.sessionState!.edits;
  let moved: boolean | undefined;
  await act(async () => { moved = await current.whole.setLayer('components'); });
  expect(moved).toBe(false); expect(current.whole.layer).toBe('tokens');
  expect(current.whole.session).toBe(session); expect(current.whole.sessionState!.edits).toEqual(edits);
  expect(current.values.layer).toBe('tokens'); expect(save).toHaveBeenCalledOnce();
});
it('query rerun preserves actual checked value preview identity and never promotes an unavailable source', async () => {
  const f = adapterFixture(); let current!: { whole: NonNullable<ReturnType<typeof useWholeStudio>>; values: ReturnType<typeof useStudioSession>; projected: ReturnType<typeof useDesignerLayerBoardProjection> };
  function Probe() { current = { whole: useWholeStudio()!, values: useStudioSession(), projected: useDesignerLayerBoardProjection() }; return <output>{current.projected.projection.phase}</output>; }
  render(<WholeStudioProvider adapter={f.adapter} labels={wholeLabels} initialSlotId="assets.icon-search"><Probe /></WholeStudioProvider>);
  await screen.findByText('ready');
  // Request the original engine's actual row; the query never evaluates alternatives itself.
  act(() => current.values.requestRow('assets.icon-search'));
  const { projection, projectionHash } = current.projected;
  const prepared = current.values.boards.map(board => {
    const sourceHashes = Object.fromEntries(board.rows.flatMap(row => row.candidates.map(candidate => [candidate.source, runtimeHash(candidate.fill)])));
    const input = { layer: 'assets' as const, board, sources: current.values.catalog.sources, consumerSource: projection.consumer!, selectionHash: projection.selectionHash!, sourceHashes, mode: 'edit' as const, canSave: true, pending: false,
      prompt: (row: typeof board.rows[number]) => ({ consumer: projection.consumer!, board: { id: board.id, label: board.label }, slot: { id: row.id, label: row.label }, variants: [], tokens: [], siblings: [], returnStep: labels.board.returnStep }) };
    return { input, records: valueLibraryBoardRecords(input), previews: valueLibraryBoardPreviews(input, labels) };
  });
  const input = { query: DESIGNER_LAYER_BOARDS_QUERY, projection, projectionHash, records: prepared.map(value => ({ sessionId: projection.session.id, consumer: projection.consumer!, libraryHash: projection.libraryHash!, selectionHash: projection.selectionHash!, records: value.records })), arrangement: { kind: 'lanes' as const, groupKey: 'domain', gap: { x: 12, y: 8 }, laneGap: 20 }, stateSections: {} };
  const result = deriveDesignerLayerBoardsV1(input); expect(result.status).toBe('materialized');
  if (result.status !== 'materialized') return;
  const records = prepared[0]!.records;
  const renderedRows = result.content.find(content => content.reference.ref === result.fills['sections.comparison']![0]!.content.rows!.ref)!.value;
  expect(renderedRows).toEqual(records.rows);
  const candidate = records.rows.items.flatMap(row => row.candidates).find(candidate => candidate.previewIdentity && candidate.usable)!;
  expect(candidate).toBeDefined();
  expect(prepared[0]!.previews.render(candidate.previewIdentity!)).toBeDefined();
  expect(prepared[0]!.previews.render({ ...candidate.previewIdentity!, selectionHash: runtimeHash('stale') })).toBeUndefined();
  expect(deriveDesignerLayerBoardsV1(input)).toEqual(result);
  expect(result.content.filter(content => content.reference.ref.endsWith('/rows')).map(content => content.value)).toEqual(prepared.map(value => value.records.rows));
  expect(f.save).not.toHaveBeenCalled();
});
async function editBoard(user: ReturnType<typeof userEvent.setup>, slot: string) {
  const row = document.querySelector<HTMLElement>(`[data-studio-row="${slot}"]`)!;
  await user.click(within(row.closest<HTMLElement>("[data-studio-board]")!).getByRole("button", { name: labels.board.changeSelection }));
}
async function expandTree(user: ReturnType<typeof userEvent.setup>, layer: "components" | "sections" | "frames", target?: string) {
  const explorer = document.querySelector<HTMLElement>('[data-studio-panel="explorer"]')!;
  const placement = loadBuildCatalog().placements.find(placement => placement.layer === layer)!;
  for (const domain of placement.nodes) {
    if (target && !placedLeaves([domain]).some(leaf => leaf.id === target)) continue;
    const branches = [domain, ...("children" in domain ? domain.children : [])];
    for (const branch of branches) {
      if (target && !placedLeaves([branch]).some(leaf => leaf.id === target)) continue;
      const row = [...explorer.querySelectorAll<HTMLElement>('[role="row"]')].find(row => row.dataset.key === branch.id)!;
      expect(row).toBeDefined();
      const chevron = within(row).getByRole("button", { name: branch.label, exact: true });
      if (row.getAttribute("aria-expanded") === "true") continue;
      expect(row).toHaveAttribute("aria-expanded", "false");
      await user.click(chevron);
      expect(row).toHaveAttribute("aria-expanded", "true");
    }
  }
  return explorer;
}
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });
function Studio(props: CompositeStudioProps | StudioCanvasProps) {
  if (!("adapter" in props)) return <StudioView {...props} />;
  return <WholeStudioProvider {...props}><StudioHeader /><StudioView header="external" /><StudioRightPanel /></WholeStudioProvider>;
}
function adapterFixture(full = false) {
  const input = componentIntegration();
  const catalog = full ? { values: loadCatalog(), components: { ...loadComponentRegistry(), fills: [] } } : { ...input.catalog, values: smallCatalog };
  let library = { ...input.library, values: { fills: [] } };
  const load = vi.fn(async () => ({ library, componentOptions: input.componentOptions }));
  const save = vi.fn(async (changes: Parameters<CompositeStudioAdapter["save"]>[0]) => { library = applyLibraryChange(catalog, library, changes); return { ok: true as const, library: structuredClone(library) }; });
  return { adapter: { kind: "composite" as const, catalog, load, save, }, load, save, getLibrary: () => library };
}
it.each(["components", "sections", "frames"] as const)("keeps legacy controls and reaches every canonical %s registry leaf", async layer => {
  const user = userEvent.setup(); const f = adapterFixture(true);
  render(<WholeStudioProvider adapter={f.adapter} labels={wholeLabels}><StudioHeader /><Studio header="external" /><StudioRightPanel /></WholeStudioProvider>);
  await screen.findByText("L-saved");
  expect(screen.getAllByRole("link")).toHaveLength(5);
  expect(document.querySelectorAll('[data-studio-panel="zoom"]')).toHaveLength(1);
  const contracts = loadBuildCatalog();
  const registryLeaves = contracts.placements.flatMap(placement => placedLeaves(placement.nodes));
  expect(contracts.slots.map(slot => slot.id).sort()).toEqual(registryLeaves.map(leaf => leaf.id).sort());
  await user.click(screen.getByRole("link", { name: new RegExp(layer, "i") }));
  const explorer = await expandTree(user, layer);
  const rowsByName = new Map(within(explorer).getAllByRole("row").map(row => [row.textContent?.trim(), row]));
  const ids = contracts.slots.filter(slot => slot.layer === layer).map(slot => slot.id);
  for (const id of ids) { expect(rowsByName.has(id)).toBe(true); expect(rowsByName.get(id)).not.toHaveAttribute("aria-disabled", "true"); }
  if (layer !== "frames") return;
  await user.click(within(document.querySelector('[data-studio-panel="explorer"]') as HTMLElement).getByRole("row", { name: "frames.inspector", exact: true }));
  expect(screen.getAllByText("W-unassessed").length).toBeGreaterThan(0);
  expect(document.querySelector('[data-studio-panel="inspector"]')?.textContent).toContain("W-proposed");
  const rows = wholeSignoff(contracts);
  expect(rows.map(row => row.id).sort()).toEqual(contracts.slots.filter(slot => slot.layer === "sections" || slot.layer === "frames").map(slot => slot.id).sort());
  expect(rows.every(row => row.placement.length === 3 && row.status === "proposed")).toBe(true);
  expect(rows.find(row => row.id === "sections.band")?.unresolved).toEqual(["rhythm"]);
  expect(rows.some(row => "signoff" in row)).toBe(false);
  expect(document.querySelectorAll('[data-studio-board]')).toHaveLength(contracts.placements.find(p => p.layer === "frames")!.nodes.flatMap(node => "children" in node ? node.children : [node]).length);
});
it("saves projected value edits with the whole composite CAS and reloads host truth", async () => {
  const user = userEvent.setup(); const f = adapterFixture(); const hash = libraryHash(f.getLibrary());
  render(<Studio adapter={f.adapter} labels={wholeLabels} initialSlotId="tokens.surface-color" />);
  await screen.findByText("L-saved");
  await editBoard(user, "tokens.surface-color");
  await user.click(screen.getByRole("radio", { name: labels.useSource("foundry", "tokens.surface-color") }));
  await waitFor(() => expect(f.load).toHaveBeenCalledTimes(2));
  expect(f.save.mock.calls[0]?.[0]).toEqual({ baseHash: hash, changes: [{ portion: "values", change: { op: "adopt", slot: "tokens.surface-color", source: "foundry" } }] });
  await screen.findByText("L-saved");
});
it("rechecks components when consumer token values change without rewriting observation hashes", () => {
  const input = adoptedComponentIntegration(); const observations = input.componentOptions!.evidence!.observations;
  const bytes = JSON.stringify(observations);
  const before = evaluateWhole(input, { library: input.library, componentOptions: input.componentOptions }, loadBuildCatalog());
  const library = applyLibraryChange(input.catalog, input.library, { baseHash: libraryHash(input.library), changes: [{ portion: "values", change: { op: "author", slot: "tokens.text-color", tokens: { primary: { $type: "color", $value: "#808080" } } } }] });
  const after = evaluateWhole({ ...input, library }, { library, componentOptions: input.componentOptions }, loadBuildCatalog());
  expect(before.profile.check.findings.some(f => f.code === "K6")).toBe(false);
  expect(after.profile.check.findings.some(f => f.code === "K6")).toBe(true);
  expect(JSON.stringify(observations)).toBe(bytes);
});
it("does not fabricate an active runtime preview when no runtime candidate is selected", async () => {
  const user = userEvent.setup(); const f = adapterFixture(); const preview = vi.fn(() => <p>host-preview</p>);
  const load = vi.fn(async () => ({ ...await f.load(), preview }));
  render(<Studio adapter={{ ...f.adapter, load }} labels={wholeLabels} initialSlotId="sections.band" />);
  await screen.findByText("L-saved");
  expect(preview).not.toHaveBeenCalled();
  expect(screen.getAllByText(labels.board.notChosen).length).toBeGreaterThan(0);
  expect(screen.getAllByText("W-unassessed").length).toBeGreaterThan(0);
  await user.click(screen.getByRole("link", { name: /Frames/ }));
  expect(screen.queryByText("host-preview")).toBeNull();
});
it.each([
  ["tokens.surface-color", "C9: actual rendered-edge contrast measurements are absent; not waived"],
  ["assets.lockup", "A5: consumer identity derivation evidence is absent; not waived"],
])("shows the consumer reason for the selected %s value leaf", async (leaf, reason) => {
  const user = userEvent.setup(); const f = adapterFixture(); const full = loadCatalog();
  const ids = new Set([...f.adapter.catalog.values.slots.map(slot => slot.id), "assets.lockup"]);
  const prune = (node: PlacementNode): PlacementNode[] => {
    if ("children" in node) { const children = node.children.flatMap(prune); return children.length ? [{ ...node, children }] : []; }
    const leaves = node.leaves.filter(id => ids.has(id)); return leaves.length ? [{ ...node, leaves }] : [];
  };
  const values = { ...full, slots: full.slots.filter(slot => ids.has(slot.id)), fills: full.fills.filter(doc => ids.has(doc.$extensions["com.clossys.fill"].slot)), placements: full.placements.map(placement => ({ ...placement, nodes: placement.nodes.flatMap(prune) })).filter(placement => placement.nodes.length) };
  const preview = vi.fn<NonNullable<CompositeStudioSnapshot["preview"]>>((selected) => selected === leaf ? <Banner variant="warning">{reason}</Banner> : undefined);
  const load = vi.fn(async () => ({ ...await f.load(), preview }));
  render(<Studio adapter={{ ...f.adapter, catalog: { ...f.adapter.catalog, values }, load }} labels={wholeLabels} initialSlotId={leaf} />);
  expect(await screen.findByText(reason)).toBeVisible();
  expect(document.querySelectorAll("[data-studio-host-preview]")).toHaveLength(1);
  expect(document.querySelector("[data-studio-host-preview]")).toHaveAttribute("data-studio-host-preview", leaf);
  expect(preview.mock.calls.length).toBeGreaterThan(0);
  expect(preview.mock.calls.every(([selected, profile]) => selected === leaf && profile.consumer === f.getLibrary().source.id && !!profile.values && !!profile.components)).toBe(true);
  if (leaf.startsWith("tokens.")) {
    const before = preview.mock.calls.at(-1)![1].selectionHash;
    await editBoard(user, leaf);
    await user.click(screen.getByRole("radio", { name: labels.useSource("foundry", leaf) }));
    await waitFor(() => expect(preview.mock.calls.at(-1)![1].selectionHash).not.toBe(before));
    expect(screen.getByText(reason)).toBeVisible();
  }
  await user.click(screen.getByRole("link", { name: /Components/ }));
  expect(screen.queryByText(reason)).not.toBeInTheDocument();
  expect(document.querySelector("[data-studio-host-preview]")).toBeNull();
});

it("reports a host value-preview error while retaining the value canvas", async () => {
  const f = adapterFixture();
  const load = async () => ({ ...await f.load(), preview: () => { throw new Error("Host preview unavailable: C9 remains unwaived"); } });
  render(<Studio adapter={{ ...f.adapter, load }} labels={wholeLabels} initialSlotId="tokens.surface-color" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Host preview unavailable: C9 remains unwaived");
  expect(screen.getByRole("treegrid", { name: labels.treeLabel })).toBeInTheDocument();
});

it("autosaves the first cold pointer click exactly once after checking the actual candidate", async () => {
  const user = userEvent.setup(); const input = componentIntegration(); let library = input.library;
  const slot = "tokens.surface-color", source = "shadcn@aria";
  const startLibrary = structuredClone(library), startHash = libraryHash(library);
  const expectedChange = { baseHash: startHash, changes: [{ portion: "values" as const, change: { op: "adopt" as const, slot, source } }] };
  const load = vi.fn(async () => ({ library, componentOptions: input.componentOptions }));
  const save = vi.fn(async (changes: Parameters<CompositeStudioAdapter["save"]>[0]) => {
    library = applyLibraryChange(input.catalog, library, changes);
    return { ok: true as const, library: structuredClone(library) };
  });
  render(<Studio adapter={{ kind: "composite", catalog: input.catalog, load, save }} labels={wholeLabels} initialSlotId={slot} />);
  await screen.findByText("L-saved");
  await editBoard(user, slot);
  const cold = screen.getByRole("radio", { name: labels.useSource(source, slot) });
  const cell = cold.closest('[data-studio-card]')!;
  expect(cell.querySelector('[data-studio-candidate]')).toBeNull();
  expect(cold).not.toBeChecked(); expect(save).not.toHaveBeenCalled(); expect(load).toHaveBeenCalledTimes(1);
  // No focus or hover preparation: pointer-down itself demands this previously unevaluated row.
  expect(cell.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(cell).toHaveTextContent(labels.loading);
  await user.pointer({ target: cold, keys: "[MouseLeft>]" });
  expect(cold).toBe(screen.getByRole("radio", { name: labels.useSource(source, slot) }));
  expect(cell.querySelector('[data-studio-candidate]')).not.toBeNull();
  expect(cell.querySelector("[aria-busy]")).toBeNull();
  expect(cold).toBeEnabled(); expect(save).not.toHaveBeenCalled();
  await user.pointer({ target: cold, keys: "[/MouseLeft]" });
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0]![0]).toEqual({ baseHash: startHash, changes: [{ portion: "values", change: { op: "adopt", slot, source } }] });
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  expect(libraryHash(library)).not.toBe(startHash);
  expect(library).toEqual(applyLibraryChange(input.catalog, startLibrary, expectedChange));
  expect(save).toHaveBeenCalledTimes(1);
});
it("does not save a cold choice whose actual source has no usable fill", async () => {
  const user = userEvent.setup(); const input = componentIntegration();
  const slot = "tokens.surface-color", source = "lucide";
  const load = vi.fn(async () => ({ library: input.library, componentOptions: input.componentOptions }));
  const save = vi.fn<CompositeStudioAdapter["save"]>();
  const hash = libraryHash(input.library);
  render(<Studio adapter={{ kind: "composite", catalog: input.catalog, load, save }} labels={wholeLabels} initialSlotId={slot} />);
  await screen.findByText("L-saved"); await editBoard(user, slot);
  const cold = screen.getByRole("radio", { name: labels.useSource(source, slot) });
  const cell = cold.closest('[data-studio-card]')!;
  expect(cell.querySelector('[data-studio-candidate]')).toBeNull();
  await user.pointer({ target: cold, keys: "[MouseLeft>]" });
  // This source is absent from the checked row, so its evaluating affordance disappears.
  expect(screen.queryByRole("radio", { name: labels.useSource(source, slot) })).toBeNull();
  await user.pointer({ keys: "[/MouseLeft]" });
  expect(save).not.toHaveBeenCalled(); expect(load).toHaveBeenCalledTimes(1);
  expect(libraryHash(input.library)).toBe(hash);
});
it("does not save a cold choice rejected by actual candidate findings", async () => {
  const user = userEvent.setup(); const input = componentIntegration();
  const slot = "tokens.surface-color", source = "shadcn@aria";
  const catalog = structuredClone(input.catalog);
  const fill = catalog.values.fills.find(fill => fill.$extensions["com.clossys.fill"].slot === slot && fill.$extensions["com.clossys.fill"].source === source)!;
  fill.tokens = { "surface-color": { base: { $type: "color", $value: "red; color: blue" } } };
  const load = vi.fn(async () => ({ library: input.library, componentOptions: input.componentOptions }));
  const save = vi.fn<CompositeStudioAdapter["save"]>();
  render(<Studio adapter={{ kind: "composite", catalog, load, save }} labels={wholeLabels} initialSlotId={slot} />);
  await screen.findByText("L-saved"); await editBoard(user, slot);
  const cold = screen.getByRole("radio", { name: labels.useSource(source, slot) });
  const cell = cold.closest('[data-studio-card]')!;
  expect(cell.querySelector('[data-studio-candidate]')).toBeNull();
  await user.pointer({ target: cold, keys: "[MouseLeft>]" });
  expect(cold).toBe(screen.getByRole("radio", { name: labels.useSource(source, slot) }));
  expect(cell.querySelector('[data-studio-candidate]')).not.toBeNull();
  expect(cold).toBeDisabled(); expect(cold).not.toBeChecked();
  expect(within(cell).getByRole("button", { name: /L-check [1-9]/ })).toBeInTheDocument();
  await user.pointer({ target: cold, keys: "[/MouseLeft]" });
  expect(save).not.toHaveBeenCalled(); expect(load).toHaveBeenCalledTimes(1);
});
it("autosaves a loaded value choice with its fresh composite base then blocks stale component evidence without a second write", async () => {
  const user = userEvent.setup(); const input = componentIntegration(); let library = input.library;
  const choice = { slot: "tokens.surface-color", source: "shadcn@aria" };
  const observations = JSON.stringify(input.componentOptions?.evidence?.observations);
  const load = vi.fn(async () => ({ library, componentOptions: input.componentOptions }));
  const save = vi.fn(async (cs: Parameters<CompositeStudioAdapter["save"]>[0]) => { library = applyLibraryChange(input.catalog, library, cs); return { ok: true as const, library: structuredClone(library) }; });
  const startHash = libraryHash(library);
  render(<Studio adapter={{ kind: "composite", catalog: input.catalog, load, save }} labels={wholeLabels} initialSlotId={choice.slot} />);
  await screen.findByText("L-saved");
  await editBoard(user, choice.slot);
  act(() => screen.getByRole("radio", { name: labels.useSource(choice.source, choice.slot) }).focus());
  const row = document.querySelector<HTMLElement>(`[data-studio-row="${choice.slot}"]`)!;
  const cell = [...row.querySelectorAll<HTMLElement>('[data-studio-card]')].find(cell => cell.dataset.studioCard === choice.source)!;
  expect(cell.querySelector('[data-studio-candidate]')).not.toBeNull();
  expect(cell.querySelector('[data-candidate-variant="tokens.surface-color.base"] [data-studio-color-swatch]')).not.toBeNull();
  const loadedChoice = within(cell).getByRole("radio", { name: labels.useSource(choice.source, choice.slot) });
  expect(loadedChoice).toBeEnabled(); expect(loadedChoice).not.toBeChecked();
  expect(save).not.toHaveBeenCalled(); expect(load).toHaveBeenCalledTimes(1);
  await user.click(loadedChoice);
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0]![0]).toEqual({ baseHash: startHash, changes: [{ portion: "values", change: { op: "adopt", slot: choice.slot, source: choice.source } }] });
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2)); const firstHash = libraryHash(library);
  await user.click(screen.getByRole("link", { name: /Components/ }));
  expect(firstHash).not.toBe(startHash);
  await user.click(within(await expandTree(user, "components", "components.button")).getByRole("row", { name: "components.button", exact: true }));
  await editBoard(user, "components.button");
  const blocked = screen.getByRole("radio", { name: labels.useSource("test-kit", "components.button") });
  expect(blocked).toBeDisabled();
  await user.click(blocked);
  const badge = document.querySelector('[data-studio-row="components.button"]')!.querySelector<HTMLButtonElement>('button[aria-label]')!;
  fireEvent.mouseMove(document.body); await user.hover(badge);
  const tooltip = await screen.findByRole("tooltip", {}, { timeout: 2500 });
  expect(tooltip).toHaveTextContent("K5"); expect(tooltip).toHaveTextContent("K6");
  expect(save.mock.calls.map(([cs]) => cs.baseHash)).toEqual([startHash]);
  expect(save.mock.calls.map(([cs]) => cs.changes.length)).toEqual([1]);
  expect(save.mock.calls[0]?.[0].changes[0]?.portion).toBe("values");
  expect(save.mock.calls[0]?.[0].changes[0]?.change).toEqual({ op: "adopt", slot: choice.slot, source: choice.source });
  expect(load).toHaveBeenCalledTimes(2);
  expect(libraryHash(library)).toBe(firstHash);
  expect(JSON.stringify(input.componentOptions?.evidence?.observations)).toBe(observations);
});
it("shows blocked materializations as inspectable candidates without an enabled adoption control", async () => {
  const user = userEvent.setup(); const input = componentIntegration();
  const catalog = structuredClone(input.catalog); const candidate = Object.values(catalog.components.fills[0]!.components)[0]!;
  candidate.blockers = [{ code: "source-unavailable", message: "missing source bytes" }];
  render(<Studio adapter={{ kind: "composite", catalog, load: async () => ({ library: input.library }), save: async () => ({ ok: false, reason: "unavailable" }) }} labels={wholeLabels} />);
  await screen.findByText("L-saved"); await user.click(screen.getByRole("link", { name: /Components/ }));
  await user.click(within(await expandTree(user, "components", "components.button")).getByRole("row", { name: "components.button", exact: true }));
  await editBoard(user, "components.button");
  expect(screen.getByRole("radio", { name: labels.useSource("test-kit", "components.button") })).toBeDisabled();
  const badge = document.querySelector('[data-studio-row="components.button"]')!.querySelector<HTMLButtonElement>('button[aria-label]')!;
  fireEvent.mouseMove(document.body); await user.hover(badge);
  expect(await screen.findByRole("tooltip", {}, { timeout: 2500 })).toHaveTextContent(/blocked materialization/);
});
it("replaces the editing session when the host adapter snapshot changes", async () => {
  const f = adapterFixture(); const view = render(<Studio adapter={f.adapter} labels={wholeLabels} />);
  await screen.findByText("L-saved");
  const replacement = { ...f.adapter, load: vi.fn(async () => ({ library: { ...f.getLibrary(), source: { ...f.getLibrary().source, id: "replacement" } } })) };
  view.rerender(<Studio adapter={replacement} labels={wholeLabels} />);
  await waitFor(() => expect(replacement.load).toHaveBeenCalledTimes(1));
  await screen.findByText("L-saved");
  expect(f.load).toHaveBeenCalledTimes(1);
});
it("keeps the local value and canvas when an acknowledged composite save cannot reload", async () => {
  const user = userEvent.setup(); const f = adapterFixture();
  const load = vi.fn().mockResolvedValueOnce(await f.load()).mockRejectedValueOnce(new Error("offline"));
  render(<Studio adapter={{ ...f.adapter, load }} labels={wholeLabels} initialSlotId="tokens.surface-color" />);
  await screen.findByText("L-saved");
  await editBoard(user, "tokens.surface-color");
  await user.click(screen.getByRole("radio", { name: labels.useSource("foundry", "tokens.surface-color") }));
  expect(await screen.findByText("L-not-saved")).toBeVisible();
  expect(document.querySelector('[data-studio-canvas]')).not.toBeNull();
  expect(screen.getAllByRole("button", { name: labels.autosave.retry }).length).toBeGreaterThan(0);
});

it("SYNTHETIC opted-in source snapshot forwards explicit surface options and authenticated bundles", async () => {
  const { adoptedSurface } = await import("../catalog-core/__fixtures__/surface-engine/synthetic.js");
  const f = adoptedSurface(); const preview = vi.fn<NonNullable<CompositeStudioSnapshot["preview"]>>((_leaf,profile) => <p>SYNTHETIC owned surfaces {Object.keys(profile.surfaces?.fills ?? {}).join(",")}</p>);
  const save=vi.fn<CompositeStudioAdapter["save"]>(async()=>({ok:true,library:f.input.library}));
  const load=vi.fn(async()=>({library:f.input.library,componentOptions:f.input.componentOptions,surfaceOptions:f.input.surfaceOptions,surfaceBundles:[f.bundle],preview}));
  const contracts = loadBuildCatalog();
  const synthetic = f.input.catalog.surfaces!.slots.find(slot => slot.id === "sections.synthetic")!;
  const placed = { ...contracts, slots: [...contracts.slots, synthetic], placements: [...contracts.placements.filter(placement => placement.layer !== "sections"), { layer: "sections" as const, nodes: [{ id: "synthetic", label: "Synthetic", children: [{ id: "synthetic-group", label: "Synthetic group", leaves: [synthetic.id] }] }] }] };
  render(<Studio adapter={{kind:"composite",catalog:f.input.catalog,contracts: placed,load,save,}} labels={wholeLabels} initialSlotId="sections.synthetic"/>);
  expect(await screen.findByText("SYNTHETIC owned surfaces sections.synthetic")).toBeVisible();
  expect(preview.mock.calls.at(-1)?.[1].surfaces?.fills["sections.synthetic"]).toBeDefined();
  // Missing runtime/type observations remain visible findings; this is not source qualification.
  expect(preview.mock.calls.at(-1)?.[1].check.findings.some(f=>f.code==="S8")).toBe(true);
});
it("SYNTHETIC opted-in source snapshot without explicit options retains the engine refusal", async () => {
  const { adoptedSurface } = await import("../catalog-core/__fixtures__/surface-engine/synthetic.js");
  const f=adoptedSurface(), preview=vi.fn(()=> <p>must not render missing-evidence preview</p>);
  render(<Studio adapter={{kind:"composite",catalog:f.input.catalog,load:async()=>({library:f.input.library,componentOptions:f.input.componentOptions,preview}),save:async()=>({ok:false,reason:"unavailable"})}} labels={wholeLabels} initialSlotId="components.button"/>);
  expect(await screen.findByText(/S8 explicit resolution options required/)).toBeVisible();
  expect(preview).not.toHaveBeenCalled();
});

it("supplies all five actual composite layers through the frame data seam", async () => {
  function Probe() { const nav = useStudioNavigation(); return <output data-testid="whole-nav">{JSON.stringify(nav)}</output>; }
  const f = adapterFixture();
  render(<WholeStudioProvider adapter={f.adapter} labels={wholeLabels}><StudioHeader /><Probe /></WholeStudioProvider>);
  await screen.findByRole("link", { name: "Tokens" });
  const read = () => JSON.parse(screen.getByTestId("whole-nav").textContent!);
  expect(read().items.map((item: { id: string }) => item.id)).toEqual(["tokens", "assets", "components", "sections", "frames"]);
  for (const item of read().items) expect(screen.getByRole("link", { name: item.label })).toHaveAttribute("href", item.href);
  await userEvent.setup().click(screen.getByRole("link", { name: "Frames" }));
  await waitFor(() => expect(read().activeId).toBe("frames"));
});

it('dispatches adapter-kind changes at the Studio host without changing hook or context identity', async () => {
  const composite = adapterFixture(), legacyLoad = vi.fn(async () => ({ library: { source: { id: "example", kind: "consumer" as const, author: "example", license: "MIT" }, fills: [] } }));
  const legacy = { catalog: smallCatalog, load: legacyLoad, save: vi.fn(async () => ({ ok: false as const, reason: "unavailable" as const })) };
  const view = render(<StudioView adapter={legacy} catalog={smallCatalog} labels={labels} livePreview={false} />);
  await waitFor(() => expect(document.querySelector("[data-studio-row]")).not.toBeNull()); expect(legacyLoad).toHaveBeenCalledOnce();
  view.rerender(<StudioView adapter={composite.adapter} labels={wholeLabels} livePreview={false} />);
  await waitFor(() => expect(document.querySelector("[data-studio-row]")).not.toBeNull()); expect(composite.load).toHaveBeenCalledOnce();
  expect(screen.getAllByRole("link")).toHaveLength(5);
  view.rerender(<StudioView adapter={legacy} catalog={smallCatalog} labels={labels} livePreview={false} />);
  await waitFor(() => expect(document.querySelector("[data-studio-row]")).not.toBeNull()); expect(legacyLoad).toHaveBeenCalledTimes(2);
  expect(composite.save).not.toHaveBeenCalled(); expect(legacy.save).not.toHaveBeenCalled();
});

it("contract boards show the host chosen line in tabular figures and name leaf rows with a mono id", async () => {
  const f = adapterFixture();
  const named: CompositeStudioLabels = { ...wholeLabels, chosenSummary: (chosen, total) => `${chosen} of ${total} chosen`, leafName: id => id === "sections.band" ? "Band" : undefined };
  render(<Studio adapter={f.adapter} labels={named} initialSlotId="sections.band" />);
  await screen.findByText("L-saved");
  const row = document.querySelector<HTMLElement>('[data-studio-row="sections.band"]')!;
  const label = row.querySelector<HTMLElement>("[data-studio-leaf-label]")!;
  expect(label).toHaveTextContent("Band");
  expect(label.querySelector("[data-studio-leaf-id]")).toHaveTextContent("sections.band");
  expect(label.querySelector("[data-studio-leaf-id]")).toHaveClass("font-mono", "tabular-nums");
  const board = row.closest<HTMLElement>("[data-studio-board]")!;
  const lines = [...board.querySelectorAll<HTMLElement>("[data-studio-chosen-summary]")];
  expect(lines.length).toBeGreaterThan(0);
  const total = board.querySelectorAll('[data-studio-zoom-full] [data-studio-row]').length;
  for (const line of lines) { expect(line).toHaveTextContent(new RegExp(`^\\d+ of ${total} chosen$`)); expect(line).toHaveClass("tabular-nums"); }
});
