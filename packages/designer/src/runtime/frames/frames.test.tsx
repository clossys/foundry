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
const draw = (leaf: string, options?: Parameters<typeof input>[1]) => render(<>{surfaceRuntimeRenderers[leaf]!.render(input(leaf, options))}</>);

describe("designer Frame runtime renderers", () => {
  it("cover every designer-owned Frames leaf; site-shell stays publisher-owned", () => {
    const designerLeaves = (slots as readonly { id: string }[]).map(slot => slot.id).filter(id => FOUNDRY_FRAME_MAP[id.slice("frames.".length)]!.package === "@clossys/designer");
    expect(Object.keys(frameRenderers).sort()).toEqual(designerLeaves.sort());
    expect(designerLeaves).toHaveLength(8);
    expect(frameRenderers["frames.site-shell"]).toBeUndefined();
  });

  it("renders each leaf's real package export from its sample content", async () => {
    draw("frames.site-header");
    expect(document.querySelector("header[data-header-root]")).toHaveAttribute("data-surface", "solid");
    expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute("href", "#start");
    cleanup(); draw("frames.site-footer");
    expect(document.querySelector("footer[data-footer-root]")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Company" })).toBeInTheDocument();
    cleanup(); draw("frames.app-header");
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    cleanup(); draw("frames.app-sidebar");
    expect(screen.getByRole("navigation", { name: specimenDataset.navigation.label })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New page" })).toBeInTheDocument();
    cleanup(); draw("frames.inspector");
    expect(screen.getByRole("complementary", { name: specimenDataset.card.title })).toHaveTextContent(specimenDataset.card.content);
    // wide.dismiss (the Drawer default) closes the sheet at the wide breakpoint the stub reports; wide.sheet keeps it.
    cleanup(); draw("frames.sheet", { members: ["placement.end", "wide.sheet"] });
    await userEvent.click(screen.getByRole("button", { name: specimenDataset.dialog.trigger }));
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent(specimenDataset.dialog.body));
    cleanup(); draw("frames.command");
    await userEvent.click(screen.getByRole("button", { name: "Open command menu" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(screen.getByText(specimenDataset.menu.label)).toBeInTheDocument();
  });

  it("swapping selected members visibly changes the rendered Frame", () => {
    draw("frames.site-header", { members: ["surface.glass", "tone.inverse", "nav-placement.leading"] });
    expect(document.querySelector("header[data-header-root]")).toMatchObject({ dataset: expect.objectContaining({ surface: "glass", tone: "inverse" }) });
    cleanup(); draw("frames.inspector", { members: ["presentation.overlay"] });
    // Overlay presentation: the same content opens as an end-placed sheet instead of a docked aside.
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.getByRole("dialog")).toHaveTextContent(specimenDataset.card.content);
    expect(screen.getByRole("button", { name: "Hide details" })).toBeInTheDocument();
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
