import { describe, expect, it } from "vitest";
import ts from "typescript";
import { checkInstance as rawInstance, checkInstancePack as rawPack, checkLayoutRendererSource as rawSource, inspectInstanceChecks } from "./instance-binding.check.js";
import { CLEAN_SOURCE, instanceFixture, key, splitFixture, tileFixture } from "./__fixtures__/instance-binding/fixtures.js";
import type { LayoutCompilerPort } from "./layout-source.js";
import type { InstanceCheckCode, InstanceCheckResult } from "./instance-binding.js";

const kindNames = new Map(Object.entries(ts.SyntaxKind).filter(([key, value]) => typeof value === "number" && !/^(?:First|Last|Count)/.test(key)).map(([key, value]) => [value, key]));
const compiler: LayoutCompilerPort = {
  parseSourceFile: (file, source) => ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS),
  kind: value => kindNames.get((value as ts.Node).kind) ?? "Unknown",
  children: value => { const children: ts.Node[] = []; ts.forEachChild(value as ts.Node, child => { children.push(child); }); return children; },
};
const checkInstance = (...args: Parameters<typeof rawInstance>) => rawInstance(args[0], args[1], args[2], compiler);
const checkInstancePack = (...args: Parameters<typeof rawPack>) => rawPack(args[0], args[1], args[2], compiler);
const checkLayoutRendererSource = (...args: Parameters<typeof rawSource>) => rawSource(args[0], args[1], args[2], compiler);

const codes = (result: InstanceCheckResult) => result.findings.map(finding => finding.code);
type Fixture = ReturnType<typeof instanceFixture>;
const run = (fixture: Fixture) => checkInstance(fixture.binding, fixture.library, fixture.registries);
const layoutFill = (fixture: Fixture) => fixture.fills.get(key(fixture.binding.layout.leaf, fixture.binding.layout.config))!;
const heroFill = (fixture: Fixture) => fixture.fills.get(key("sections.hero", "default"))!;
const contentFill = (fixture: Fixture) => fixture.fills.get(key("sections.content", "default"))!;

const cases: { code: InstanceCheckCode; setup?: () => Fixture; fail: (fixture: Fixture) => void }[] = [
  { code: "LK1", fail: f => { f.registries.frames[0]!.status = "held"; } },
  { code: "LK2", fail: f => { delete (f.binding.layout as { config?: string }).config; } },
  { code: "LK3", fail: f => { f.binding.fills.unknown = []; } },
  { code: "LK4", fail: f => { f.binding.fills.lead![0]!.section = "sections.content"; } },
  { code: "LK5", fail: f => { f.binding.fills.body = []; } },
  { code: "LK6", fail: f => { f.binding.fills.lead![0]!.span = "1x1"; } },
  { code: "LK7", fail: f => { heroFill(f).library = "foundry"; } },
  { code: "LK8", fail: f => { contentFill(f).headings = [1]; } },
  { code: "LK9", fail: f => { layoutFill(f).leadGround = "inverse"; } },
  { code: "LK10", fail: f => { f.binding.fills.lead![0]!.content.title = "Literal copy" as never; } },
  { code: "LK11", fail: f => { layoutFill(f).renderer!.files["Layout.tsx"] = 'export const Layout = () => <div className="bg-red-500" />;'; } },
  { code: "LK13", setup: tileFixture, fail: f => { delete f.registries.sections.find(leaf => leaf.id === "sections.stats")!.contract.container; } },
  { code: "LK14", fail: f => { contentFill(f).states = []; } },
];

