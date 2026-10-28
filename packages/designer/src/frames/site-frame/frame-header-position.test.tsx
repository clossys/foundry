import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CopyResolver } from "@clossys/writer";
import { AppFrame } from "@clossys/designer/frames";
import type { AppFrameProps } from "@clossys/designer/frames";
import { SiteFrame } from "./SiteFrame.js";
import { resolveShell } from "./internal/resolveShell.js";
import { normalizeSiteFrameConfig, SITE_FRAME_CONTRACT } from "./site-frame-contract.js";
import type { SiteFramePresentationConfig } from "./site-frame-contract.js";
import type { SiteShellInput } from "./types.js";

const copy: CopyResolver = value => ({ ref: value, text: value.id, recordId: "fixture", entryId: value.id,
  revision: "1", locale: "en", source: { kind: "consumer", reference: "fixture" } });
const asset = () => ({ type: "image", src: "/mark.svg", width: 48, height: 48, alt: "Example" });
const shell: SiteShellInput = { brand: { assetId: "mark", label: { id: "Example" }, variant: "mark", size: "md" }, skipLink: { id: "Skip" } };
function site(header?: SiteShellInput["header"], presentation?: SiteFramePresentationConfig) {
  return renderToStaticMarkup(<SiteFrame shell={{ ...shell, header }} presentation={presentation} resolveCopy={copy} resolveAsset={asset}><h1>Page</h1></SiteFrame>);
}
const app: AppFrameProps = {
  brand: { markSrc: "/mark.svg", wordmark: "Workspace", label: "Workspace" },
  navigation: { tree: [], label: "Navigation" }, account: { signedOutLabel: "Signed out", sections: [] },
  commands: { heading: "Commands", triggerLabel: "Find commands", searchLabel: "Search commands", closeLabel: "Close commands", emptyMessage: "No commands", groups: [] }, children: <p>View</p>,
};
function bar(props: Partial<AppFrameProps> = {}) {
  return renderToStaticMarkup(<AppFrame {...app} {...props} />).match(/<header\b[^>]*data-application-frame-region="bar"[^>]*>/)?.[0] ?? "";
}

describe("Publisher frame header member forwarding", () => {
  it("preserves omitted site position and does not synthesize a member", () => {
    expect(normalizeSiteFrameConfig()).not.toHaveProperty("headerPosition");
    expect(site().match(/<header\b[^>]*>/)?.[0]).toContain("position:relative");
  });
  it("forwards sticky and gives instance static precedence over inherited sticky", () => {
    expect(site({ position: "sticky" })).toContain("z-index:var(--ui-z-sticky, 10)");
    const header = site({ position: "sticky" }, { headerPosition: "static" }).match(/<header\b[^>]*>/)?.[0];
    expect(header).toContain("position:static");
    expect(header).not.toContain("--ui-z-sticky");
    expect(site({ position: "static" }, { headerPosition: "sticky" })).toContain("z-index:var(--ui-z-sticky, 10)");
  });
  it("merges position independently of inherited surface and tone", () => {
    expect(resolveShell({ ...shell, header: { surface: "transparent", tone: "inverse", position: "sticky" } }, copy, asset, { headerPosition: "static" }).header)
      .toEqual({ surface: "transparent", tone: "inverse", position: "static" });
  });
  it("keeps glass fixed and rejects static glass across both input layers", () => {
    expect(site({ surface: "glass", position: "sticky" })).toContain("position:fixed");
    expect(() => site({ surface: "glass", position: "static" })).toThrow();
    expect(() => site({ surface: "glass" }, { headerPosition: "static" })).toThrow();
    expect(() => site({ position: "static" }, { headerSurface: "glass" })).toThrow();
  });
  it("refuses values outside the finite position vocabulary without echoing input", () => {
    const attempt = () => normalizeSiteFrameConfig({ headerPosition: "PAYLOAD-SENTINEL" });
    expect(attempt).toThrow();
    try { attempt(); } catch (error) { expect(String(error)).not.toContain("PAYLOAD-SENTINEL"); }
    expect(SITE_FRAME_CONTRACT.required).not.toContain("sticky-header");
    expect(SITE_FRAME_CONTRACT.constituents.Header.config).toContain("headerPosition");
  });
  it("forwards AppFrame solid sticky and static, preserving legacy omissions", () => {
    expect(bar()).toContain("position:sticky");
    expect(bar()).toContain("rounded-control");
    const sticky = bar({ headerPosition: "sticky", headerSurface: "solid" });
    expect(sticky).toContain("position:sticky");
    expect(sticky).toContain("border-bottom-width:var(--ui-border-hairline, 1px)");
    const flow = bar({ headerPosition: "static", headerSurface: "solid" });
    expect(flow).toContain("position:static");
    expect(flow).not.toContain("--ui-z-sticky");
  });
  it("keeps the explicit static header in reserved flow without a sticky layer", () => {
    const html = renderToStaticMarkup(<AppFrame {...app} headerPosition="static" headerSurface="solid" />);
    expect(bar({ headerPosition: "static", headerSurface: "solid" })).toContain("position:static");
    expect(html).not.toContain("--ui-z-sticky");
    expect(html).toContain('data-application-frame-region="header"');
    expect(html).toContain('data-application-frame-region="stage"');
  });
  it("forwards AppFrame glass as fixed and refuses static glass", () => {
    expect(bar({ headerPosition: "sticky", headerSurface: "glass" })).toContain("position:fixed");
    expect(() => bar({ headerPosition: "static", headerSurface: "glass" })).toThrow();
  });
});
