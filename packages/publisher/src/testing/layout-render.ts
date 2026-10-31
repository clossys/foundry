import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, posix } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { checkInstance } from "../core/instance-binding.check.js";
import type { ConsumerInstanceLibrary, FlowInstanceBinding as InstanceBinding, InstanceCheckResult, InstanceRegistries, LayoutRendererSource, SectionFill } from "../core/instance-binding.js";
import type { LayoutCompilerPort } from "../core/layout-source.js";
import { planFlowStage } from "../core/flow-stage.js";
import { getEffectiveLayoutContract } from "../layouts/resolve.js";
import type { EffectivePageLayoutContract } from "../layouts/resolve.js";
import type { BreakpointValues } from "../core/flow-stage.js";
import { withLayoutBrowser } from "./layout-render.browser.js";
import type { LayoutMeasurement } from "./layout-render.browser.js";

export interface LayoutRenderOptions {
  /** Explicit installed executable. The harness never downloads a browser. */
  readonly browserExecutable: string;
  /** Export in the consumer-resolved source entry, not a substitute component. */
  readonly exportName: string;
  readonly breakpointValues: BreakpointValues;
  readonly css: string;
  /** Only section contents; the harness builds the layout and fill markers. */
  renderSection(fill: SectionFill, path: string): ReactElement;
  /** Optional previously retained pin. A mismatch refuses before execution. */
  readonly sourceDigest?: string;
}
export interface LayoutRenderResult {
  readonly scope: "layout-assembly-with-supplied-section-content-and-css";
  readonly layoutStatus: "valid" | "refused" | "pending";
  /** Frame and actual section runtimes have not been qualified by this harness. */
  readonly pendingChecks: readonly ["LK12"];
  readonly findings: readonly string[];
  readonly requiredWidths: readonly number[];
  readonly measurements: readonly (LayoutMeasurement & { readonly payloadDigest: string })[];
  readonly staticResult?: InstanceCheckResult;
  readonly sourceDigest?: string;
  readonly bundleDigest?: string;
  readonly cssDigest?: string;
}
const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const sourceDigest = (source: LayoutRendererSource) => digest(JSON.stringify([source.entry, Object.entries(source.files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)]));

/** Snapshot only plain data; cloning must not normalize accessors or exotic objects. */
function snapshot<T>(input: T): T {
  const active = new Set<object>();
  const plain = (value: unknown): boolean => {
    if (value === null || value === undefined || typeof value === "string" || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value !== "object" || active.has(value)) return false;
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (prototype !== (array ? Array.prototype : Object.prototype) && prototype !== null) return false;
    const properties = Object.getOwnPropertyDescriptors(value);
    if (array && Object.keys(properties).length !== value.length + 1) return false;
    active.add(value);
    for (const key of Reflect.ownKeys(properties)) {
      if (array && key === "length") continue;
      const property = properties[key as string]!;
      if (typeof key !== "string" || !property.enumerable || !Object.hasOwn(property, "value") || !plain(property.value)) return false;
    }
    active.delete(value);
    return true;
  };
  if (!plain(input)) throw new Error("Input must be plain snapshot data");
  return structuredClone(input);
}

