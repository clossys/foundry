import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FrameHeaderPreview } from "./frame-preview.js";

describe("header frame preview", () => {
  it("renders the actual site header from defaults and instance overrides", () => {
    const defaults = { position: "sticky", surface: "solid" } as const;
    const render = (instance = {}) => renderToStaticMarkup(<FrameHeaderPreview frame="frames.site-header"
      content={{ brand: "Example" }} defaults={defaults} instance={instance} />);
    expect(render()).toContain("position:sticky");
    expect(render()).toContain("--ui-z-sticky");
    expect(render({ position: "static" })).toContain("position:static");
    expect(render({ position: "static" })).not.toContain("--ui-z-sticky");
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
