import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, useState } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CatalogBrowser, type CatalogBrowserConfig, type CatalogBrowserKind, type CatalogBrowserLabels, type CatalogBrowserSelection } from "./CatalogBrowser.js";
import { extractStyleCandidates, scanStyleSources } from "../style-scan.js";
import { checkTokenPurity } from "../token-gate.js";
import { TOKENS } from "../tokens/tokens.js";

interface ComponentEntry { id: string; label: string; l1: string; l2: string; lifecycle: "draft" | "stable" | "deprecated" | "parked"; status: "main" | "gap"; notes?: string[] }
interface TokenEntry { id: string; label: string; l1: string; l2: string; lifecycle: "draft" | "stable" | "deprecated" | "parked"; tier: "core" | "role" }

const components = {
  kind: "components" as const,
  groups: [
    { id: "act", label: "Act", children: [{ id: "buttons", label: "Buttons" }, { id: "links", label: "Links" }] },
    { id: "show", label: "Show", children: [{ id: "status", label: "Status" }, { id: "empty", label: "Empty" }] },
  ],
  entries: [
    { id: "act.button", label: "Button", l1: "act", l2: "buttons", lifecycle: "stable", status: "main", notes: ["Pairs with Link."] },
    { id: "act.icon-button", label: "Icon button", l1: "act", l2: "buttons", lifecycle: "draft", status: "main" },
    { id: "act.link", label: "Link", l1: "act", l2: "links", lifecycle: "draft", status: "gap" },
    { id: "show.badge", label: "Badge", l1: "show", l2: "status", lifecycle: "parked", status: "main" },
  ] satisfies ComponentEntry[],
};
const tokens = {
  kind: "themes" as const,
  groups: [{ id: "color", label: "Color", children: [{ id: "ink", label: "Ink" }] }],
  entries: [
    { id: "--color-ink-primary", label: "Ink primary", l1: "color", l2: "ink", lifecycle: "stable", tier: "role" },
    { id: "--color-blue-500", label: "Blue 500", l1: "color", l2: "ink", lifecycle: "draft", tier: "core" },
  ] satisfies TokenEntry[],
};
const catalogs = [components, tokens];

const labels: CatalogBrowserLabels = {
  catalogs: "Catalogs", toolbar: "Browse tools", search: "Search entries", anyValue: "Any",
  showParked: count => `Show parked (${count})`, entryCount: count => `${count} entries`,
  lifecycle: { draft: "Draft", stable: "Stable", deprecated: "Deprecated", parked: "Parked" },
  browse: "Entries", preview: "Entry", inspector: "Controls", resizeBrowse: "Resize entries", resizeInspector: "Resize controls",
  selectEntry: "Select an entry", noMatches: "No entries match", empty: "This catalog is empty",
  unknownEntry: id => `No entry ${id}`, loading: "Loading catalog", notBuilt: "Not built", livePreview: "Live preview",
  metadata: "Metadata", id: "ID", group: "Group", lifecycleField: "Lifecycle", notes: "Notes", states: "States", usage: "Usage",
  builtFrom: "Built from", usedBy: "Used by", noControls: "No controls for this entry", resetControls: "Reset controls",
};

const componentPreview = vi.fn((entry: ComponentEntry, context: { kind: string; config: CatalogBrowserConfig }) =>
  <p data-testid="preview">{`${context.kind}:${entry.id}:${String(context.config.tone)}:${String(context.config.disabled)}:${String(context.config.text)}`}</p>);