/** No catalog numeric defaults: unresolved or non-integral measurements stay pending. */
function widths(binding: InstanceBinding, contract: EffectivePageLayoutContract, values: BreakpointValues): number[] {
  const addresses = contract.reflow.map(step => step.at);
  // Stack also changes its measure at the sm screen, outside its column reflow.
  if (binding.layout.leaf === "layouts.stack") addresses.push("sm");
  const result = new Set([320]);
  let previous = 0;
  for (const address of addresses) {
    const value = values[address];
    if (!Number.isSafeInteger(value) || value! <= 1 || value! > 100000 || value! <= previous) throw new Error("Unresolved or unordered consumer breakpoint measurement");
    previous = value!;
    for (const width of [value! - 1, value!, value! + 1]) result.add(width);
  }
  return [...result].sort((a, b) => a - b);
}
function expectedOrder(binding: InstanceBinding, contract: EffectivePageLayoutContract, width: number, values: BreakpointValues): string[] {
  const members = { ...Object.fromEntries(Object.entries(contract.members).map(([key, allowed]) => [key, allowed[0]])), ...contract.memberValues };
  let slots = contract.slots.map(slot => slot.id);
  if (binding.layout.leaf === "layouts.split") slots = members.collapse === "end-first" ? ["lead", "end", "start"] : ["lead", "start", "end"];
  if (binding.layout.leaf === "layouts.sidebar-content") {
    const wide = contract.reflow.some(step => width >= values[step.at]!);
    const before = wide ? members.side === "start" : members["stacked-aside"] === "before";
    slots = before ? ["lead", "aside", "main"] : ["lead", "main", "aside"];
  }
  return slots.flatMap(slot => (binding.fills[slot] ?? []).map((_, index) => `fills.${slot}.${index}`));
}

/** Tool loading is optional; importing ./testing does not require the development toolchain. */
async function tools(): Promise<{ compiler: LayoutCompilerPort; build: (options: any) => Promise<{ outputFiles: { text: string }[] }> }> {
  const parserName = "typescript", bundlerName = "esbuild";
  const ts = await import(parserName), esbuild = await import(bundlerName);
  const kinds = new Map(Object.entries(ts.SyntaxKind).filter(([key, value]) => typeof value === "number" && !/^(?:First|Last|Count)/.test(key)).map(([key, value]) => [value, key]));
  return { build: esbuild.build, compiler: {
    parseSourceFile: (file, source) => ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS),
    kind: value => kinds.get((value as { kind: number }).kind) ?? "Unknown",
    children: value => { const result: unknown[] = []; ts.forEachChild(value, (child: unknown) => { result.push(child); }); return result; },
  } };
}

async function bundleRenderer(source: LayoutRendererSource, exportName: string, build: Awaited<ReturnType<typeof tools>>["build"]): Promise<string> {
  const require = createRequire(import.meta.url);
  const resolveDir = dirname(require.resolve("react/package.json"));
  const entry = "publisher-layout-bootstrap";
  const bootstrap = `import * as renderer from "publisher-layout-source";
    import { createElement } from "react";
    import { createRoot } from "react-dom/client";
    import { flushSync } from "react-dom";
    globalThis.__publisherLayoutRender = input => {
      const Layout = renderer[${JSON.stringify(exportName)}];
      if (typeof Layout !== "function") throw new Error("Missing layout export");
      const slots = Object.fromEntries(Object.entries(input.slots).map(([slot, fills]) => [slot, fills.map(fill =>
        createElement("div", { key: fill.path, "data-lk12-fill": fill.path, dangerouslySetInnerHTML: { __html: fill.html } }))]));
      flushSync(() => createRoot(document.getElementById("lk12-root")).render(createElement(Layout, { ...input.props, slots })));
      document.body.dataset.lk12Ready = "true";
    };`;
  const output = await build({ entryPoints: [entry], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", logLevel: "silent", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "closed-layout-source", setup(plugin: any) {
    plugin.onResolve({ filter: /.*/ }, (args: { path: string; namespace: string; importer: string }) => {
      if (args.path === entry && !args.importer) return { path: entry, namespace: "bootstrap" };
      if (args.namespace === "bootstrap" && args.path === "publisher-layout-source") return { path: source.entry, namespace: "layout" };
      if (args.namespace === "bootstrap" || args.namespace === "layout") {
        if (["react", "react/jsx-runtime", "react-dom", "react-dom/client"].includes(args.path)) return { path: require.resolve(args.path) };
        if (args.namespace !== "layout" || !args.path.startsWith(".")) throw new Error("Source import escapes the closed layout snapshot");
        const path = posix.normalize(posix.join(posix.dirname(args.importer), args.path));
        const found = [path, path.replace(/\.js$/, ".ts"), path.replace(/\.js$/, ".tsx"), `${path}.ts`, `${path}.tsx`, `${path}/index.ts`].find(file => Object.hasOwn(source.files, file));
        if (!found || found.startsWith("../") || found.startsWith("/")) throw new Error("Missing closed layout dependency");
        return { path: found, namespace: "layout" };
      }
      return undefined;
    });
    plugin.onLoad({ filter: /.*/, namespace: "bootstrap" }, () => ({ contents: bootstrap, loader: "js", resolveDir }));
    plugin.onLoad({ filter: /.*/, namespace: "layout" }, (args: { path: string }) => ({ contents: source.files[args.path], loader: args.path.endsWith(".json") ? "json" : args.path.endsWith(".tsx") ? "tsx" : "ts", resolveDir }));
  } }] });
  if (output.outputFiles.length !== 1) throw new Error("Incomplete layout bundle");
  return output.outputFiles[0]!.text;
}

