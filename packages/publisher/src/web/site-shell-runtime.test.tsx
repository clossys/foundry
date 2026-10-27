// @vitest-environment node

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { dsAttrs, planSurfaceRuntime, scanProvenance } from "@clossys/designer/catalog";
import type { RuntimeJson, RuntimeRenderInput, SurfacePackageEvidence } from "@clossys/designer/catalog";
import { surfaceRendererId, surfaceRuntimePointers } from "@clossys/designer/frames";
import { specimenDataset } from "../../../designer/dist/studio/specimen-dataset.js";
import { packageSurfaceLibrary } from "../../../designer/dist/library-cli/__fixtures__/package-surface-library.js";
import { packageBarrelExports } from "../../../designer/dist/library-cli/surface-package-evidence.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { LandingView } from "#publisher-web-views";
import type { ResolvedSectionedViewDocument } from "../core/sectioned-view.js";
import * as webIndex from "./index.js";
import * as webServer from "./server.js";
import { SITE_SHELL_RUNTIME_POINTER, siteShellRuntimeCallbacks, siteShellRuntimePointers, siteShellRuntimeRenderers } from "./index.js";

const LEAF = "frames.site-shell";
const entry = siteShellRuntimeRenderers[LEAF]!;
const contentOf = (values: Readonly<Record<string, RuntimeJson>>) => Object.fromEntries(Object.entries(values).map(([slot, value]) => [slot, { reference: { kind: "region", ref: `content:${slot}` }, value, hash: "sha256:0" }]));
function inputFor(content: Readonly<Record<string, RuntimeJson>>, options: { members?: readonly string[]; main?: readonly ReactNode[]; toasts?: ReactNode } = {}): RuntimeRenderInput<ReactNode> {
  return {
    path: "frame", fill: { leaf: LEAF }, cell: { theme: "light", state: "default", width: 1280 }, profile: {},
    slots: { main: options.main ?? [<section key="body" {...dsAttrs("sections", "sections.content", "foundry/sections.content")} className="p-md"><a href="#start">Start</a></section>] },
    selection: { leaf: LEAF, fill: `foundry/${LEAF}`, config: null, members: options.members ?? [], content: {} },
    content: contentOf(content),
    ...(options.toasts === undefined ? {} : { host: { navigate: () => undefined, toasts: options.toasts } }),
  } as unknown as RuntimeRenderInput<ReactNode>;
}
const sample = () => entry.sample(specimenDataset);
const render = (input: RuntimeRenderInput<ReactNode>) => renderToStaticMarkup(<>{entry.render(input)}</>);
/** The page root a registered route draws around its Frame, so WL1 scans the page scope. */
const page = (html: string) => `<div ${Object.entries(dsAttrs("pages", "pages.site", "foundry/pages.site")).map(([key, value]) => `${key}="${value}"`).join(" ")}>${html}</div>`;
function scan(html: string) {
  const stamps = [...html.matchAll(/data-ds-leaf="([^"]+)" data-ds-fill="([^"]+)"/g)];
  const selection = Object.fromEntries(stamps.map(([, leaf, fill]) => [leaf!, fill!]));
  return scanProvenance({ html: page(html), route: { id: "site", binding: { frame: { leaf: LEAF }, frameSlots: {}, sections: { body: [{ leaf: "sections.content" }] } } as never }, selection });
}

