// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseDate } from "@internationalized/date";
import { render } from "./__fixtures__/frame.js";
import { Studio } from "./index.js";
import { StudioProvider, useStudioSession } from "./StudioProvider.js";
import { canvasPreviewPort } from "./canvas-boards.js";
import { smallCatalog, labels, emptyLibrary, adopt } from "./__fixtures__/studio.js";
import { findLayerSelect, chooseLayer } from "./__fixtures__/rail.js";
import { Matrix as Comparison } from "../blocks/Matrix.js";
import { valueLibraryBoardRecords, valueLibraryBoardPreviews, type PreparedLibraryBoardInput } from "./library-board-adapter.js";
import { buildCandidates } from "./model.js";
import { DateField } from "../components/DateField.js";
import { resolve } from "../catalog-core/api.js";
import { runtimeHash } from "../catalog-core/runtime-ports.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
import { scanProvenance } from "../catalog-core/provenance-scan.js";
import { checkWiring } from "../catalog-core/wiring.js";
import dateFieldFill from "../catalog/fills/foundry/components.date-field.json" with { type: "json" };

afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

/**
 * The canvas content slot as a page would serve it. The app-shell frame and the page root are stamped here
 * because the Studio frame stamp is WIRE-5a-frame (after WIRE-4); explorer, map, zoom and inspector stay in
 * frame-owned slots (D5d), so only the content slot is scanned, inside the frame's `<main>`.
 */
const ROUTE = "agents-designer";
const attrs = (stamp: Record<string, string>) => Object.entries(stamp).map(([name, value]) => `${name}="${value}"`).join(" ");
const page = (content: string) => `<div ${attrs(dsAttrs("pages", `pages.${ROUTE}`, `foundry/pages.${ROUTE}`))}><div ${attrs(dsAttrs("frames", "frames.app-shell", "foundry/frames.app-shell"))}><nav class="frame-chrome"></nav><main>${content}</main></div></div>`;

function scanCanvas(declared: number) {
  const world = document.querySelector<HTMLElement>("[data-studio-world]");
  expect(world).not.toBeNull();
  const binding = { frame: { leaf: "frames.app-shell" }, frameSlots: { main: Array.from({ length: declared }, () => ({ leaf: "sections.comparison" })) }, sections: {} };
  return scanProvenance({ html: page(world!.innerHTML), route: { id: ROUTE, binding }, selection: {} }).findings;
}

it("renders every value-layer canvas board as the registered library-board Section: WL1 and WL6 are 0", async () => {
  const library = adopt(emptyLibrary(), "tokens.surface-color", "foundry");
  const declared = { boards: -1 };
  function Declared() { declared.boards = useStudioSession().boards.length; return null; }
  render(<StudioProvider catalog={smallCatalog} adapter={{ load: async () => ({ library }), save: async () => ({ ok: false, reason: "unavailable" }) }} labels={labels}>
    <Declared /><Studio header="internal" />
  </StudioProvider>);
  await findLayerSelect();
  for (const layer of ["Tokens", "Assets"]) {
    if (layer !== "Tokens") await chooseLayer(labels, layer);
    await waitFor(() => expect(document.querySelector("[data-studio-world] section[data-library-board]")).not.toBeNull());
    expect(declared.boards).toBeGreaterThan(0);
    // The camera zoom reaches board titles through the registered CanvasLod owner, not a Studio inline style.
    expect(document.querySelector("[data-studio-world]")!.closest<HTMLElement>("[data-canvas-lod]")?.style.getPropertyValue("--canvas-zoom")).toMatch(/^\d/);
    const findings = scanCanvas(declared.boards);
    expect(findings.filter(finding => finding.code === "WL1"), layer).toEqual([]);
    expect(findings.filter(finding => finding.code === "WL6"), layer).toEqual([]);
    // Every mounted board is exactly one outermost sections.comparison stamp.
    expect(document.querySelectorAll('[data-studio-world] [data-ds-leaf="sections.comparison"]').length).toBe(declared.boards);
  }
});

it("the designer route module renders only the runtime assembly: WL10 is 0", () => {
  const read = (path: string) => ({ path: `packages/publisher/src/web/${path}`, content: readFileSync(resolvePath(import.meta.dirname, "../../../publisher/src/web", path), "utf8") });
  const report = checkWiring({ sources: [], routes: { modules: [read("designer-route-controller.tsx"), read("designer-route-registration.ts")], assembly: [{ module: "@clossys/designer/studio", export: "Studio" }] } });
  expect(report.findings.filter(finding => finding.code === "WL10")).toEqual([]);
});

