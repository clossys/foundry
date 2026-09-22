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
 * Issue #1103: consumer templates are data (`blocks`), not a React `build`
 * function. A chart `node` slot renders inside a Designer frame.
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
  blocks: [
    { kind: "page-header", title: "heading" },
    { kind: "node-chapter", node: "chart" },
    { kind: "stat-grid", repeating: "stats" },
    { kind: "copy-footer", copy: "footer" },
  ],
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
  it("renders a caller-owned chart node inside a Designer frame and a stat-grid end to end", () => {
    const renderer = createWebRenderer({ templates: [DASHBOARD_TEMPLATE] });
    const chartNode = createElement("div", { "data-testid": "chart" }, "Placeholder chart of 3 points");

    const surface = dashboardSurface([
      { slot: "heading", copy: ref("acme.dashboard.heading") },
      { slot: "chart", node: chartNode },
      { slot: "stats", items: [{ copy: ref("acme.dashboard.stat.one") }, { copy: ref("acme.dashboard.stat.two") }] },
    ]);

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
    expect(html).not.toMatch(/<h1[^>]*>[\s\S]*<ul/);
    expect(html).toContain("text-h1");
    expect(resolved.document.bindings.some((b) => b.slot === "chart")).toBe(false);
  });

  it("refuses a consumer template that tries to supply a raw build function", () => {
    expect(() =>
      defineWebTemplate({
        name: "RawView",
        flow: { slots: [{ key: "heading", required: true }] },
        blocks: [{ kind: "page-header", title: "heading" }],
        build: () => null,
      } as never),
    ).toThrow(RenderError);
  });

  it("still refuses a node targeting a slot resolveSurfaceDocument was not told is node-kind — core's own fail-closed default, unrelated to the web template's own opinion", () => {
    const surface = dashboardSurface([
      { slot: "heading", copy: ref("acme.dashboard.heading") },
      { slot: "chart", node: { kind: "consumer-chart" } },
    ]);
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
