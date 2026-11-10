// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { buildUsageGraph } from "../catalog-core/usage-graph.js";
import { Slider } from "../components/preview-runtime/components/slider/slider.js";
import { CanvasZoom } from "../components/CanvasZoom.js";
import type { Placement } from "../catalog-core/types.js";
import { createRouteStudioLabels } from "./route-labels.js";
import { DesignerPage } from "./system-canvas/DesignerPage.js";
import { UsagePanel } from "./usage/UsagePanel.js";
import { catalogFixture, expectOnlyResolvedCopy, pseudoStudioCopy } from "./__fixtures__/copy-hand-roll.js";

const tokenPlacement = catalogFixture<Placement>("packages/designer/src/catalog/ia/themes.json");
const color = tokenPlacement.nodes.find(node => node.id === "colors")!;
if (!("children" in color)) throw new Error("fixture.ia.colors");
const palettes = color.children.find(node => node.id === "colors-actions")!;
const placements: Placement[] = [{ layer: "themes", nodes: [{ ...color, children: [palettes] }] }];
const graph = buildUsageGraph({ inventory: { themes: ["themes.primary", "themes.destructive"] }, selection: {} });
const size = { width: 1200, height: 800 };

afterEach(() => { cleanup(); localStorage.clear(); window.history.replaceState(null, "", "/"); });

it.each(["en", "ar"])("hand-rolls a measured selected Designer page, Explorer, canvas, minimap and zoom in %s", async locale => {
  const { copy, requests } = pseudoStudioCopy(locale);
  const { container } = render(<DesignerPage copy={copy} data={{ placements }} viewSize={size} graph={graph}
    initialUrl={{ search: "?layer=themes&node=themes.primary", hash: "" }} />);
  await waitFor(() => expect(container.querySelector('[data-studio-control="zoom-reset"]')).not.toBeNull());
  // Read-only: the URL leaf is the camera's target (its cell is on the canvas, its board in the trail), never a selection.
  expect(container.querySelector('[data-system-cell="themes.primary"]')).not.toBeNull();
  expect(container.querySelector('[data-system-breadcrumb]')).not.toBeNull();
  expect(container.querySelector('[data-system-cell][data-selected], [data-selected-leaf], [data-studio-panel="inspector"]')).toBeNull();
  expect(container.querySelector('[data-studio-panel="minimap"]')).not.toBeNull();
  // Stock Slider value text: react-aria's Intl percent format of the camera zoom (R2F-33c).
  expect(container.querySelector('input[type="range"]')).toHaveAttribute("aria-valuetext", "75%");
  expect(requests.some(ref => ref.id === "st.ctpgn255tg")).toBe(true);
  expect(requests.every(ref => ref.locale === locale)).toBe(true);
  expectOnlyResolvedCopy(container);
});

it("hand-rolls Usage labels and retains an exact Need for the unrecorded WL5 producer", () => {
  const { copy } = pseudoStudioCopy();
  const props = { copy, id: "themes.primary", graph, labels: createRouteStudioLabels(copy).usage!, onNavigate: () => {} };
  const { container } = render(<UsagePanel {...props} />);
  expectOnlyResolvedCopy(container);
  expect(() => render(<UsagePanel {...props} findings={[{ code: "WL5", subject: "themes.primary", message: "untranslated host diagnostic" }]} />)).toThrow("studio.usage.finding.WL5");
});

it("hand-rolls zoom output and reset through the Writer formatter; the stock Slider speaks its Intl percent value", () => {
  const { copy, requests } = pseudoStudioCopy();
  const labels = createRouteStudioLabels(copy);
  const { container } = render(<>
    <CanvasZoom value={1.25} min={0.5} max={2} onChange={() => {}} onFit={() => {}}
      labels={{ group: labels.canvas.zoomLabel, out: labels.canvas.zoomOut, in: labels.canvas.zoomIn, fit: labels.canvas.fit, percent: labels.canvas.zoomLabel }} formatValue={labels.canvas.zoom} />
    <Slider aria-label={labels.canvas.zoomLabel} value={1.25} minValue={0.5} maxValue={2} step={0.01} onChange={() => {}} formatOptions={{ style: "percent" }} />
  </>);
  // Stock contract (R2F-33c): the thumb's value text is react-aria's Intl percent format, not Writer copy.
  expect(container.querySelector('input[type="range"]')).toHaveAttribute("aria-valuetext", "125%");
  expect(requests).toContainEqual({ id: "st.zhgkbpn8eq", locale: "en", values: { value: 125 } });
  expectOnlyResolvedCopy(container);
});

it("still refuses worded value text on a stock slider thumb", () => {
  const { container } = render(<><span>[[st.probe]]</span><div data-slot="slider-thumb"><input type="range" aria-valuetext="Zoom 125 percent" readOnly /></div></>);
  expect(() => expectOnlyResolvedCopy(container)).toThrow("aria-valuetext: Zoom 125 percent");
});
