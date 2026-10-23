import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ChangeSet, Selection } from "../catalog-core/index.js";
import { DEMO_CATALOG, DEMO_LIBRARY, DEMO_SELECTION } from "./demo-data.js";
import { Studio, demoStudioAdapter } from "./index.js";
import type { StudioAdapter, StudioLabels } from "./types.js";

const labels: StudioLabels = {
  treeLabel: "L-tree", stageLabel: "L-stage", inspectorLabel: "L-inspector", useGroup: "L-use-group",
  useSource: (source, target) => `L-use ${source} @ ${target}`,
  scope: { label: "L-scope", member: "L-member", slot: "L-slot", node: "L-node", memberPicker: "L-member-picker", nodePicker: "L-node-picker" },
  checkSummary: (errors, notices) => `L-check ${errors}/${notices}`,
  referenceOnly: "L-reference-only", inUseByDefault: "L-default", noFill: "L-no-fill",
  pending: (count) => `L-pending ${count}`, save: "L-save", discard: "L-discard", resetToDefault: "L-reset",
  saveFailed: { unavailable: "L-unavailable", conflict: "L-conflict", invalid: "L-invalid", failed: "L-failed" },
  loading: "L-loading", loadFailed: "L-load-failed", sampleText: "L-sample", fontNotLoaded: "L-font-note",
  inspector: { source: "L-i-source", mode: "L-i-mode", licence: "L-i-licence", pin: "L-i-pin", status: "L-i-status", evidence: "L-i-evidence", members: "L-i-members", findings: "L-i-findings", via: "L-i-via", light: "L-i-light", dark: "L-i-dark", alias: "L-i-alias", builtOn: "L-i-built-on", relation: "L-i-relation" },
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
  matches: media.includes("1024") || media.includes("desktop") ? desktop : tablet, media, addEventListener: vi.fn(), removeEventListener: vi.fn(),
})));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Studio", () => {
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
    const use = within(screen.getByRole("radiogroup", { name: "L-use-group" }));
    expect(use.getAllByRole("radio").map((node) => node.getAttribute("aria-label"))).toEqual([
      "L-use example @ tokens.accent-color", "L-use foundry @ tokens.accent-color", "L-use reference-kit @ tokens.accent-color",
    ]);
    expect(radio("reference-kit")).toBeDisabled();
    expect(radio("foundry")).toBeEnabled();
    expect(screen.getByText("L-reference-only")).toBeInTheDocument();
    expect(screen.getByText("L-default")).toBeInTheDocument();
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
    await act(async () => { document.querySelector<HTMLElement>("[data-studio-card=reference-kit]")?.focus(); });
    await user.tab();
    await user.click(document.querySelector("[data-studio-card=reference-kit]") as HTMLElement);
    expect(within(inspector).getByText("reference-kit", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("L-pending 0")).toBeInTheDocument();
    expect(within(screen.getByRole("radiogroup", { name: "L-use-group" })).getAllByRole("radio").filter((node) => (node as HTMLInputElement).checked)).toHaveLength(0);
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
    await user.click(screen.getByRole("row", { name: "tokens.surface-color" }));
    expect(screen.getByRole("radio", { name: "L-use foundry @ tokens.surface-color" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "L-use reference-kit @ tokens.surface-color" })).toBeNull();
  });

  it("lays out three panes wide, and moves the cards into Tabs below tablet-lg", async () => {
    stub(true, true);
    const wide = await mount();
    expect(document.querySelector("[data-studio]")?.getAttribute("data-layout")).toBe("wide");
    expect(screen.queryByRole("tablist")).toBeNull();
    wide.unmount();
    stub(false, false);
    await mount();
    expect(document.querySelector("[data-studio]")?.getAttribute("data-layout")).toBe("narrow");
    expect(screen.getAllByRole("tab").map((node) => node.textContent)).toEqual(["example", "foundry", "reference-kit"]);
    expect(screen.getByRole("button", { name: "L-tree" })).toHaveAttribute("aria-expanded", "false");
  });

  it("takes its chrome copy only from labels", async () => {
    await mount();
    expect(screen.getByRole("region", { name: "L-stage" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "L-use-group" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "L-scope" })).toBeInTheDocument();
    expect(screen.getAllByText(/^L-check /)).toHaveLength(3);
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
    expect(screen.getByRole("row", { name: "tokens.accent-color" })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: "tokens.surface-color" })).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: "tokens.line-height" })).toBeNull();
    expect(screen.getAllByRole("row").map((row) => row.getAttribute("aria-label") ?? row.textContent)).toEqual(expect.arrayContaining(["Scale", "Role", "tokens.accent-color"]));
  });

  it("expands a node pick into one slot pick per leaf the source fills, and never stores a node", async () => {
    const user = userEvent.setup();
    const host = adapter();
    await mount({}, host);
    await user.click(screen.getByRole("radio", { name: "L-node" }));
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
    await user.click(screen.getByRole("radio", { name: "L-node" }));
    const reset = screen.getByRole("button", { name: "L-reset" });
    expect(reset).toBeDisabled();
    await user.click(radio("foundry", "tokens/scale-type"));
    expect(screen.getByText("L-pending 1")).toBeInTheDocument();
    expect(reset).toBeEnabled();
    await user.click(reset);
    expect(screen.getByText("L-pending 0")).toBeInTheDocument();
  });
});
