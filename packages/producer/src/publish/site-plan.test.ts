import { createElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { planSite, type DesignerInput, type PublisherInput, type WriterInput } from "./site-plan.js";
import { renderSite, visibleText, type SiteRuntime } from "./site-render.js";

const publisher = (): PublisherInput => ({
  publicationId: "site",
  entries: [
    { id: "home", order: 0, title: "page-home.title", kind: "page", path: "/", source: { frameId: "frames.site-shell", sectionIds: ["sections.steps", "sections.pricing", "sections.hero"] }, pin: { nav: true } },
    { id: "about", order: 1, title: "page-about.title", kind: "page", path: "/about", source: { frameId: "frames.site-shell", sectionIds: [] } },
  ],
  routes: [
    { instanceId: "home", path: "/", slots: [
      { section: "sections.steps", config: "home.steps", state: "active" },
      { section: "sections.pricing", config: "home.pricing", state: "active" },
      { section: "sections.hero", config: "home.hero", state: "pending", heldBy: "designer" },
    ] },
    { instanceId: "about", path: "/about", slots: [], requested: [{ agent: "designer", section: "sections.form", config: "about.form" }] },
  ],
  copy: {
    "page.home": [{ key: "skip-link", cell: "page.home" }, { key: "meta-title", cell: "page.home" }, { key: "home.steps", cell: "page.home" }, { key: "home.pricing", cell: "page.home" }, { key: "home.hero", cell: "page.home" }],
    "page.about": [{ key: "skip-link", cell: "page.about" }],
  },
  cellOfEntry: { home: "page.home", about: "page.about" },
});

const writer = (stepRef = "r-step-1"): WriterInput => ({
  aliases: { "page.home.skip-link": "r-skip", "page.home.meta-title": "r-title", "page.about.skip-link": "r-skip", "page-home.title": "r-nav-home" },
  records: [
    { id: "r-skip", text: "Jump to content" }, { id: "r-title", text: "Home title" }, { id: "r-nav-home", text: "Home" },
    { id: "r-step-1", text: "Brief the studio" }, { id: "r-step-2", text: "Review the draft" }, { id: "r-heading", text: "How it works" },
  ],
  sections: [{ sectionId: "sections.steps", configId: "home.steps", fields: [
    { key: "header.heading", ref: { id: "r-heading" } },
    { key: "steps[0].heading", ref: { id: stepRef } },
    { key: "steps[1].heading", ref: { id: "r-step-2" } },
  ] }],
});

const designer = (): DesignerInput => ({
  active: new Set(["frames.site-shell", "sections.steps", "sections.pricing", "sections.form"]),
  fills: {
    "frames.site-shell": { id: "acme/site-shell", slots: ["skip-link", "header", "main", "footer"], members: [], configs: {} },
    "sections.steps": { id: "acme/steps", slots: ["steps"], members: [], configs: {} },
    "sections.pricing": { id: "acme/pricing", slots: ["plans"], members: [], configs: {} },
    "sections.form": { id: "acme/form", slots: ["fields"], members: [], configs: {} },
  },
  contracts: {
    "frames.site-shell": { slots: [{ name: "main", type: "region", required: true }] },
    "sections.steps": { slots: [{ name: "steps", type: "records", required: true }], anatomy: { header: "sections.section-header" } },
    "sections.pricing": { slots: [{ name: "plans", type: "records", required: true }] },
  },
  renderers: { "frames.site-shell": ["skip-link", "header", "footer"], "sections.steps": ["header", "steps"], "sections.pricing": ["plans"] },
});

/** Stub package renderers: they print only the content they are handed. */
const value = (input: any, name: string) => input.content[name]?.value;
const runtime = (): SiteRuntime => ({
  renderers: {
    "frames.site-shell": { render: (input: any) => createElement("div", null, createElement("a", { href: "#main" }, value(input, "skip-link")), createElement("main", { id: "main" }, ...(input.slots.main ?? []))) },
    "sections.steps": { render: (input: any) => createElement("section", null,
      createElement("h2", null, value(input, "header")?.heading),
      createElement("ol", null, ...(value(input, "steps") as any[]).map(step => createElement("li", { key: step.id }, step.heading)))) },
  },
  wrap: (node: ReactNode) => node, profile: {}, consumer: "acme", locale: "en", hash: () => "h",
});

async function build(stepRef?: string) {
  const plan = planSite(publisher(), writer(stepRef), designer());
  const pages = await renderSite(plan.pages, runtime(), plan.report, "/assets/site.css");
  return { plan, report: plan.report, home: visibleText(pages.find(page => page.id === "home")!.html), pages };
}

describe("publish preview renderer", () => {
  it("renders one frame plus ordered bound sections with Writer copy and nothing invented", async () => {
    const { home, report, pages } = await build();
    expect(home).toContain("Jump to content");
    expect(home.indexOf("How it works")).toBeLessThan(home.indexOf("Brief the studio"));
    expect(home.indexOf("Brief the studio")).toBeLessThan(home.indexOf("Review the draft"));
    expect(pages.find(page => page.id === "home")!.html).toContain("<title>Home title</title>");
    expect(report.pages.find(page => page.id === "home")).toMatchObject({ frame: "frames.site-shell", sections: ["sections.steps"] });
    expect(report.unboundKeys.filter(row => row.page === "home" && row.key.startsWith("home.steps"))).toEqual([]);
  });

  it("leaves slots without an active section or binding empty, reports them and shows no placeholder", async () => {
    const { home, report } = await build();
    expect(report.emptySlots).toEqual(expect.arrayContaining([
      expect.objectContaining({ page: "home", section: "sections.hero", reason: expect.stringContaining("no active Designer section") }),
      expect.objectContaining({ page: "home", section: "sections.pricing", reason: expect.stringContaining("Writer has no section binding") }),
      expect.objectContaining({ page: "about", section: "sections.form", reason: expect.stringContaining("active in Designer but not placed") }),
    ]));
    expect(report.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ agent: "designer", subject: "sections.hero" }),
      expect.objectContaining({ agent: "writer", subject: "sections.pricing/home.pricing" }),
      expect.objectContaining({ agent: "publisher", subject: "about", need: expect.stringContaining("pin the page") }),
    ]));
    expect(home).not.toMatch(/hero|pricing|placeholder|lorem/i);
  });

  it("leaves out copy whose Writer record is gone and reports it (mutation: broken binding)", async () => {
    const { home, report } = await build("r-missing");
    expect(home).not.toContain("Brief the studio");
    expect(home).toContain("Review the draft");
    expect(report.unboundKeys).toEqual(expect.arrayContaining([expect.objectContaining({ page: "home", key: "home.steps.steps[0].heading", reason: expect.stringContaining("r-missing") })]));
  });

  it("empties only the refusing section's slot", async () => {
    const plan = planSite(publisher(), writer(), designer());
    const broken = { ...runtime(), renderers: { ...runtime().renderers, "sections.steps": { render: () => { throw new Error("steps needs ids"); } } } };
    const pages = await renderSite(plan.pages, broken, plan.report, "/assets/site.css");
    const home = visibleText(pages.find(page => page.id === "home")!.html);
    expect(home).toContain("Jump to content");
    expect(home).not.toContain("How it works");
    expect(plan.report.emptySlots).toEqual(expect.arrayContaining([expect.objectContaining({ section: "sections.steps", reason: "renderer refused: steps needs ids" })]));
    expect(plan.report.pages.find(page => page.id === "home")!.sections).toEqual([]);
  });
});