describe("frames.site-shell publisher runtime renderer", () => {
  it("is one publisher-owned registry entry addressed by the shared renderer id", () => {
    expect(Object.keys(siteShellRuntimeRenderers)).toEqual([LEAF]);
    expect(Object.isFrozen(siteShellRuntimeRenderers)).toBe(true);
    expect(entry.leaf).toBe(LEAF);
    expect(SITE_SHELL_RUNTIME_POINTER).toEqual({ module: "@clossys/publisher/web", export: "siteShellRuntimeRenderers" });
    expect(siteShellRuntimePointers()).toEqual({ [LEAF]: SITE_SHELL_RUNTIME_POINTER });
    expect(Object.keys(siteShellRuntimeCallbacks())).toEqual([surfaceRendererId(LEAF)]);
    expect(siteShellRuntimeCallbacks()[surfaceRendererId(LEAF)]).toBe(entry.render);
    // Designer never claims the leaf; the publisher pointer plugs in beside its registry.
    expect(surfaceRuntimePointers()[LEAF]).toBeUndefined();
    for (const name of ["SITE_SHELL_RUNTIME_POINTER", "siteShellRuntimeRenderers", "siteShellRuntimePointers", "siteShellRuntimeCallbacks"]) {
      expect(Object.keys(webIndex)).toContain(name);
      expect(Object.keys(webServer)).toContain(name);
    }
  });

  it("samples its content from the shared specimen dataset", () => {
    const content = sample() as Record<string, any>;
    expect(Object.keys(content).sort()).toEqual(["footer", "header", "skip-link"]);
    expect(content.header.brand.wordmark).toBe(specimenDataset.assets.mark.name);
    expect(content.header.nav.label).toBe(specimenDataset.navigation.label);
    expect(content.header.nav.links.map((link: { href: string }) => link.href)).toEqual(specimenDataset.navigation.items.map(item => item.href));
    expect(content.footer.legal.entity).toBe(specimenDataset.assets.mark.name);
  });

  it("draws the real SiteFrame from runtime content: landmarks, chrome stamps and the frames.site-shell root stamp", () => {
    const html = render(inputFor(sample(), { toasts: <div role="region" aria-label="Notifications" /> }));
    expect(html).toMatch(/^(?:<link [^>]*\/>)*<div data-frame-root=""[^>]*data-ds-layer="frames" data-ds-leaf="frames.site-shell" data-ds-fill="foundry\/frames.site-shell"/);
    expect(html.match(/<header\b/g)).toHaveLength(1);
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/<footer\b/g)).toHaveLength(1);
    expect(html).toContain('<main id="publisher-main-content" tabindex="-1"');
    expect(html).toContain('href="#publisher-main-content"');
    expect(html).toContain("Skip to content");
    expect(html).toMatch(/<nav[^>]*aria-label="Sections"/);
    for (const item of specimenDataset.navigation.items) expect(html).toContain(`href="${item.href}"`);
    expect(html).toContain(specimenDataset.assets.mark.name);
    expect(html).toContain('data-ds-leaf="frames.site-header"');
    expect(html).toContain('data-ds-leaf="frames.site-footer"');
    expect(html).toContain('role="region" aria-label="Notifications"');
    expect(html.indexOf('aria-label="Notifications"')).toBeGreaterThan(html.indexOf("</footer>"));
    expect(html.indexOf('data-ds-leaf="sections.content"')).toBeGreaterThan(html.indexOf("<main"));
  });

  it("passes provenance: no WL1 chrome, and the site-shell composes the site header and footer", () => {
    const html = render(inputFor(sample()));
    const result = scan(html);
    expect(result.findings.filter(finding => finding.code === "WL1")).toEqual([]);
    expect(result.findings.filter(finding => finding.code === "WL7")).toEqual([]);
    const edges = result.observations.map(row => `${row.from} -> ${row.to}`);
    expect(edges).toContain("frames.site-shell -> frames.site-header");
    expect(edges).toContain("frames.site-shell -> frames.site-footer");
    expect(edges).toContain("frames.site-shell -> sections.content");
  });

  it("a content swap and a member swap visibly change the frame", () => {
    const base = sample() as Record<string, any>;
    const flow = render(inputFor(base));
    const swapped = render(inputFor({ ...base, header: { ...base.header, nav: { ...base.header.nav, links: [{ label: "Pricing", href: "#pricing" }] } } }));
    expect(swapped).not.toBe(flow);
    expect(swapped).toContain('href="#pricing"');
    expect(swapped).not.toContain(`href="${specimenDataset.navigation.items[1]!.href}"`);
    expect(render(inputFor(base, { members: ["footer-placement.flow"] }))).toBe(flow);

    const welcome = { ref: { id: "hero.heading" }, text: "Welcome", recordId: "hero.heading", revision: "1", locale: "en-US", source: { kind: "consumer" as const, reference: "fixture" }, entryId: "hero.heading" };
    const hero: ResolvedSectionedViewDocument = { id: "site-home", resolutions: [welcome], sections: [{ id: "hero", kind: "hero", ground: "inverse", heading: "Welcome" }] };
    const overlayContent = { ...base, header: { ...base.header, surface: "glass", tone: "inverse" } };
    const landing = [<LandingView key="hero" document={hero} header="overlay" fit="frame" landmark="none" />];
    const flowHero = render(inputFor(overlayContent, { members: ["footer-placement.flow"], main: landing }));
    const overlay = render(inputFor(overlayContent, { members: ["footer-placement.overlay"], main: landing }));
    expect(flowHero).not.toContain("data-frame-footer-overlay");
    expect(overlay).toContain("data-frame-footer-overlay");
    expect(overlay).not.toBe(flowHero);
    // Overlay keeps SiteFrame's own scene guard: a non-hero main is refused, never drawn.
    expect(() => render(inputFor(overlayContent, { members: ["footer-placement.overlay"] }))).toThrow(/shell\.footer\.placement/);
  });

  it("refuses content and members it has no mapped prop for", () => {
    const base = sample() as Record<string, any>;
    expect(() => render(inputFor({ ...base, consent: "Accept" }))).toThrow(/frames\.site-shell: consent content has no mapped prop/);
    expect(() => render(inputFor({ ...base, toasts: "toast" }))).toThrow(/toasts content has no mapped prop/);
    expect(() => render(inputFor({ ...base, "skip-link": " " }))).toThrow(/skip-link must be non-empty text/);
    expect(() => render(inputFor({ ...base, header: { ...base.header, stray: true } }))).toThrow(/header has no stray field/);
    expect(() => render(inputFor(base, { members: ["chrome.minimal"] }))).toThrow(/chrome\.minimal member has no mapped prop/);
    const { nav: _nav, ...headerWithoutNav } = base.header;
    expect(() => render(inputFor({ ...base, header: headerWithoutNav }))).toThrow(/header\.actions need header\.nav/);
    // SiteFrame's own footer rules stay in force: a footer link may not repeat a nav destination.
    expect(() => render(inputFor({ ...base, footer: { ...base.footer, links: [{ label: "Again", href: specimenDataset.navigation.items[0]!.href }] } }))).toThrow();
  });

  describe("route wiring", () => {
    let plan: ReturnType<typeof planSurfaceRuntime>;
    let packages: readonly SurfacePackageEvidence[];
    let engine: Parameters<typeof planSurfaceRuntime>[0]["engine"];
    beforeAll(async () => {
      const fixture = await packageSurfaceLibrary();
      // The page-header lease lives on the @clossys/designer/shell barrel, which no surface fill points at.
      const shell = readFileSync(new URL("../../../designer/dist/shell/index.js", import.meta.url), "utf8"), inventory = packageBarrelExports(shell);
      packages = [...fixture.packages, { module: "@clossys/designer/shell", version: "0.0.0", artifactSha256: createHash("sha256").update(shell).digest("hex"), values: inventory.values, types: inventory.types }];
      engine = { catalog: fixture.catalog, library: fixture.library, surfaceOptions: fixture.options };
      plan = planSurfaceRuntime({ engine, packages, renderers: { ...surfaceRuntimePointers(), ...siteShellRuntimePointers() }, leaves: [LEAF] });
    }, 180_000);

    it("plans frames.site-shell through the publisher registry with installed artifact evidence", () => {
      const publisher = packages.find(row => row.module === "@clossys/publisher/web");
      expect(publisher?.values).toContain("siteShellRuntimeRenderers");
      expect(plan.gaps).toEqual([]);
      const frame = plan.manifest.fills.find(fill => fill.leaf === LEAF)!;
      expect(frame.kind).toBe("frame");
      expect(frame.renderer.id).toBe(surfaceRendererId(LEAF));
      expect(Object.values(frame.renderer.source.files)).toEqual([`import { siteShellRuntimeRenderers } from "@clossys/publisher/web";\nexport default siteShellRuntimeRenderers["frames.site-shell"].render;\n`]);
      expect(frame.headerModule?.export).toBe("PageHeaderModule");
      expect(frame.stageModule?.export).toBe("FrameStage");
      expect([...frame.members].sort()).toEqual(["footer-placement.flow", "footer-placement.overlay"]);
      expect(plan.origins[frame.fill]).toBe(`foundry/${LEAF}`);
    });

    it("without the publisher pointer the leaf is a named gap, never an invented renderer", () => {
      const designerOnly = planSurfaceRuntime({ engine, packages, renderers: surfaceRuntimePointers(), leaves: [LEAF] });
      expect(designerOnly.gaps).toEqual([{ leaf: LEAF, reason: "no package-owned renderer" }]);
      expect(designerOnly.manifest.fills).toEqual([]);
    });

    it("the route's Stage-wrapped main renders through the callback the descriptor id names", () => {
      const callback = siteShellRuntimeCallbacks()[plan.manifest.fills.find(fill => fill.leaf === LEAF)!.renderer.id]!;
      const html = renderToStaticMarkup(<>{callback({ ...inputFor(sample()), slots: { main: [<section key="stage" {...dsAttrs("sections", "sections.content", "foundry/sections.content")} className="p-md" />] } })}</>);
      expect(html).toContain('data-ds-leaf="frames.site-shell"');
      expect(html).toMatch(/<main[^>]*><section data-ds-layer="sections"/);
    });
  });
});
