// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../__fixtures__/frame.js";
import { buildUsageGraph, type UsageGraph, type UsageGraphInputs } from "../../catalog-core/usage-graph.js";
import { checkWiring, type WiringException } from "../../catalog-core/wiring.js";
import { componentIntegration } from "../../catalog-core/__fixtures__/component-integration.js";
import { labels as studioLabels, smallCatalog } from "../__fixtures__/studio.js";
import { Studio, StudioRightPanel } from "../index.js";
import { WholeStudioProvider } from "../WholeStudioProvider.js";
import type { CompositeStudioLabels } from "../types.js";
import { UsagePanel, type UsagePanelLabels } from "./UsagePanel.js";
import { usageBlockRelations, usageConsumers, usageModel } from "./model.js";
import { loadCommittedUsage } from "./committed-graph.js";

afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

/** Every word the panel shows comes from these labels or from the graph itself. */
const labels: UsagePanelLabels = {
  title: "U-title", using: "U-using", usedWhere: "U-used-where", reads: "U-reads", composes: "U-composes", options: "U-options", owns: "U-owns",
  exceptions: "U-exceptions", transitive: "U-transitive", back: "U-back", usedNowhere: "U-used-nowhere", notLinked: "U-not-linked", loading: "U-loading", none: "U-none",
  layer: { tokens: "U-tokens", assets: "U-assets", components: "U-components", sections: "U-sections", frames: "U-frames", pages: "U-pages" },
  kind: { reads: "U-k-reads", composes: "U-k-composes", hosts: "U-k-hosts", renders: "U-k-renders" },
  evidence: { declared: "U-e-declared", scanned: "U-e-scanned", runtime: "U-e-runtime" },
  count: count => `U-count ${count}`,
};

/** components.button is composed by a section and by a frame; the home page renders both. */
const inputs: UsageGraphInputs = {
  inventory: { tokens: ["tokens.color", "tokens.unused"], components: ["components.button", "components.icon"], sections: ["sections.hero"], frames: ["frames.app-shell"] },
  selection: { "tokens.color": "foundry/tokens.color", "tokens.unused": "foundry/tokens.unused", "components.button": "foundry/components.button", "components.icon": "lucide/components.icon", "sections.hero": "foundry/sections.hero", "frames.app-shell": "foundry/frames.app-shell" },
  components: {
    fills: [{ id: "foundry/components.button", slot: "components.button", scanStatus: "lower-bound", declaredReads: { tokens: ["tokens.color"], assets: [] }, scannedReads: { tokens: ["tokens.color"], assets: [] } }],
    reverseComposes: { "components.icon": { declared: ["foundry/components.button"], scanned: [] } },
  },
  surfaces: {
    fills: [
      { id: "foundry/sections.hero", slot: "sections.hero", scanStatus: "lower-bound", declaredReads: { tokens: [], assets: [] }, scannedReads: { tokens: [], assets: [] },
        observedComposes: [{ file: "src/blocks/Hero.tsx", line: 4, slotId: "components.button", tag: "Button" }, { file: "src/blocks/Hero.tsx", line: 9, slotId: "components.button", tag: "Button" }] },
      { id: "foundry/frames.app-shell", slot: "frames.app-shell", scanStatus: "lower-bound", declaredReads: { tokens: [], assets: [] }, scannedReads: { tokens: [], assets: [] } },
    ],
    reverseComposes: { "components.button": { declared: ["foundry/sections.hero", "foundry/frames.app-shell"], scanned: ["foundry/sections.hero"] } },
  },
  pages: [{ routeId: "home", binding: { frame: { leaf: "frames.app-shell", fill: "foundry/frames.app-shell" }, frameSlots: {}, sections: { main: [{ leaf: "sections.hero", fill: "foundry/sections.hero" }] } } }],
};
const graph = buildUsageGraph(inputs);

/** A host that follows navigation, as a frame does: it shows whatever element the panel asks for. */
function Host({ graph, onNavigate, initial = "components.button" }: { graph: UsageGraph; onNavigate: (id: string) => void; initial?: string }) {
  const [id, setId] = useState(initial);
  return <UsagePanel id={id} graph={graph} labels={labels} onNavigate={next => { onNavigate(next); setId(next); }} />;
}
const list = (name: string) => screen.getByRole("heading", { name, level: 4 }).closest("section")!;
const layers = (section: HTMLElement) => [...section.querySelectorAll("[data-usage-layer]")].map(group => group.getAttribute("data-usage-layer"));
const rowIds = (section: HTMLElement, layer?: string) => [...section.querySelectorAll(`${layer ? `[data-usage-layer="${layer}"] ` : ""}[data-usage-row]`)].map(row => row.getAttribute("data-usage-row"));

