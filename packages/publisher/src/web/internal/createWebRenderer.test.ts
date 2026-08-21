import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ComposeDocument } from "../../core/index.js";
import { RenderError } from "../../internal/errors.js";
import { createWebRenderer } from "./createWebRenderer.js";
import { defineWebTemplate } from "./defineWebTemplate.js";

const DASHBOARD_TEMPLATE = defineWebTemplate({
  name: "DashboardView",
  flow: { slots: [{ key: "heading", required: true }] },
  build: (content) => createElement("h1", null, content.heading),
});

const REPORT_TEMPLATE = defineWebTemplate({
  name: "ReportView",
  flow: { slots: [{ key: "title", required: true }] },
  build: (content) => createElement("h2", null, content.title),
});

const dashboardDoc: ComposeDocument = {
  id: "acme-dashboard",
  channel: "web",
  template: "DashboardView",
  meta: { channel: "web", title: "Dashboard", description: "d" },
  bindings: [{ slot: "heading", value: "Acme Dashboard" }],
};

describe("createWebRenderer — no arguments knows ZERO templates, not the three built-ins", () => {
  it("listWebTemplateNames() is empty", () => {
    expect(createWebRenderer().listWebTemplateNames()).toEqual([]);
  });

  it("getWebTemplate returns undefined even for a built-in name", () => {
    expect(createWebRenderer().getWebTemplate("AuthView")).toBeUndefined();
  });

  it("renderWebDocument throws RenderError('unknown-template', ...) for any template name, matching today's error for an unregistered name", () => {
    const renderer = createWebRenderer();
    let thrown: unknown;
    try {
      renderer.renderWebDocument(dashboardDoc);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RenderError);
    expect((thrown as RenderError).reason).toBe("unknown-template");
    expect((thrown as RenderError).message).toContain("DashboardView");
  });
});

describe("createWebRenderer({ templates }) — scoped to exactly those templates", () => {
  it("knows the supplied template and nothing else", () => {
    const renderer = createWebRenderer({ templates: [DASHBOARD_TEMPLATE] });
    expect(renderer.listWebTemplateNames()).toEqual(["DashboardView"]);
    expect(renderer.getWebTemplate("DashboardView")).toBe(DASHBOARD_TEMPLATE);
    expect(renderer.getWebTemplate("AuthView")).toBeUndefined();
  });

  it("renders a real element end to end through react-dom/server", () => {
    const renderer = createWebRenderer({ templates: [DASHBOARD_TEMPLATE] });
    const { element, head } = renderer.renderWebDocument(dashboardDoc);
    const html = renderToStaticMarkup(element);
    expect(html).toBe("<h1>Acme Dashboard</h1>");
    expect(head.title).toBe("Dashboard");
  });
});

describe("createWebRenderer — instance scoping: two renderers never observe each other's templates", () => {
  it("a template registered on one renderer is invisible to a second, independently created renderer", () => {
    const rendererA = createWebRenderer({ templates: [DASHBOARD_TEMPLATE] });
    const rendererB = createWebRenderer({ templates: [REPORT_TEMPLATE] });

    expect(rendererA.listWebTemplateNames()).toEqual(["DashboardView"]);
    expect(rendererB.listWebTemplateNames()).toEqual(["ReportView"]);
    expect(rendererA.getWebTemplate("ReportView")).toBeUndefined();
    expect(rendererB.getWebTemplate("DashboardView")).toBeUndefined();
  });

  it("the module-level built-in registry is unaffected by any createWebRenderer call — no shared mutable state", () => {
    createWebRenderer({ templates: [DASHBOARD_TEMPLATE], includeBuiltins: true });
    const bareRenderer = createWebRenderer({ templates: [] });
    expect(bareRenderer.listWebTemplateNames()).toEqual([]);
  });
});

describe("createWebRenderer({ includeBuiltins: true })", () => {
  it("additionally knows AuthView/ErrorView/MarketingView alongside a consumer's own templates", () => {
    const renderer = createWebRenderer({ templates: [DASHBOARD_TEMPLATE], includeBuiltins: true });
    expect(renderer.listWebTemplateNames().sort()).toEqual(["AuthView", "DashboardView", "ErrorView", "MarketingView"]);
  });

  it("includeBuiltins defaults to false", () => {
    const renderer = createWebRenderer({ templates: [DASHBOARD_TEMPLATE] });
    expect(renderer.getWebTemplate("AuthView")).toBeUndefined();
  });
});

describe("createWebRenderer — fails closed on a duplicate template name, never silently keeping the last one", () => {
  it("throws RenderError('duplicate-template', ...) when two entries in `templates` share a name", () => {
    const duplicate = defineWebTemplate({ name: "DashboardView", flow: { slots: [{ key: "x" }] }, build: () => null });
    let thrown: unknown;
    try {
      createWebRenderer({ templates: [DASHBOARD_TEMPLATE, duplicate] });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RenderError);
    expect((thrown as RenderError).reason).toBe("duplicate-template");
    expect((thrown as RenderError).message).toContain("DashboardView");
  });

  it("throws RenderError('duplicate-template', ...) when a consumer's own template collides with a built-in name and includeBuiltins is true", () => {
    const collidesWithAuthView = defineWebTemplate({ name: "AuthView", flow: { slots: [{ key: "x" }] }, build: () => null });
    let thrown: unknown;
    try {
      createWebRenderer({ templates: [collidesWithAuthView], includeBuiltins: true });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RenderError);
    expect((thrown as RenderError).reason).toBe("duplicate-template");
  });
});
