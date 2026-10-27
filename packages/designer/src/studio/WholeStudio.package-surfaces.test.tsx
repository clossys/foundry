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
import { boardItem, boardOf, boardRow } from "./__fixtures__/library-board-dom.js";
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
  "sections.chat": "How do I invite a teammate", "sections.explorer": "Campaigns", "sections.hero": "Ship pages your whole team can trust",
  "sections.newsletter": "One email a month", "frames.app-shell": "Review the spring launch", "frames.command": "Open command menu",
};

function mount(preview: CompositeStudioSnapshot["preview"], samples: Parameters<typeof planSurfacePreviews>[0]["samples"] = HOST_SAMPLES, sampleState?: Parameters<typeof planSurfacePreviews>[0]["sampleState"], dropPlanned: (pointer: string) => boolean = () => false) {
  const fills = fixture.catalog.surfaces!.fills as unknown as SurfaceDefaultCandidateDocument[], slots = fixture.catalog.surfaces!.slots as unknown as SurfaceDefaultsInput["catalog"]["slots"];
  const plannedPreviews = planSurfacePreviews({ fills, samples, sampleState, plan: planSurfaceDefaults({ catalog: { slots, fills }, slots: slots.map(slot => slot.id), preference: ["foundry"] }) });
  // A test may withhold planned rows so an adopted leaf can only draw its state through its own package preview.
  for (const [leaf, planned] of Object.entries(plannedPreviews.previews)) if (dropPlanned(planned.pointer)) delete plannedPreviews.previews[leaf];
  const load = vi.fn(async (): Promise<CompositeStudioSnapshot> => ({ library: structuredClone(fixture.library), surfaceOptions: fixture.options, preview, plannedPreviews }));
  render(<WholeStudioProvider adapter={{ kind: "composite", catalog: fixture.catalog, load, save: async () => ({ ok: false, reason: "unavailable" }) }} labels={wholeLabels} initialSlotId="sections.faq"><StudioHeader /><StudioView header="external" /><StudioRightPanel /></WholeStudioProvider>);
}
const row = (slot: string) => boardRow(slot) ?? null;
/** "L-saved" shows once the library loads; the boards mount after the composite profile evaluates. */
async function loaded() {
  await screen.findByText("L-saved");
  await waitFor(() => expect(document.querySelector("section[data-library-board]")).not.toBeNull());
}

describe("adopted package-pointer surfaces on the Studio board", { timeout: 120_000 }, () => {
  it("previews every adopted Section and Frame with its real export and sample content", async () => {
    const user = userEvent.setup();
    // Every leaf with sample text is an adopted leaf of the fixture, so none is skipped.
    expect(fixture.decisions.map(row => row.slot)).toEqual(expect.arrayContaining(Object.keys(SAMPLE_TEXT)));
    mount(() => undefined);
    await loaded();
    const check = (slots: readonly string[]) => {
      for (const slot of slots) {
        const cell = row(slot);
        expect(cell, slot).not.toBeNull();
        expect(cell, slot).not.toHaveTextContent(labels.previewUnavailable);
        // Adopted, not planned: the cell is the chosen preview, never the planned-default label.
        expect(cell!.querySelector("[data-studio-planned]"), slot).toBeNull();
        if (SAMPLE_TEXT[slot]) expect(cell, slot).toHaveTextContent(SAMPLE_TEXT[slot]!);
        // vf35: the capture hook says the same thing the cell shows.
        expect(cell!.querySelector("[data-candidate-cell]"), slot).toHaveAttribute("data-preview-state", "live");
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
    await loaded();
    expect(row("sections.data-table")).toHaveTextContent("host-table");
    expect(row("sections.data-table")).not.toHaveTextContent("Fabrikam");
    await user.click(screen.getByRole("link", { name: /Frames/ }));
    await waitFor(() => expect(row("frames.sheet")).not.toBeNull());
    expect(row("frames.site-shell")).toHaveTextContent(labels.previewUnavailable);
    expect(row("frames.site-shell")!.querySelector("[data-candidate-cell]")).toHaveAttribute("data-preview-state", "unavailable");
    expect(row("frames.sheet")).toHaveTextContent("Open filters");
  });

  it("previews adopted package leaves in the board's choosing view as well", async () => {
    const user = userEvent.setup();
    mount(() => undefined);
    await loaded();
    const board = boardOf("sections.data-table")!;
    await user.click(within(board).getByRole("button", { name: labels.board.changeSelection }));
    const editing = boardItem("sections.data-table", document.querySelector<HTMLElement>('section[data-library-board][data-board-mode="edit"]')!);
    expect(editing).toBeDefined();
    expect(editing).toHaveTextContent("Fabrikam");
  });

  it("vf35: renders adopted package leaves in the host's requested sample state and names it on the cell", async () => {
    mount(() => undefined, HOST_SAMPLES, "empty");
    await loaded();
    const list = row("sections.resource-list")!.querySelector<HTMLElement>("[data-candidate-cell]")!;
    expect(list).toHaveAttribute("data-sample-state", "empty");
    expect(list).toHaveTextContent("No projects yet");
    expect(list).not.toHaveTextContent("Help centre");
    // An export without that state keeps its default sample and says so.
    const table = row("sections.form")!.querySelector<HTMLElement>("[data-candidate-cell]")!;
    expect(table).toHaveAttribute("data-sample-state", "default");
    expect(table).toHaveTextContent("Work email");
  });

  it("vf35: an adopted leaf with no planned row still draws the requested state through its own package preview", async () => {
    mount(() => undefined, HOST_SAMPLES, "empty", pointer => pointer.endsWith("#DataTable"));
    await loaded();
    const orders = row("sections.data-table")!.querySelector<HTMLElement>("[data-candidate-cell]")!;
    expect(orders).toHaveAttribute("data-sample-state", "empty");
    expect(orders).toHaveTextContent("No orders yet");
    expect(orders).not.toHaveTextContent("Fabrikam");
  });
});
