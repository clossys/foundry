/**
 * Per-layer render cost of the filled Studio (designer criteria 4 and 11): the package-surface library mounted with
 * header, canvas and right panel, then each of the five layers switched to in turn. Each switch is stamped from the
 * click until the layer's board rows are drawn, with the document's element count and the whole-library resolves
 * it ran. Budgets carry headroom for a loaded machine; the resolve count is exact.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "./__fixtures__/frame.js";
import { labels } from "./__fixtures__/studio.js";
import { packageSurfaceLibrary, type PackageSurfaceLibrary } from "../library-cli/__fixtures__/package-surface-library.js";
import { Studio as StudioView, StudioHeader, StudioRightPanel } from "./index.js";
import { WholeStudioProvider } from "./WholeStudioProvider.js";
import { boardRowLeaf } from "./canvas-boards.js";
import { STUDIO_LAYERS } from "./layer-navigation.js";
import { resolve, type LayerId } from "../catalog-core/index.js";
import type { CompositeStudioLabels, CompositeStudioSnapshot } from "./types.js";

vi.mock("../catalog-core/index.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../catalog-core/index.js")>();
  // The Studio evaluates the whole library through this export; counting it counts whole-library resolves.
  return { ...actual, resolve: vi.fn(actual.resolve) };
});

/** Milliseconds per layer switch and rendered elements after it (PERF-2 receipt: b3a66e74c spent 1.8-2.0 s on
 * components and sections re-resolving the whole library once per board; now about 0.2 and 0.45 s). */
const BUDGET: Readonly<Record<LayerId, { ms: number; nodes: number }>> = {
  tokens: { ms: 800, nodes: 12_160 }, assets: { ms: 450, nodes: 1_559 }, components: { ms: 600, nodes: 1_461 },
  sections: { ms: 900, nodes: 3_651 }, frames: { ms: 400, nodes: 921 },
};
/** Whole-library resolves one full traversal may run: the provider's evaluation is shared by every board, and a
 * layer switch changes no library input (b3a66e74c ran 57). */
const RESOLVES_PER_TRAVERSAL = 0;

const wholeLabels: CompositeStudioLabels = { ...labels, whole: { signoff: "W-signoff", proposed: "W-proposed", contract: "W-contract", contentSlots: "W-slots", configurations: "W-config", unresolved: "W-unresolved", unassessed: "W-unassessed" } };
let fixture: PackageSurfaceLibrary;
beforeAll(async () => { fixture = await packageSurfaceLibrary(); }, 120_000);
// The sheet frame's Drawer reads its wide-layout query; jsdom has no matchMedia.
beforeEach(() => { vi.stubGlobal("matchMedia", vi.fn((media: string) => ({ media, matches: false, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => true }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });

function mount() {
  const load = vi.fn(async (): Promise<CompositeStudioSnapshot> => ({ library: structuredClone(fixture.library), surfaceOptions: fixture.options, preview: () => undefined }));
  render(<WholeStudioProvider adapter={{ kind: "composite", catalog: fixture.catalog, load, save: async () => ({ ok: false, reason: "unavailable" }) }} labels={wholeLabels} initialSlotId="sections.faq"><StudioHeader /><StudioView header="external" /><StudioRightPanel /></WholeStudioProvider>);
}
/** The rows the canvas draws for a layer, by their leaf id. */
const rowsOf = (layer: LayerId) => [...document.querySelectorAll<HTMLElement>("section[data-library-board] tr")].filter(row => boardRowLeaf(row)?.startsWith(`${layer}.`));

interface Stamp { layer: LayerId; ms: number; rows: number; nodes: number }
async function traverse(): Promise<{ stamps: Stamp[]; resolves: number }> {
  const stamps: Stamp[] = [], before = vi.mocked(resolve).mock.calls.length;
  for (const layer of STUDIO_LAYERS) {
    const link = screen.getByRole("link", { name: new RegExp(`^${labels.layers[layer]}`) });
    const start = performance.now();
    await act(async () => { fireEvent.click(link); });
    await waitFor(() => { expect(rowsOf(layer).length).toBeGreaterThan(0); expect(link).toHaveAttribute("aria-current", "page"); }, { timeout: 60_000, interval: 5 });
    stamps.push({ layer, ms: Math.round(performance.now() - start), rows: rowsOf(layer).length, nodes: document.body.querySelectorAll("*").length });
  }
  return { stamps, resolves: vi.mocked(resolve).mock.calls.length - before };
}

describe("filled Studio per-layer render cost", { timeout: 180_000 }, () => {
  it("switches to each of the five layers within its time, element and resolve budget", async () => {
    mount();
    await screen.findByText("L-saved", undefined, { timeout: 60_000 });
    await waitFor(() => expect(document.querySelector("section[data-library-board]")).not.toBeNull(), { timeout: 60_000 });
    // The first pass mounts each layer's modules cold; the second is the steady state a designer switches in.
    const cold = await traverse(), warm = await traverse();
    process.stderr.write(`layer-render ${JSON.stringify({ cold, warm })}\n`);
    for (const { stamps, resolves } of [cold, warm]) {
      expect(resolves).toBeLessThanOrEqual(RESOLVES_PER_TRAVERSAL);
      for (const stamp of stamps) {
        expect(stamp.rows, stamp.layer).toBeGreaterThan(0);
        expect(stamp.nodes, stamp.layer).toBeLessThanOrEqual(BUDGET[stamp.layer].nodes);
        expect(stamp.ms, stamp.layer).toBeLessThanOrEqual(BUDGET[stamp.layer].ms);
      }
    }
  });
});
