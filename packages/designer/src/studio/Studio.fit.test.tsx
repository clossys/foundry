import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render as plainRender, screen, waitFor } from "@testing-library/react";
import { render } from "./__fixtures__/frame.js";
import { Studio } from "./index.js";
import { smallCatalog, labels, emptyLibrary } from "./__fixtures__/studio.js";
import { TOKENS } from "../tokens/tokens.js";
import { CanvasSurface } from "../blocks/canvas/CanvasSurface.js";
import { CANVAS_LOD_TEXT, CanvasLod } from "../blocks/canvas/CanvasLod.js";
import { BoardHeader } from "../blocks/library-board/LeafCell.js";
import { CanvasMap } from "../components/CanvasMap.js";
import { legibleZoomFloor, openOnFirstBoard, revealDelta, worldExtent } from "./useCanvasWorld.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, "", "/"); });
const px = (token: string) => Number.parseFloat(TOKENS[token]!.value);
const mount = async () => { render(<Studio catalog={smallCatalog} adapter={{ load: async () => ({ library: emptyLibrary() }), save: async () => ({ ok: false, reason: "unavailable" }) }} labels={labels} />); await screen.findByRole("link", { name: "Tokens" }); };
const world = () => document.querySelector<HTMLElement>("[data-studio-world]")!;
const pose = () => {
  const match = /translate\((-?[\d.e-]+)px, (-?[\d.e-]+)px\) scale\(([\d.e-]+)\)/.exec(world().style.transform)!;
  return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
};
const rect = (left: number, top: number, width: number, height: number) => ({ x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON() {} }) as DOMRect;

describe("studio canvas domain rail (VR1 studio-01/02, components-12)", () => {
  it("wide: the domain label is a rail-token-wide vertical column beside the boards, never a page-width gutter", async () => {
    await mount();
    const domain = document.querySelector<HTMLElement>("[data-studio-world] [data-studio-domain]")!;
    const label = domain.querySelector<HTMLElement>("[data-studio-domain-label]")!;
    expect(domain.dataset.studioDomainLayout).toBe("wide");
    expect(domain).toHaveClass("flex", "items-start");
    expect(domain).not.toHaveClass("flex-col");
    expect(label.className.split(/\s+/)).toContain("canvas-domain-rail");
    expect(label.className).not.toMatch(/aside-w|(?:^|\s)h-\[/);
    expect(label.nextElementSibling?.querySelector("[data-studio-board]")).not.toBeNull();
  });
  it("narrow: the label sits above a stacked list of boards, and first load opens on the first board at a legible zoom", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(390);
    const original = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.matches("[data-studio-world]")) return rect(0, 0, 2000, 4000);
      if (this.matches("[data-studio-domain]") && this === document.querySelector("[data-studio-domain]")) return rect(48, 48, 1400, 900);
      if (this.matches("[data-studio-board]") && this === document.querySelector("[data-studio-board]")) return rect(48, 90, 1200, 800);
      return original.call(this);
    });
    await mount();
    const domain = document.querySelector<HTMLElement>("[data-studio-world] [data-studio-domain]")!;
    await waitFor(() => expect(domain.dataset.studioDomainLayout).toBe("narrow"));
    expect(domain).toHaveClass("flex", "flex-col");
    expect(domain.querySelector("[data-studio-domain-label]")!.className).not.toMatch(/canvas-domain-rail|writing-mode|rail-w/);
    const gutter = px("--spacing-md"), zoom = Math.min(1, Math.max(legibleZoomFloor(), (390 - gutter * 2) / 1200));
    await waitFor(() => expect(pose().zoom).toBeCloseTo(zoom, 5));
    expect(pose().x).toBeCloseTo(gutter - 48 * zoom, 5);
    expect(pose().y).toBeCloseTo(gutter - 48 * zoom, 5);
    // The floor keeps the least detailed tier's text at the caption size on screen.
    expect(legibleZoomFloor() * px(CANVAS_LOD_TEXT.overview)).toBeCloseTo(px("--text-caption"), 5);
  });
  it("narrow opening never drops below the legible floor for a very wide first board, and never above 1:1", () => {
    const host = document.createElement("div"), worldNode = document.createElement("div");
    worldNode.innerHTML = '<section data-studio-domain="d"><h2>D</h2><section data-studio-board="b"></section></section>';
    const board = worldNode.querySelector<HTMLElement>("[data-studio-board]")!, domain = worldNode.querySelector<HTMLElement>("[data-studio-domain]")!;
    Object.defineProperty(host, "clientWidth", { value: 390, configurable: true });
    vi.spyOn(worldNode, "getBoundingClientRect").mockReturnValue(rect(0, 0, 9000, 9000));
    vi.spyOn(domain, "getBoundingClientRect").mockReturnValue(rect(48, 48, 6000, 900));
    const wide = vi.spyOn(board, "getBoundingClientRect").mockReturnValue(rect(48, 90, 6000, 800));
    expect(openOnFirstBoard(host, worldNode, { x: 0, y: 0, zoom: 1 })!.zoom).toBe(legibleZoomFloor());
    wide.mockReturnValue(rect(48, 90, 200, 800));
    expect(openOnFirstBoard(host, worldNode, { x: 0, y: 0, zoom: 1 })!.zoom).toBe(1);
  });
});