describe("UsagePanel", () => {
  it("shows where components.button is used (sections, frames, then pages transitively) and navigates with a back stack", async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<Host graph={graph} onNavigate={onNavigate} />);
    const usedWhere = list("U-used-where");
    // Above first: frames before sections.
    expect(layers(usedWhere)).toEqual(["frames", "sections"]);
    expect(rowIds(usedWhere, "sections")).toEqual(["sections.hero"]);
    expect(rowIds(usedWhere, "frames")).toEqual(["frames.app-shell"]);
    expect(within(usedWhere).getByRole("heading", { name: "U-sections", level: 5 })).toBeInTheDocument();
    // Each row: target id, its selected fill source, edge kind, evidence and the site count.
    const hero = usedWhere.querySelector<HTMLElement>('[data-usage-row="sections.hero"]')!;
    for (const text of ["sections.hero", "foundry", "U-k-composes", "U-e-declared", "U-e-scanned", "U-count 2"]) expect(within(hero).getByText(text)).toBeInTheDocument();
    // Using what, below first: the token it reads, then the component it composes.
    expect(layers(list("U-using"))).toEqual(["tokens", "components"]);
    expect(rowIds(list("U-reads"))).toEqual(["tokens.color"]);
    expect(rowIds(list("U-composes"))).toEqual(["components.icon"]);

    // The transitive toggle switches to closure(): the page rendering the section and the frame appears.
    await user.click(screen.getByRole("switch", { name: "U-transitive" }));
    expect(layers(list("U-used-where"))).toEqual(["pages", "frames", "sections"]);
    expect(rowIds(list("U-used-where"), "pages")).toEqual(["pages.home"]);
    await user.click(screen.getByRole("switch", { name: "U-transitive" }));
    expect(rowIds(list("U-used-where"), "pages")).toEqual([]);

    // Selecting a row navigates through onNavigate; the section's own Used where shows its page and frame.
    expect(screen.getByRole("button", { name: "U-back" })).toBeDisabled();
    await user.click(within(list("U-used-where")).getByRole("button", { name: "sections.hero" }));
    expect(onNavigate).toHaveBeenLastCalledWith("sections.hero");
    await waitFor(() => expect(document.querySelector('[data-studio-usage="sections.hero"]')).not.toBeNull());
    expect(rowIds(list("U-used-where"), "pages")).toEqual(["pages.home"]);
    expect(rowIds(list("U-used-where"), "frames")).toEqual(["frames.app-shell"]);
    await user.click(within(list("U-used-where")).getByRole("button", { name: "pages.home" }));
    expect(onNavigate).toHaveBeenLastCalledWith("pages.home");
    // Back walks the stack in order.
    await user.click(screen.getByRole("button", { name: "U-back" }));
    expect(onNavigate).toHaveBeenLastCalledWith("sections.hero");
    await user.click(screen.getByRole("button", { name: "U-back" }));
    expect(onNavigate).toHaveBeenLastCalledWith("components.button");
    await waitFor(() => expect(document.querySelector('[data-studio-usage="components.button"]')).not.toBeNull());
    expect(screen.getByRole("button", { name: "U-back" })).toBeDisabled();
  });

  it("an element the host cannot show renders as text, never a dead control", () => {
    render(<UsagePanel id="components.button" graph={graph} labels={labels} onNavigate={vi.fn()} canNavigate={id => !id.startsWith("frames.")} />);
    const frame = list("U-used-where").querySelector<HTMLElement>('[data-usage-row="frames.app-shell"]')!;
    expect(within(frame).queryByRole("button")).toBeNull();
    expect(within(frame).getByText("frames.app-shell")).toBeInTheDocument();
  });

  it("shows exception rows, not-linked findings and a used-nowhere leaf inline", () => {
    const owned: WiringException = { name: "hero-geometry", file: "src/blocks/Hero.tsx", elementId: "hero-grid", hash: "sha256:0", reason: "layout", owner: "design", expiry: "2026-12-31", read: "tokens.unused.gap", reasonCode: "layout-geometry", status: "proposed" };
    const other: WiringException = { ...owned, name: "elsewhere", file: "src/blocks/Other.tsx", read: "tokens.color" };
    render(<UsagePanel id="sections.hero" graph={graph} labels={labels} onNavigate={vi.fn()} exceptions={[owned, other]} />);
    // Owns: the exception recorded in a file this section's scanned edges point at.
    const owns = list("U-owns").querySelector<HTMLElement>('[data-usage-exception="hero-geometry"]')!;
    for (const text of ["hero-geometry", "layout-geometry", "design", "2026-12-31", "proposed"]) expect(within(owns).getByText(text)).toBeInTheDocument();
    expect(list("U-owns").querySelector('[data-usage-exception="elsewhere"]')).toBeNull();
    cleanup();
    render(<UsagePanel id="tokens.unused" graph={graph} labels={labels} onNavigate={vi.fn()} exceptions={[owned, other]}
      findings={[{ code: "WL5", subject: "tokens.unused", message: "no provenance stamp" }, { code: "WL5", subject: "tokens.color", message: "other" }]} />);
    expect(screen.getByText("U-used-nowhere")).toBeInTheDocument();
    // The exception whose read is one of this token's members is shown on the token.
    expect(list("U-exceptions").querySelector('[data-usage-exception="hero-geometry"]')).not.toBeNull();
    const notLinked = [...document.querySelectorAll<HTMLElement>("[data-usage-not-linked]")];
    expect(notLinked).toHaveLength(1);
    for (const text of ["U-not-linked", "WL5", "no provenance stamp"]) expect(within(notLinked[0]!).getByText(text)).toBeInTheDocument();
    cleanup();
    render(<UsagePanel id="components.button" graph={graph} labels={labels} onNavigate={vi.fn()} />);
    expect(screen.queryByText("U-used-nowhere")).toBeNull();
  });

  it("fills the catalog computed fields from the same graph API", () => {
    expect(usageConsumers(graph, "tokens.color")).toEqual({ consumers: ["components.button"] });
    expect(usageBlockRelations(graph, "sections.hero")).toEqual({ components: ["components.button"], tokens: [], composedBy: ["frames.app-shell", "pages.home"] });
    expect(usageModel(graph, "components.button").options).toEqual([]);
  });

  it("reads the committed Foundry graph by default", async () => {
    const committed = await loadCommittedUsage();
    expect(committed?.graph.schemaVersion).toBe(1);
    expect(usageModel(committed!.graph, "components.button").usedWhere.flatMap(group => group.rows).length).toBeGreaterThan(0);
    render(<UsagePanel id="components.button" labels={labels} onNavigate={vi.fn()} />);
    expect(screen.getByText("U-loading")).toBeInTheDocument();
    await waitFor(() => expect(document.querySelectorAll('[data-studio-usage="components.button"] [data-usage-row]').length).toBeGreaterThan(0));
  });

  it("carries no raw value above Components: WL4 is 0 on the usage sources", () => {
    const dir = resolvePath(import.meta.dirname);
    const sources = readdirSync(dir).filter(file => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
      .map(file => ({ path: `src/studio/usage/${file}`, content: readFileSync(resolvePath(dir, file), "utf8"), layer: "sections" as const }));
    expect(sources.map(source => source.path)).toContain("src/studio/usage/UsagePanel.tsx");
    expect(checkWiring({ sources }).findings.filter(finding => finding.code === "WL4")).toEqual([]);
  });
});

