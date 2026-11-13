import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { posix } from "node:path";
import ts from "typescript";
import { compile } from "tailwindcss";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { checkLayoutRender } from "./layout-render.js";
import type { LayoutRenderOptions, LayoutRenderResult } from "./layout-render.js";
import type { LayoutRendererSource } from "../core/instance-binding.js";
import { instanceFixture } from "../core/__fixtures__/instance-binding/fixtures.js";
import { getEffectiveLayoutContract, LAYOUT_LEAVES } from "../layouts/resolve.js";

const browserExecutable = process.env.CHROME_PATH ?? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"].find(existsSync)!;
const names = { "layouts.stack": "Stack", "layouts.split": "Split", "layouts.sidebar-content": "SidebarContent", "layouts.bento": "Bento" } as const;
const breakpoints = { "tokens.breakpoint.mobile": 381, "tokens.breakpoint.tablet": 731, "tokens.breakpoint.tablet-lg": 1009, "tokens.breakpoint.desktop": 1259 };
function closure(entry: string): LayoutRendererSource {
  const files: Record<string, string> = {}, pending = [entry];
  while (pending.length) {
    const file = pending.pop()!;
    if (Object.hasOwn(files, file)) continue;
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    files[file] = source;
    if (file.endsWith(".json")) continue;
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    for (const statement of parsed.statements) {
      if ((!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      if (ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly || ts.isExportDeclaration(statement) && statement.isTypeOnly) continue;
      const specifier = statement.moduleSpecifier.text;
      if (!specifier.startsWith(".")) continue;
      const target = posix.normalize(posix.join(posix.dirname(file), specifier));
      const resolved = [target, target.replace(/\.js$/, ".ts"), target.replace(/\.js$/, ".tsx")].find(candidate => existsSync(new URL(`../${candidate}`, import.meta.url)));
      if (!resolved) throw new Error(`Missing fixture closure: ${target}`);
      pending.push(resolved);
    }
  }
  return { entry, files };
}
let css: string;
beforeAll(async () => {
  expect(browserExecutable, "Rendered fixtures require an installed Chromium executable").toBeTruthy();
  // Actual Tailwind compiler over the exact renderer closure's classes, not mock CSS geometry.
  const candidates = new Set<string>();
  for (const name of Object.values(names)) for (const source of Object.values(closure(`web/layouts/${name}.tsx`).files)) {
    for (const literal of source.matchAll(/["']([^"'\n]+)["']/g)) for (const candidate of literal[1]!.split(/\s+/)) candidates.add(candidate);
  }
  css = `${(await compile("@tailwind utilities;")).build([...candidates])}
    :root{--spacing-lg:16px;--spacing-md:12px;--spacing-xl:24px;--ui-width-wide-max:960px;--ui-width-content-max:720px;--ui-width-prose-max:640px;--ui-width-form-max:480px;--ui-layout-aside-w:220px}
    *,::before,::after{box-sizing:border-box}html,body{margin:0}h1,h2,p{margin:0}[data-lk12-fill]{min-height:64px;overflow-wrap:anywhere}`;
});

function fixture(leafId: keyof typeof names = "layouts.split", configId = "split.default", members?: Record<string, string>) {
  const f = instanceFixture();
  f.binding.layout = { leaf: leafId, config: configId, ...(members ? { members } : {}) };
  const contract = getEffectiveLayoutContract(leafId, configId, members);
  f.binding.fills = {};
  for (const slot of contract.slots) {
    const count = slot.id === "lead" ? 1 : slot.id === "close" ? 0 : Math.max(slot.min, slot.id === "tiles" ? 4 : 1);
    const section = (slot.id === "lead" ? slot.accepts[0] : slot.accepts.find(id => id !== "sections.hero" && id !== "sections.page-header"))!;
    f.binding.fills[slot.id] = Array.from({ length: count }, () => ({ section, config: "default", content: { title: { kind: "copy" as const, ref: "copy.title" } } }));
    if (!f.registries.sections.some(leaf => leaf.id === section)) f.registries.sections.push({ id: section, status: "stable", contract: { surface: "both", configs: ["default"], slots: [{ name: "title", type: "copy", required: true }], states: ["loading"], container: "adaptive" } });
    f.put(section, "default", { headings: slot.id === "lead" ? [1] : [2], bandGround: "base" });
  }
  f.registries.tokens = [
    ...["md", "lg", "xl"].map(member => ({ id: `themes.spacing.${member}` as const, property: `--spacing-${member}` })),
    ...["wide", "content", "prose", "form"].map(member => ({ id: `tokens.content-size.${member}` as const, property: `--ui-width-${member}-max` })),
    { id: "tokens.region-width.aside", property: "--ui-layout-aside-w" },
    ...Object.keys(breakpoints).map(id => ({ id: id as keyof typeof breakpoints, property: `--breakpoint-${id.split(".").at(-1)}` })),
  ];
  const renderer = closure(`web/layouts/${names[leafId]}.tsx`);
  f.put(leafId, configId, { leadGround: "base", renderer });
  const options: LayoutRenderOptions = { browserExecutable, exportName: names[leafId], breakpointValues: structuredClone(breakpoints), css,
    renderSection: (_, path) => <article><p>{path} audience content that wraps across narrow columns</p></article> };
  return { ...f, options, renderer };
}
const run = (f: ReturnType<typeof fixture>, overrides: Partial<LayoutRenderOptions> = {}) => checkLayoutRender(f.binding, f.library, f.registries, { ...f.options, ...overrides });
const paths = (result: LayoutRenderResult, width: number) => result.measurements.find(measurement => measurement.width === width)!.fills.map(fill => fill.path);
const configs = LAYOUT_LEAVES.filter(leaf => leaf.status === "draft" || leaf.status === "stable").flatMap(leaf => leaf.contract.configs.map(config => [leaf.id as keyof typeof names, config.id] as const));

describe("LK12 actual Chromium layout assembly", () => {
  it.each(configs)("measures exact %s %s source at every consumer breakpoint edge", async (leaf, config) => {
    const result = await run(fixture(leaf, config));
    expect(result.staticResult?.findings).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.layoutStatus).toBe("valid");
    expect(result.pendingChecks).toEqual(["LK12"]);
    expect(result.scope).toBe("layout-assembly-with-supplied-section-content-and-css");
    expect(result.measurements.map(item => item.width)).toEqual(result.requiredWidths);
    expect(result.requiredWidths).toContain(320);
    for (const item of result.measurements) {
      expect(item.viewport).toBe(item.width);
      expect(item.fills.every(fill => fill.width > 0 && fill.height > 0)).toBe(true);
      expect(item.payloadDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
    expect(result.sourceDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.bundleDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    process.stdout.write("layout-render geometry " + JSON.stringify({ leaf, config, widths: result.requiredWidths,
      measured: result.measurements.length, narrow: result.measurements[0]!.fills[0], wide: result.measurements.at(-1)!.fills[0] }) + "\n");
  }, 60000);

  it.each([
    ["overflow", "[data-lk12-fill]{min-width:1800px}"],
    ["hidden overflow", "body{overflow-x:hidden}[data-lk12-fill]{min-width:1800px}"],
    ["order", "[data-layout-slot=start]{order:3}"],
    ["reverse", "[data-layout=\"layouts.split\"]>div:last-child{flex-direction:row-reverse!important}"],
    ["dense", "[data-layout=\"layouts.split\"]{grid-auto-flow:row dense}"],
    ["overlapping placement", "[data-layout-slot=start],[data-layout-slot=end]{position:absolute;left:0;top:0}"],
    ["grid placement", "[data-layout=\"layouts.split\"]{display:flex;flex-direction:column}[data-layout-slot=lead]{position:absolute;top:500px}"],
  ])("rejects the actual %s CSS mutation", async (_, mutation) => {
    const result = await run(fixture(), { css: css + mutation });
    expect(result.measurements).toHaveLength(result.requiredWidths.length);
    expect(result.layoutStatus).toBe("refused");
    expect(result.findings.some(finding => /overflow|order/.test(finding))).toBe(true);
  }, 60000);

  it("preserves visual order for unequal-height centered panels and column reading groups", async () => {
    const result = await run(fixture("layouts.split", "split.default", { align: "center" }), {
      renderSection: (_, path) => <article style={{ minHeight: path.includes("start") ? 128 : 64 }}>{path}</article>,
    });
    expect(result.findings).toEqual([]);
    expect(result.layoutStatus).toBe("valid");
    const wide = result.measurements.at(-1)!;
    const start = wide.fills.find(fill => fill.path === "fills.start.0")!, end = wide.fills.find(fill => fill.path === "fills.end.0")!;
    expect(start.top).toBeLessThan(end.top);
    expect(start.bottom).toBeGreaterThan(end.bottom);
    expect(wide.visualOrder).toEqual(wide.fills.map(fill => fill.path));
  }, 60000);

  it("collapse changes DOM order and never relies on CSS order", async () => {
    const normal = await run(fixture());
    const reversed = await run(fixture("layouts.split", "split.default", { collapse: "end-first" }));
    expect(reversed.findings).toEqual([]);
    expect(paths(normal, 320)).toEqual(["fills.lead.0", "fills.start.0", "fills.end.0"]);
    expect(paths(reversed, 320)).toEqual(["fills.lead.0", "fills.end.0", "fills.start.0"]);
    expect(reversed.measurements.every(item => !item.reorder.length)).toBe(true);
  }, 60000);

  it("stacked aside changes DOM order across its resolved breakpoint", async () => {
    // Use an unconstrained config projection to exercise the closed member variant.
    const f = fixture("layouts.sidebar-content", "sidebar-content.record");
    const leaf = f.registries.layouts.find(leaf => leaf.id === "layouts.sidebar-content")!;
    leaf.contract.configs.find(config => config.id === "sidebar-content.record")!.members["stacked-aside"] = "before";
    f.binding.layout.members = { "stacked-aside": "before" };
    const sourceRegistry = JSON.parse(f.renderer.files["layouts/slots/layouts.json"]!);
    sourceRegistry.find((item: any) => item.id === "layouts.sidebar-content").contract.configs.find((config: any) => config.id === "sidebar-content.record").members["stacked-aside"] = "before";
    f.renderer.files["layouts/slots/layouts.json"] = JSON.stringify(sourceRegistry);
    const result = await run(f);
    expect(result.findings).toEqual([]);
    expect(paths(result, 730)).toEqual(["fills.lead.0", "fills.aside.0", "fills.main.0"]);
    expect(paths(result, 731)).toEqual(["fills.lead.0", "fills.main.0", "fills.aside.0"]);
    expect(result.measurements.every(item => !item.reorder.length)).toBe(true);
  }, 60000);

  it("retains missing breakpoint values and incomplete width matrices as pending", async () => {
    const missing = await run(fixture(), { breakpointValues: {} });
    expect(missing.layoutStatus).toBe("pending");
    expect(missing.measurements).toEqual([]);
    // A real CSS mutation hides one measurement at only one required edge.
    const incomplete = await run(fixture(), { css: css + "@media(width:732px){[data-lk12-fill]{display:none}}" });
    expect(incomplete.layoutStatus).toBe("pending");
    expect(incomplete.requiredWidths).toEqual([320, 730, 731, 732]);
    expect(incomplete.findings).toContain("732: incomplete viewport or fill measurements");
    const invisible = await run(fixture(), { css: css + "@media(width:732px){[data-lk12-fill]{opacity:0}}" });
    expect(invisible.layoutStatus).toBe("pending");
    expect(invisible.findings).toContain("732: incomplete viewport or fill measurements");
  }, 60000);

  it("requires one nonzero measurement for every bound fill and no additional markers", async () => {
    const result = await run(fixture(), { renderSection: () => <div data-lk12-fill="foreign">Foreign marker</div> });
    expect(result.layoutStatus).toBe("pending");
    expect(result.findings.every(item => item.includes("incomplete"))).toBe(true);
    const empty = fixture();
    empty.put("layouts.split", "split.default", { leadGround: "base", renderer: { entry: "Layout.tsx", files: { "Layout.tsx": 'export const Split = () => <div className="grid" />;' } } });
    expect((await run(empty)).layoutStatus).toBe("pending");
  }, 60000);

  it("uses one data snapshot despite mutation during section rendering", async () => {
    const f = fixture();
    const originalCss = f.options.css;
    const result = await run(f, { renderSection: (_, path) => {
      f.binding.layout.config = "missing";
      f.binding.layout.members = { collapse: "end-first" };
      (f.options.breakpointValues as Record<string, number>)["tokens.breakpoint.tablet"] = 900;
      (f.options as { css: string; exportName: string }).css += "[data-lk12-fill]{min-width:1800px}";
      (f.options as { exportName: string }).exportName = "Missing";
      f.registries.layouts.length = 0;
      return <p>{path}</p>;
    } });
    expect(result.findings).toEqual([]);
    expect(result.layoutStatus).toBe("valid");
    expect(result.requiredWidths).toEqual([320, 730, 731, 732]);
    expect(paths(result, 320)).toEqual(["fills.lead.0", "fills.start.0", "fills.end.0"]);
    expect(result.cssDigest).toBe(`sha256:${createHash("sha256").update(originalCss).digest("hex")}`);
  }, 60000);

  it("refuses source pin mismatch and source swaps during preparation", async () => {
    expect((await run(fixture(), { sourceDigest: "sha256:" + "0".repeat(64) })).layoutStatus).toBe("refused");
    const f = fixture();
    const result = await run(f, { renderSection: (_, path) => {
      f.renderer.files[f.renderer.entry] += "\n";
      return <p>{path}</p>;
    } });
    expect(result.layoutStatus).toBe("refused");
    expect(result.findings).toEqual(["Consumer layout source changed during preparation"]);
  });

  it("does not execute missing exports, missing dependencies, source escapes or failed purity", async () => {
    const absent = await run(fixture(), { exportName: "Missing" });
    expect(absent.layoutStatus).toBe("pending");
    expect(absent.measurements).toEqual([]);
    const dependency = fixture();
    delete dependency.renderer.files["web/layouts/preview/structure.tsx"];
    expect((await run(dependency)).layoutStatus).toBe("refused");
    const escape = fixture();
    escape.renderer.files["../outside.ts"] = "export const secret = 1";
    expect((await run(escape)).layoutStatus).toBe("refused");
    const external = fixture();
    external.renderer.files[external.renderer.entry] = 'import { readFileSync } from "node:fs"; export const Split = () => <div />;';
    expect((await run(external)).layoutStatus).toBe("refused");
    const impure = fixture();
    impure.renderer.files[impure.renderer.entry] = 'export const Split = () => <div style={{order:2}} />';
    expect((await run(impure)).layoutStatus).toBe("refused");
  }, 60000);

  it("preserves an unavailable browser or toolchain as pending", async () => {
    expect((await run(fixture(), { browserExecutable: "/nonexistent/publisher-render-browser" })).layoutStatus).toBe("pending");
    vi.doMock("esbuild", () => { throw new Error("unavailable bundler"); });
    try { expect((await run(fixture())).layoutStatus).toBe("pending"); }
    finally { vi.doUnmock("esbuild"); }
  }, 60000);
});
