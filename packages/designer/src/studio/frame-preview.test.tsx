import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FrameHeaderPreview } from "./frame-preview.js";

describe("header frame preview", () => {
  it("renders the actual site header from defaults and instance overrides", () => {
    const defaults = { position: "sticky", surface: "solid" } as const;
    const render = (instance = {}) => renderToStaticMarkup(<FrameHeaderPreview frame="frames.site-header"
      content={{ brand: "Example" }} defaults={defaults} instance={instance} />);
    // The site header positions through named theme-keys utilities, never inline style (header-position.test.tsx).
    const classes = (html: string) => html.match(/<header[^>]*class="([^"]*)"/)![1]!.split(/\s+/);
    expect(classes(render())).toEqual(expect.arrayContaining(["sticky", "top-0", "layer-sticky"]));
    expect(classes(render({ position: "static" }))).toContain("static");
    for (const absent of ["sticky", "layer-sticky"]) expect(classes(render({ position: "static" }))).not.toContain(absent);
    expect(render()).toContain('data-surface="solid"');
  });

  it("renders the actual app header and refuses inherited glass/static conflicts", () => {
    const content = { root: { label: "Workspace" }, width: "contained" as const, onWidthChange() {},
      labels: { breadcrumb: "Trail", collapsedBreadcrumb: "Ancestors", pageInfo: "Information", fullWidth: "Expand", containedWidth: "Contain", pageActions: "Actions" } };
    const render = (instance = {}) => renderToStaticMarkup(<FrameHeaderPreview frame="frames.app-header"
      content={content} defaults={{ position: "sticky", surface: "solid" }} instance={instance} />);
    expect(render()).toContain('data-application-frame-region="bar"');
    expect(render()).toContain("position:sticky");
    expect(render({ position: "static" })).not.toContain("--ui-z-sticky");
    expect(() => render({ position: "static", surface: "glass" })).toThrow(/glass.*static/);
  });
});