describe("fit uses the union box of the world content (VR1 components-11, assets-13, studio-15)", () => {
  it("measures laid-out children through display-contents wrappers, not the stage-stretched world box", () => {
    const host = document.createElement("div");
    host.innerHTML = '<div data-w style="padding-right:48px;padding-bottom:48px"><div data-c><section data-a></section><section data-b></section></div></div>';
    document.body.append(host);
    const define = (node: Element, values: Record<string, number>) => { for (const [name, value] of Object.entries(values)) Object.defineProperty(node, name, { value, configurable: true }); };
    const w = host.querySelector<HTMLElement>("[data-w]")!;
    define(w, { offsetWidth: 800, offsetHeight: 600 });
    define(host.querySelector("[data-c]")!, { offsetWidth: 0, offsetHeight: 0 });
    define(host.querySelector("[data-a]")!, { offsetLeft: 48, offsetTop: 48, offsetWidth: 3000, offsetHeight: 900 });
    define(host.querySelector("[data-b]")!, { offsetLeft: 48, offsetTop: 1000, offsetWidth: 1200, offsetHeight: 8700 });
    expect(worldExtent(w)).toEqual({ width: 3048 + 48, height: 9700 + 48 });
    host.remove();
  });
  it("the studio world sizes to its content on both axes", async () => {
    await mount();
    expect(world()).toHaveClass("h-max", "w-max");
  });
  it("a world that still overflows at the zoom floor starts at its origin instead of centring its beginning away", () => {
    const onViewportChange = vi.fn();
    plainRender(<CanvasSurface aria-label="Fit" viewport={{ x: 0, y: 0, zoom: 1 }} onViewportChange={onViewportChange} selection={[]} onSelectionChange={() => {}}
      items={[]} itemInteraction="content" worldBounds={{ x: 0, y: 0, width: 1000, height: 10000 }} viewSize={{ width: 800, height: 600 }} minZoom={.12} maxZoom={2} />);
    fireEvent.keyDown(screen.getByRole("region", { name: "Fit" }), { key: "0" });
    const next = onViewportChange.mock.lastCall![0];
    expect(next.zoom).toBe(.12);
    expect(next.y).toBe(0);
    expect(next.x).toBeCloseTo(400 - 500 * .12, 5);
  });
});

