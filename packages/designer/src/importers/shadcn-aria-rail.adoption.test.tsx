import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button as AriaButton } from "react-aria-components";
import { readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { loadCatalogBundles, installedHeadlessLibrary } from "../catalog-bundles.js";
import { loadCatalog, loadComponentRegistry, type LibraryData, type CompositeLibraryData } from "../catalog-core/index.js";
import { applyLibraryChange, libraryHash, resolve } from "../catalog-core/api.js";
import { emittedTokenProperties } from "../catalog-core/emit.js";
import { planComponentDefaults } from "../catalog-core/component-defaults.js";
import { applyDecisions } from "../library-cli/apply-decisions.js";
import { componentOf } from "../catalog-core/resolve-components.js";
import { importShadcnAriaRail, SHADCN_ARIA_RAIL_ITEMS } from "./shadcn-aria-rail.js";
import { SidebarProvider, Sidebar, SidebarTrigger, SidebarRail } from "../components/sidebar/index.js";
import { Command, CommandDialog, CommandInput, CommandList, CommandItem } from "../components/command/index.js";
import { SheetTrigger, Sheet, SheetTitle } from "../components/sheet/index.js";
import { Empty, EmptyTitle, EmptyDescription } from "../components/empty/index.js";
import { Item, ItemTitle } from "../components/item/index.js";
import { ScrollArea } from "../components/scroll-area/index.js";
import { DropdownMenuTrigger, DropdownMenu, DropdownMenuItem } from "../components/dropdown-menu/index.js";
import { DialogFooter } from "../components/_parts/rail-dialog/dialog.js";
import adaptations from "./vendor/shadcn-aria-rail.adapters.json" with { type: "json" };
import { Kbd } from "../components/preview-runtime/components/keyboard/kbd.js";
const drafts = JSON.parse(readFileSync(pathResolve(import.meta.dirname, "../../../writer/src/catalog/records/admin-studio.r1.en.json"), "utf8"));
const draftResolver = (ref: { readonly id: string }) => {
  const record = drafts.records.find((row: { id: string }) => row.id === ref.id);
  if (!record || record.status !== "draft") throw new Error(`Missing Writer draft ${ref.id}`);
  return { ref, text: record.text as string };
};
const toggleLabel = draftResolver({ id: "st.qbaewx3e0y" }).text;


function adoption() {
  const values = loadCatalog(), bundles = loadCatalogBundles(), registry = loadComponentRegistry();
  const changes = values.slots.filter(slot => slot.layer === "themes" || slot.id.startsWith("assets.icon-")).flatMap(slot => {
    const offers = values.fills.filter(doc => doc.$extensions["com.clossys.fill"].slot === slot.id && doc.$extensions["com.clossys.fill"].mode !== "reference");
    const offer = ["foundry", "tailwind-default", "lucide"].flatMap(source => offers.filter(doc => doc.$extensions["com.clossys.fill"].source === source))[0] ?? offers[0];
    return offer ? [{ op: "adopt" as const, slot: slot.id, source: offer.$extensions["com.clossys.fill"].source }] : [];
  });
  const source = { kind: "consumer", author: "consumer", id: "rail-consumer" } as LibraryData["source"];
  const library = applyLibraryChange(values, { source, fills: [], adoptedAt: "2026-10-28" }, { baseHash: libraryHash({ source, fills: [], adoptedAt: "2026-10-28" }), changes });
  const profile = resolve({ catalog: values, library });
  const literal = (id: string): string => { let member = profile.members[id]!; while (member.alias.light) member = profile.members[member.alias.light]!; return member.css.light; };
  const tokens = Object.fromEntries([...emittedTokenProperties(profile)].map(([id, output]) => [id, { property: output.property, light: literal(id) }]));
  const assets = [...new Set(Object.values(profile.members).filter(member => member.slot.startsWith("assets.")).map(member => member.slot))];
  const catalog = { slots: registry.slots, fills: bundles.componentFills };
  const slots = [...SHADCN_ARIA_RAIL_ITEMS.map(item => `components.${item === "kbd" ? "keyboard" : item}`), "components.icon"];
  const plan = planComponentDefaults({ catalog, slots, tokens, assets, installedRac: installedHeadlessLibrary(), bundles: bundles.sourceBundles, preference: ["shadcn@aria", "foundry"] });
  const empty: CompositeLibraryData = { source, adoptedAt: "2026-10-28", values: { fills: [] }, components: { fills: [], files: [] } };
  const adopted = applyDecisions({ values, components: catalog }, empty, plan.decisions, { bundles: bundles.sourceBundles });
  return { plan, adopted, bundles };
}
let selected: ReturnType<typeof adoption>;
beforeAll(() => { selected = adoption(); });
beforeEach(() => {
  document.documentElement.style.setProperty("--breakpoint-mobile-lg", "48rem");
  document.documentElement.style.fontSize = "16px";
  Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn().mockImplementation(query => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
});

const interactions: Record<string, () => Promise<void>> = {
  sidebar: async () => { const user = userEvent.setup(); const { container } = render(<SidebarProvider><Sidebar collapsible="icon" copyResolver={draftResolver}><SidebarTrigger copyResolver={draftResolver} /></Sidebar></SidebarProvider>); expect(container.querySelector('[data-state="expanded"]')).toBeTruthy(); await user.click(screen.getByRole("button", { name: toggleLabel })); expect(container.querySelector('[data-state="collapsed"]')).toBeTruthy(); },
  command: async () => { const user = userEvent.setup(), action = vi.fn(); render(<Command><CommandInput aria-label="Find command" copyResolver={draftResolver} /><CommandList aria-label="Commands" onAction={action}><CommandItem id="run">Run</CommandItem><CommandItem id="stop">Stop</CommandItem></CommandList></Command>); await user.type(screen.getByRole("searchbox"), "Run"); await user.keyboard("{ArrowDown}{ArrowUp}{Enter}"); expect(action).toHaveBeenCalledWith("run", undefined); action.mockClear(); await user.click(screen.getByRole("menuitem", { name: "Run" })); expect(action).toHaveBeenCalledWith("run", undefined); },
  sheet: async () => { const user = userEvent.setup(); render(<SheetTrigger><AriaButton>Open panel</AriaButton><Sheet copyResolver={draftResolver}><SheetTitle>Panel</SheetTitle></Sheet></SheetTrigger>); await user.click(screen.getByRole("button", { name: "Open panel" })); expect(screen.getByRole("dialog", { name: "Panel" })).toBeInTheDocument(); await user.click(screen.getByRole("button", { name: "Close" })); await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument()); },
  empty: async () => { render(<Empty aria-label="Empty inbox"><EmptyTitle>No messages</EmptyTitle><EmptyDescription>Compose a message.</EmptyDescription></Empty>); expect(screen.getByLabelText("Empty inbox")).toHaveTextContent("No messagesCompose a message."); },
  item: async () => { render(<Item href="/details"><ItemTitle>Details</ItemTitle></Item>); expect(screen.getByRole("link", { name: "Details" })).toHaveAttribute("href", "/details"); },
  "scroll-area": async () => { const scroll = vi.fn(); render(<ScrollArea role="region" aria-label="History" tabIndex={0} onScroll={scroll}>Earlier messages</ScrollArea>); const region = screen.getByRole("region", { name: "History" }); region.focus(); expect(region).toHaveFocus(); fireEvent.scroll(region, { target: { scrollTop: 20 } }); expect(scroll).toHaveBeenCalled(); },
  "dropdown-menu": async () => { const user = userEvent.setup(), action = vi.fn(); render(<DropdownMenuTrigger><AriaButton>Actions</AriaButton><DropdownMenu aria-label="Actions" onAction={action}><DropdownMenuItem id="save">Save</DropdownMenuItem></DropdownMenu></DropdownMenuTrigger>); await user.click(screen.getByRole("button", { name: "Actions" })); await user.click(screen.getByRole("menuitem", { name: "Save" })); expect(action).toHaveBeenCalledWith("save", undefined); },
  kbd: async () => { render(<Kbd>Esc</Kbd>); expect(screen.getByText("Esc").tagName).toBe("KBD"); },
};

describe("official Aria rail adoption", () => {
  it.each(SHADCN_ARIA_RAIL_ITEMS)("adopts and executes %s through its registered leaf", async item => {
    const slot = `components.${item === "kbd" ? "keyboard" : item}`;
    expect(selected.plan.rows.find(row => row.slot === slot)).toMatchObject({ status: "default", source: "shadcn@aria" });
    const doc = selected.adopted.components.fills.find(doc => componentOf(doc).slot === slot);
    expect(doc, slot).toBeDefined();
    const fill = componentOf(doc!);
    expect(selected.adopted.components.files.some(file => file.path === fill.impl.entry)).toBe(true);
    const upstream = importShadcnAriaRail().rewrites[item]!;
    expect(upstream.issues).toEqual([]);
    if (item !== "kbd") {
      const descriptor = selected.bundles.componentFills.find(doc => doc.$extensions["com.clossys.fill"].slot === slot)!;
      expect(descriptor.$extensions["com.clossys.fill"].status).toBe("draft");
      const emitted = upstream.files.find(file => file.path === fill.impl.entry)!;
      const compiled = readFileSync(pathResolve(import.meta.dirname, "..", emitted.path), "utf8");
      expect(compiled).toBe(emitted.content.replace(/((?:from\s*|import\s*)["'])(\.[^"']+)(["'])/g, (_m,a,s,b) => a+s+(/\.(js|json)$/.test(s) ? "" : ".js")+b));
    }
    await interactions[item]!();
  });
});

it("resolves every new component chrome identity through actual Writer-backed copy ports", async () => {
  const requested = new Set<string>();
  const resolver = (ref: { readonly id: string }) => { requested.add(ref.id); return draftResolver(ref); };
  const text = (key: string) => draftResolver(adaptations.copy.find(row => row.key === key)!.ref).text;
  const user = userEvent.setup();
  render(<CommandDialog open showCloseButton copyResolver={resolver}><Command><CommandInput copyResolver={resolver} /><CommandList aria-label="Commands"><CommandItem id="run">Run</CommandItem></CommandList></Command><DialogFooter showCloseButton copyResolver={resolver} /></CommandDialog>);
  expect(await screen.findByRole("dialog", { name: text("command.title") })).toBeInTheDocument();
  expect(screen.getByRole("searchbox", { name: text("command.search") })).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: text("sheet.close") })).toHaveLength(2);
  cleanup();
  render(<SheetTrigger><AriaButton>Open panel</AriaButton><Sheet copyResolver={resolver}><SheetTitle>Panel</SheetTitle></Sheet></SheetTrigger>);
  await user.click(screen.getByRole("button", { name: "Open panel" }));
  await user.click(screen.getByRole("button", { name: text("sheet.close") }));
  cleanup();
  const previousWidth = window.innerWidth;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 400 });
  try {
  const { container } = render(<SidebarProvider><Sidebar copyResolver={resolver} /><SidebarTrigger copyResolver={resolver} /><SidebarRail copyResolver={resolver} /></SidebarProvider>);
  await user.click(container.querySelector('[data-slot="sidebar-trigger"]') as HTMLElement);
  expect(await screen.findByRole("dialog", { name: text("sidebar.title") })).toBeInTheDocument();
  expect(screen.getByText(text("sidebar.description"))).toBeInTheDocument();
  expect([...requested].sort()).toEqual(adaptations.copy.map(row => row.ref.id).sort());
  } finally {
    cleanup();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: previousWidth });
  }
});