const tokenPreview = vi.fn((entry: TokenEntry) => <p data-testid="preview">{`token:${entry.id}`}</p>);
const componentKind: CatalogBrowserKind<ComponentEntry> = {
  label: "Components",
  preview: componentPreview,
  notBuilt: entry => entry.status === "gap" ? "Waiting on the link spec." : undefined,
  controls: entry => entry.id === "act.button" ? [
    { type: "choice", id: "tone", label: "Tone", options: [{ id: "primary", label: "Primary" }, { id: "quiet", label: "Quiet" }], defaultValue: "primary" },
    { type: "toggle", id: "disabled", label: "Disabled", defaultValue: false },
    { type: "text", id: "text", label: "Text", defaultValue: "Save" },
  ] : [],
  badges: entry => entry.id === "act.button" ? [{ label: "Owner reviewed", tone: "success" }] : [],
  fields: entry => [{ label: "Status", value: entry.status }],
  states: entry => entry.id === "act.button" ? ["hover", "focus-visible", "disabled"] : [],
  usage: entry => entry.id === "act.button" ? <p>Use for the primary action.</p> : undefined,
  builtFrom: entry => entry.id === "act.button" ? [{ catalog: "themes", entryId: "--color-ink-primary" }, { catalog: "themes", entryId: "--missing", label: "Missing token" }] : [],
  usedBy: entry => entry.id === "act.button" ? [{ catalog: "components", entryId: "act.icon-button" }] : [],
  filters: [{ id: "status", label: "Status", options: [{ id: "main", label: "On main" }, { id: "gap", label: "Gap" }], value: entry => entry.status }],
};
const tokenKind: CatalogBrowserKind<TokenEntry> = { label: "Tokens", preview: tokenPreview, fields: entry => [{ label: "Tier", value: entry.tier }] };
const kinds = { components: componentKind, tokens: tokenKind };
const base = { catalogs, kinds, label: "Design catalog", labels };

