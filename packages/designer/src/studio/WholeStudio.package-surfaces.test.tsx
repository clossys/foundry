/** Adopted package-pointer Sections and Frames on the Studio board: the real export with sample content, never "preview unavailable". */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "./__fixtures__/frame.js";
import { labels } from "./__fixtures__/studio.js";
import { packageSurfaceLibrary, type PackageSurfaceLibrary } from "../library-cli/__fixtures__/package-surface-library.js";
import { planSurfaceDefaults, type SurfaceDefaultCandidateDocument, type SurfaceDefaultsInput } from "../catalog-core/index.js";
import { planSurfacePreviews } from "./planned-surface-previews.js";
import { Studio as StudioView, StudioHeader, StudioRightPanel } from "./index.js";
import { WholeStudioProvider } from "./WholeStudioProvider.js";
import type { CompositeStudioLabels, CompositeStudioSnapshot } from "./types.js";

const wholeLabels: CompositeStudioLabels = { ...labels, whole: { signoff: "W-signoff", proposed: "W-proposed", contract: "W-contract", contentSlots: "W-slots", configurations: "W-config", unresolved: "W-unresolved", unassessed: "W-unassessed" } };
let fixture: PackageSurfaceLibrary;
beforeAll(async () => { fixture = await packageSurfaceLibrary(); }, 120_000);
// The sheet frame's Drawer reads its wide-layout query; jsdom has no matchMedia.
beforeEach(() => { vi.stubGlobal("matchMedia", vi.fn((media: string) => ({ media, matches: false, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => true }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });

/** The host knows the Publisher frame; the designer never imitates it. */
const HOST_SAMPLES = { "@clossys/publisher/web#SiteFrame": () => <p>host-site-frame</p> };
/** Distinct sample text per adopted leaf this unit added content for. */
const SAMPLE_TEXT: Record<string, string> = {
  "sections.comparison": "Version history", "sections.content": "One place for every project", "sections.data-table": "Fabrikam", "sections.form": "Work email",
  "sections.pricing": "Choose Team", "sections.resource-list": "Help centre", "sections.status-list": "Mobile alerts", "sections.task-list": "Publish the launch page",
  "frames.site-shell": "host-site-frame", "frames.sheet": "Open filters",
};

function mount(preview: CompositeStudioSnapshot["preview"], samples: Parameters<typeof planSurfacePreviews>[0]["samples"] = HOST_SAMPLES) {
  const fills = fixture.catalog.surfaces!.fills as unknown as SurfaceDefaultCandidateDocument[], slots = fixture.catalog.surfaces!.slots as unknown as SurfaceDefaultsInput["catalog"]["slots"];
  const plannedPreviews = planSurfacePreviews({ fills, samples, plan: planSurfaceDefaults({ catalog: { slots, fills }, slots: slots.map(slot => slot.id), preference: ["foundry"] }) });
  const load = vi.fn(async (): Promise<CompositeStudioSnapshot> => ({ library: structuredClone(fixture.library), surfaceOptions: fixture.options, preview, plannedPreviews }));
  render(<WholeStudioProvider adapter={{ kind: "composite", catalog: fixture.catalog, load, save: async () => ({ ok: false, reason: "unavailable" }) }} labels={wholeLabels} initialSlotId="sections.faq"><StudioHeader /><StudioView header="external" /><StudioRightPanel /></WholeStudioProvider>);
}
const row = (slot: string) => document.querySelector<HTMLElement>(`[data-studio-zoom-full] [data-studio-row="${slot}"]`);

describe("adopted package-pointer surfaces on the Studio board", { timeout: 120_000 }, () => {
  it("previews every adopted Section and Frame with its real export and sample content", async () => {
    const user = userEvent.setup();
    mount(() => undefined);
    await screen.findByText("L-saved");
    const check = (slots: readonly string[]) => {
      for (const slot of slots) {
        const cell = row(slot);
        expect(cell, slot).not.toBeNull();
        expect(cell, slot).not.toHaveTextContent(labels.previewUnavailable);
        // Adopted, not planned: the cell is the chosen preview, never the planned-default label.
        expect(cell!.querySelector("[data-studio-planned]"), slot).toBeNull();
        if (SAMPLE_TEXT[slot]) expect(cell, slot).toHaveTextContent(SAMPLE_TEXT[slot]!);
      }
    };
    check(fixture.decisions.map(row => row.slot).filter(slot => slot.startsWith("sections.")));
    await user.click(screen.getByRole("link", { name: /Frames/ }));
    await waitFor(() => expect(row("frames.sheet")).not.toBeNull());
    check(fixture.decisions.map(row => row.slot).filter(slot => slot.startsWith("frames.")));
  });

  it("keeps the host's own preview first, and without a host sample the Publisher frame is unavailable rather than imitated", async () => {
    const user = userEvent.setup();
    mount(leaf => leaf === "sections.data-table" ? <p>host-table</p> : undefined, {});
    await screen.findByText("L-saved");
    expect(row("sections.data-table")).toHaveTextContent("host-table");
    expect(row("sections.data-table")).not.toHaveTextContent("Fabrikam");
    await user.click(screen.getByRole("link", { name: /Frames/ }));
    await waitFor(() => expect(row("frames.sheet")).not.toBeNull());
    expect(row("frames.site-shell")).toHaveTextContent(labels.previewUnavailable);
    expect(row("frames.sheet")).toHaveTextContent("Open filters");
  });

  it("previews adopted package leaves in the board's choosing view as well", async () => {
    const user = userEvent.setup();
    mount(() => undefined);
    await screen.findByText("L-saved");
    const board = row("sections.data-table")!.closest<HTMLElement>("[data-studio-board]")!;
    await user.click(within(board).getByRole("button", { name: labels.board.changeSelection }));
    const editing = document.querySelector<HTMLElement>('[data-studio-board][data-board-mode="edit"] [data-studio-row="sections.data-table"]');
    expect(editing).not.toBeNull();
    expect(editing).toHaveTextContent("Fabrikam");
  });
});
