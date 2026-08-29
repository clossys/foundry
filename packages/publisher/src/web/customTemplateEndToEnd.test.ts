/**
 * End-to-end test for issue #175 — a consumer registering their own,
 * non-trivial, multi-section flowed template and rendering it through the
 * REAL pipeline a consumer actually uses: author a `SurfaceDocument`,
 * resolve it with `resolveSurfaceDocument` (naming which slots may carry a
 * caller-owned `node` via `nodeSlots`), then render the result through a
 * `createWebRenderer` instance scoped to that one custom template — never
 * falling back to a local, unregistered render path. Mirrors
 * `marketingView.test.ts`'s own "real pipeline, not each half in
 * isolation" structure, for the built-ins' registry-extension counterpart.
 *
 * Fixtures are deliberately, obviously placeholder text, per this
 * repository's own public-safety rules.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CopyRegistry, CopyResolver } from "@clossys/writer";
import { createCopyResolver } from "@clossys/writer";
import { resolveSurfaceDocument } from "../core/index.js";
import type { SurfaceDocument } from "../core/index.js";
import { RenderError } from "../internal/errors.js";
import { createWebRenderer } from "./internal/createWebRenderer.js";
import { defineWebTemplate } from "./internal/defineWebTemplate.js";
import { nodeSlotKeys } from "./internal/webTemplates.js";

const ref = (id: string) => ({ id });

const registry: CopyRegistry = {
  id: "acme-dashboard-fixture",
  locale: "en",
  revision: "1",
  source: { kind: "consumer", reference: "fixtures/acme-dashboard" },
  entries: [
    { id: "acme.dashboard.heading", text: "Acme placeholder dashboard", context: "fixture", status: "approved" },
    { id: "acme.dashboard.stat.one", text: "Placeholder stat one", context: "fixture", status: "approved" },
    { id: "acme.dashboard.stat.two", text: "Placeholder stat two", context: "fixture", status: "approved" },
  ],
};

const resolver: CopyResolver = createCopyResolver(registry);

/**
 * A "non-trivial, multi-section flowed page, not a copy of AuthView" —
 * two flowed text slots, one node-kind slot for a caller-owned chart
 * widget, and one repeating slot for a stat band — proving a
 * consumer-defined template can declare and consume BOTH a rich node and
 * a repeating group, not just flowed single slots.
 */
const DASHBOARD_TEMPLATE = defineWebTemplate({
  name: "DashboardView",
  flow: {
    slots: [
      { key: "heading", required: true },
      { key: "chart", required: true },
      { key: "footer" },
    ],
  },
  slotKinds: { chart: ["node"] },
  repeatingSlots: [{ key: "stats" }],
  build: (content, groups) =>
    createElement(
      "main",
      null,
      createElement("h1", null, content.heading),
      content.chart,
      createElement(
        "ul",
        null,
        (groups.stats ?? []).map((item) => createElement("li", { key: item.index }, item.text)),
      ),
      content.footer ?? null,
    ),
});

function dashboardSurface(bindings: SurfaceDocument["bindings"]): SurfaceDocument {
  return {
    id: "acme.dashboard.home",
    channel: "web",
    meta: { channel: "web", title: ref("acme.dashboard.heading"), description: ref("acme.dashboard.heading") },
    template: "DashboardView",
    bindings,
  };
}

describe("a consumer-registered template — full pipeline, SurfaceDocument through to markup", () => {
  it("renders a caller-owned chart node and a repeating stat band end to end", () => {
    const renderer = createWebRenderer({ templates: [DASHBOARD_TEMPLATE] });
    // A real ReactElement the caller's own trusted code constructed — the
    // ONLY thing a "node"-kind slot is meant to carry (see this file's own
    // top comment and defineWebTemplate's own doc comment on rich-node
    // slots). A raw data object would not be valid React child content.
    const chartNode = createElement("div", { "data-testid": "chart" }, "Placeholder chart of 3 points");

    const surface = dashboardSurface([
      { slot: "heading", copy: ref("acme.dashboard.heading") },
      { slot: "chart", node: chartNode },
      { slot: "stats", items: [{ copy: ref("acme.dashboard.stat.one") }, { copy: ref("acme.dashboard.stat.two") }] },
    ]);

    // The consumer derives which slots on THIS template accept a node from
    // the template's own declared slotKinds — never a hardcoded list — and
    // hands that to resolveSurfaceDocument as options.nodeSlots.
    const resolved = resolveSurfaceDocument(surface, resolver, { nodeSlots: nodeSlotKeys(DASHBOARD_TEMPLATE) });
    expect(resolved.nodes).toEqual([{ slot: "chart", node: chartNode }]);

    const { element, head } = renderer.renderWebDocument(resolved.document, { groups: resolved.groups, nodes: resolved.nodes });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Acme placeholder dashboard");
    expect(html).toContain("Placeholder stat one");
    expect(html).toContain("Placeholder stat two");
    expect(html).toContain('data-testid="chart"');
    expect(html).toContain("Placeholder chart of 3 points");
    expect(head.title).toBe("Acme placeholder dashboard");
    // The chart is a caller-owned node this test never gave any DOM shape
    // to — resolved.document.bindings never carries it (core cannot lower
    // a node into the legacy shape), only options.nodes does.
    expect(resolved.document.bindings.some((b) => b.slot === "chart")).toBe(false);
  });

  it("still refuses a node targeting a slot resolveSurfaceDocument was not told is node-kind — core's own fail-closed default, unrelated to the web template's own opinion", () => {
    const surface = dashboardSurface([
      { slot: "heading", copy: ref("acme.dashboard.heading") },
      { slot: "chart", node: { kind: "consumer-chart" } },
    ]);
    // No nodeSlots option at all — the caller forgot to derive it from the
    // template, or is resolving against a channel with no template concept.
    let thrown: unknown;
    try {
      resolveSurfaceDocument(surface, resolver);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ name: "SurfaceResolutionError", reason: "unsupported-node" });
  });

  it("still refuses to render when the required 'chart' node-kind slot is never authored", () => {
    const renderer = createWebRenderer({ templates: [DASHBOARD_TEMPLATE] });
    const surface = dashboardSurface([{ slot: "heading", copy: ref("acme.dashboard.heading") }]);
    const resolved = resolveSurfaceDocument(surface, resolver, { nodeSlots: nodeSlotKeys(DASHBOARD_TEMPLATE) });
    try {
      renderer.renderWebDocument(resolved.document, { groups: resolved.groups, nodes: resolved.nodes });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("empty-output");
      expect((error as Error).message).toContain("chart");
    }
  });
});
