// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DesignerPage } from "./DesignerPage.js";
import { SystemCanvas } from "./SystemCanvas.js";
import { createRouteStudioLabels } from "../route-labels.js";
import type { StudioCopyBinding, StudioCopyRef } from "../copy-binding.js";
import { CanvasZoom } from "../../components/CanvasZoom.js";

const binding: StudioCopyBinding = {
  locale: "en",
  resolver: ref => ({ ref, text: `[[${ref.id}]]`, servedLocale: "en", chain: ["en"] }),
};
const wrapped = /^(?:\[\[[^\]]+\]\]\s*)+$/;

function assertWrapped(container: HTMLElement) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const texts: string[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest("style,script,[data-studio-data-value]")) continue;
    const text = node.textContent?.trim();
    if (text) texts.push(text);
  }
  expect(texts.length).toBeGreaterThan(0);
  for (const text of texts) expect(text, `unbound text: ${text}`).toMatch(wrapped);
  for (const element of container.querySelectorAll("[aria-label],[aria-valuetext],[title],[placeholder]")) {
    for (const attribute of ["aria-label", "aria-valuetext", "title", "placeholder"]) {
      const value = element.getAttribute(attribute)?.trim();
      if (value) expect(value, `${attribute}: ${value}`).toMatch(wrapped);
    }
  }
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("system-canvas copy hand-roll", () => {
  it("renders the real empty studio page with only resolver-wrapped chrome text and aria labels", () => {
    // Empty data is a real supported page state. Raw catalog IDs, graph values,
    // check diagnostics and selected-history presentation remain named Needs.
    const { container } = render(<DesignerPage copy={binding} data={{ placements: [{ layer: "themes", nodes: [] }] }} initialUrl={{ search: "", hash: "" }} />);
    expect(container.querySelector("[data-designer-page]")).not.toBeNull();
    assertWrapped(container);
  });

  it("names the missing IA display-name binding rather than rendering raw graph names", () => {
    const labels = createRouteStudioLabels(binding);
    expect(() => render(<SystemCanvas copy={binding} data={{ placements: [{ layer: "components", nodes: [
      { id: "actions", label: "Actions", children: [{ id: "buttons", label: "Buttons", leaves: ["components.fixture-missing"] }] },
    ] }] }} labels={{ label: labels.canvas.label, hint: labels.canvas.hint, breadcrumb: labels.inspector.relation, layers: labels.layers }} />))
      .toThrow("studio.ia.item.components.fixture-missing");
  });

  it("resolves the real measured zoom readout and reset text with the registered Writer formatter", () => {
    const requests: StudioCopyRef[] = [];
    const copy: StudioCopyBinding = {
      locale: "en",
      resolver: ref => {
        requests.push(ref);
        return { ref, text: `[[${ref.id}]]`, servedLocale: "en", chain: ["en"] };
      },
    };
    const labels = createRouteStudioLabels(copy);
    const controls = {
      group: labels.canvas.zoomLabel, out: labels.canvas.zoomOut,
      in: labels.canvas.zoomIn, fit: labels.canvas.fit, percent: labels.canvas.zoomLabel,
    };
    const view = render(<CanvasZoom value={1.75} min={0.5} max={3} onChange={() => {}} onFit={() => {}}
      labels={controls} formatValue={labels.canvas.zoom} />);
    expect(view.container.querySelector("output")).toHaveTextContent("[[st.zhgkbpn8eq]]");
    expect(view.container.querySelector('[data-studio-control="zoom-reset"]')).toHaveTextContent("[[st.zhgkbpn8eq]]");
    expect(requests).toContainEqual(expect.objectContaining({ id: "st.zhgkbpn8eq", values: { value: 175 } }));
    expect(requests).toContainEqual(expect.objectContaining({ id: "st.zhgkbpn8eq", values: { value: 100 } }));
    assertWrapped(view.container);
    view.rerender(<CanvasZoom value={1} min={0.5} max={3} onChange={() => {}} onFit={() => {}}
      labels={controls} formatValue={labels.canvas.zoom} />);
    expect(view.container.querySelector("[data-zoom-reset]")).toHaveAttribute("inert");
    assertWrapped(view.container);
  });

  it("refuses an absent zoom formatter instead of manufacturing percentage copy", () => {
    const labels = createRouteStudioLabels(binding);
    expect(() => render(<CanvasZoom value={1.75} min={0.5} max={3} onChange={() => {}} onFit={() => {}}
      labels={{ group: labels.canvas.zoomLabel, out: labels.canvas.zoomOut, in: labels.canvas.zoomIn,
        fit: labels.canvas.fit, percent: labels.canvas.zoomLabel }} />)).toThrow("CanvasZoom.formatValue");
  });
});
