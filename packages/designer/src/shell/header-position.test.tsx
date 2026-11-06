import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import frameSlots from "../catalog/slots/frames.json" with { type: "json" };
import { resolveFrameHeaderOptions } from "../catalog-core/frame-header-options.js";
import { PageBar } from "../blocks/PageBar.js";
import { PAGE_BAR_LAYOUT } from "../blocks/page-bar-layout.js";
import { SiteHeader } from "./SiteHeader.js";

const labels = { breadcrumb: "Trail", collapsedBreadcrumb: "Ancestors", pageInfo: "Information", pageActions: "Actions" };
const appProps = { root: { label: "Workspace" }, labels };
const app = (options = {}) => renderToStaticMarkup(<PageBar {...appProps} {...options} />);
const site = (options = {}) => renderToStaticMarkup(<SiteHeader brand="Example" {...options} />);
afterEach(() => vi.restoreAllMocks());

describe("header position members", () => {
  it("adds the closed position axis to exactly the two headers", () => {
    for (const slot of frameSlots) {
      const positions = slot.contract.members.names.filter(name => name.startsWith("position."));
      expect(positions).toEqual(["frames.app-header", "frames.site-header"].includes(slot.id)
        ? ["position.sticky", "position.static"] : []);
    }
  });

  it.each(["frames.app-header", "frames.site-header"] as const)("%s resolves sticky and static without a themes read (z-index is not a themes leaf)", frame => {
    const sticky = resolveFrameHeaderOptions(frame, { position: "sticky", surface: "solid" });
    const flow = resolveFrameHeaderOptions(frame, { position: "static", surface: "solid" });
    expect(sticky.position).toBe("sticky");
    expect(sticky.reads).toEqual([]);
    expect(sticky.members).toEqual({ position: "sticky", surface: "solid" });
    expect(flow.position).toBe("static");
    expect(flow.reads).toEqual([]);
  });

  // The app header (PageBar) positions inline; the site header positions through named theme-keys utilities
  // (sticky top-0 / static / fixed / relative, layer-sticky / layer-shell, hairline-b), never inline style.
  const siteClasses = (html: string) => html.match(/<header[^>]*class="([^"]*)"/)![1]!.split(/\s+/);
  it("renders sticky positioning and its token, with a solid hairline", () => {
    const html = app({ position: "sticky", surface: "solid" });
    expect(html).toContain("position:sticky");
    expect(html).toContain("var(--ui-z-sticky");
    expect(html).toContain("border-bottom-width:var(--ui-border-hairline");
    expect(html).not.toContain("rounded-control border border-line-base");
    const header = site({ position: "sticky", surface: "solid" });
    expect(siteClasses(header)).toEqual(expect.arrayContaining(["sticky", "top-0", "layer-sticky", "hairline-b"]));
    expect(siteClasses(header)).not.toContain("layer-shell");
    expect(header).not.toContain("style=");
    expect(header).not.toContain("rounded-control border border-line-base");
  });

  it("static headers emit neither sticky positioning nor the sticky token", () => {
    const html = app({ position: "static" });
    expect(html).toContain("position:static");
    expect(html).not.toContain("position:sticky");
    expect(html).not.toContain("--ui-z-sticky");
    const header = siteClasses(site({ position: "static" }));
    expect(header).toContain("static");
    for (const absent of ["sticky", "layer-sticky", "layer-shell"]) expect(header).not.toContain(absent);
  });

  it("keeps glass fixed and rejects glass with static", () => {
    expect(app({ surface: "glass", position: "sticky" })).toContain("position:fixed");
    expect(() => app({ surface: "glass", position: "static" })).toThrow(/glass.*static/);
    expect(siteClasses(site({ surface: "glass", position: "sticky" }))).toEqual(expect.arrayContaining(["fixed", "top-0", "inset-x-0", "layer-shell"]));
    expect(() => site({ surface: "glass", position: "static" })).toThrow(/glass.*static/);
  });

  it("preserves omitted package behavior", () => {
    expect(app()).toContain("position:sticky");
    expect(app()).toContain("rounded-control border border-line-base");
    expect(siteClasses(site())).toEqual(expect.arrayContaining(["relative", "layer-shell"]));
    expect(siteClasses(site({ surface: "glass" }))).toContain("fixed");
  });

  it("does not resolve the app sticky token for static instances", () => {
    const read = vi.spyOn(PAGE_BAR_LAYOUT, "barLayer", "get");
    app({ position: "static" });
    expect(read).not.toHaveBeenCalled();
    app({ position: "sticky" });
    expect(read).toHaveBeenCalledOnce();
  });

  it.each(["frames.app-header", "frames.site-header"] as const)("%s gives the instance precedence over library defaults", frame => {
    const defaults = { position: "sticky", surface: "solid" } as const;
    expect(resolveFrameHeaderOptions(frame, {}, defaults).position).toBe("sticky");
    expect(resolveFrameHeaderOptions(frame, { position: "static" }, defaults).position).toBe("static");
    expect(resolveFrameHeaderOptions(frame, { position: "sticky" }, { position: "static" }).position).toBe("sticky");
    expect(() => resolveFrameHeaderOptions(frame, { surface: "glass" }, { position: "static" })).toThrow(/glass.*static/);
  });

  it("refuses unsupported runtime values", () => {
    expect(() => site({ position: "fixed" })).toThrow(/position/);
    expect(() => app({ position: "fixed" })).toThrow(/position/);
  });
});