/** One canvas board in view mode whose cell preview is the DateField that `content.date` resolves to. */
function DateBoard() {
  const library = adopt(emptyLibrary(), "assets.icon-search", "lucide");
  const candidates = buildCandidates({ catalog: smallCatalog, library, working: library, slotId: "assets.icon-search", scope: "slot", target: "assets.icon-search" });
  const input: PreparedLibraryBoardInput = { layer: "assets", board: { id: "assets/icons", label: "Icons", leaves: ["assets.icon-search"], rows: [{ id: "assets.icon-search", label: "Search", scope: "slot", target: "assets.icon-search", leaves: ["assets.icon-search"], depth: 0, emphasized: false, basket: "leaf", candidates }] },
    sources: smallCatalog.sources, consumerSource: library.source.id, selectionHash: resolve({ catalog: smallCatalog, library }).selectionHash,
    sourceHashes: Object.fromEntries(candidates.map(candidate => [candidate.source, runtimeHash(candidate.fill)])), mode: "view", canSave: true, pending: false,
    prompt: row => ({ consumer: library.source.id, board: { id: "assets/icons", label: "Icons" }, slot: { id: row.id, label: row.label }, variants: [], tokens: [], siblings: [], returnStep: labels.board.returnStep }) };
  const port = valueLibraryBoardPreviews(input, labels);
  const previews = canvasPreviewPort({ status: "available", port: { ...port, render: identity => port.render(identity) == null ? undefined : <DateField label="Due" defaultValue={parseDate("2026-10-27")} /> } });
  return <Comparison arrangement="library-board" records={valueLibraryBoardRecords(input)} previews={previews} labels={labels} onCommand={vi.fn()} />;
}

it("a date segment inside a canvas board cell keeps ArrowUp/ArrowDown; the grid keeps them elsewhere", async () => {
  // The registered fill's date and time members are the DateField export this cell renders.
  const members = JSON.stringify(dateFieldFill);
  expect(members).toContain('"content.date":"./components#DateField"');
  expect(members).toContain('"content.time":"./components#DateField"');
  const user = userEvent.setup();
  render(<DateBoard />);
  const grid = screen.getByRole("grid");
  const field = within(grid).getByRole("group", { name: "Due" });
  const day = within(field).getAllByRole("spinbutton").find(segment => /day/i.test(segment.getAttribute("aria-label") ?? ""))!;
  expect(day).toHaveAttribute("aria-valuenow", "27");
  await user.click(day);
  expect(day).toHaveFocus();
  await user.keyboard("{ArrowUp}");
  expect(day).toHaveAttribute("aria-valuenow", "28");
  await user.keyboard("{ArrowDown}{ArrowDown}");
  expect(day).toHaveAttribute("aria-valuenow", "26");
  expect(day).toHaveFocus();
  // Focus leaving the field resumes the grid's own arrow-key navigation.
  const cell = day.closest<HTMLElement>("[role=gridcell], [role=rowheader]")!;
  act(() => cell.focus());
  await user.keyboard("{ArrowUp}");
  expect(day).toHaveAttribute("aria-valuenow", "26");
});

it("canvas shortcuts still work when the canvas itself has focus, and never from a focused date segment", async () => {
  render(<Studio catalog={smallCatalog} adapter={{ load: async () => ({ library: emptyLibrary() }), save: async () => ({ ok: false, reason: "unavailable" }) }} labels={labels} />);
  await findLayerSelect();
  // Let the boards mount and the camera finish its initial fit before measuring a pan.
  await waitFor(() => expect(document.querySelector("[data-studio-world] section[data-library-board]")).not.toBeNull());
  await act(async () => { await new Promise(settle => setTimeout(settle, 50)); });
  const viewport = screen.getByRole("region", { name: "L-canvas" }), world = document.querySelector<HTMLElement>("[data-studio-world]")!;
  act(() => viewport.focus());
  const before = world.style.transform;
  fireEvent.keyDown(viewport, { key: "ArrowDown" });
  const panned = world.style.transform;
  expect(panned).not.toBe(before);
  // A focused spin button (a date segment's role) inside the world owns its arrows: the camera does not pan.
  const segment = Object.assign(document.createElement("div"), { tabIndex: 0 }); segment.setAttribute("role", "spinbutton");
  world.querySelector("section[data-library-board]")?.append(segment) ?? world.append(segment);
  act(() => segment.focus());
  fireEvent.keyDown(segment, { key: "ArrowDown" });
  expect(world.style.transform).toBe(panned);
  segment.remove();
});
