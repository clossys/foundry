import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Studio, StudioHeader, StudioProvider } from "./index.js";
import { Matrix } from "./Matrix.js";
import { studioEngine } from "./engine.js";
import { DEMO_CATALOG, DEMO_LIBRARY, DEMO_SELECTION } from "./demo-data.js";
import type { StudioLabels } from "./types.js";

const labels: StudioLabels = {
  canvas: { label: "L-canvas", hint: "L-canvas-hint", search: "L-search", explorerOpen: "L-open-explorer", explorerClose: "L-close-explorer", inspectorClose: "L-close-inspector", minimap: "L-minimap", filters: { all: "All", pending: "Pending", warnings: "Has warnings", undecided: "Undecided", differs: "Differs from group" }, zoomLabel: "L-zoom", zoomIn: "L-zoom-in", zoomOut: "L-zoom-out", fit: "L-fit", zoom: percent => `${Math.round(percent)}%`, openBoard: name => `L-open-board ${name}`, goToBoard: name => `L-go-board ${name}` },
  layers: { label: "L-layers", tokens: "Tokens", assets: "Assets", components: "Components", sections: "Sections", frames: "Frames", disabled: "Built after Tokens sign-off" },
  progress: (decided, total) => `Decided ${Math.round(decided * 100 / total)}%`,
  scorecard: { title: "L-score", close: "L-close", decided: "L-decided", resolved: "L-resolved", checks: "L-checks", issues: "L-issues", noIssues: "L-no-issues", target: "Target: needs the check engine", counts: (errors, notices) => `L-score-count ${errors}/${notices}`, supported: codes => `L-supported ${codes.join("/")}`, categories: { contract: "Contract and format", accessibility: "Accessibility", coherence: "Coherence", modes: "Modes", provenance: "Provenance and license", coverage: "Coverage" } },
  matrix: { label: "L-matrix", leaf: "L-leaf", libraries: "L-libraries", showAll: "L-show-all", expand: leaf => `L-expand ${leaf}`, collapse: leaf => `L-collapse ${leaf}`, differs: "L-differs", pending: "L-cell-pending" },
  treeLabel: "L-tree", stageLabel: "L-stage", inspectorLabel: "L-inspector", useGroup: "L-use-group",
  useSource: (source, target) => `L-use ${source} @ ${target}`,
  scope: { label: "L-scope", member: "L-member", slot: "L-slot", node: "L-node", memberPicker: "L-member-picker", nodePicker: "L-node-picker", explanation: "L-specificity" },
  memberCount: (count) => `L-count ${count}`,
  checkSummary: (errors, notices) => `L-check ${errors}/${notices}`,
  previewUnavailable: "L-preview-unavailable", referenceOnly: "L-reference-only", inUseByDefault: "L-default", noFill: "L-no-fill",
  pending: (count) => `L-pending ${count}`, save: "L-save", discard: "L-discard", resetToDefault: "L-reset",
  saveFailed: { unavailable: "L-unavailable", conflict: "L-conflict", invalid: "L-invalid", failed: "L-failed" },
  loading: "L-loading", loadFailed: "L-load-failed", sampleText: "L-sample", fontNotLoaded: "L-font-note",
  inspector: { representedLeaf: "L-represented-leaf", trust: "L-trust", usedBy: "L-used-by", none: "L-none", source: "L-i-source", mode: "L-i-mode", licence: "L-i-licence", pin: "L-i-pin", status: "L-i-status", evidence: "L-i-evidence", members: "L-i-members", findings: "L-i-findings", via: "L-i-via", light: "L-i-light", dark: "L-i-dark", alias: "L-i-alias", builtOn: "L-i-built-on", relation: "L-i-relation" },
};

vi.mock("./Matrix.js", async original => { const actual = await original<typeof import("./Matrix.js")>(); return { ...actual, Matrix: vi.fn(actual.Matrix) }; });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
it("fills its host with an immersive canvas, no stacked list fallback", async () => {
  const adapter = { canSave: false, load: vi.fn(async () => ({ library: DEMO_LIBRARY, selection: DEMO_SELECTION })), save: vi.fn() };
  render(<Studio catalog={DEMO_CATALOG} adapter={adapter} labels={labels} />);
  await screen.findByText("L-pending 0");
  expect(document.querySelector("[data-studio-canvas]")).not.toBeNull();
  expect(document.querySelector("[data-studio-world]")).not.toBeNull();
  expect(document.querySelector("[data-studio-boards]")).toBeNull();
  expect(document.querySelectorAll("[data-studio-domain]")).toHaveLength(2);
});

