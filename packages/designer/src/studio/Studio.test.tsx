import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TOKENS } from "../tokens/tokens.js";
import type { ChangeSet, Selection } from "../catalog-core/index.js";
import { DEMO_CATALOG, DEMO_LIBRARY, DEMO_SELECTION } from "./demo-data.js";
import { CandidateStage } from "./CandidateStage.js";
import { studioEngine } from "./engine.js";
import { buildCandidates } from "./model.js";
import { Studio, demoStudioAdapter, catalogStudioAdapter } from "./index.js";
import type { StudioAdapter, StudioLabels } from "./types.js";

const labels: StudioLabels = {
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

const adapter = (over: Partial<StudioAdapter> = {}): StudioAdapter & { load: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn> } => ({
  canSave: true,
  load: vi.fn(async () => ({ library: DEMO_LIBRARY, selection: DEMO_SELECTION })),
  save: vi.fn(async (changes: ChangeSet) => ({ ok: true as const, selection: { ...DEMO_SELECTION, picks: changes.changes.flatMap((change) => (change.op === "set" ? [change.pick] : [])) } satisfies Selection })),
  ...over,
}) as never;

const mount = async (props: Partial<Parameters<typeof Studio>[0]> = {}, host: StudioAdapter = adapter()) => {
  const view = render(<Studio catalog={DEMO_CATALOG} adapter={host} labels={labels} {...props} />);
  await screen.findByText("L-pending 0");
  return view;
};
const radio = (source: string, target = "tokens.accent-color") => screen.getByRole("radio", { name: `L-use ${source} @ ${target}` });
const stub = (desktop: boolean, tablet: boolean) => vi.stubGlobal("matchMedia", vi.fn((media: string) => ({
  matches: media === `(width >= ${TOKENS["--breakpoint-desktop"]!.value})` ? desktop : tablet, media, addEventListener: vi.fn(), removeEventListener: vi.fn(),
})));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const scrollSpy = () => {
  const calls: string[] = [];
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(function (this: HTMLElement) { calls.push(this.getAttribute("data-studio-board") ?? this.getAttribute("data-studio-row") ?? ""); });
  return calls;
};
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, writable: true, value() {} });