describe("counter-scaled board titles (VR1 sf-13, sf-14, studio-15)", () => {
  it("exposes the camera zoom to world content and binds board titles to a caption-size floor on screen", () => {
    plainRender(<CanvasLod zoom={.25}><BoardHeader id="t" title="Palettes" editing={false} labels={{ changeSelection: "Change", done: "Done" }} onEdit={() => {}} onDone={() => {}} /></CanvasLod>);
    const title = document.getElementById("t")!;
    expect(title.closest<HTMLElement>("[data-canvas-lod]")!.style.getPropertyValue("--canvas-zoom")).toBe("0.25");
    expect(title.className.split(/\s+/)).toContain("canvas-caption-zoom-floor");
  });
});

describe("keyboard focus stays inside the visible stage (VR1 studio-18)", () => {
  it("pans the smallest distance that brings a control inside the inset stage", () => {
    const inset = px("--spacing-md"), stage = rect(0, 0, 800, 600);
    expect(revealDelta(stage, rect(100, 100, 50, 20))).toEqual({ x: 0, y: 0 });
    expect(revealDelta(stage, rect(-200, 100, 50, 20))).toEqual({ x: 200 + inset, y: 0 });
    expect(revealDelta(stage, rect(100, 700, 50, 20))).toEqual({ x: 0, y: 600 - inset - 720 });
    expect(revealDelta(stage, rect(100, -40, 50, 2000))).toEqual({ x: 0, y: 40 + inset });
  });
  it("Tab focus on an off-stage control restores native scroll and pans the camera to it; programmatic board focus does not", async () => {
    await mount();
    const surface = document.querySelector<HTMLElement>("[data-studio-viewport]")!;
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue(rect(0, 0, 800, 600));
    const board = document.querySelector<HTMLElement>("[data-studio-world] [data-studio-board]")!;
    const control = board.querySelector<HTMLElement>("button")!;
    vi.spyOn(control, "getBoundingClientRect").mockReturnValue(rect(100, 900, 28, 28));
    const before = pose();
    act(() => { board.focus(); });
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
    expect(pose()).toEqual(before);
    surface.scrollTop = 0;
    act(() => { control.focus(); surface.scrollTop = 120; });
    await waitFor(() => expect(pose().y).toBeCloseTo(before.y + (600 - px("--spacing-md") - 928), 5));
    expect(surface.scrollTop).toBe(0);
  });
});

describe("board map (VR1 studio-19)", () => {
  it("clips every board to the world bounds and names it", () => {
    plainRender(<CanvasMap label="Map" bounds={{ x: 0, y: 0, width: 1000, height: 500 }} viewport={{ x: 0, y: 0, zoom: 1 }} viewSize={{ width: 200, height: 100 }} onViewportChange={() => {}}
      items={[{ id: "a", label: "Palettes", rect: { x: 900, y: 400, width: 300, height: 1994 } }, { id: "gone", rect: { x: 2000, y: 0, width: 10, height: 10 } }]} />);
    const svg = document.querySelector("svg")!;
    expect(svg).toHaveClass("overflow-hidden");
    const a = svg.querySelector<SVGRectElement>('[data-canvas-map-item="a"]')!;
    expect([a.getAttribute("x"), a.getAttribute("y"), a.getAttribute("width"), a.getAttribute("height")]).toEqual(["900", "400", "100", "100"]);
    expect(a.querySelector("title")).toHaveTextContent("Palettes");
    expect(svg.querySelector('[data-canvas-map-item="gone"]')).toBeNull();
  });
  it("the studio map names each board rectangle with its board heading", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) { return this.matches("[data-studio-board]") ? rect(10, 10, 100, 100) : rect(0, 0, 800, 600); });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(4000);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(4000);
    await mount();
    const board = document.querySelector<HTMLElement>("[data-studio-world] [data-studio-board]")!;
    const name = document.getElementById(board.getAttribute("aria-labelledby")!)!.textContent;
    await waitFor(() => expect(document.querySelector(`[data-canvas-map-item="${board.dataset.studioBoard}"] title`)).toHaveTextContent(name!));
  });
});