it("pans its focused viewport by keyboard with a visible token focus indicator", async () => {
  const adapter = { canSave: false, load: vi.fn(async () => ({ library: DEMO_LIBRARY, selection: DEMO_SELECTION })), save: vi.fn() };
  render(<Studio catalog={DEMO_CATALOG} adapter={adapter} labels={labels} />);
  await screen.findByText("L-pending 0");
  const viewport = screen.getByRole("region", { name: "L-canvas" }); const world = document.querySelector<HTMLElement>("[data-studio-world]")!;
  await act(async () => { viewport.focus(); }); expect(viewport).toHaveFocus(); const before = world.style.transform;
  fireEvent.keyDown(viewport, { key: "ArrowRight" });
  expect(world.style.transform).not.toBe(before);
  expect(viewport).toHaveClass("focus-visible:outline-solid", "focus-visible:outline-2", "focus-visible:outline-accent");
});

it("moves one world transform without re-rendering any matrix on pan or zoom", async () => {
  const user = userEvent.setup(); const adapter = { canSave: false, load: vi.fn(async () => ({ library: DEMO_LIBRARY, selection: DEMO_SELECTION })), save: vi.fn() };
  render(<Studio catalog={DEMO_CATALOG} adapter={adapter} labels={labels} />); await screen.findByText("L-pending 0");
  const viewport = screen.getByRole("region", { name: "L-canvas" }); const world = document.querySelector<HTMLElement>("[data-studio-world]")!;
  const renders = vi.mocked(Matrix).mock.calls.length; const bounds = [...document.querySelectorAll<HTMLElement>("[data-studio-board]")].map(board => [board.style.inlineSize, board.style.blockSize]);
  fireEvent.wheel(viewport, { deltaY: 40 }); fireEvent.wheel(viewport, { deltaY: 300, ctrlKey: true, clientX: 100, clientY: 100 });
  expect(world.style.transform).toContain("translate("); expect(world.dataset.semantic).toBe("summary");
  expect(document.querySelector<HTMLElement>("[data-studio-zoom-full]")!.style.visibility).toBe("hidden");
  await user.click(screen.getByRole("button", { name: "L-zoom-in" }));
  expect(vi.mocked(Matrix).mock.calls.length).toBe(renders);
  expect([...document.querySelectorAll<HTMLElement>("[data-studio-board]")].map(board => [board.style.inlineSize, board.style.blockSize])).toEqual(bounds);
  expect(document.querySelectorAll("[data-studio-map-board]")).toHaveLength(7);
});

it("shares one session with a cohesive external header, including Save and Discard", async () => {
  const user = userEvent.setup(); let selection = DEMO_SELECTION;
  const adapter = { canSave: true, load: vi.fn(async () => ({ library: DEMO_LIBRARY, selection })), save: vi.fn(async (changes: Parameters<typeof studioEngine.applyChangeSet>[1]) => { selection = studioEngine.applyChangeSet(selection, changes); return { ok: true as const, selection }; }) };
  render(<StudioProvider catalog={DEMO_CATALOG} adapter={adapter} labels={labels}><div data-host-header=""><StudioHeader /></div><Studio header="external" panelInsets={{ blockStart: "3rem" }} /></StudioProvider>);
  await screen.findByText("L-pending 0"); expect(adapter.load).toHaveBeenCalledTimes(1);
  expect(document.querySelectorAll("[data-studio-header]")).toHaveLength(1); expect(document.querySelector("[data-host-header] [data-studio-header]")).not.toBeNull();
  expect((document.querySelector('[data-studio-panel="explorer"]') as HTMLElement).style.insetBlockStart).toBe("3rem");
  await user.click(screen.getByRole("radio", { name: "L-use foundry @ tokens.accent-color" })); expect(screen.getByText("L-pending 1")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "L-save" })); await screen.findByText("L-pending 0"); expect(adapter.save).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("radio", { name: "L-use example @ tokens.accent-color" })); await user.click(screen.getByRole("button", { name: "L-discard" }));
  expect(screen.getByRole("radio", { name: "L-use foundry @ tokens.accent-color" })).toBeChecked(); expect(adapter.load).toHaveBeenCalledTimes(1);
});
