// Example fix: Use the public data-only template API and a typed local consumer widget fixture.
const fixtureResolveCopy: import("@clossys/writer").CopyResolver = (ref) => ({
  ref, text: ref.id, recordId: "readme-example", revision: "1", locale: "en",
  source: { kind: "consumer", reference: "readme-example" }, entryId: ref.id,
});
const myCopyResolver = fixtureResolveCopy;

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SurfaceDocument } from "@clossys/publisher/core";
import { resolveSurfaceDocument } from "@clossys/publisher/core";
import { createWebRenderer, defineWebTemplate } from "@clossys/publisher/web";
const DashboardWidget = ({ chartId }: { chartId: string }) => createElement("div", null, chartId); // a consumer's own component

const DashboardView = defineWebTemplate({
  name: "DashboardView",
  flow: { slots: [{ key: "heading", required: true }, { key: "widget", required: true }] },
  // A slot key absent from slotKinds defaults to ["copy", "asset"] — the
  // same two sources AuthView/ErrorView's slots already accept. "widget"
  // opts INTO "node" explicitly, per slot — never a renderer-wide switch.
  slotKinds: { widget: ["node"] },
  blocks: [{ kind: "page-header", title: "heading" }, { kind: "node-chapter", node: "widget", title: "heading" }],
});

// Every renderer instance is isolated — see "Instance-scoped, never a
// global mutable registry" below. `includeBuiltins: true` additionally
// registers AuthView/ErrorView/MarketingView on this same instance.
const renderer = createWebRenderer({ templates: [DashboardView], includeBuiltins: true });

const ref = (id: string) => ({ id });
const acmeDashboard: SurfaceDocument = {
  id: "acme.dashboard.home",
  channel: "web",
  template: "DashboardView",
  meta: { channel: "web", title: ref("acme.dashboard.heading"), description: ref("acme.dashboard.heading") },
  bindings: [
    { slot: "heading", copy: ref("acme.dashboard.heading") },
    // A caller-owned, already-composed React element — never a raw HTML
    // string, never audience-supplied content. See "Rich-node slots" below.
    { slot: "widget", node: createElement(DashboardWidget, { chartId: "acme.chart.mrr" }) },
  ],
};

// Tell resolveSurfaceDocument which of THIS template's slots accept a
// node — derived from the template's own declaration, never hardcoded —
// and which template names this renderer instance knows.
const resolved = resolveSurfaceDocument(acmeDashboard, myCopyResolver, {
  knownTemplates: renderer.listWebTemplateNames(),
  nodeSlots: Object.entries(DashboardView.slotKinds ?? {})
    .filter(([, kinds]) => kinds.includes("node"))
    .map(([slot]) => slot),
});

const { element } = renderer.renderWebDocument(resolved.document, {
  groups: resolved.groups, // repeating slots, if the template declares any
  nodes: resolved.nodes, // resolved single-binding node slots
});
renderToStaticMarkup(element);