/**
 * Execute the exact consumer layout source closure after static purity checks.
 * A valid layout measurement never clears whole-instance LK12: actual frame and
 * section runtimes require their own evidence. No externally authored observation
 * or success flag is accepted. Unsupported/unavailable execution remains pending.
 */
export async function checkLayoutRender(binding: InstanceBinding, library: ConsumerInstanceLibrary, registries: InstanceRegistries, options: LayoutRenderOptions): Promise<LayoutRenderResult> {
  const base = { scope: "layout-assembly-with-supplied-section-content-and-css" as const, pendingChecks: ["LK12"] as const };
  let requiredWidths: number[] = [];
  const measurements: (LayoutMeasurement & { payloadDigest: string })[] = [];
  let staticResult: InstanceCheckResult | undefined, sourcePin: string | undefined, bundlePin: string | undefined, cssPin: string | undefined;
  const findings: string[] = [];
  let stage = "input snapshot";
  const finish = (layoutStatus: LayoutRenderResult["layoutStatus"], findings: string[]): LayoutRenderResult => ({ ...base, layoutStatus, findings, requiredWidths, measurements, staticResult, sourceDigest: sourcePin, bundleDigest: bundlePin, cssDigest: cssPin });
  try {
    if (!options || typeof options.css !== "string" || typeof options.renderSection !== "function" || !options.exportName || !options.browserExecutable) return finish("pending", ["Explicit browser, source export, CSS and section renderer are required"]);
    const renderSection = options.renderSection;
    const dataOptions = snapshot({ browserExecutable: options.browserExecutable, exportName: options.exportName,
      breakpointValues: options.breakpointValues, css: options.css, sourceDigest: options.sourceDigest });
    options = { ...dataOptions, renderSection };
    binding = snapshot(binding); registries = snapshot(registries);
    const owner = library;
    library = { id: owner.id, role: owner.role, resolveFill: owner.resolveFill.bind(owner), resolveContent: owner.resolveContent.bind(owner) };
    cssPin = digest(options.css);
    stage = "parser or bundler loading";
    const toolkit = await tools();
    stage = "consumer layout source snapshot";
    // Resolve once and snapshot: static inspection and execution read the same bytes.
    const resolved = snapshot(library.resolveFill(binding.layout.leaf, binding.layout.config));
    if (!resolved?.renderer) return finish("pending", ["Consumer layout source is unavailable"]);
    const source = snapshot(resolved.renderer);
    if (Object.keys(source.files).some(file => file.startsWith("/") || file.startsWith("../") || file.includes("\\") || posix.normalize(file) !== file)) return finish("refused", ["Layout source path escapes its snapshot"]);
    sourcePin = sourceDigest(source);
    if (options.sourceDigest !== undefined && options.sourceDigest !== sourcePin) return finish("refused", ["Layout source pin mismatch"]);
    const snapshotLibrary: ConsumerInstanceLibrary = { ...library, resolveFill: (leaf, config) => leaf === binding.layout.leaf && config === binding.layout.config ? { ...resolved, renderer: source } : snapshot(library.resolveFill(leaf, config)), resolveContent: reference => snapshot(library.resolveContent(reference)) };
    staticResult = checkInstance(binding, snapshotLibrary, registries, toolkit.compiler);
    if (staticResult.staticStatus !== "valid") return finish("refused", ["Instance static checks refused rendering"]);
    const contract = getEffectiveLayoutContract(registries.layouts.find(leaf => leaf.id === binding.layout.leaf)!, binding.layout.config, binding.layout.members);
    stage = "consumer breakpoint measurements";
    requiredWidths = widths(binding, contract, options.breakpointValues);
    stage = "section content preparation";
    const slots = Object.fromEntries(Object.entries(binding.fills).map(([slot, fills]) => [slot, fills.map((fill, index) => {
      const path = `fills.${slot}.${index}`;
      return { path, html: renderToStaticMarkup(options.renderSection(snapshot(fill), path)) };
    })]));
    const current = library.resolveFill(binding.layout.leaf, binding.layout.config)?.renderer;
    if (!current || sourceDigest(current) !== sourcePin) return finish("refused", ["Consumer layout source changed during preparation"]);
    stage = "closed renderer bundling";
    const bundle = await bundleRenderer(source, options.exportName, toolkit.build);
    bundlePin = digest(bundle);
    let incomplete = false;
    stage = "browser startup";
    await withLayoutBrowser(options.browserExecutable, async browser => {
      for (const width of requiredWidths) {
        stage = `browser measurement at ${width}px`;
        const props = { config: binding.layout.config, members: binding.layout.members, stage: planFlowStage(binding.layout.leaf, binding.layout.config, binding.layout.members, width, options.breakpointValues),
          ...(binding.layout.leaf === "layouts.bento" && binding.fills.tiles?.some(fill => fill.span !== undefined) ? { spans: binding.fills.tiles.map(fill => fill.span) } : {}),
          ...(binding.layout.leaf === "layouts.sidebar-content" ? { asideSections: binding.fills.aside?.map(fill => fill.section) ?? [] } : {}) };
        const payload = JSON.stringify({ slots, props });
        let observation: LayoutMeasurement;
        try { observation = await browser.measure(width, options.css, bundle, payload); }
        catch { incomplete = true; findings.push(`${width}: rendering or measurement unavailable`); break; }
        measurements.push({ ...observation, payloadDigest: digest(payload) });
        const expected = expectedOrder(binding, contract, width, options.breakpointValues);
        if (!observation.ready || observation.viewport !== width || observation.fills.length !== expected.length ||
          new Set(observation.fills.map(fill => fill.path)).size !== expected.length ||
          expected.some(path => !observation.fills.some(fill => fill.path === path)) ||
          observation.fills.some(fill => ![fill.left, fill.right, fill.top, fill.bottom, fill.width, fill.height].every(Number.isFinite) || fill.width <= 0 || fill.height <= 0 || !fill.visible)) {
          incomplete = true; findings.push(`${width}: incomplete viewport or fill measurements`); continue;
        }
        if (observation.overflow.length || observation.scrollWidth > width + 1) findings.push(`${width}: horizontal overflow`);
        if (observation.reorder.length) findings.push(`${width}: CSS reordering or unsupported reading direction`);
        if (observation.ambiguous.length) findings.push(`${width}: overlapping sibling placement makes visual order ambiguous`);
        if (observation.fills.some((fill, index) => fill.path !== expected[index])) findings.push(`${width}: DOM order differs from the bound collapse or aside order`);
        if (observation.visualOrder.length !== observation.fills.length || observation.visualOrder.some((path, index) => path !== observation.fills[index]!.path)) findings.push(`${width}: visual order differs from DOM order`);
      }
    });
    if (incomplete || measurements.length !== requiredWidths.length) return finish("pending", findings);
    return finish(findings.length ? "refused" : "valid", findings);
  } catch {
    return finish("pending", [...findings, `Required execution unavailable: ${stage}`]);
  }
}
