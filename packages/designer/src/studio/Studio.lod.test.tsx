import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { render } from "./__fixtures__/frame.js";
import { Studio } from "./index.js";
import { smallCatalog, labels, emptyLibrary } from "./__fixtures__/studio.js";
import { TOKENS } from "../tokens/tokens.js";

afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });
const OWNER = "../blocks/canvas/CanvasLod.js";
const owner = (): Promise<typeof import("../blocks/canvas/CanvasLod.js")> => import(/* @vite-ignore */ OWNER);
const sweep = Array.from({ length: 189 }, (_, index) => Math.round((.12 + index * .01) * 100) / 100);

describe("canvas level-of-detail owner", () => {
  it("defines exactly three tiers, every one reachable between the Studio zoom limits", async () => {
    const { CANVAS_LOD_TIERS, canvasLodTier } = await owner();
    expect(CANVAS_LOD_TIERS).toHaveLength(3);
    expect(new Set(sweep.map(canvasLodTier))).toEqual(new Set(CANVAS_LOD_TIERS));
    expect(canvasLodTier(.12)).toBe(CANVAS_LOD_TIERS.at(-1)); expect(canvasLodTier(2)).toBe(CANVAS_LOD_TIERS[0]);
  });
  it("switches by on-screen legibility of each tier's text token, not by fixed zoom numbers", async () => {
    const { CANVAS_LOD_TIERS, CANVAS_LOD_TEXT, CANVAS_LEGIBLE_TEXT_PX, canvasLodTier } = await owner();
    const px = (token: string) => Number.parseFloat(TOKENS[token]!.value);
    for (const zoom of sweep) {
      // The most detailed tier whose own smallest text stays legible at this zoom.
      const legible = CANVAS_LOD_TIERS.find(tier => px(CANVAS_LOD_TEXT[tier]) * zoom >= CANVAS_LEGIBLE_TEXT_PX) ?? CANVAS_LOD_TIERS.at(-1);
      expect(canvasLodTier(zoom), `zoom ${zoom}`).toBe(legible);
    }
  });
});

const mount = async () => { render(<Studio catalog={smallCatalog} adapter={{ load: async () => ({ library: emptyLibrary() }), save: async () => ({ ok: false, reason: "unavailable" }) }} labels={labels} />); await screen.findByRole("link", { name: "Tokens" }); };
const tier = () => document.querySelector<HTMLElement>("[data-studio-world] [data-canvas-lod]")?.dataset.canvasLod;
const press = (name: string, times: number) => { for (let index = 0; index < times; index += 1) act(() => { fireEvent.click(screen.getByRole("button", { name })); }); };
const OUT_OF_FLOW = /(?:^|\s)(?:absolute|fixed|sticky|float-[a-z]+|inset-\S+|top-\S+|-?translate-\S+)(?:\s|$)/;
const CLIPPING = /(?:^|\s)(?:overflow-(?:hidden|clip|auto|scroll)|text-clip|truncate|line-clamp-\S+|max-h-\S+|h-\[[^\]]+\]|h-\d+)(?:\s|$)/;

describe("Studio boards across canvas tiers", () => {
  it("reaches all three tiers through the camera and keeps every board's outer box", async () => {
    await mount();
    const board = document.querySelector<HTMLElement>("[data-studio-world] [data-studio-board]")!;
    const outer = () => ({ className: board.className, style: board.getAttribute("style"), hidden: board.hidden, layers: [...board.querySelectorAll<HTMLElement>("[data-canvas-lod-layer]")].map(layer => [layer.dataset.canvasLodLayer, layer.hidden, layer.style.gridArea, layer.style.display]) });
    const seen = new Map<string, ReturnType<typeof outer>>();
    press(labels.canvas.zoomIn, 20); seen.set(tier()!, outer());
    for (let step = 0; step < 25; step += 1) { press(labels.canvas.zoomOut, 1); seen.set(tier()!, outer()); }
    expect([...seen.keys()].sort()).toEqual(["compact", "full", "overview"]);
    const [first, ...rest] = [...seen.values()];
    for (const box of rest) expect(box).toEqual(first);
    expect(first!.layers.map(layer => layer[0])).toEqual(["full", "compact", "overview"]);
    expect(first!.layers.every(layer => layer[1] === false)).toBe(true);
  });
  it("shows only the active tier, with Open in the overview tier alone and no overlap or clipping", async () => {
    await mount();
    press(labels.canvas.zoomOut, 25); expect(tier()).toBe("overview");
    const board = document.querySelector<HTMLElement>("[data-studio-world] [data-studio-board]")!;
    const name = board.querySelector("h3")!.textContent!;
    const open = screen.getAllByRole("button", { name: labels.canvas.openBoard(name), hidden: true }).filter(button => board.contains(button));
    expect(open).toHaveLength(1);
    expect(open[0]!.closest("[data-canvas-lod-layer]")).toHaveAttribute("data-canvas-lod-layer", "overview");
    const overview = board.querySelector<HTMLElement>('[data-canvas-lod-layer="overview"]')!;
    const summary = [...overview.querySelectorAll("p")].find(p => p.textContent!.startsWith("L-check"))!;
    expect(summary).toBeDefined();
    // Summary text and Open are siblings in one flowing flex column with a gap.
    const column = summary.parentElement!;
    expect(column.contains(open[0]!)).toBe(true);
    expect(column).toHaveClass("flex", "flex-col");
    expect(column.className).toMatch(/(?:^|\s)gap-\S+/);
    for (let node: HTMLElement | null = summary; node && node !== board.parentElement; node = node.parentElement) expect(node.className, node.outerHTML.slice(0, 80)).not.toMatch(OUT_OF_FLOW);
    for (let node: HTMLElement | null = open[0]!; node && node !== board.parentElement; node = node.parentElement) expect(node.className).not.toMatch(OUT_OF_FLOW);
    for (const element of [board, ...board.querySelectorAll<HTMLElement>('[data-canvas-lod-layer="compact"] *, [data-canvas-lod-layer="overview"] *, [data-canvas-lod-layer]')]) {
      expect(element.className, element.outerHTML.slice(0, 80)).not.toMatch(CLIPPING);
      expect(element.style.overflow).toBe("");
    }
    for (const layer of board.querySelectorAll<HTMLElement>("[data-canvas-lod-layer]")) {
      const active = layer.dataset.canvasLodLayer === "overview";
      expect(layer.hasAttribute("inert")).toBe(!active);
      expect(layer.getAttribute("aria-hidden")).toBe(active ? null : "true");
      expect(layer.style.opacity).toBe(active ? "1" : "0");
    }
    press(labels.canvas.zoomIn, 25); expect(tier()).toBe("full");
    expect(screen.queryByRole("button", { name: labels.canvas.openBoard(name) })).toBeNull();
    expect(board.querySelector('[data-canvas-lod-layer="full"]')).not.toHaveAttribute("inert");
  });
});
