// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { buildUsageGraph } from "../catalog-core/usage-graph.js";
import { emptyLibrary, smallCatalog } from "./__fixtures__/studio.js";
import { StudioProvider } from "./StudioProvider.js";
import { Slider } from "../components/Slider.js";
import { CanvasZoom } from "../components/CanvasZoom.js";
import { createRouteStudioLabels } from "./route-labels.js";
import { DesignerPage } from "./DesignerPage.js";
import { UsagePanel } from "./usage/UsagePanel.js";
import { expectOnlyResolvedCopy, pseudoStudioCopy } from "./__fixtures__/copy-hand-roll.js";

const graph = buildUsageGraph({ inventory: { themes: ["themes.primary", "themes.destructive"] }, selection: {} });

afterEach(() => { cleanup(); localStorage.clear(); window.history.replaceState(null, "", "/"); });

it.each(["en", "ar"])("hand-rolls the Designer page's vertical scroll and its Explorer and Checks rail in %s", async locale => {
  const { copy, requests } = pseudoStudioCopy(locale);
  // No adoption, like the base canvas test: the scroll's own chrome, board titles and row labels are under test;
  // a filled row's specimen (token member keys and channel values) is display data the specimen tests own.
  const library = emptyLibrary();
  const { container } = render(<StudioProvider copy={copy} catalog={smallCatalog} initialSlotId="themes.background" labels={createRouteStudioLabels(copy)}
    adapter={{ load: async () => ({ library }), save: async () => { throw new Error("view-only"); } }}><DesignerPage copy={copy} /></StudioProvider>);
  await waitFor(() => expect(container.querySelector("[data-designer-page][data-designer-ready]")).not.toBeNull());
  // R2F-19: one vertical scroll of library boards; the canvas, its minimap and its zoom are retired.
  expect(container.querySelector("[data-studio-canvas-board] > section[data-library-board]")).not.toBeNull();
  expect(container.querySelector('[data-studio-panel="minimap"], [data-system-canvas], [data-studio-control="zoom-reset"]')).toBeNull();
  expect(container.querySelector('[data-selected-leaf], [data-studio-panel="inspector"]')).toBeNull();
  expect(requests.length).toBeGreaterThan(0);
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

it("hand-rolls zoom output, reset and Slider spoken values through the existing Writer formatter", () => {
  const { copy, requests } = pseudoStudioCopy();
  const labels = createRouteStudioLabels(copy);
  const { container } = render(<>
    <CanvasZoom value={1.25} min={0.5} max={2} onChange={() => {}} onFit={() => {}}
      labels={{ group: labels.canvas.zoomLabel, out: labels.canvas.zoomOut, in: labels.canvas.zoomIn, fit: labels.canvas.fit, percent: labels.canvas.zoomLabel }} formatValue={labels.canvas.zoom} />
    <Slider label={labels.canvas.zoomLabel} value={1.25} minValue={0.5} maxValue={2} onChange={() => {}} formatValue={value => labels.canvas.zoom(value * 100)} />
  </>);
  expect(container.querySelector('input[type="range"]')).toHaveAttribute("aria-valuetext", "[[st.zhgkbpn8eq]]");
  expect(requests).toContainEqual({ id: "st.zhgkbpn8eq", locale: "en", values: { value: 125 } });
  expectOnlyResolvedCopy(container);
});
