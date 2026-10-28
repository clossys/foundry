// @vitest-environment jsdom
/**
 * DESIGNER-RO part B1: the Designer has no page tabs. A right rail of five collapsible cards (Explorer, Inspector,
 * Canvas map, Zoom) holds the modules that used to register into FrameDock and the AppFrame right panel.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render, studioReady, chooseLayer, layerRows, railCard, railCards } from "../__fixtures__/frame.js";
import { adopt, emptyLibrary, labels, smallCatalog } from "../__fixtures__/studio.js";
import { Studio, StudioProvider, WholeStudioProvider } from "../index.js";
import * as studioApi from "../index.js";
import { componentIntegration } from "../../catalog-core/__fixtures__/component-integration.js";
import type { CompositeStudioLabels } from "../types.js";
import { studioTestCopy } from "../__fixtures__/copy.js";
import { systemLayout } from "../system-canvas/layout.js";
import { identityFor } from "../system-canvas/inspector/model.js";
import type { StudioCopyBinding, StudioCopyRef } from "../copy-binding.js";

afterEach(() => { cleanup(); try { localStorage.clear(); } catch { /* jsdom always has storage */ } window.history.replaceState(null, "", "/"); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const wholeLabels = { ...labels, whole: { signoff: "W-signoff", proposed: "W-proposed", contract: "W-contract", contentSlots: "W-slots", configurations: "W-config", unresolved: "W-unresolved", unassessed: "W-unassessed" } } as CompositeStudioLabels;
// Synthetic host messages preserve this existing interaction fixture. These are
// not Foundry records or binding proof: the dedicated hand-roll tests require
// the actual record ids and assert Needs for unavailable metadata messages.
const fixtureMessages: Record<string, StudioCopyRef> = {};
const fixtureText = new Map<string, string>();
function addFixtureMessage(cell: string, value: string) {
  const id = `fixture.rail.message-${fixtureText.size}`;
  fixtureMessages[cell] = { id }; fixtureText.set(id, value);
}
const fixtureLayout = systemLayout(smallCatalog.placements);
for (const board of fixtureLayout.boards.values()) addFixtureMessage(`studio.ia.board.${board.id}`, board.label);
for (const line of fixtureLayout.lines.values()) addFixtureMessage(`studio.ia.line.${line.id}`, line.label);
for (const cell of fixtureLayout.cells.values()) {
  addFixtureMessage(`studio.ia.item.${cell.leaf}`, cell.leaf);
  addFixtureMessage(`studio.inspector.path.${cell.leaf}`, identityFor(smallCatalog.placements, cell.leaf).path.join(" › "));
}
addFixtureMessage("designer.scorecard.resolved-count", "fixture-count");
for (let number = 1; number <= 10; number++) {
  addFixtureMessage(`designer.scorecard.finding.C${number}`, `fixture check ${number}`);
}
const railCopy: StudioCopyBinding = {
  ...studioTestCopy, messages: fixtureMessages,
  resolver(ref) {
    let text = fixtureText.get(ref.id);
    if (fixtureMessages["designer.scorecard.resolved-count"].id === ref.id) text = `${ref.values?.resolved}/${ref.values?.total}`;
    return text === undefined ? studioTestCopy.resolver(ref) : { ref, text, servedLocale: ref.locale, chain: [ref.locale!] };
  },
};
const legacy = () => {
  const library = adopt(emptyLibrary(), "tokens.surface-color", "foundry");
  return <StudioProvider copy={railCopy} catalog={smallCatalog} initialSlotId="tokens.surface-color" adapter={{ load: async () => ({ library }), save: vi.fn() }} labels={labels}><Studio copy={railCopy} /></StudioProvider>;
};
function compositeAdapter() {
  const input = componentIntegration();
  const catalog = { ...input.catalog, values: smallCatalog };
  const library = { ...input.library, values: { fills: [] } };
  return { kind: "composite" as const, catalog, load: async () => ({ library, componentOptions: input.componentOptions }), save: vi.fn() };
}
const cardTrigger = (id: Parameters<typeof railCard>[0]) => within(railCard(id)!).getAllByRole("button").find(button => button.hasAttribute("aria-expanded"))!;

describe("no page tabs", () => {
  it("renders no layer tabs and exports no header", async () => {
    render(legacy());
    await studioReady();
    expect(document.querySelector("[data-studio-header]")).toBeNull();
    for (const name of ["Tokens", "Assets", "Components", "Sections", "Frames"]) expect(screen.queryAllByRole("link", { name })).toEqual([]);
    expect("StudioHeader" in studioApi).toBe(false);
    expect("useStudioNavigation" in studioApi).toBe(false);
  }, 30_000);
});

