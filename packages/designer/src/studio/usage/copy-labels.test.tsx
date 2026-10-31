// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { buildUsageGraph } from "../../catalog-core/usage-graph.js";
import { UsagePanel } from "./UsagePanel.js";
import { createStudioUsageLabels } from "./copy-labels.js";
import { StudioCopyNeedsError, type StudioCopyBinding } from "../copy-binding.js";

afterEach(cleanup);
it("hand-rolls the real empty usage panel with only resolver-wrapped text and aria labels", () => {
  const copy: StudioCopyBinding = { locale: "en", resolver: ref => ({ ref, text: `[[${ref.id}]]`, servedLocale: "en", chain: ["en"] }) };
  const labels = createStudioUsageLabels(copy);
  const graph = buildUsageGraph({ inventory: { components: ["components.example"] }, selection: {} });
  const { container } = render(<UsagePanel copy={copy} id="components.example" graph={graph} labels={labels} onNavigate={() => {}} />);
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const texts: string[] = []; let node: Node | null;
  while ((node = walker.nextNode())) if (node.textContent?.trim()) texts.push(node.textContent.trim());
  expect(texts.length).toBeGreaterThan(5);
  for (const text of texts) expect(text).toMatch(/^\[\[[^\]]+\]\]$/);
  for (const element of container.querySelectorAll("[aria-label]")) expect(element.getAttribute("aria-label")).toMatch(/^\[\[[^\]]+\]\]$/);
});

it("hand-roll keeps dependency identifiers in the data seam and all copy resolver-wrapped", () => {
  const copy: StudioCopyBinding = { locale: "en", resolver: ref => ({ ref, text: `[[${ref.id}]]`, servedLocale: "en", chain: ["en"] }) };
  const labels = createStudioUsageLabels(copy);
  const graph = buildUsageGraph({ inventory: { components: ["components.example"], themes: ["themes.example"] }, selection: {},
    runtime: [{ from: "components.example", to: "themes.example", kind: "reads", route: "fixture", selector: "button" }] });
  const { container } = render(<UsagePanel copy={copy} id="components.example" graph={graph} labels={labels} onNavigate={() => {}} />);
  const data = [...container.querySelectorAll("[data-studio-data-value]")];
  expect(data.some(node => node.textContent === "themes.example")).toBe(true);
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node: Node | null; const text: string[] = [];
  while ((node = walker.nextNode())) if (node.textContent?.trim() && !node.parentElement?.closest("[data-studio-data-value]")) text.push(node.textContent.trim());
  expect(text.length).toBeGreaterThan(5);
  for (const value of text) expect(value).toMatch(/^\[\[[^\]]+\]\]$/);
});

it("hand-roll refuses missing finding-message copy with its exact Need", () => {
  const copy: StudioCopyBinding = { locale: "en", resolver: ref => ({ ref, text: `[[${ref.id}]]`, servedLocale: "en", chain: ["en"] }) };
  const graph = buildUsageGraph({ inventory: { components: ["components.example"] }, selection: {} });
  let observed: unknown;
  try { render(<UsagePanel copy={copy} id="components.example" graph={graph} labels={createStudioUsageLabels(copy)} onNavigate={() => {}}
    findings={[{ code: "WL5", subject: "components.example", message: "Unrecorded fixture message" }]} />); }
  catch (error) { observed = error; }
  expect(observed).toBeInstanceOf(StudioCopyNeedsError);
  expect((observed as StudioCopyNeedsError).cellId).toBe("studio.usage.finding.WL5");
});