describe("Studio", () => {
  it("retains the saved group baseline after a later Discard", async () => {
    const user = userEvent.setup();
    let selection = DEMO_SELECTION;
    const host = adapter({ save: vi.fn(async (changes: ChangeSet) => { selection = studioEngine.applyChangeSet(selection, changes); return { ok: true as const, selection }; }) });
    await mount({}, host);
    await user.click(radio("foundry", "tokens/role-color"));
    await user.click(screen.getByRole("button", { name: "L-save" }));
    await screen.findByText("L-pending 0");
    await user.click(radio("example"));
    await user.click(screen.getByRole("button", { name: "L-discard" }));
    await user.click(radio("example"));
    expect(screen.getByText("L-differs")).toBeInTheDocument();
  });

  it("scrolls to an issue outside the current explorer position and focuses its real leaf row without later focus theft", async () => {
    const user = userEvent.setup();
    const calls = scrollSpy();
    const host = adapter({ load: vi.fn(async () => ({ library: DEMO_LIBRARY, selection: { ...DEMO_SELECTION, picks: [{ scope: "slot" as const, target: "tokens.accent-color", source: "reference-kit" }] } })) });
    await mount({}, host);
    await user.click(screen.getByRole("row", { name: "Scale" }));
    expect(document.querySelector('[data-studio-row="tokens.accent-color"]')).not.toBeNull();
    await user.click(screen.getByRole("tab", { name: /Tokens Decided/ }));
    await user.click(within(screen.getByRole("region", { name: "L-score" })).getByRole("button", { name: /reference cell/ }));
    const row = document.querySelector('[data-studio-row="tokens.accent-color"]') as HTMLElement;
    expect(row).toHaveFocus();
    expect(calls.at(-1)).toBe("tokens.accent-color");
    await user.click(radio("foundry"));
    expect(radio("foundry")).toHaveFocus();
    expect(row).not.toHaveFocus();
  });

  it("keeps group context transient, restores it on Discard and preserves the session baseline after Save", async () => {
    const user = userEvent.setup();
    let selection = DEMO_SELECTION;
    const host = adapter({ save: vi.fn(async (changes: ChangeSet) => { selection = studioEngine.applyChangeSet(selection, changes); return { ok: true as const, selection }; }) });
    await mount({}, host);
    await user.click(radio("foundry", "tokens/role-color"));
    await user.click(radio("example"));
    expect(within(document.querySelector('[data-studio-row="tokens.accent-color"]') as HTMLElement).getByText("L-differs")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "L-discard" }));
    expect(screen.queryByText("L-differs")).toBeNull();
    await user.click(radio("example"));
    expect(screen.queryByText("L-differs")).toBeNull();
    await user.click(screen.getByRole("button", { name: "L-discard" }));
    await user.click(radio("foundry", "tokens/role-color"));
    await user.click(screen.getByRole("button", { name: "L-save" }));
    await screen.findByText("L-pending 0");
    await user.click(radio("example"));
    expect(screen.getByText("L-differs")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "L-discard" }));
    expect(screen.queryByText("L-differs")).toBeNull();
    expect(radio("foundry")).toBeChecked();
    await user.click(radio("example"));
    await user.click(screen.getByRole("button", { name: "L-save" }));
    await screen.findByText("L-pending 0");
    expect(screen.getByText("L-differs")).toBeInTheDocument();
    expect(selection.picks.every(pick => pick.scope === "slot" || pick.scope === "member")).toBe(true);
    expect(JSON.stringify(selection)).not.toContain("role-color");
    await user.click(screen.getByRole("button", { name: "L-reset" }));
    expect(screen.queryByText("L-differs")).toBeNull();
  });

  it("shows the active Tokens progress tab and four disabled layers, with a scorecard that closes back to the tab", async () => {
    const user = userEvent.setup();
    await mount();
    const tab = screen.getByRole("tab", { name: /Tokens Decided 0%/ });
    expect(tab).toHaveAttribute("aria-selected", "true");
    for (const name of ["Assets", "Components", "Sections", "Frames"]) expect(screen.getByRole("tab", { name: new RegExp(name) })).toHaveAttribute("aria-disabled", "true");
    await user.click(tab);
    const panel = screen.getByRole("region", { name: "L-score" });
    expect(within(panel).getByText("0/10")).toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: "L-close" }));
    expect(screen.queryByRole("region", { name: "L-score" })).toBeNull();
    expect(tab).toHaveFocus();
    await user.click(radio("foundry", "tokens/role-color"));
    const progress = screen.getByRole("tab", { name: /Tokens Decided 20%/ });
    expect(progress.querySelector("circle[pathLength]")).toHaveAttribute("stroke-dashoffset", "80");
  });

  it("scrolls boards on pointer and keyboard explorer selection without filtering any board", async () => {
    const user = userEvent.setup();
    const calls = scrollSpy();
    await mount();
    const boards = [...document.querySelectorAll<HTMLElement>("[data-studio-board]")];
    expect(boards).toHaveLength(7);
    expect(boards.every(board => board.id && board.querySelector("h3 circle[pathLength]"))).toBe(true);
    expect(new Set(boards.map(board => board.id)).size).toBe(7);
    const ids = boards.map(board => board.id);
    await user.click(screen.getByRole("row", { name: "Scale" }));
    expect(calls.at(-1)).toBe("tokens/scale-color");
    const scale = screen.getByRole("row", { name: "Scale" });
    await act(async () => { scale.focus(); });
    await user.keyboard("{ArrowRight}");
    await user.click(document.querySelector('[data-key="tokens/scale-color"]') as HTMLElement);
    await act(async () => { (document.querySelector('[data-key="tokens/scale-color"]') as HTMLElement).focus(); });
    await user.keyboard("{ArrowLeft}");
    expect(calls.at(-1)).toBe("tokens/scale-color");
    expect([...document.querySelectorAll<HTMLElement>("[data-studio-board]")].map(board => board.id)).toEqual(ids);
    expect(document.querySelectorAll('[data-studio-row][data-scope="slot"]')).toHaveLength(10);
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "L-show-all" })).toBeNull();
    await user.click(radio("foundry", "tokens/role-color"));
    expect(within(document.querySelector('[data-studio-board="tokens/role-color"]') as HTMLElement).getByRole("heading", { name: /Color Decided 100%/ }).querySelector("circle[pathLength]")).toHaveAttribute("stroke-dashoffset", "0");
    expect(within(document.querySelector('[data-studio-board="tokens/scale-color"]') as HTMLElement).getByRole("heading", { name: /Color Decided 0%/ })).toBeInTheDocument();
    const role = document.querySelector('[data-key="tokens/role"]') as HTMLElement;
    if (role.getAttribute("aria-expanded") !== "true") await user.click(role);
    const color = document.querySelector('[data-key="tokens/role-color"]') as HTMLElement;
    if (color.getAttribute("aria-expanded") !== "true") await user.click(color);
    await user.click(screen.getByRole("row", { name: "tokens.accent-color (L-count 2)" }));
    expect(calls.at(-1)).toBe("tokens.accent-color");
    expect(document.querySelectorAll("[data-studio-board]")).toHaveLength(7);
  });

  it("selects the adapter catalog unless an explicit prop overrides it", async () => {
    const view = await mount({ catalog: undefined }, catalogStudioAdapter);
    expect(within(screen.getByRole("treegrid", { name: "L-tree" })).getByRole("row", { name: "Color" })).toBeInTheDocument();
    expect(within(screen.getByRole("treegrid", { name: "L-tree" })).getByRole("row", { name: "tokens.accent-color (L-count 5)" })).toBeInTheDocument();
    expect(document.querySelectorAll("[data-studio-row][data-scope=slot]")).toHaveLength(52);
    expect(document.querySelectorAll("[data-studio-board]")).toHaveLength(19);
    expect(within(screen.getByRole("treegrid", { name: "L-tree" })).queryByRole("row", { name: "Role" })).toBeNull();
    view.unmount();
    await mount({}, catalogStudioAdapter);
    expect(within(screen.getByRole("treegrid", { name: "L-tree" })).getByRole("row", { name: "Role" })).toBeInTheDocument();
  });

  it("renders the requested plain copy entirely through the host labels", async () => {
    const plain: StudioLabels = { ...labels, useSource: () => "Use this version", scope: { ...labels.scope, label: "Apply to", member: "One token", slot: "Whole leaf", node: "Everything under a group", explanation: "A more specific choice wins: one token beats a whole leaf, which beats a group." } };
    await mount({ labels: plain });
    expect(screen.getByRole("heading", { name: "Apply to" })).toBeInTheDocument();
    for (const name of ["One token", "Whole leaf", "Everything under a group"]) expect(screen.getByText(name)).toBeInTheDocument();
    expect(within(document.querySelector('[data-studio-row="tokens.accent-color"]') as HTMLElement).getAllByRole("radio", { name: "Use this version" })).toHaveLength(4);
    expect(screen.getByText(plain.scope.explanation)).toBeVisible();
  });

  it.each([1, 2, 4, 5, 6])("caps the explicit horizontal columns at four for %i sources", (count) => {
    const first = buildCandidates({ catalog: DEMO_CATALOG, library: DEMO_LIBRARY, working: DEMO_SELECTION, slotId: "tokens.accent-color", scope: "slot", target: "tokens.accent-color" })[0]!;
    const candidates = Array.from({ length: count }, (_, index) => ({ ...first, source: `source-${index}`, index }));
    render(<CandidateStage labels={labels} layout="wide" scope="slot" onScope={() => undefined} target="tokens.accent-color" targets={[]} onTarget={() => undefined} candidates={candidates} focusedSource="source-0" onFocusSource={() => undefined} onUse={() => undefined} />);
    const row = document.querySelector("[data-studio-cards]") as HTMLElement;
    expect(row.style.gridTemplateColumns).toBe(`repeat(${Math.min(count, 4)}, minmax(0, 1fr))`);
    expect(row).toHaveClass("grid-flow-col", "overflow-x-auto");
    expect(row.children).toHaveLength(count);
  });

  it("shows the scope explanation from labels and leaves source identities visible", async () => {
    await mount();
    expect(screen.getByText("L-specificity")).toBeInTheDocument();
    expect(within(document.querySelector('[data-studio-row="tokens.accent-color"]') as HTMLElement).getByText("foundry", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("L-use foundry @ tokens.accent-color")).toBeVisible();
  });

  it.each([[true, true, "wide"], [false, true, "medium"]] as const)("keeps %s/%s candidates in one horizontally overflowing row", async (desktop, tablet, layout) => {
    stub(desktop, tablet);
    await mount();
    expect(document.querySelector("[data-studio]")).toHaveAttribute("data-layout", layout);
    const matrix = document.querySelector("[data-studio-matrix]") as HTMLElement;
    expect(matrix).not.toBeNull();
    expect(matrix).toHaveClass("overflow-x-auto");
    expect(matrix.querySelector("table")).toHaveClass("table-fixed");
    expect(matrix.querySelector("table")?.style.inlineSize).toBe("100%");
    expect(document.querySelector('[data-studio-row="tokens.accent-color"]')?.querySelectorAll("[data-studio-card]")).toHaveLength(4);
    expect(screen.queryByRole("tablist", { name: "L-libraries" })).toBeNull();
  });

  it("loads once on mount and shows only the loading note until the adapter answers", async () => {
    let finish: (value: Awaited<ReturnType<StudioAdapter["load"]>>) => void = () => undefined;
    const host = adapter({ load: vi.fn(() => new Promise((resolve) => { finish = resolve as never; })) as never });
    render(<Studio catalog={DEMO_CATALOG} adapter={host} labels={labels} />);
    expect(screen.getByText("L-loading")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).toBeNull();
    await act(async () => { finish({ library: DEMO_LIBRARY, selection: DEMO_SELECTION }); });
    expect(await screen.findByText("L-pending 0")).toBeInTheDocument();
    expect(host.load).toHaveBeenCalledTimes(1);
  });

  it("reports a failed load with the host's label and draws no cards", async () => {
    render(<Studio catalog={DEMO_CATALOG} adapter={adapter({ load: vi.fn(async () => { throw new Error("boom"); }) as never })} labels={labels} />);
    expect(await screen.findByText("L-load-failed")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(document.querySelector("style[data-studio-preview]")).toBeNull();
  });

  it("lists one Use radio per source, consumer first, and disables a reference-only fill", async () => {
    await mount();
    const use = within(screen.getByRole("radiogroup", { name: "L-use-group tokens.accent-color" }));
    expect(use.getAllByRole("radio").map((node) => node.getAttribute("aria-label"))).toEqual([
      "L-use example @ tokens.accent-color", "L-use foundry @ tokens.accent-color", "L-use reference-kit @ tokens.accent-color", "L-use tailwind-default @ tokens.accent-color",
    ]);
    expect(radio("reference-kit")).toBeDisabled();
    expect(radio("foundry")).toBeEnabled();
    expect(screen.getAllByText("L-reference-only").length).toBeGreaterThan(0);
    expect(screen.getAllByText("L-default").length).toBeGreaterThan(0);
  });

  it("counts a pick as one pending change in a polite region and enables Save and Discard", async () => {
    const user = userEvent.setup();
    await mount();
    const count = screen.getByText("L-pending 0");
    expect(count.closest("[aria-live=polite]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "L-save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "L-discard" })).toBeDisabled();
    await user.click(radio("foundry"));
    expect(screen.getByText("L-pending 1")).toBeInTheDocument();
    expect(radio("foundry")).toBeChecked();
    expect(screen.getByRole("button", { name: "L-save" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "L-discard" }));
    expect(screen.getByText("L-pending 0")).toBeInTheDocument();
    expect(radio("foundry")).not.toBeChecked();
  });

  it("follows focus in the inspector without selecting anything", async () => {
    const user = userEvent.setup();
    await mount();
    const inspector = screen.getByRole("complementary", { name: "L-inspector" });
    expect(inspector.querySelector("[data-studio-inspector]")?.getAttribute("data-studio-inspector")).toBe("example");
    await act(async () => { document.querySelector<HTMLElement>('[data-studio-row="tokens.accent-color"] [data-studio-card=reference-kit]')?.focus(); });
    await user.tab();
    await user.click(document.querySelector('[data-studio-row="tokens.accent-color"] [data-studio-card=reference-kit]') as HTMLElement);
    expect(within(inspector).getByText("reference-kit", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("L-pending 0")).toBeInTheDocument();
    expect(within(screen.getByRole("radiogroup", { name: "L-use-group tokens.accent-color" })).getAllByRole("radio").filter((node) => (node as HTMLInputElement).checked)).toHaveLength(0);
  });

  it("hides Save when the adapter cannot save, and keeps the preview live", async () => {
    await mount({}, adapter({ canSave: false }));
    expect(screen.queryByRole("button", { name: "L-save" })).toBeNull();
    expect(document.querySelector("style[data-studio-preview]")).not.toBeNull();
  });

  it("saves the pending changes, adopts the returned selection and clears the count", async () => {
    const user = userEvent.setup();
    const host = adapter();
    await mount({}, host);
    await user.click(radio("foundry"));
    await user.click(screen.getByRole("button", { name: "L-save" }));
    await waitFor(() => expect(screen.getByText("L-pending 0")).toBeInTheDocument());
    expect(host.save).toHaveBeenCalledTimes(1);
    expect((host.save.mock.calls[0] as [ChangeSet])[0].changes).toEqual([{ op: "set", pick: { scope: "slot", target: "tokens.accent-color", source: "foundry" } }]);
    expect(radio("foundry")).toBeChecked();
  });

  it.each(["unavailable", "conflict", "invalid", "failed"] as const)("keeps the changes and shows the %s label when the save is refused", async (reason) => {
    const user = userEvent.setup();
    const findings = reason === "invalid" ? [{ code: "C1", severity: "error", subject: "x", message: "FINDING-TEXT" }] : undefined;
    await mount({}, adapter({ save: vi.fn(async () => ({ ok: false as const, reason, ...(findings ? { findings } : {}) })) as never }));
    await user.click(radio("foundry"));
    await user.click(screen.getByRole("button", { name: "L-save" }));
    expect(await screen.findByText(`L-${reason}`)).toBeInTheDocument();
    if (findings) expect(screen.getByText("FINDING-TEXT")).toBeInTheDocument();
    expect(screen.getByText("L-pending 1")).toBeInTheDocument();
  });

  it("treats a thrown save as failed", async () => {
    const user = userEvent.setup();
    await mount({}, adapter({ save: vi.fn(async () => { throw new Error("net"); }) as never }));
    await user.click(radio("foundry"));
    await user.click(screen.getByRole("button", { name: "L-save" }));
    expect(await screen.findByText("L-failed")).toBeInTheDocument();
  });

  it("writes the working selection into the live style and each card's values into the candidate style", async () => {
    const user = userEvent.setup();
    await mount();
    const live = () => document.querySelector("style[data-studio-preview]")?.textContent ?? "";
    expect(live()).toContain(":root:root[data-brand-bound]");
    const before = live();
    await user.click(radio("foundry"));
    expect(live()).not.toBe(before);
    expect(document.querySelector("style[data-studio-candidates]")?.textContent).toContain('[data-studio-candidate="0"]');
  });

  it("leaves the document alone when livePreview is off", async () => {
    await mount({ livePreview: false });
    expect(document.querySelector("style[data-studio-preview]")).toBeNull();
    expect(document.querySelector("style[data-studio-candidates]")).not.toBeNull();
  });

  it("refuses a card whose fill smuggles CSS and keeps its text out of every style element", async () => {
    await mount({ initialSlotId: "tokens.region-width" });
    expect(screen.getByRole("radio", { name: "L-use tailwind-default @ tokens.region-width" })).toBeDisabled();
    for (const node of document.querySelectorAll("style")) expect(node.textContent).not.toContain("display: none");
  });

  it("switches slot from the tree and draws that slot's cards", async () => {
    const user = userEvent.setup();
    await mount();
    await user.click(screen.getByRole("row", { name: "tokens.surface-color (L-count 2)" }));
    expect(screen.getByRole("radio", { name: "L-use foundry @ tokens.surface-color" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "L-use reference-kit @ tokens.surface-color" })).toBeDisabled();
  });

  it("lays out three panes wide, and moves the cards into Tabs below tablet-lg", async () => {
    stub(true, true);
    const wide = await mount();
    expect(document.querySelector("[data-studio]")?.getAttribute("data-layout")).toBe("wide");
    expect(screen.queryByRole("tablist", { name: "L-libraries" })).toBeNull();
    wide.unmount();
    stub(false, false);
    await mount();
    expect(document.querySelector("[data-studio]")?.getAttribute("data-layout")).toBe("narrow");
    expect(within(within(document.querySelector('[data-studio-board="tokens/role-color"]') as HTMLElement).getByRole("tablist", { name: "L-libraries" })).getAllByRole("tab").map((node) => node.textContent)).toEqual(["example", "foundry", "reference-kit", "tailwind-default"]);
    expect(screen.getByRole("button", { name: "L-tree" })).toHaveAttribute("aria-expanded", "false");
  });

  it("takes its chrome copy only from labels", async () => {
    await mount();
    expect(screen.getByRole("region", { name: "L-stage" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "L-use-group tokens.accent-color" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "L-scope" })).toBeInTheDocument();
    expect(within(document.querySelector('[data-studio-row="tokens.accent-color"]') as HTMLElement).getAllByText(/^L-check /)).toHaveLength(3);
  });

  it("shows the throwaway demo library read-only through demoStudioAdapter", async () => {
    render(<Studio adapter={demoStudioAdapter} labels={labels} />);
    await screen.findByText("L-pending 0");
    expect(screen.queryByRole("button", { name: "L-save" })).toBeNull();
    expect(radio("foundry")).toBeEnabled();
    expect(await demoStudioAdapter.save({ baseHash: "x", changes: [] })).toEqual({ ok: false, reason: "unavailable" });
  });

  it("builds the slot tree from the placement file and opens it on the current slot", async () => {
    await mount();
    expect(screen.getByRole("row", { name: "tokens.accent-color (L-count 2)" })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: "tokens.surface-color (L-count 2)" })).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: "tokens.line-height" })).toBeNull();
    expect(screen.getAllByRole("row").map((row) => row.getAttribute("aria-label") ?? row.textContent)).toEqual(expect.arrayContaining(["Scale", "Role", "tokens.accent-color (L-count 2)"]));
  });

  it("expands a node pick into one slot pick per leaf the source fills, and never stores a node", async () => {
    const user = userEvent.setup();
    const host = adapter();
    await mount({}, host);
    await user.click(radio("foundry", "tokens/role-color"));
    expect(screen.getByText("L-pending 2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "L-save" }));
    await waitFor(() => expect(host.save).toHaveBeenCalledTimes(1));
    expect((host.save.mock.calls[0] as [ChangeSet])[0].changes).toEqual([
      { op: "set", pick: { scope: "slot", target: "tokens.surface-color", source: "foundry" } },
      { op: "set", pick: { scope: "slot", target: "tokens.accent-color", source: "foundry" } },
    ]);
  });

  it("skips a leaf the source does not fill, and clears a node pick back to the default", async () => {
    const user = userEvent.setup();
    await mount({ initialSlotId: "tokens.line-height" });
    const reset = screen.getByRole("button", { name: "L-reset" });
    expect(reset).toBeDisabled();
    await user.click(radio("foundry", "tokens/scale-type"));
    expect(screen.getByText("L-pending 1")).toBeInTheDocument();
    expect(reset).toBeEnabled();
    await user.click(reset);
    expect(screen.getByText("L-pending 0")).toBeInTheDocument();
  });
});