describe("InstanceBinding v2 static LK contract", () => {
  it("checks every authored descendant's exact consumer fill and typed content", () => {
    const f = instanceFixture(), child = structuredClone(f.binding.fills.body![0]!);
    f.binding.fills.body![0]!.children = [child];
    expect(run(f).staticStatus).toBe("valid");
    child.content.title = { kind: "copy", ref: "missing" };
    expect(run(f).findings).toContainEqual({ code: "LK10", path: "fills.body.0.children.0.content.title", message: "Content must resolve by typed reference in the consumer registry" });
    child.section = "sections.notices";
    expect(run(f).findings.some(finding => finding.path === "fills.body.0.children.0" && finding.code === "LK4")).toBe(true);
  });
  it("validates additive repeat/lazy declarations through the authored template and withholds dynamic coverage", () => {
    const f = instanceFixture();
    Object.assign(f.binding.fills.body![0]!, { repeat: { over: { kind: "records", ref: "bands" }, key: "id" } });
    Object.assign(f.binding.fills.body![0]!.content.title!, { lazy: { loader: "chunk", args: { l0: "records" } } });
    const result = inspectInstanceChecks(f.binding, f.library, f.registries, compiler);
    expect(result.result.staticStatus).toBe("valid");
    expect(result.unavailableChecks).toEqual(expect.arrayContaining(["LK5", "LK10"]));
    Object.assign(f.binding.fills.body![0]!.repeat!, { execute: "host callback" });
    expect(run(f).staticStatus).toBe("refused");
  });
  it.each(["non-owner", "invalid receipt", "frame", "layout", "missing grounds"] as const)("preserves the exact public result when %s coverage becomes unavailable", mutation => {
    const f = instanceFixture();
    let path = "fills.body.0";
    if (mutation === "non-owner") f.fills.delete(key("sections.content", "default"));
    else if (mutation === "invalid receipt") contentFill(f).library = "other";
    else if (mutation === "frame") { path = "frame"; f.fills.delete(key(f.binding.frame.leaf, f.binding.frame.config)); }
    else if (mutation === "layout") {
      path = "layout";
      f.fills.get(key(f.binding.frame.leaf, f.binding.frame.config))!.headerGround = "opaque";
      f.fills.delete(key(f.binding.layout.leaf, f.binding.layout.config));
    } else {
      f.fills.get(key(f.binding.frame.leaf, f.binding.frame.config))!.headerGround = "opaque";
      delete layoutFill(f).leadGround; delete heroFill(f).bandGround;
    }
    const expected: InstanceCheckResult = {
      staticStatus: mutation === "missing grounds" ? "valid" : "refused",
      findings: mutation === "missing grounds" ? [] : [
        { code: "LK7", path, message: "Fill must resolve exactly in the consumer library" },
        ...(mutation === "layout" ? [{ code: "LK11" as const, path: "layout.renderer", message: "Actual layout renderer source is required" }] : []),
      ], pendingChecks: ["LK12"],
    };
    expect(run(f)).toEqual(expected);
    expect(inspectInstanceChecks(f.binding, f.library, f.registries, compiler).result).toEqual(expected);
  });
  it("reports actual static completion independently from a valid verdict or rendered proof", () => {
    const f = instanceFixture();
    expect(inspectInstanceChecks(f.binding, f.library, f.registries, compiler)).toMatchObject({
      completed: true, unavailableChecks: [], result: run(f),
    });
    f.binding.fills.body = [];
    expect(inspectInstanceChecks(f.binding, f.library, f.registries, compiler)).toMatchObject({ completed: true });
    f.binding.layout.config = "missing";
    expect(inspectInstanceChecks(f.binding, f.library, f.registries, compiler)).toMatchObject({ completed: false });
  });
  it("keeps skipped content inspection explicit when any bound section has no contract", () => {
    const f = instanceFixture();
    f.registries.sections = [];
    const evidence = inspectInstanceChecks(f.binding, f.library, f.registries, compiler);
    expect(evidence.completed).toBe(true);
    expect(evidence.unavailableChecks).toEqual(["LK10", "LK14"]);
    expect(evidence.result.findings.some(finding => finding.code === "LK4")).toBe(true);
    expect(evidence.result.pendingChecks).toEqual(["LK12"]);
  });
  for (const { code, setup = instanceFixture, fail } of cases) {
    it(`${code} passing fixture`, () => { expect(run(setup())).toEqual({ staticStatus: "valid", findings: [], pendingChecks: ["LK12"] }); });
    it(`${code} failing fixture`, () => { const fixture = setup(); fail(fixture); expect(codes(run(fixture))).toContain(code); });
  }
  it("LK15 passing pack fixture leaves rendered LK12 pending", () => {
    const f = instanceFixture();
    const other = structuredClone(f.binding); other.instanceId = "example.about";
    expect(checkInstancePack([f.binding, other], f.library, f.registries)).toEqual({ staticStatus: "valid", findings: [], pendingChecks: ["LK12"] });
  });
  it("LK15 fails duplicate ids and failing members, and permits per-instance registered frame configs", () => {
    const f = instanceFixture();
    expect(codes(checkInstancePack([f.binding, f.binding], f.library, f.registries))).toContain("LK15");
    const other = structuredClone(f.binding); other.instanceId = "example.about"; other.frame.config = "minimal";
    expect(run({ ...f, binding: other }).staticStatus).toBe("valid");
    expect(checkInstancePack([f.binding, other], f.library, f.registries).staticStatus).toBe("valid");
    other.frame.config = "site"; other.fills.body = [];
    expect(codes(checkInstancePack([f.binding, other], f.library, f.registries))).toContain("LK15");
  });
  it("LK15 refuses different frame leaves on the same pack surface", () => {
    const f = instanceFixture(), other = structuredClone(f.binding);
    other.instanceId = "example.about"; other.frame.leaf = "frames.app-shell";
    expect(codes(checkInstancePack([f.binding, other], f.library, f.registries))).toContain("LK15");
    other.frame = { leaf: "frames.site-shell", config: "missing" };
    expect(codes(checkInstancePack([f.binding, other], f.library, f.registries))).toContain("LK1");
  });
  it("never treats static success as rendered responsive proof", () => {
    expect(run(instanceFixture()).pendingChecks).toEqual(["LK12"]);
  });
  it("passes actual registered split and bento presets and still rejects missing configs", () => {
    for (const fixture of [splitFixture(), tileFixture()]) {
      expect(run(fixture)).toEqual({ staticStatus: "valid", findings: [], pendingChecks: ["LK12"] });
      delete (fixture.binding.layout as { config?: string }).config;
      expect(codes(run(fixture))).toContain("LK2");
    }
  });
  it("checks config narrowing, member closure and known retired layout status", () => {
    for (const change of [
      (f: Fixture) => { f.binding.layout.members = { align: "unknown" }; },
      (f: Fixture) => { f.registries.layouts[0]!.contract.configs[0]!.slotOverrides = { lead: { max: 9 } }; },
      (f: Fixture) => { f.registries.layouts[0]!.status = "deprecated"; },
    ]) { const f = instanceFixture(); change(f); expect(codes(run(f))).toContain("LK2"); }
  });
  it("uses effective acceptance/count narrowing and contract order, not object insertion order", () => {
    const f = instanceFixture();
    f.binding.fills = { body: f.binding.fills.body!, lead: f.binding.fills.lead! };
    expect(run(f).staticStatus).toBe("valid");
    f.binding.fills.lead = [];
    expect(codes(run(f))).toContain("LK5");
    f.binding.fills.lead = [{ section: "sections.page-header", content: {} }];
    expect(codes(run(f))).toContain("LK4");
  });
  it("rejects unknown section configs and invalid tile spans", () => {
    const f = instanceFixture(); f.binding.fills.lead![0]!.config = "missing";
    expect(codes(run(f))).toContain("LK4");
    const bento = tileFixture(); bento.binding.fills.tiles![0]!.span = "3x3" as never;
    expect(codes(run(bento))).toContain("LK6");
  });
  it("never asks a catalog for missing consumer fills, or accepts wrong leaf/config receipts", () => {
    for (const change of [
      (f: Fixture) => { f.fills.delete(key("sections.hero", "default")); },
      (f: Fixture) => { heroFill(f).leaf = "sections.content"; },
      (f: Fixture) => { heroFill(f).config = "other"; },
      (f: Fixture) => { layoutFill(f).library = "catalog"; },
    ]) { const f = instanceFixture(); change(f); expect(codes(run(f))).toContain("LK7"); }
  });
  it("rejects a direct package import field in a binding", () => {
    const f = instanceFixture(); (f.binding as unknown as Record<string, unknown>).import = "@example/layout";
    expect(codes(run(f))).toContain("LK7");
  });
  it("assigns the app page h1 to the app header and refuses any second owner", () => {
    const f = instanceFixture(); f.binding.surface = "app"; f.binding.frame = { leaf: "frames.app-shell", config: "page" };
    heroFill(f).headings = [2]; expect(run(f).staticStatus).toBe("valid");
    heroFill(f).headings = [1]; expect(codes(run(f))).toContain("LK8");
  });
  it("does not count a later hero or a frame-slot heading as a legal site owner", () => {
    const f = instanceFixture(); heroFill(f).headings = [2]; contentFill(f).headings = [1];
    expect(codes(run(f))).toContain("LK8");
    f.binding.frame.slotFills = { consent: f.binding.fills.lead![0]! };
    expect(codes(run(f))).toContain("LK8");
  });
  it("requires declared ground for transparent headers and equal first-band ground", () => {
    const f = instanceFixture(); delete heroFill(f).bandGround; delete layoutFill(f).leadGround;
    expect(codes(run(f))).toContain("LK9");
  });
  it("checks required refs, unknown content slots, wrong types, and unresolved registry refs", () => {
    for (const change of [
      (f: Fixture) => { delete f.binding.fills.lead![0]!.content.title; },
      (f: Fixture) => { f.content.clear(); },
      (f: Fixture) => { f.binding.fills.lead![0]!.content.title!.kind = "media"; },
      (f: Fixture) => { f.binding.fills.lead![0]!.content.extra = { kind: "copy", ref: "copy.title" }; },
    ]) { const f = instanceFixture(); change(f); expect(codes(run(f))).toContain("LK10"); }
  });
  it("checks frame slot content, outline, library and state closure too", () => {
    const f = instanceFixture(); f.binding.frame.slotFills = { context: structuredClone(f.binding.fills.body![0]!) };
    expect(run(f).staticStatus).toBe("valid");
    delete f.binding.frame.slotFills.context!.content.title;
    expect(codes(run(f))).toContain("LK10");
  });
  it("requires every state on both section contracts and all resolved implementations", () => {
    const f = instanceFixture(); f.binding.states = ["unknown"];
    expect(codes(run(f))).toContain("LK14");
    f.binding.states = ["loading"]; layoutFill(f).states = [];
    expect(codes(run(f))).toContain("LK14");
    layoutFill(f).states = ["loading"]; f.registries.sections[0]!.contract.states = [];
    expect(codes(run(f))).toContain("LK14");
  });
  it("fails closed on malformed/accessor/cyclic data and thrown library lookups", () => {
    const f = instanceFixture(); let read = false;
    const accessor = Object.defineProperty({}, "instanceId", { enumerable: true, get() { read = true; return "example.home"; } });
    expect(checkInstance(accessor, f.library, f.registries).staticStatus).toBe("refused"); expect(read).toBe(false);
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    expect(checkInstance(cycle, f.library, f.registries).staticStatus).toBe("refused");
    expect(checkInstance(f.binding, { ...f.library, resolveFill() { throw new Error("offline"); } }, f.registries).staticStatus).toBe("refused");
  });
});

