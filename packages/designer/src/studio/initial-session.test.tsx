import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { syntheticSurface } from "../catalog-core/__fixtures__/surface-engine/synthetic.js";
import { componentIntegration } from "../catalog-core/__fixtures__/component-integration.js";
import { runtimeHash } from "../catalog-core/runtime-ports.js";
import { WholeStudioProvider, useWholeStudio, useDesignerLayerBoardProjection } from "./WholeStudioProvider.js";
import { createWholeStudioInitialSession, checkWholeStudioInitialSession } from "./designer-layer-boards.js";
import { labels, smallCatalog } from "./__fixtures__/studio.js";
import type { CompositeStudioSnapshot } from "./types.js";
const wholeLabels = { ...labels, whole: { signoff: "Signoff", proposed: "Proposed", contract: "Contract", contentSlots: "Slots", configurations: "Configurations", unresolved: "Unresolved", unassessed: "Unassessed" } };
afterEach(cleanup);
function fixture() {
  const input = componentIntegration();
  const catalog = { ...input.catalog, values: smallCatalog };
  const snapshot = { library: { ...input.library, values: { fills: [] } }, componentOptions: input.componentOptions };
  const initialSession = createWholeStudioInitialSession({ id: "SYNTHETIC-server-session", snapshot, catalog });
  return { catalog, snapshot, initialSession };
}
it("adopts the checked JSON snapshot at the first render and preserves its projection through a delayed local load", async () => {
  const f = fixture(); let finish!: (snapshot: CompositeStudioSnapshot) => void;
  const load = vi.fn(() => new Promise<CompositeStudioSnapshot>(resolve => { finish = resolve; }));
  const seen: ReturnType<typeof useDesignerLayerBoardProjection>[] = [];
  let current!: NonNullable<ReturnType<typeof useWholeStudio>>;
  function Probe() { current = useWholeStudio()!; const value = useDesignerLayerBoardProjection(); seen.push(value); return <output>{value.projection.phase}</output>; }
  render(<WholeStudioProvider adapter={{ kind: "composite", catalog: f.catalog, load }} labels={wholeLabels} initialSession={JSON.parse(JSON.stringify(f.initialSession))}><Probe /></WholeStudioProvider>);
  expect(screen.getByText("ready")).toBeDefined();
  const first = seen[0]!;
  expect(first.projection.session).toEqual({ id: f.initialSession.id, revision: 0, status: "saved", edits: [], history: null });
  await act(async () => finish({ ...f.snapshot, preview: () => undefined, fileExists: () => true }));
  expect(seen.every(value => value.projectionHash === first.projectionHash)).toBe(true);
  expect(current.sessionIdentity).toBe(f.initialSession.id);
  expect(load).toHaveBeenCalledOnce();
});
it("rejects missing seals, changed ids, changed snapshots, foreign catalogs and stale loaded facts", () => {
  const f = fixture(), copy = () => JSON.parse(JSON.stringify(f.initialSession));
  const unsealed = copy(); delete unsealed.digest;
  const digest = copy(); digest.digest = runtimeHash("SYNTHETIC-tampered");
  const id = copy(); id.id = "SYNTHETIC-tampered";
  const snapshot = copy(); snapshot.snapshot.library.source.id = "SYNTHETIC-other";
  for (const value of [unsealed, digest, id, snapshot]) expect(() => checkWholeStudioInitialSession(value, f.catalog)).toThrow();
  expect(() => checkWholeStudioInitialSession(f.initialSession, { ...f.catalog, values: { ...f.catalog.values, placements: [] } })).toThrow(/differs/);
  expect(() => checkWholeStudioInitialSession(f.initialSession, f.catalog, undefined, { ...f.snapshot, library: { ...f.snapshot.library, source: { ...f.snapshot.library.source, id: "SYNTHETIC-new" } } })).toThrow(/differs/);
  expect(() => render(<WholeStudioProvider adapter={{ kind: "composite", catalog: f.catalog, load: async () => f.snapshot }} labels={wholeLabels} initialSession={unsealed}><span /></WholeStudioProvider>)).toThrow();
});
it("a changed local snapshot becomes error without adopting a fresh identity", async () => {
  const f = fixture(); let phase = "", id = "";
  function Probe() { const value = useDesignerLayerBoardProjection().projection; phase = value.phase; id = value.session.id; return <output>{phase}</output>; }
  render(<WholeStudioProvider adapter={{ kind: "composite", catalog: f.catalog, load: async () => ({ ...f.snapshot, library: { ...f.snapshot.library, source: { ...f.snapshot.library.source, id: "SYNTHETIC-new" } } }) }} labels={wholeLabels} initialSession={f.initialSession}><Probe /></WholeStudioProvider>);
  expect(phase).toBe("ready");
  await screen.findByText("error"); expect(id).toBe(f.initialSession.id);
});
it("seals only finite facts and exposes creation/checking from the server-safe public query export", () => {
  const f = fixture();
  const sealed = createWholeStudioInitialSession({ id: f.initialSession.id, catalog: f.catalog, snapshot: { ...f.snapshot, preview: () => undefined, fileExists: () => true } });
  expect(runtimeHash(sealed)).toBe(runtimeHash(f.initialSession));
  expect("preview" in sealed.snapshot).toBe(false); expect("fileExists" in sealed.snapshot).toBe(false);
  expect(execFileSync(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", 'import { createWholeStudioInitialSession, checkWholeStudioInitialSession } from "@clossys/designer/studio/queries"; console.log(typeof createWholeStudioInitialSession, typeof checkWholeStudioInitialSession)'], { encoding: "utf8" }).trim()).toBe("function function");
});

it("without a handoff keeps the existing loading, one local load and independent generated session behavior", async () => {
  const f = fixture(); let finish!: (snapshot: CompositeStudioSnapshot) => void;
  const load = vi.fn(() => new Promise<CompositeStudioSnapshot>(resolve => { finish = resolve; }));
  let id = "";
  function Probe() { const p = useDesignerLayerBoardProjection().projection; id = p.session.id; return <output>{p.phase}</output>; }
  render(<WholeStudioProvider adapter={{ kind: "composite", catalog: f.catalog, load }} labels={wholeLabels}><Probe /></WholeStudioProvider>);
  expect(screen.getByText("loading")).toBeDefined();
  expect(id).not.toBe(f.initialSession.id);
  await act(async () => finish(f.snapshot));
  expect(screen.getByText("ready")).toBeDefined(); expect(load).toHaveBeenCalledOnce();
  expect(id).not.toBe(f.initialSession.id);
});
it("updates a mounted handoff atomically without pairing the new id with the previous snapshot", async () => {
  const f = fixture(), nextSnapshot = { ...f.snapshot, library: { ...f.snapshot.library, source: { ...f.snapshot.library.source, id: "SYNTHETIC-next" } } };
  const next = createWholeStudioInitialSession({ id: "SYNTHETIC-next-session", snapshot: nextSnapshot, catalog: f.catalog });
  const seen: { id: string; consumer: string | undefined }[] = [];
  function Probe() { const whole = useWholeStudio()!; seen.push({ id: whole.sessionIdentity, consumer: whole.snapshot?.library.source.id }); return null; }
  const adapter = { kind: "composite" as const, catalog: f.catalog, load: () => new Promise<CompositeStudioSnapshot>(() => {}) };
  const view = render(<WholeStudioProvider adapter={adapter} labels={wholeLabels} initialSession={f.initialSession}><Probe /></WholeStudioProvider>);
  view.rerender(<WholeStudioProvider adapter={adapter} labels={wholeLabels} initialSession={next}><Probe /></WholeStudioProvider>);
  expect(seen.filter(value => value.id === next.id).length).toBeGreaterThan(0);
  expect(seen.filter(value => value.id === next.id).every(value => value.consumer === nextSnapshot.library.source.id)).toBe(true);
});

it("binds callback-bearing catalogs by every finite descriptor and refuses a changed rule source", () => {
  const { input } = syntheticSurface();
  expect(() => runtimeHash(input.catalog)).toThrow(/finite/);
  const sealed = createWholeStudioInitialSession({ id: "SYNTHETIC-surface-session", snapshot: { library: input.library }, catalog: input.catalog });
  expect(checkWholeStudioInitialSession(JSON.parse(JSON.stringify(sealed)), input.catalog).id).toBe(sealed.id);
  const surfaces = input.catalog.surfaces!;
  const changed = { ...input.catalog, surfaces: { ...surfaces, transforms: surfaces.transforms.map((transform, index) => index ? transform : { ...transform, source: [...transform.source, { path: "SYNTHETIC-changed.ts", content: "SYNTHETIC changed descriptor" }] }) } };
  expect(() => checkWholeStudioInitialSession(sealed, changed)).toThrow(/differs/);
});