describe("Studio mounts", () => {
  const wholeLabels: CompositeStudioLabels = { ...studioLabels, usage: labels, whole: { signoff: "W-signoff", proposed: "W-proposed", contract: "W-contract", contentSlots: "W-slots", configurations: "W-config", unresolved: "W-unresolved", unassessed: "W-unassessed" } };

  it("the contract inspector shows the host graph's usage and a row changes the selected element, with back", async () => {
    const user = userEvent.setup();
    const input = componentIntegration();
    const library = { ...input.library, values: { fills: [] } };
    const adapter = { kind: "composite" as const, catalog: { ...input.catalog, values: smallCatalog }, load: async () => ({ library, componentOptions: input.componentOptions, usageGraph: graph }), save: async () => ({ ok: false as const, reason: "unavailable" as const }) };
    // The Inspector card fills on a selection: deep-link the leaf (?node=), as a shared Designer URL does.
    window.history.replaceState(null, "", "?node=components.button");
    render(<WholeStudioProvider adapter={adapter} labels={wholeLabels} initialSlotId="components.button"><Studio /><StudioRightPanel /></WholeStudioProvider>);
    const inspector = () => document.querySelector<HTMLElement>('[data-studio-panel="inspector"]')!;
    await waitFor(() => expect(inspector()?.querySelector('[data-studio-usage="components.button"]') ?? null).not.toBeNull());
    expect(rowIds(within(inspector()).getByRole("heading", { name: "U-used-where", level: 4 }).closest("section")!, "frames")).toEqual(["frames.app-shell"]);
    // Pages have no Studio tab: the row is text, not a control.
    await user.click(within(inspector()).getByRole("switch", { name: "U-transitive" }));
    expect(within(inspector().querySelector<HTMLElement>('[data-usage-row="pages.home"]')!).queryByRole("button")).toBeNull();
    await user.click(within(inspector()).getByRole("switch", { name: "U-transitive" }));
    // A row in another layer switches tab and selection.
    await user.click(within(inspector()).getByRole("button", { name: "frames.app-shell" }));
    await waitFor(() => expect(inspector()?.querySelector('[data-studio-usage="frames.app-shell"]') ?? null).not.toBeNull());
    expect(within(inspector()).getByRole("heading", { name: "frames.app-shell", level: 2 })).toBeInTheDocument();
    await user.click(within(inspector()).getByRole("button", { name: "U-back" }));
    await waitFor(() => expect(inspector()?.querySelector('[data-studio-usage="components.button"]') ?? null).not.toBeNull());
    expect(within(inspector()).getByRole("button", { name: "U-back" })).toBeDisabled();
  });
});