function media() {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, media: "", addEventListener: vi.fn(), removeEventListener: vi.fn() })));
}
const tree = () => screen.getByRole("tree", { name: labels.browse });
const row = (name: string) => within(tree()).getByRole("treeitem", { name });
const rowNames = () => within(tree()).getAllByRole("treeitem").map(item => item.getAttribute("aria-label"));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("CatalogBrowser", () => {
  it("names its regions and lists catalogs as tabs with entry counts", () => {
    media(); render(<CatalogBrowser {...base} />);
    expect(screen.getByRole("region", { name: "Design catalog" })).toBeInTheDocument();
    const tabs = within(screen.getByRole("tablist", { name: "Catalogs" })).getAllByRole("tab");
    expect(tabs.map(tab => tab.textContent)).toEqual(["Components 4", "Tokens 2"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("toolbar", { name: "Browse tools" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search entries" })).toBeInTheDocument();
    for (const name of ["Entries", "Entry", "Controls"]) expect(screen.getByRole("region", { name })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Select an entry" })).toBeVisible();
    expect(componentPreview).not.toHaveBeenCalled();
  });

  it("builds the tree by group with counts, lifecycle tags and not-built badges, hiding parked entries", async () => {
    media(); render(<CatalogBrowser {...base} />);
    expect(rowNames()).toEqual(["Act", "Show"]);
    expect(row("Act")).toHaveAccessibleDescription("3 entries");
    expect(row("Show")).toHaveAccessibleDescription("0 entries");
    await userEvent.click(row("Act")); await userEvent.click(row("Links"));
    expect(row("Link")).toHaveAccessibleDescription("act.link · Draft Not built");
    await userEvent.click(row("Show")); await userEvent.click(row("Status"));
    expect(within(tree()).queryByRole("treeitem", { name: "Badge" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: "Show parked (1)" }));
    expect(row("Badge")).toHaveAccessibleDescription("show.badge · Parked");
  });

  it("searches by label or id, expands matching groups and drops empty ones only while searching", async () => {
    media(); render(<CatalogBrowser {...base} />);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search entries" }), "ICON");
    expect(rowNames()).toEqual(["Act", "Buttons", "Icon button"]);
    expect(row("Act")).toHaveAttribute("aria-expanded", "true");
    await userEvent.clear(screen.getByRole("searchbox")); await userEvent.type(screen.getByRole("searchbox"), "act.link");
    expect(rowNames()).toEqual(["Act", "Links", "Link"]);
    await userEvent.clear(screen.getByRole("searchbox")); await userEvent.type(screen.getByRole("searchbox"), "zzz");
    expect(screen.queryByRole("tree")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("No entries match");
    await userEvent.clear(screen.getByRole("searchbox"));
    expect(rowNames()).toEqual(["Act", "Show"]);
  });

  it("filters by a host filter with an any-value option first", async () => {
    media(); render(<CatalogBrowser {...base} />);
    await userEvent.click(screen.getByRole("button", { name: /Status/ }));
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options).toHaveLength(3);
    ["Any", "On main", "Gap"].forEach((name, index) => expect(options[index]).toHaveAccessibleName(name));
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    await userEvent.click(options[2]!);
    expect(rowNames()).toEqual(["Act", "Links", "Link"]);
  });

  it("selects by pointer and keyboard, reporting the catalog and exact entry id", async () => {
    media(); const onSelectionChange = vi.fn(); render(<CatalogBrowser {...base} onSelectionChange={onSelectionChange} />);
    act(() => row("Act").focus());
    await userEvent.keyboard("{ArrowRight}{ArrowDown}{ArrowRight}{ArrowDown}{Enter}");
    expect(onSelectionChange).toHaveBeenLastCalledWith({ catalog: "components", entryId: "act.button" });
    expect(row("Button")).toHaveAttribute("aria-selected", "true");
    expect(row("Button")).toHaveFocus();
    await userEvent.keyboard("{ArrowDown} ");
    expect(onSelectionChange).toHaveBeenLastCalledWith({ catalog: "components", entryId: "act.icon-button" });
    expect(row("Icon button")).toHaveFocus();
    await userEvent.click(row("Button"));
    expect(onSelectionChange).toHaveBeenCalledTimes(3);
    await userEvent.click(row("Buttons"));
    expect(onSelectionChange).toHaveBeenCalledTimes(3);
  });

  it("calls the per-kind renderer slot with the selected entry, its kind and resolved config", () => {
    media(); render(<CatalogBrowser {...base} defaultSelection={{ catalog: "components", entryId: "act.button" }} />);
    expect(componentPreview).toHaveBeenLastCalledWith(components.entries[0], { kind: "components", config: { tone: "primary", disabled: false, text: "Save" } });
    expect(screen.getByTestId("preview")).toHaveTextContent("components:act.button:primary:false:Save");
    expect(tokenPreview).not.toHaveBeenCalled();
    expect(row("Button")).toHaveAttribute("aria-selected", "true");
    expect(row("Act")).toHaveAttribute("aria-expanded", "true");
  });

  it("renders the entry detail template: identity, badges, metadata, notes, states and usage", () => {
    media(); render(<CatalogBrowser {...base} defaultSelection={{ catalog: "components", entryId: "act.button" }} />);
    const detail = screen.getByRole("region", { name: "Entry" });
    expect(within(detail).getByRole("heading", { level: 4, name: "Button" })).toBeInTheDocument();
    expect(within(detail).getByText("Components / Act / Buttons")).toBeInTheDocument();
    expect(within(detail).getAllByText("Stable").length).toBeGreaterThan(0);
    expect(within(detail).getByText("Owner reviewed")).toBeInTheDocument();
    const metadata = within(detail).getByRole("region", { name: "Metadata" });
    const terms = within(metadata).getAllByRole("term").map(term => term.textContent);
    expect(terms).toEqual(["ID", "Group", "Lifecycle", "Status", "Notes"]);
    expect(within(metadata).getByText("Act / Buttons")).toBeInTheDocument();
    expect(within(metadata).getByText("Pairs with Link.")).toBeInTheDocument();
    const states = within(detail).getByRole("region", { name: "States" });
    expect(within(states).getAllByRole("listitem").map(item => item.textContent)).toEqual(["hover", "focus-visible", "disabled"]);
    expect(within(detail).getByRole("region", { name: "Usage" })).toHaveTextContent("Use for the primary action.");
    expect(within(detail).getByRole("region", { name: "Live preview" })).toContainElement(screen.getByTestId("preview"));
  });

  it("links built-from and used-by references to their targets across catalogs; unresolved ones stay text", async () => {
    media(); const onSelectionChange = vi.fn();
    render(<CatalogBrowser {...base} defaultSelection={{ catalog: "components", entryId: "act.button" }} onSelectionChange={onSelectionChange} />);
    const builtFrom = screen.getByRole("region", { name: "Built from" });
    expect(within(builtFrom).queryByRole("button", { name: "Missing token" })).not.toBeInTheDocument();
    expect(within(builtFrom).getByText("Missing token")).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("region", { name: "Used by" })).getByRole("button", { name: "Icon button" }));
    expect(onSelectionChange).toHaveBeenLastCalledWith({ catalog: "components", entryId: "act.icon-button" });
    expect(screen.getByRole("heading", { level: 4, name: "Icon button" })).toBeInTheDocument();
    await userEvent.click(row("Button"));
    await userEvent.click(within(screen.getByRole("region", { name: "Built from" })).getByRole("button", { name: "Ink primary" }));
    expect(onSelectionChange).toHaveBeenLastCalledWith({ catalog: "themes", entryId: "--color-ink-primary" });
    expect(screen.getByRole("tab", { name: /Tokens/ })).toHaveAttribute("aria-selected", "true");
    expect(tokenPreview).toHaveBeenLastCalledWith(tokens.entries[0], { kind: "themes", config: {} });
    expect(row("Ink primary")).toHaveAttribute("aria-selected", "true");
  });

  it("shows the not-built state instead of calling the renderer, with no controls", () => {
    media(); render(<CatalogBrowser {...base} defaultSelection={{ catalog: "components", entryId: "act.link" }} />);
    const status = within(screen.getByRole("region", { name: "Live preview" })).getByRole("status");
    expect(status).toHaveTextContent("Not built"); expect(status).toHaveTextContent("Waiting on the link spec.");
    expect(componentPreview).not.toHaveBeenCalled();
    expect(within(screen.getByRole("region", { name: "Controls" })).getByText("No controls for this entry")).toBeInTheDocument();
  });

  it("drives the renderer from uncontrolled controls and resets them when the entry changes", async () => {
    media(); const onConfigChange = vi.fn();
    render(<CatalogBrowser {...base} defaultSelection={{ catalog: "components", entryId: "act.button" }} onConfigChange={onConfigChange} />);
    const controls = screen.getByRole("region", { name: "Controls" });
    await userEvent.click(within(controls).getByRole("switch", { name: "Disabled" }));
    expect(onConfigChange).toHaveBeenLastCalledWith({ tone: "primary", disabled: true, text: "Save" });
    expect(screen.getByTestId("preview")).toHaveTextContent("components:act.button:primary:true:Save");
    await userEvent.click(within(controls).getByRole("button", { name: /Tone/ }));
    await userEvent.click(screen.getByRole("option", { name: "Quiet" }));
    const text = within(controls).getByRole("textbox", { name: "Text" });
    await userEvent.clear(text); await userEvent.type(text, "Go");
    expect(screen.getByTestId("preview")).toHaveTextContent("components:act.button:quiet:true:Go");
    await userEvent.click(within(controls).getByRole("button", { name: "Reset controls" }));
    expect(screen.getByTestId("preview")).toHaveTextContent("components:act.button:primary:false:Save");
    await userEvent.click(within(controls).getByRole("switch", { name: "Disabled" }));
    await userEvent.click(row("Icon button"));
    expect(within(screen.getByRole("region", { name: "Controls" })).getByText("No controls for this entry")).toBeInTheDocument();
    await userEvent.click(row("Button"));
    expect(screen.getByTestId("preview")).toHaveTextContent("components:act.button:primary:false:Save");
  });

  it("follows controlled config and selection, filling missing control ids with defaults", async () => {
    media(); const onConfigChange = vi.fn(); const onSelectionChange = vi.fn();
    const { rerender } = render(<CatalogBrowser {...base} selection={{ catalog: "components", entryId: "act.button" }} onSelectionChange={onSelectionChange}
      config={{ tone: "quiet" }} onConfigChange={onConfigChange} />);
    expect(screen.getByTestId("preview")).toHaveTextContent("components:act.button:quiet:false:Save");
    await userEvent.click(screen.getByRole("switch", { name: "Disabled" }));
    expect(onConfigChange).toHaveBeenLastCalledWith({ tone: "quiet", disabled: true, text: "Save" });
    expect(screen.getByTestId("preview")).toHaveTextContent("components:act.button:quiet:false:Save");
    await userEvent.click(row("Icon button"));
    expect(onSelectionChange).toHaveBeenLastCalledWith({ catalog: "components", entryId: "act.icon-button" });
    expect(row("Button")).toHaveAttribute("aria-selected", "true");
    rerender(<CatalogBrowser {...base} selection={{ catalog: "themes", entryId: "--color-blue-500" }} config={{}} />);
    expect(tokenPreview).toHaveBeenLastCalledWith(tokens.entries[1], { kind: "themes", config: {} });
    expect(row("Blue 500")).toHaveAttribute("aria-selected", "true");
  });

  it("works as a fully host-controlled page", async () => {
    media();
    function Host() {
      const [selection, setSelection] = useState<CatalogBrowserSelection>({ catalog: "components", entryId: "act.button" });
      const [config, setConfig] = useState<CatalogBrowserConfig>({});
      return <CatalogBrowser {...base} selection={selection} onSelectionChange={setSelection} config={config} onConfigChange={setConfig} />;
    }
    render(<Host />);
    await userEvent.click(screen.getByRole("switch", { name: "Disabled" }));
    expect(screen.getByTestId("preview")).toHaveTextContent("components:act.button:primary:true:Save");
    await userEvent.click(screen.getByRole("tab", { name: /Tokens/ }));
    expect(screen.getByRole("heading", { name: "Select an entry" })).toBeVisible();
    expect(rowNames()).toEqual(["Color"]);
  });

  it("keeps a selected parked or filtered-out entry listed", async () => {
    media(); render(<CatalogBrowser {...base} defaultSelection={{ catalog: "components", entryId: "show.badge" }} />);
    expect(row("Badge")).toHaveAttribute("aria-selected", "true");
    await userEvent.type(screen.getByRole("searchbox"), "link");
    expect(rowNames()).toEqual(["Act", "Links", "Link", "Show", "Status", "Badge"]);
  });

  it("reveals an already-selected entry once its catalog loads or its entries arrive", () => {
    media(); const selection = { catalog: "components", entryId: "act.link" };
    const loading = render(<CatalogBrowser {...base} catalogs={[]} isLoading defaultSelection={selection} />);
    loading.rerender(<CatalogBrowser {...base} defaultSelection={selection} />);
    expect(row("Act")).toHaveAttribute("aria-expanded", "true");
    expect(row("Links")).toHaveAttribute("aria-expanded", "true");
    expect(row("Link")).toHaveAttribute("aria-selected", "true");
    loading.unmount();
    const empty = render(<CatalogBrowser {...base} catalogs={[{ ...components, entries: [] }]} defaultSelection={selection} />);
    expect(row("Act")).toHaveAttribute("aria-expanded", "false");
    empty.rerender(<CatalogBrowser {...base} catalogs={[components]} defaultSelection={selection} />);
    expect(row("Act")).toHaveAttribute("aria-expanded", "true");
    expect(row("Link")).toHaveAttribute("aria-selected", "true");
  });

  it("reveals again when a reference returns to the last revealed entry after tree selections", async () => {
    media(); render(<CatalogBrowser {...base} defaultSelection={{ catalog: "components", entryId: "act.button" }} />);
    const usedBy = () => within(screen.getByRole("region", { name: "Used by" }));
    await userEvent.click(usedBy().getByRole("button", { name: "Icon button" }));
    await userEvent.click(row("Button"));
    await userEvent.click(row("Act"));
    expect(row("Act")).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(usedBy().getByRole("button", { name: "Icon button" }));
    expect(row("Act")).toHaveAttribute("aria-expanded", "true");
    expect(row("Icon button")).toHaveAttribute("aria-selected", "true");
  });

  it("reopens a collapsed group when a reference selects another entry in that group", async () => {
    media(); render(<CatalogBrowser {...base} defaultSelection={{ catalog: "components", entryId: "act.button" }} />);
    await userEvent.click(row("Buttons"));
    expect(row("Buttons")).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(within(screen.getByRole("region", { name: "Used by" })).getByRole("button", { name: "Icon button" }));
    expect(row("Buttons")).toHaveAttribute("aria-expanded", "true");
    expect(row("Icon button")).toHaveAttribute("aria-selected", "true");
  });

  it("keeps the tree, its focus and arrow navigation when a keyboard selection drops retained groups", async () => {
    media(); render(<CatalogBrowser {...base} defaultSelection={{ catalog: "components", entryId: "show.badge" }} />);
    await userEvent.type(screen.getByRole("searchbox"), "link");
    const explorer = tree();
    act(() => row("Link").focus());
    await userEvent.keyboard("{Enter}");
    expect(row("Link")).toHaveAttribute("aria-selected", "true");
    expect(rowNames()).toEqual(["Act", "Links", "Link"]);
    expect(tree()).toBe(explorer);
    expect(row("Link")).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(row("Links")).toHaveFocus();
  });

  it("reveals a host selection of an entry whose earlier tree request the host ignored", async () => {
    media(); const onSelectionChange = vi.fn();
    const view = render(<CatalogBrowser {...base} selection={{ catalog: "components", entryId: "act.button" }} onSelectionChange={onSelectionChange} />);
    await userEvent.click(row("Icon button"));
    expect(onSelectionChange).toHaveBeenLastCalledWith({ catalog: "components", entryId: "act.icon-button" });
    expect(row("Button")).toHaveAttribute("aria-selected", "true");
    await userEvent.click(row("Buttons"));
    expect(row("Buttons")).toHaveAttribute("aria-expanded", "false");
    view.rerender(<CatalogBrowser {...base} selection={{ catalog: "components", entryId: "act.icon-button" }} onSelectionChange={onSelectionChange} />);
    expect(row("Buttons")).toHaveAttribute("aria-expanded", "true");
    expect(row("Icon button")).toHaveAttribute("aria-selected", "true");
  });

  it("keeps the tree and its focus when a host takes a tree selection", async () => {
    media();
    function Host() {
      const [selection, setSelection] = useState<CatalogBrowserSelection>({ catalog: "components", entryId: "act.button" });
      return <CatalogBrowser {...base} selection={selection} onSelectionChange={setSelection} />;
    }
    render(<Host />);
    const explorer = tree();
    act(() => row("Icon button").focus());
    await userEvent.keyboard("{Enter}");
    expect(row("Icon button")).toHaveAttribute("aria-selected", "true");
    expect(tree()).toBe(explorer);
    expect(row("Icon button")).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(row("Button")).toHaveFocus();
  });

  it("treats prototype member names as ordinary catalog kinds", async () => {
    media(); const names = ["constructor", "toString", "__proto__", "hasOwnProperty"];
    const named = names.map(kind => ({
      kind, groups: [{ id: "__proto__", label: `${kind} group`, children: [{ id: "constructor", label: `${kind} set` }] }],
      entries: [{ id: "toString", label: `${kind} entry`, l1: "__proto__", l2: "constructor", lifecycle: "stable" as const }],
    }));
    const bindings = Object.fromEntries(names.map(kind => [kind, { label: `Kind ${kind}`, preview: () => <p>{kind}</p> }]));
    render(<CatalogBrowser {...base} catalogs={named} kinds={bindings as never} />);
    for (const kind of names) {
      await userEvent.click(screen.getByRole("tab", { name: `Kind ${kind} 1` }));
      expect(row(`${kind} group`)).toHaveAccessibleDescription("1 entries");
      await userEvent.type(screen.getByRole("searchbox"), "entry");
      expect(rowNames()).toEqual([`${kind} group`, `${kind} set`, `${kind} entry`]);
    }
  });

  it("treats prototype member names as ordinary filter ids before and after a choice", async () => {
    media();
    const filters = ["constructor", "toString", "__proto__", "hasOwnProperty"].map(id => ({
      id, label: `Filter ${id}`, options: [{ id: "main", label: "On main" }, { id: "gap", label: "Gap" }], value: (entry: ComponentEntry) => entry.status,
    }));
    render(<CatalogBrowser {...base} kinds={{ ...kinds, components: { ...componentKind, filters } }} />);
    expect(row("Act")).toHaveAccessibleDescription("3 entries");
    for (const filter of filters) expect(screen.getByRole("button", { name: new RegExp(`Filter ${filter.id}`) })).toHaveTextContent("Any");
    await userEvent.click(screen.getByRole("button", { name: /Filter __proto__/ }));
    await userEvent.click(screen.getByRole("option", { name: "Gap" }));
    expect(rowNames()).toEqual(["Act", "Links", "Link"]);
  });

  it("alerts for an unknown entry id and shows the overview or empty states", () => {
    media(); const { rerender } = render(<CatalogBrowser {...base} defaultSelection={{ catalog: "components", entryId: "gone" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("No entry gone");
    rerender(<CatalogBrowser {...base} selection={{ catalog: "components", entryId: null }} kinds={{ ...kinds, components: { ...componentKind, overview: <p>Components overview</p> } }} />);
    expect(screen.getByText("Components overview")).toBeVisible();
    rerender(<CatalogBrowser {...base} catalogs={[{ ...tokens, entries: [] }]} kinds={kinds} />);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "This catalog is empty" })).toBeVisible();
  });

  it("shows loading and error states without requiring catalogs", () => {
    media(); const { rerender } = render(<CatalogBrowser {...base} catalogs={[]} isLoading />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading catalog");
    expect(screen.getByRole("region", { name: "Design catalog" })).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("tree")).not.toBeInTheDocument();
    rerender(<CatalogBrowser {...base} catalogs={[]} error={<p role="alert">Could not load</p>} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it.each([
    ["no catalogs", { catalogs: [] }],
    ["duplicate kinds", { catalogs: [components, components] }],
    ["a missing kind binding", { kinds: { components: componentKind } }],
    ["an inherited kind binding", { catalogs: [{ ...tokens, kind: "constructor" }] }],
    ["an unplaced entry", { catalogs: [{ ...tokens, entries: [{ ...tokens.entries[0]!, l2: "nowhere" }] }] }],
    ["a duplicate entry id", { catalogs: [{ ...tokens, entries: [tokens.entries[0]!, tokens.entries[0]!] }] }],
    ["a reserved filter option", { kinds: { ...kinds, components: { ...componentKind, filters: [{ id: "f", label: "F", options: [{ id: "catalog-browser-any", label: "X" }], value: () => undefined }] } } }],
    ["a missing label", { labels: { ...labels, resetControls: "" } }],
  ])("refuses %s with a TypeError", (_name, override) => {
    expect(() => render(<CatalogBrowser {...base} {...(override as object)} />)).toThrow(TypeError);
  });

  it("server-renders and hydrates without recoverable errors", async () => {
    media(); const errors: unknown[] = []; const container = document.createElement("div"); document.body.append(container);
    const element = <CatalogBrowser {...base} defaultSelection={{ catalog: "components", entryId: "act.button" }} />;
    container.innerHTML = renderToString(element);
    expect(container.textContent).toContain("components:act.button:primary:false:Save");
    let root: ReturnType<typeof hydrateRoot>;
    await act(async () => { root = hydrateRoot(container, element, { onRecoverableError: error => errors.push(error) }); });
    expect(errors).toEqual([]);
    await act(async () => root!.unmount()); container.remove();
  });

  it("keeps shipped source inside the native token-purity gate without ignore markers", () => {
    const main = extractStyleCandidates(readFileSync(resolve(import.meta.dirname, "CatalogBrowser.tsx"), "utf8"), "CatalogBrowser.tsx");
    const nested = scanStyleSources(resolve(import.meta.dirname, "catalog-browser"));
    const result = checkTokenPurity([...main.candidates, ...nested.candidates], TOKENS, nested.filesScanned + 1, [...main.unchecked, ...nested.unchecked]);
    expect(result.findings).toEqual([]); expect(result.ignored).toEqual([]); expect(result.unchecked).toEqual([]);
  });
});
