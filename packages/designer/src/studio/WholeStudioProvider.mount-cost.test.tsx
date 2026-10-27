/**
 * Mount cost of the filled Studio (PERF-STUDIO). With no pending change the working library is the committed one:
 * mounting applies no change set, and the whole library's value and component portions resolve once for one
 * library, however often the provider re-renders and whichever layer is shown. The working library still equals
 * what the empty change set yields, with the same hash. The pass criteria are call counts, never wall time.
 *
 * `PERF_STUDIO_PROFILE=1` also runs a measured profile (React root time, mount-to-ready, five layer switches and
 * the time spent applying and resolving) and prints it as one `perf-studio` line. It reads public exports only, so
 * the same test measures an older provider.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, waitFor } from "@testing-library/react";
import { Profiler, type ProfilerOnRenderCallback } from "react";

const { cost, timed } = vi.hoisted(() => {
  const cost = { apply: 0, applyMs: 0, resolve: 0, resolveMs: 0, components: 0, componentsMs: 0 };
  /** Counts and times every call of `run` under `count`. */
  const timed = <A extends unknown[], R>(run: (...args: A) => R, count: "apply" | "resolve" | "components") => (...args: A): R => {
    const start = performance.now();
    try { return run(...args); } finally { cost[count]++; cost[`${count}Ms`] += performance.now() - start; }
  };
  return { cost, timed };
});
vi.mock("../catalog-core/index.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../catalog-core/index.js")>();
  return { ...actual, applyLibraryChange: timed(actual.applyLibraryChange, "apply") as typeof actual.applyLibraryChange, resolve: timed(actual.resolve, "resolve") as typeof actual.resolve };
});
vi.mock("../catalog-core/resolve-components.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../catalog-core/resolve-components.js")>();
  // One portion resolution resolves the component portion once, so this counts portion computations.
  return { ...actual, resolveComponents: timed(actual.resolveComponents, "components") };
});

import { render, studioReady } from "./__fixtures__/frame.js";
import { labels } from "./__fixtures__/studio.js";
import { packageSurfaceLibrary, type PackageSurfaceLibrary } from "../library-cli/__fixtures__/package-surface-library.js";
import { Studio as StudioView, StudioRightPanel } from "./index.js";
import { WholeStudioProvider, useWholeStudio } from "./WholeStudioProvider.js";
import { useStudioSession } from "./StudioProvider.js";
import { boardRowLeaf } from "./canvas-boards.js";
import { STUDIO_LAYERS } from "./layer-navigation.js";
import { applyLibraryChange, libraryHash, type LayerId } from "../catalog-core/index.js";
import type { CompositeStudioLabels, CompositeStudioSnapshot } from "./types.js";

const wholeLabels: CompositeStudioLabels = { ...labels, whole: { signoff: "W-signoff", proposed: "W-proposed", contract: "W-contract", contentSlots: "W-slots", configurations: "W-config", unresolved: "W-unresolved", unassessed: "W-unassessed" } };
let fixture: PackageSurfaceLibrary;
beforeAll(async () => { fixture = await packageSurfaceLibrary(); }, 120_000);
// The sheet frame's Drawer reads its wide-layout query; jsdom has no matchMedia.
beforeEach(() => { vi.stubGlobal("matchMedia", vi.fn((media: string) => ({ media, matches: false, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => true }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });

let session!: ReturnType<typeof useStudioSession>;
let whole!: NonNullable<ReturnType<typeof useWholeStudio>>;
function Probe() { session = useStudioSession(); whole = useWholeStudio()!; return null; }
/** The committed library the host hands over, kept so the old path can be replayed on exactly that library. */
let committed: CompositeStudioSnapshot["library"];
let reactMs = 0;
const onRender: ProfilerOnRenderCallback = (_id, _phase, actualDuration) => { reactMs += actualDuration; };
function mount() {
  const load = vi.fn(async (): Promise<CompositeStudioSnapshot> => ({ library: committed = structuredClone(fixture.library), surfaceOptions: fixture.options, preview: () => undefined }));
  render(<Profiler id="studio" onRender={onRender}><WholeStudioProvider adapter={{ kind: "composite", catalog: fixture.catalog, load, save: async () => ({ ok: false, reason: "unavailable" }) }} labels={wholeLabels} initialSlotId="sections.faq"><Probe /><StudioView /><StudioRightPanel /></WholeStudioProvider></Profiler>);
}
const rowsOf = (layer: LayerId) => [...document.querySelectorAll<HTMLElement>("section[data-library-board] tr")].filter(row => boardRowLeaf(row)?.startsWith(`${layer}.`));
async function ready() {
  await studioReady(60_000);
  await waitFor(() => expect(document.querySelector("section[data-library-board]")).not.toBeNull(), { timeout: 60_000 });
}
async function show(layer: LayerId) {
  await act(async () => { session.onNavigate({ layer }); });
  await waitFor(() => { expect(rowsOf(layer).length).toBeGreaterThan(0); expect(session.layer).toBe(layer); }, { timeout: 60_000, interval: 5 });
}
const reset = () => { for (const key of Object.keys(cost) as (keyof typeof cost)[]) cost[key] = 0; reactMs = 0; };

describe("filled Studio mount cost", { timeout: 180_000 }, () => {
  it("applies no change set and resolves the library's portions once across re-renders and layer switches", async () => {
    reset();
    mount();
    await ready();
    expect(cost.apply).toBe(0);
    expect(cost.components).toBe(1);

    // Provider re-renders that keep the working library, then every layer in turn: nothing re-resolves.
    act(() => whole.setScore(true));
    act(() => whole.setScore(false));
    for (const layer of STUDIO_LAYERS) await show(layer);
    expect(cost.apply).toBe(0);
    expect(cost.components).toBe(1);

    // The working library is what the old path's empty change set yields: deep-equal, with the same hash.
    const old = applyLibraryChange(fixture.catalog, committed, { baseHash: libraryHash(committed), changes: [] }, { surfaceOptions: fixture.options });
    expect(whole.input!.library).toEqual(old);
    expect(libraryHash(whole.input!.library)).toBe(libraryHash(old));
    expect(committed).toEqual(fixture.library);
  });

  it.runIf(process.env.PERF_STUDIO_PROFILE)("profiles mount, first render and five layer switches", async () => {
    reset();
    const start = performance.now();
    mount();
    await ready();
    const mounted = { wallMs: performance.now() - start, reactRootMs: reactMs, ...cost };
    reset();
    const switchStart = performance.now();
    for (const layer of STUDIO_LAYERS) await show(layer);
    const switched = { wallMs: performance.now() - switchStart, reactRootMs: reactMs, ...cost };
    const round = (row: Record<string, number>) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Math.round(value)]));
    process.stderr.write(`perf-studio ${JSON.stringify({ mount: round(mounted), switches: round(switched) })}\n`);
    expect(mounted.reactRootMs).toBeGreaterThan(0);
  });
});