describe("LK11 actual renderer source, conservative closed syntax", () => {
  const check = (source: string) => {
    const f = instanceFixture(); return checkLayoutRendererSource({ entry: "Layout.tsx", files: { "Layout.tsx": source } }, f.registries.layouts[0]!.contract, f.registries.tokens);
  };
  it("passes the clean source fixture and a literal constant reference", () => {
    expect(check(CLEAN_SOURCE)).toEqual([]);
    expect(check('const CLASSES = "grid gap-lg"; export const Layout = () => <div className={CLASSES} />;')).toEqual([]);
  });
  it.each([
    ["R1", 'export const Layout = () => <div style={{gap: "13px"}} />;'],
    ["R1 suppression", '// token-gate:ignore\nexport const Layout = () => <div style={{gap: "13px"}} />;'],
    ["R2", 'export const Layout = () => <div className="hover:bg-red-500" />;'],
    ["R2 dynamic", 'export const Layout = ({name}) => <div className={name} />;'],
    ["R2 unknown", 'export const Layout = () => <div className="grid-lookalike" />;'],
    ["R3", 'export const Layout = () => <div style={{color: "red"}} />;'],
    ["R3 dynamic", 'export const Layout = ({style}) => <div style={style} />;'],
    ["uninspected construction", 'export const Layout = () => { Object.assign(node, {style: {color: "red"}}); return <div />; };'],
    ["visual HTML attribute", 'export const Layout = () => <div bgcolor="red" />;'],
    ["R3 spread", 'export const Layout = ({style}) => <div style={{...style}} />;'],
    ["R4 style", 'export const Layout = () => <style />;'],
    ["R4 HTML", 'export const Layout = () => <div dangerouslySetInnerHTML={{__html: html}} />;'],
    ["R5", 'export const Layout = () => <button />;'],
    ["R6", 'import {Button} from "react-aria-components"; export const Layout = () => <Button />;'],
    ["R6 private", 'import {X} from "@clossys/designer/src/private"; export const Layout = () => <X />;'],
    ["reads", 'export const Layout = () => <div style={{gap: "var(--color-red)"}} />;'],
    ["fallback", 'export const Layout = () => <div style={{gap: "var(--spacing-lg, 1px)"}} />;'],
    ["query", 'const query = "@media (min-width: 768px)"; export const Layout = () => <div />;'],
    ["container query", 'const query = "@container (min-width: 40rem)"; export const Layout = () => <div />;'],
    ["dynamic query", 'const query = matchMedia(name); export const Layout = () => <div />;'],
    ["CSS order", 'export const Layout = () => <div className="order-2" />;'],
    ["dense flow", 'export const Layout = () => <div className="grid-flow-dense" />;'],
    ["reverse", 'export const Layout = () => <div style={{flexDirection: "row-reverse"}} />;'],
    ["uninspected template", 'export const Layout = ({name}) => <div className={`grid ${name}`} />;'],
  ])("refuses %s source fixture", (_, source) => { expect(check(source)).not.toEqual([]); });
  it("checks allowed token reads and resolves every local source dependency", () => {
    const f = instanceFixture(), contract = f.registries.layouts[0]!.contract;
    contract.allowedReads = [];
    expect(checkLayoutRendererSource({ entry: "Layout.tsx", files: { "Layout.tsx": CLEAN_SOURCE } }, contract, f.registries.tokens)).not.toEqual([]);
    contract.allowedReads = ["tokens.spacing"];
    const source = 'import {Child} from "./Child.js"; export const Layout = () => <Child />;';
    expect(checkLayoutRendererSource({ entry: "Layout.tsx", files: { "Layout.tsx": source } }, contract, f.registries.tokens)).not.toEqual([]);
    expect(checkLayoutRendererSource({ entry: "Layout.tsx", files: { "Layout.tsx": source, "Child.tsx": CLEAN_SOURCE.replace("Layout", "Child") } }, contract, f.registries.tokens)).toEqual([]);
  });
  it("refuses absent compiler support for source, instance and pack", () => {
    const f = instanceFixture();
    expect(rawSource({ entry: "Layout.tsx", files: { "Layout.tsx": CLEAN_SOURCE } }, f.registries.layouts[0]!.contract, f.registries.tokens)).not.toEqual([]);
    expect(codes(rawInstance(f.binding, f.library, f.registries))).toContain("LK11");
    expect(codes(rawPack([f.binding], f.library, f.registries))).toContain("LK11");
  });
  it("cannot replace real source with a caller-supplied successful purity flag", () => {
    const f = instanceFixture(); delete layoutFill(f).renderer;
    (layoutFill(f) as unknown as Record<string, unknown>).purityPassed = true;
    expect(codes(run(f))).toContain("LK11");
  });
});