describe("right rail of cards", () => {
  it("renders five collapsible cards in order: Explorer, Inspector, Canvas map, Zoom", async () => {
    render(legacy());
    await studioReady();
    expect(screen.getByRole("complementary", { name: labels.rail.label })).toBeTruthy();
    expect(railCards().map(card => card.dataset.studioRailCard)).toEqual(["explorer", "inspector", "map", "zoom", "checks"]);
    const user = userEvent.setup();
    for (const id of ["explorer", "inspector", "map", "zoom"] as const) {
      const trigger = cardTrigger(id);
      expect(trigger.getAttribute("aria-expanded"), id).toBe("true");
      await user.click(trigger);
      expect(cardTrigger(id).getAttribute("aria-expanded"), id).toBe("false");
    }
  }, 30_000);

  it("hides the whole rail, and collapsed and hidden state persist across a remount", async () => {
    const user = userEvent.setup();
    const first = render(legacy());
    await studioReady();
    await user.click(cardTrigger("map"));
    await user.click(screen.getByRole("button", { name: labels.rail.hide }));
    expect(railCards()).toEqual([]);
    first.unmount();
    render(legacy());
    await studioReady();
    expect(railCards()).toEqual([]);
    await user.click(screen.getByRole("button", { name: labels.rail.show }));
    expect(railCards().length).toBe(5);
    expect(cardTrigger("map").getAttribute("aria-expanded")).toBe("false");
    expect(cardTrigger("explorer").getAttribute("aria-expanded")).toBe("true");
  }, 30_000);

  it("becomes an overlay drawer on a narrow viewport", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }) as MediaQueryList);
    render(legacy());
    await studioReady();
    expect(railCards()).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: labels.rail.show }));
    const sheet = await screen.findByRole("dialog");
    expect([...sheet.querySelectorAll<HTMLElement>("[data-studio-rail-card]")].map(card => card.dataset.studioRailCard)).toEqual(["explorer", "inspector", "map", "zoom", "checks"]);
  }, 30_000);

  it("registers no Designer module into FrameDock or the AppFrame right panel", async () => {
    render(legacy());
    await studioReady();
    expect(document.querySelectorAll("[data-frame-module]").length).toBe(0);
    const studio = join(dirname(fileURLToPath(import.meta.url)), "..");
    const sources = (dir: string): string[] => readdirSync(dir).flatMap(name => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === "__fixtures__" ? [] : sources(path);
      return /\.tsx?$/.test(name) && !name.includes(".test.") ? [path] : [];
    });
    for (const path of sources(studio)) expect(readFileSync(path, "utf8"), path).not.toMatch(/\bSlotModule\b/);
  }, 30_000);
});

describe("inspector card", () => {
  it("shows its empty hint, fills on an L3 select, and Escape clears it (and the URL node)", async () => {
    const user = userEvent.setup();
    render(legacy());
    await studioReady();
    const inspector = railCard("inspector")!;
    expect(within(inspector).getByText(labels.rail.inspectorEmpty)).toBeTruthy();
    const tree = screen.getByRole("treegrid", { name: labels.treeLabel });
    await user.click(within(tree).getByText(/^tokens\.surface-color/));
    await waitFor(() => expect(within(railCard("inspector")!).queryByText(labels.rail.inspectorEmpty)).toBeNull());
    expect(railCard("inspector")!.querySelector('[data-studio-panel="inspector"]')).not.toBeNull();
    expect(window.location.search).toBe("?layer=tokens&node=tokens.surface-color");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(within(railCard("inspector")!).getByText(labels.rail.inspectorEmpty)).toBeTruthy());
    expect(window.location.search).toBe("?layer=tokens");
  }, 30_000);

  it("opens on a deep-linked ?node= leaf and normalises the URL", async () => {
    window.history.replaceState(null, "", "/?node=assets.icon-search");
    render(legacy());
    await studioReady();
    expect(window.location.search).toBe("?layer=assets&node=assets.icon-search");
    await waitFor(() => expect(railCard("inspector")!.querySelector('[data-studio-panel="inspector"]')).not.toBeNull());
  }, 30_000);
});

describe("explorer card", () => {
  it("lists the five layers at the top level in D5g order, and the layer select and the tree stay in sync", async () => {
    const user = userEvent.setup();
    render(<WholeStudioProvider copy={railCopy} adapter={compositeAdapter()} labels={wholeLabels}><Studio copy={railCopy} /></WholeStudioProvider>);
    await studioReady(30_000);
    const names = ["Frames", "Sections", "Components", "Assets", "Tokens"];
    const rows = layerRows(labels.treeLabel);
    expect(rows.map(row => names.find(name => row.textContent?.includes(name)))).toEqual(names);
    const expandedLayer = () => layerRows(labels.treeLabel).filter(row => row.getAttribute("aria-expanded") === "true").map(row => names.find(name => row.textContent?.includes(name)));
    expect(expandedLayer()).toEqual(["Tokens"]);
    // Select -> tree.
    await chooseLayer(labels, "Components", user);
    await waitFor(() => expect(expandedLayer()).toEqual(["Components"]));
    // Tree -> select.
    await user.click(within(layerRows(labels.treeLabel).find(row => row.textContent?.includes("Assets"))!).getByText("Assets"));
    await waitFor(() => expect(screen.getByRole("button", { name: new RegExp(`${labels.layers.label}$`) }).textContent?.trim()).toBe("Assets"));
    await waitFor(() => expect(expandedLayer()).toEqual(["Assets"]));
    expect(new URLSearchParams(window.location.search).get("layer")).toBe("assets");
  }, 90_000);
});
