import { describe, expect, it } from "vitest";
import type { MaterialsIndexEntry } from "./types.js";
import { renderMaterialsIndexHtml } from "./siteIndex.js";

const entries: MaterialsIndexEntry[] = [
  {
    id: "overview-short",
    title: "Company overview — short",
    kind: "overview",
    status: "verified",
    condition: "current",
    version: "v0.3",
    lastPublishedAt: "2026-09-22T00:00:00.000Z",
    href: "./overview/short/v0.3/index.html",
  },
  {
    id: "pitch-investor",
    title: "Pitch deck — investor",
    kind: "deck",
    status: "draft",
    condition: "current",
    version: "v0.1",
    lastPublishedAt: null,
    href: "./deck/investor/v0.1/index.html",
  },
];

describe("renderMaterialsIndexHtml", () => {
  it("lists every entry with its status, condition, version, and last-published time", () => {
    const html = renderMaterialsIndexHtml(entries);
    expect(html).toContain("Company overview — short");
    expect(html).toContain('data-status="verified"');
    expect(html).toContain('data-condition="current"');
    expect(html).toContain("v0.3");
    expect(html).toContain("2026-09-22T00:00:00.000Z");
  });

  it("shows never-published entries distinctly rather than a blank cell", () => {
    const html = renderMaterialsIndexHtml(entries);
    expect(html).toContain("never published");
  });

  it("links each entry to its own href", () => {
    const html = renderMaterialsIndexHtml(entries);
    expect(html).toContain('href="./overview/short/v0.3/index.html"');
    expect(html).toContain('href="./deck/investor/v0.1/index.html"');
  });

  it("escapes a title containing markup", () => {
    const html = renderMaterialsIndexHtml([{ ...entries[0]!, title: "<script>alert(1)</script>" }]);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("states the internal, not-deployed nature of the site", () => {
    const html = renderMaterialsIndexHtml(entries);
    expect(html.toLowerCase()).toContain("internal");
    expect(html.toLowerCase()).toContain("not deployed");
  });

  it("renders an empty table body for zero entries, never throws", () => {
    expect(() => renderMaterialsIndexHtml([])).not.toThrow();
    expect(renderMaterialsIndexHtml([])).toContain("<tbody>");
  });
});