describe("frame member selection narrows the frame's declared members, one per axis", () => {
  const SITE_MEMBERS = ["chrome.full", "chrome.minimal", "footer-placement.flow", "footer-placement.overlay"];
  const selecting = (members: unknown, declared: readonly string[] | null = SITE_MEMBERS, config?: string) => {
    const f = instanceFixture();
    if (declared) (f.registries.frames[0]!.contract as { members?: readonly string[] }).members = declared;
    if (config !== undefined) {
      f.binding.frame.config = config;
      (f.registries.frames[0]!.contract as { configs: string[] }).configs.push(config);
      f.put("frames.site-shell", config, { groundRead: "leadGround", headerGround: "glass" });
    }
    (f.binding.frame as Record<string, unknown>).members = members;
    return f;
  };
  it("accepts a selection of declared members, one per axis", () => {
    const f = selecting({ chrome: "minimal", "footer-placement": "flow" });
    expect(run(f)).toEqual({ staticStatus: "valid", findings: [], pendingChecks: ["LK12"] });
  });
  it.each([
    ["an unknown axis", { density: "compact" }, "Frame member axis is not declared by the frame"],
    ["an unknown member on a known axis", { chrome: "floating" }, "Frame member is not declared on its axis"],
    ["a fully qualified member as the choice", { chrome: "chrome.minimal" }, "Frame member is not declared on its axis"],
  ])("refuses %s with LK1", (_, members, message) => {
    expect(run(selecting(members))).toEqual({ staticStatus: "refused", findings: [{ code: "LK1", path: "frame", message }], pendingChecks: ["LK12"] });
  });
  it.each([
    ["a non-string choice", { chrome: 1 }],
    ["an array", ["chrome.minimal"]],
    ["an empty selection", {}],
    ["an axis that addresses a member", { "chrome.minimal": "minimal" }],
    ["an empty choice", { chrome: "" }],
  ])("refuses %s as an invalid frame binding", (_, members) => {
    expect(run(selecting(members)).findings).toEqual([{ code: "LK1", path: "frame", message: "Invalid frame binding" }]);
  });
  it("refuses a choice that conflicts with the member the frame config already selects", () => {
    expect(run(selecting({ chrome: "minimal" }, SITE_MEMBERS, "chrome.full")).findings).toEqual([{ code: "LK1", path: "frame", message: "Frame member conflicts with the frame config" }]);
    expect(run(selecting({ chrome: "full" }, SITE_MEMBERS, "chrome.full")).staticStatus).toBe("valid");
  });
  it("fails closed when the frame registry declares no members to select from", () => {
    expect(run(selecting({ chrome: "minimal" }, null)).findings).toEqual([{ code: "LK1", path: "frame", message: "Frame member selection requires the frame's declared members" }]);
  });
  it("keeps a binding without a selection valid whether or not members are declared", () => {
    const declared = instanceFixture();
    (declared.registries.frames[0]!.contract as { members?: readonly string[] }).members = SITE_MEMBERS;
    expect(run(declared)).toEqual(run(instanceFixture()));
    expect(run(instanceFixture()).staticStatus).toBe("valid");
  });
});
