// @vitest-environment jsdom
/** Frame runtime renderers: every designer Frames leaf renders its real package export from fill JSON. */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import slots from "../../catalog/slots/frames.json" with { type: "json" };
import type { RuntimeFrameHost, RuntimeJson, RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";
import { FOUNDRY_FRAME_MAP } from "../../importers/foundry-frames.map.js";
import { surfaceRuntimeRenderers } from "../index.js";
import { frameRenderers } from "./index.js";
import { ShellCopyProvider } from "../../components/Banner.copy-context.js";
import { shellCopyFixtureResolver } from "../../frames/__fixtures__/shell-copy.js";
import { appHeaderProps } from "./app-header.js";

beforeEach(() => {
  vi.stubGlobal("matchMedia", (media: string) => ({ media, matches: media.includes("min-width"), addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const contentOf = (values: Readonly<Record<string, RuntimeJson>>) => Object.fromEntries(Object.entries(values).map(([slot, value]) => [slot, { reference: { kind: "region" as const, ref: `content:${slot}` }, value, hash: "sha256:0" as const }]));
function input(leaf: string, options: { members?: string[]; host?: RuntimeFrameHost<ReactNode>; content?: Readonly<Record<string, RuntimeJson>> } = {}): RuntimeRenderInput<ReactNode> {
  const entry = surfaceRuntimeRenderers[leaf]!;
  return {
    path: "frame", fill: { leaf }, cell: { theme: "light", state: "default", width: 1280 }, profile: {}, slots: {},
    selection: { leaf, fill: `foundry/${leaf}`, config: null, members: options.members ?? [], content: {} },
    content: contentOf(options.content ?? entry.sample(specimenDataset)), ...(options.host ? { host: options.host } : {}),
  } as unknown as RuntimeRenderInput<ReactNode>;
}
const F = specimenDataset.frames;
const draw = (leaf: string, options?: Parameters<typeof input>[1]) => render(<ShellCopyProvider resolver={shellCopyFixtureResolver}>{surfaceRuntimeRenderers[leaf]!.render(input(leaf, options))}</ShellCopyProvider>);

describe("designer Frame runtime renderers", () => {
  it("cover every designer-owned Frames leaf, including site-shell", () => {
    const designerLeaves = (slots as readonly { id: string }[]).map(slot => slot.id).filter(id => FOUNDRY_FRAME_MAP[id.slice("frames.".length)]!.package === "@clossys/designer");
    expect(Object.keys(frameRenderers).sort()).toEqual(designerLeaves.sort());
    expect(designerLeaves).toHaveLength(slots.length);
    expect(frameRenderers["frames.site-shell"]).toBeDefined();
  });

  it("renders each leaf's real package export from its sample content", async () => {
    draw("frames.site-header");
    expect(document.querySelector("header[data-header-root]")).toHaveAttribute("data-surface", "solid");
    expect(screen.getByRole("link", { name: F.siteHeader.actions[1].label })).toHaveAttribute("href", F.siteHeader.actions[1].href);
    cleanup(); draw("frames.site-footer");
    expect(document.querySelector("footer[data-footer-root]")).toBeInTheDocument();
    for (const column of F.siteFooter.columns) expect(screen.getByRole("heading", { name: column.heading })).toBeInTheDocument();
    cleanup(); draw("frames.app-header");
    expect(screen.getByRole("navigation", { name: F.appHeader.labels.breadcrumb })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    cleanup(); draw("frames.app-sidebar");
    expect(screen.getByRole("navigation", { name: F.appSidebar.label })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: F.appSidebarHeader.label })).toBeInTheDocument();
    cleanup(); draw("frames.inspector");
    expect(screen.getByRole("complementary", { name: F.inspector.label })).toHaveTextContent(F.inspector.body);
    // wide.dismiss (the Drawer default) closes the sheet at the wide breakpoint the stub reports; wide.sheet keeps it.
    cleanup(); draw("frames.sheet", { members: ["placement.end", "wide.sheet"] });
    await userEvent.click(screen.getByRole("button", { name: F.sheet.trigger }));
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent(F.sheet.body));
    cleanup(); draw("frames.command");
    await userEvent.click(screen.getByRole("button", { name: F.command.trigger }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    for (const group of F.command.groups) expect(screen.getByText(group.label)).toBeInTheDocument();
  });

  it("draws every Frame sample from the shared specimen dataset, never from renderer literals", () => {
    // Structural keys (ids, action commands, kinds, variants, sizes) are not copy; every other string is a dataset value.
    const STRUCTURAL = new Set(["id", "action", "kind", "variant", "size"]);
    const strings = (value: unknown, key = "", into: string[] = []): string[] => {
      if (typeof value === "string") { if (!STRUCTURAL.has(key)) into.push(value); }
      else if (Array.isArray(value)) for (const item of value) strings(item, key, into);
      else if (value && typeof value === "object") for (const [field, item] of Object.entries(value)) strings(item, field, into);
      return into;
    };
    const dataset = new Set(strings(specimenDataset));
    const records: Record<string, keyof typeof F> = {
      "frames.document": "document",
      "frames.app-shell": "app", "frames.app-header": "appHeader", "frames.app-sidebar": "appSidebar", "frames.inspector": "inspector",
      "frames.sheet": "sheet", "frames.site-header": "siteHeader", "frames.site-footer": "siteFooter", "frames.command": "command",
    };
    expect(Object.keys(records).sort()).toEqual(Object.keys(frameRenderers).filter(id => id !== "frames.site-shell").sort());
    for (const [leaf, record] of Object.entries(records)) {
      const sample = strings(surfaceRuntimeRenderers[leaf]!.sample(specimenDataset)), own = new Set(strings(F[record]));
      expect(sample.filter(value => !dataset.has(value)), leaf).toEqual([]);
      // Bound to its own frames record, not merely to some other part of the dataset.
      expect(sample.filter(value => own.has(value)).length, leaf).toBeGreaterThanOrEqual(2);
    }
  });

  it("swapping selected members visibly changes the rendered Frame", () => {
    draw("frames.site-header", { members: ["surface.glass", "tone.inverse", "nav-placement.leading"] });
    expect(document.querySelector("header[data-header-root]")).toMatchObject({ dataset: expect.objectContaining({ surface: "glass", tone: "inverse" }) });
    cleanup(); draw("frames.inspector", { members: ["presentation.overlay"] });
    // Overlay presentation: the same content opens as an end-placed sheet instead of a docked aside.
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.getByRole("dialog")).toHaveTextContent(F.inspector.body);
    expect(screen.getByRole("button", { name: F.inspector.closeLabel })).toBeInTheDocument();
    cleanup(); draw("frames.inspector", { members: ["presentation.collapsed"] });
    expect(document.querySelector("aside")).toHaveAttribute("data-collapsed", "true");
  });

  it("binds actions, panels and guarded navigation from the host port only", async () => {
    const onCommand = vi.fn(), navigate = vi.fn(), beforeNavigate = vi.fn(async () => true);
    const props = appHeaderProps(input("frames.app-header", { host: { navigate, beforeNavigate, onCommand, panels: { context: <span>Workspace</span> } } }));
    const save = props.page!.actions!.find(action => action.id === "edit") as { onAction: () => void; primary: boolean };
    save.onAction();
    expect(onCommand).toHaveBeenCalledWith("page.save");
    expect(save.primary).toBe(true);
    expect(props.context).toEqual(<span>Workspace</span>);
    await props.onNavigate!("#orders");
    expect(beforeNavigate).toHaveBeenCalledWith("#orders");
    expect(navigate).toHaveBeenCalledWith("#orders");
    draw("frames.inspector", { host: { navigate, panels: { content: <p>Host panel</p> } } });
    expect(screen.getByRole("complementary")).toHaveTextContent("Host panel");
  });

  it("refuses unmapped or incomplete content instead of inventing chrome", () => {
    const sample = (leaf: string) => surfaceRuntimeRenderers[leaf]!.sample(specimenDataset);
    expect(() => draw("frames.site-footer", { content: { ...sample("frames.site-footer"), legal: "Northwind" } })).toThrow(/frames.site-footer: legal content has no mapped prop/);
    expect(() => draw("frames.app-sidebar", { content: { ...sample("frames.app-sidebar"), account: {} } })).toThrow(/account content has no mapped prop/);
    expect(() => draw("frames.site-header", { content: { nav: sample("frames.site-header").nav! } })).toThrow(/brand content is required/);
    expect(() => draw("frames.command", { content: { ...sample("frames.command"), groups: [] } })).toThrow(/groups must list at least one group/);
    expect(() => draw("frames.sheet", { content: { heading: sample("frames.sheet").heading! } })).toThrow(/body content is required/);
  });
});
