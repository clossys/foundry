// @vitest-environment node
import { describe, expect, it } from "vitest";
import ts from "typescript";
import * as React from "react";
import { createElement as h, forwardRef, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { synthetic } from "./__fixtures__/component-engine/synthetic.js";
import { applyComponentLibraryChange } from "./changeset-components.js";
import { componentLibraryHash, resolveComponents } from "./resolve-components.js";
import { emitComponents } from "./emit-components.js";
import { dsAttrs } from "./provenance-attrs.js";
import { PROVENANCE_FINDING_CODES, scanProvenance, type ProvenanceScanInput } from "./provenance-scan.js";
import { buildUsageGraph, type UsageBindingLike } from "./usage-graph.js";

// SSR fixtures: the Button below is the emitter's real stamped component-index over a synthetic
// package Button, so "drop the wrapper" is the unwrapped implementation itself.
const Impl = forwardRef<HTMLButtonElement, Record<string, unknown>>(function Impl(props, ref) {
  return h("button", { type: "button", className: "button", ...props, ref });
});
function emittedButton(): ComponentType<{ children?: ReactNode }> {
  const input = synthetic();
  const library = applyComponentLibraryChange(input.catalog, input.library, { baseHash: componentLibraryHash(input.library), changes: [{ op: "adopt", slot: input.candidate.slot, source: input.candidate.source }] });
  const profile = resolveComponents({ catalog: input.catalog, library, values: input.check, evidence: input.check, packageExports: { "test-kit/components": ["Button"] } });
  const index = emitComponents(profile, ["component-index"]).find(file => file.path === "components/button/index.ts")!.content;
  const { outputText } = ts.transpileModule(index, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  const modules: Record<string, unknown> = { react: React, "test-kit/components": { Button: Impl } }, exports: Record<string, unknown> = {};
  new Function("require", "exports", outputText)((id: string) => modules[id], exports);
  return exports.Button as ComponentType<{ children?: ReactNode }>;
}
const Button = emittedButton();
const page = dsAttrs("pages", "pages.home", "acme/pages.home");
const hero = dsAttrs("sections", "sections.hero", "foundry/sections.hero");
const faq = dsAttrs("sections", "sections.faq", "foundry/sections.faq");
const selection = { "components.button": "test-kit/components.button", "sections.hero": "foundry/sections.hero", "sections.faq": "foundry/sections.faq", "frames.site": "foundry/frames.site" };
const binding: UsageBindingLike = { frame: { leaf: "frames.site" }, frameSlots: {}, sections: { body: [{ leaf: "sections.hero" }, { leaf: "sections.faq" }] } };
interface Variant { readonly button?: ComponentType<{ children?: ReactNode }>; readonly stray?: boolean; readonly omitFaq?: boolean; readonly heroFill?: string }
function render({ button: Action = Button, stray = false, omitFaq = false, heroFill }: Variant = {}): string {
  return renderToStaticMarkup(h("div", { ...page, className: "page" },
    h("section", { ...hero, ...(heroFill ? { "data-ds-fill": heroFill } : {}), className: "hero" }, h("h1", null, "Welcome"), h(Action, null, "Start")),
    stray ? h(Action, null, "Stray") : null,
    omitFaq ? null : h("section", { ...faq, className: "faq" }, h("p", null, "Question")),
  ));
}
const route = { id: "home", binding };
const inventory = { components: ["components.button"], sections: ["sections.faq", "sections.hero"], frames: ["frames.site"] };
// The route's graph from its declared binding plus the observations of a reference render whose button is
// stamped by hand, independent of the emitter: an emitter that stops stamping then shows up as WL5 and WL7.
const Reference = (props: { children?: ReactNode }) => h("button", { type: "button", className: "button", ...dsAttrs("components", "components.button", "test-kit/components.button"), ...props });
const graph = buildUsageGraph({ inventory, selection, pages: [{ routeId: "home", binding }], runtime: scanProvenance({ html: render({ button: Reference }), route, selection }).observations });
const scan = (html: string, extra: Partial<ProvenanceScanInput> = {}) => scanProvenance({ html, route, selection, graph, ...extra });
const codes = (html: string, extra?: Partial<ProvenanceScanInput>) => [...new Set(scan(html, extra).findings.map(finding => finding.code))];

describe("provenance-scan over SSR fixtures (D3: WL1, WL5, WL6, WL7)", () => {
  it("the stamped render round-trips through the usage graph with no findings", () => {
    const html = render();
    // Against the emitter-independent reference graph first: an emitter that stops stamping fails here with WL5 and WL7.
    expect(scan(html).findings).toEqual([]);
    expect(html).toContain('data-ds-leaf="components.button"');
    const first = scanProvenance({ html, route, selection });
    expect(first.findings).toEqual([]);
    expect(first.observations.map(row => [row.from, row.to, row.kind])).toEqual([
      ["pages.home", "sections.faq", "renders"],
      ["pages.home", "sections.hero", "renders"],
      ["sections.hero", "components.button", "composes"],
    ]);
    expect(first.observations.every(row => row.route === "home")).toBe(true);
    expect(first.observations.find(row => row.to === "components.button")!.selector).toBe('[data-ds-leaf="pages.home"] [data-ds-leaf="sections.hero"] [data-ds-leaf="components.button"]');
    expect(graph.edges.find(edge => edge.from === "sections.hero" && edge.to === "components.button")!.evidence).toEqual(["runtime"]);
    expect(render({ button: Reference })).toBe(html);
  });
  it("mutation: drop the stamping wrapper and WL5 and WL7 fire", () => {
    const findings = scan(render({ button: Impl as unknown as ComponentType<{ children?: ReactNode }> })).findings;
    expect(findings).toEqual([
      { code: "WL5", severity: "error", subject: "components.button", message: "usage-graph composes edge sections.hero -> components.button is not rendered on home" },
      { code: "WL7", severity: "error", subject: "components.button", message: "selected fill test-kit/components.button is not rendered under sections.hero" },
    ]);
  });
  it("mutation: render a button outside a section and WL1 fires", () => {
    const findings = scan(render({ stray: true })).findings;
    expect(findings.filter(finding => finding.code === "WL1")).toEqual([
      { code: "WL1", severity: "error", subject: "pages.home", message: "<button> renders outside any Section or Frame", selector: '[data-ds-leaf="pages.home"] [data-ds-leaf="components.button"]' },
    ]);
    // The stray placement is also an edge the graph never declared.
    expect(findings.map(finding => finding.code)).toContain("WL5");
    // An unstamped interactive element outside a section is WL1 as well.
    expect(codes(render().replace("</div>", '<a href="/x">x</a></div>'))).toEqual(["WL1"]);
  });
  it("mutation: declare a section but omit it and WL6 fires; an undeclared section is WL6 too", () => {
    expect(scan(render({ omitFaq: true })).findings).toEqual([{ code: "WL6", severity: "error", subject: "sections.faq", message: "declared 1 time(s) in the route binding, rendered 0" }]);
    const extra = { ...binding, sections: { body: [{ leaf: "sections.hero" }] } };
    expect(scan(render(), { route: { id: "home", binding: extra } }).findings.map(finding => [finding.code, finding.subject])).toEqual([["WL6", "sections.faq"]]);
  });
  it("WL7: a rendered fill other than the selection, and a package-pointer surface bound to another fill", () => {
    expect(scan(render({ heroFill: "other/sections.hero" })).findings).toEqual([{ code: "WL7", severity: "error", subject: "sections.hero", message: "renders other/sections.hero, selection is foundry/sections.hero", selector: '[data-ds-leaf="pages.home"] [data-ds-leaf="sections.hero"]' }]);
    expect(scan(render(), { surfaces: [{ leaf: "sections.hero", components: { "components.button": "other/components.button" } }] }).findings).toEqual([{ code: "WL7", severity: "error", subject: "sections.hero", message: "binds components.button to other/components.button, selection is test-kit/components.button" }]);
    expect(scan(render(), { surfaces: [{ leaf: "sections.hero", components: { "components.button": "test-kit/components.button" } }] }).findings).toEqual([]);
  });
  it("WL5: missing page root, malformed stamps, rendered leaves without a node and unselected graph endpoints", () => {
    const bare = render().replace(/^<div data-ds-layer="pages" data-ds-leaf="pages.home" data-ds-fill="acme\/pages.home"/, "<div");
    expect(scan(bare).findings.map(finding => [finding.code, finding.subject, finding.message])).toContainEqual(["WL5", "pages.home", "page root stamp is missing; the whole document is scanned as the page"]);
    expect(codes(render().replace('data-ds-layer="sections" data-ds-leaf="sections.faq"', 'data-ds-layer="sections" data-ds-leaf="components.faq"'))).toContain("WL5");
    const sparse = buildUsageGraph({ inventory, selection, pages: [{ routeId: "home", binding }] });
    expect(scan(render(), { graph: sparse }).findings.map(finding => [finding.code, finding.message])).toEqual([["WL5", "rendered composes edge sections.hero -> components.button is not in the usage graph"]]);
    const partial = Object.fromEntries(Object.entries(selection).filter(([leaf]) => leaf !== "sections.faq"));
    const unselected = scan(render(), { selection: partial }).findings.map(finding => [finding.code, finding.subject]);
    expect(unselected).toContainEqual(["WL5", "sections.faq"]);
    expect(unselected).toContainEqual(["WL7", "sections.faq"]);
  });
  it("WL1 in a frame content slot: frame chrome is frame-owned, <main> content needs a Section", () => {
    const frame = dsAttrs("frames", "frames.site", "foundry/frames.site");
    const framed = (content: ReactNode) => renderToStaticMarkup(h("div", { ...page }, h("div", { ...frame, className: "frame" }, h("nav", { className: "nav" }, h("a", { href: "/" }, "Home")), h("main", { className: "main" }, content))));
    const good = framed([h("section", { ...hero, key: "hero", className: "hero" }, h(Button, null, "Start")), h("section", { ...faq, key: "faq", className: "faq" }, "Q")]);
    const framedGraph = buildUsageGraph({ inventory, selection, pages: [{ routeId: "home", binding }], runtime: scanProvenance({ html: good, route, selection }).observations });
    expect(scanProvenance({ html: good, route, selection, graph: framedGraph }).findings).toEqual([]);
    const loose = framed([h("div", { key: "loose", className: "card" }, "Loose"), h("section", { ...hero, key: "hero", className: "hero" }, h(Button, null, "Start")), h("section", { ...faq, key: "faq", className: "faq" }, "Q")]);
    expect(scanProvenance({ html: loose, route, selection, graph: framedGraph }).findings).toEqual([{ code: "WL1", severity: "error", subject: "frames.site", message: "<div> in the frame content slot has no Section ancestor", selector: '[data-ds-leaf="pages.home"] [data-ds-leaf="frames.site"] div' }]);
  });
  it("a Section rendered inside a selected Section is part of the outer fill, not its own placement", () => {
    const header = dsAttrs("sections", "sections.section-header", "foundry/sections.section-header");
    const html = render().replace("<h1>Welcome</h1>", renderToStaticMarkup(h("div", { ...header, className: "header" }, h("h1", null, "Welcome"))));
    expect(html).toContain('data-ds-leaf="sections.section-header"');
    // Not selected, not declared, not in the graph: still no WL5, WL6 or WL7, and the button stays attributed to the hero.
    expect(scan(html).findings).toEqual([]);
    expect(scanProvenance({ html, route, selection }).observations.map(row => [row.from, row.to])).toEqual([["pages.home", "sections.faq"], ["pages.home", "sections.hero"], ["sections.hero", "components.button"]]);
  });
  it("is a pure markup reader: comments, raw text and attribute look-alikes are not stamps", () => {
    const noise = '<!-- <div data-ds-layer="sections" data-ds-leaf="sections.x"> --><script>"<button class=x>"</script><style>.a>b{}</style>';
    expect(scan(render().replace("<h1>", `${noise}<h1 title="a &gt; b">`)).findings).toEqual([]);
    expect(Object.keys(PROVENANCE_FINDING_CODES)).toEqual(["WL1", "WL5", "WL6", "WL7"]);
  });
});
