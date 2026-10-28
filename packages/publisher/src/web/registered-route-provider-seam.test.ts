/** @vitest-environment node */
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkRegisteredRoutes, documentOnlyLayout, redirectOnlyRoute } from "./registered-route-check.js";
import { emitRegisteredRouteAdapter, emitRegisteredRoutePage, emitRegisteredRouteRegistryModule } from "./registered-route-source.js";
import { syntheticPlan, syntheticRoute, SYNTHETIC_ROUTE_REGISTRIES } from "../core/__fixtures__/registered-route.js";
import type { RouteRegistration } from "../core/route-registry.js";

// SYNTHETIC source fixtures: these establish source-closure classification only,
// never runtime, provider-state or consumer qualification.
let root: string;
beforeEach(async () => { root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "SYNTHETIC-route-provider-"))); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
async function write(file: string, text: string) { await fs.mkdir(join(root, file, ".."), { recursive: true }); await fs.writeFile(join(root, file), text); }

const PROVIDER_FILE = "providers/designer.tsx";
/** The registered original-provider mount for the Designer derived body. */
function designerRoute(provider: unknown = { id: "designer.whole-studio", source: { file: PROVIDER_FILE, export: "DesignerStudioProvider" } }): RouteRegistration {
  const route = structuredClone(syntheticRoute());
  Object.assign(route.composition.binding, { body: { ...route.composition.binding.body!, source: { kind: "derived", query: { id: "designer.layer-boards", version: 1 } } } });
  if (provider !== undefined) Object.assign(route.composition, { provider });
  return route;
}
const nonvisual = [
  '"use client";',
  'import type { ReactNode } from "react";',
  'import { WholeStudioProvider } from "@clossys/designer/studio/state";',
  'import { useStudioInputs } from "../runtime.ts";',
  "export function DesignerStudioProvider({ children }: { children: ReactNode }) {",
  "  const inputs = useStudioInputs();",
  "  return <WholeStudioProvider adapter={inputs.adapter} labels={inputs.labels}>{children}</WholeStudioProvider>;",
  "}", "",
].join("\n");
/** The same fixture reading its inputs through a second registered runtime hook. */
const withPair = (source: string) => source.replace('import { useStudioInputs } from "../runtime.ts";', 'import { useStudioInputPair } from "../runtime.ts";');
const contract = () => ({ version: 2 as const, registry: { file: "routes.json", export: "default" as const, module: "routes.ts" }, sources: {} as Record<string, string>, routeRoots: [{ directory: "app", basePath: "/" }] });
async function setup(route = designerRoute(), provider = nonvisual) {
  await write("routes.json", JSON.stringify({ version: 1, consumer: "example", routes: [route] })); await write("routes.ts", emitRegisteredRouteRegistryModule({ version: 1, consumer: "example", routes: [route] }));
  await write(route.entry.file, emitRegisteredRouteAdapter(route)); await write(route.composition.source.file, emitRegisteredRoutePage("routes.ts", route));
  await write("runtime.ts", "export function useRuntime(){throw new Error('SYNTHETIC unresolved runtime')}\nexport function useStudioInputs(){throw new Error('SYNTHETIC unresolved provider inputs')}");
  await write(PROVIDER_FILE, provider);
  return route;
}
const check = (route: RouteRegistration, sources: Record<string, string> = {}) => checkRegisteredRoutes({ root, contract: { ...contract(), sources }, plan: syntheticPlan([route]), registries: SYNTHETIC_ROUTE_REGISTRIES });
/** Each case runs the real consumer source scan; loops of cases need more than the default 5 s. */
const SCAN_TIMEOUT = 120_000;
const providerRefused = (findings: readonly { code: string; file: string }[]) => findings.some(finding => finding.code === "RR2" && finding.file === PROVIDER_FILE);

describe("registered nonvisual provider ownership seam (synthetic fixtures; no runtime clearance)", () => {
  it("(a) admits exactly the registered Designer provider and the emitted page mounts it around the page", async () => {
    const route = await setup();
    const page = emitRegisteredRoutePage("routes.ts", route);
    expect(page).toBe([
      '"use client";',
      'import registry from "../routes.ts";',
      'import { RegisteredRoutePage } from "@clossys/publisher/web/registered-route";',
      'import { useRuntime as useRuntime } from "../runtime.ts";',
      'import { DesignerStudioProvider as RegisteredProvider } from "../providers/designer.tsx";',
      "export default function RegisteredPage() {",
      '  return <RegisteredProvider><RegisteredRoutePage registry={registry} routeId="example.tools" useRuntime={useRuntime} /></RegisteredProvider>;',
      "}", "",
    ].join("\n"));
    const result = await check(route);
    expect(result.findings).toEqual([]);
    expect(result.classifications).toContainEqual({ file: PROVIDER_FILE, kind: "provider" });
    // The provider module and the original provider are reached through the emitted page graph.
    expect(result.dogfood?.consumerBoundary.sourceImports[`${route.composition.source.file}:../providers/designer.tsx`]).toBe(PROVIDER_FILE);
    expect(result.ok).toBe(false); expect(result.runtime).toBe("pending");
  });

  it("(b) an unregistered provider layout stays RR2, including an exact nonvisual provider mount", async () => {
    const route = await setup(designerRoute(undefined));
    const layout = 'import { WholeStudioProvider } from "@clossys/designer/studio/state";\nimport { adapter, labels } from "../runtime";\nexport default function Layout({ children }) {\n  return <WholeStudioProvider adapter={adapter} labels={labels}>{children}</WholeStudioProvider>;\n}\n';
    await write("app/layout.tsx", layout);
    expect((await check(route)).findings).toContainEqual(expect.objectContaining({ code: "RR2", file: "app/layout.tsx" }));
    // Registering a provider never turns a layout into an admitted mount.
    const registered = await setup();
    await write("app/layout.tsx", 'import { DesignerStudioProvider } from "../providers/designer";\nexport default function Layout({ children }) {\n  return <DesignerStudioProvider>{children}</DesignerStudioProvider>;\n}\n');
    const result = await check(registered);
    expect(result.findings).toContainEqual(expect.objectContaining({ code: "RR2", file: "app/layout.tsx" }));
    expect(result.classifications.some(row => row.file === "app/layout.tsx")).toBe(false);
  }, SCAN_TIMEOUT);

  it("(b) the provider must match its registration exactly: id, owner body, export, component and module", async () => {
    // Unknown provider identity or a provider on a non-Designer body is a registry finding.
    for (const provider of [{ id: "example.other", source: { file: PROVIDER_FILE, export: "DesignerStudioProvider" } }, { id: "designer.whole-studio", source: { file: PROVIDER_FILE, export: "DesignerStudioProvider" }, extra: true }, { id: "designer.whole-studio", source: { file: "../escape.tsx", export: "DesignerStudioProvider" } }]) {
      // The emitter refuses an invalid mount, so the consumer tree holds a valid emission
      // and only the registry row is changed.
      const route = designerRoute(provider); expect(() => emitRegisteredRoutePage("routes.ts", route)).toThrow();
      await setup(); await write("routes.json", JSON.stringify({ version: 1, consumer: "example", routes: [route] })); await write("routes.ts", emitRegisteredRouteRegistryModule({ version: 1, consumer: "example", routes: [route] }));
      expect((await check(route)).findings).toContainEqual(expect.objectContaining({ code: "RR1", message: expect.stringContaining("composition.provider") }));
    }
    const staticRoute = structuredClone(syntheticRoute()); Object.assign(staticRoute.composition, { provider: { id: "designer.whole-studio", source: { file: PROVIDER_FILE, export: "DesignerStudioProvider" } } });
    expect(() => emitRegisteredRoutePage("routes.ts", staticRoute)).toThrow();
    await setup(syntheticRoute()); await write("routes.json", JSON.stringify({ version: 1, consumer: "example", routes: [staticRoute] })); await write("routes.ts", emitRegisteredRouteRegistryModule({ version: 1, consumer: "example", routes: [staticRoute] }));
    expect((await check(staticRoute)).findings).toContainEqual(expect.objectContaining({ code: "RR1", message: expect.stringContaining("composition.provider") }));
    // A nonvisual module that exports a different name, mounts a different component or
    // imports the provider from a different module is not the registered provider.
    for (const foreign of [
      nonvisual.replace("function DesignerStudioProvider", "function OtherProvider"),
      nonvisual.replace('import { WholeStudioProvider } from "@clossys/designer/studio/state";', 'import { WholeStudioProvider } from "./fake-provider";'),
      nonvisual.replace('import { WholeStudioProvider } from "@clossys/designer/studio/state";', 'import { WholeStudioProvider } from "@clossys/designer/studio";'),
      nonvisual.replace('import { WholeStudioProvider } from "@clossys/designer/studio/state";', 'import { WholeStudioProvider as Provider } from "@clossys/designer/studio/state";').replaceAll("<WholeStudioProvider", "<Provider").replace("</WholeStudioProvider>", "</Provider>"),
      nonvisual.replace("export function DesignerStudioProvider", "const WholeStudioProvider = ({ children }) => children;\nexport function DesignerStudioProvider"),
    ]) {
      const route = await setup(designerRoute(), foreign); await write("providers/fake-provider.tsx", "export function WholeStudioProvider({ children }){ return children }");
      expect(providerRefused((await check(route)).findings), foreign).toBe(true);
    }
    // The original provider module cannot be remapped to consumer source by prefix.
    const route = await setup(); await write("fake/designer/studio/state.tsx", "export function WholeStudioProvider({ children }){ return children }");
    let remapped: Awaited<ReturnType<typeof check>> | undefined, refused = false;
    try { remapped = await check(route, { "@clossys/": "fake/" }); } catch { refused = true; }
    expect(refused || providerRefused(remapped!.findings)).toBe(true);
  }, SCAN_TIMEOUT);

  it("(c) a registered provider plus extra visual markup stays refused at every mount site", async () => {
    // Inside the provider module, around or beside children.
    for (const visual of [
      nonvisual.replace(">{children}</WholeStudioProvider>", "><header>Old chrome</header>{children}</WholeStudioProvider>"),
      nonvisual.replace(">{children}</WholeStudioProvider>", "><div>{children}</div></WholeStudioProvider>"),
      nonvisual.replace(">{children}</WholeStudioProvider>", ">{children}<footer /></WholeStudioProvider>"),
    ]) expect(providerRefused((await check(await setup(designerRoute(), visual))).findings), visual).toBe(true);
    // In a layout wrapping the registered provider.
    const route = await setup();
    await write("app/layout.tsx", 'import { DesignerStudioProvider } from "../providers/designer";\nexport default function Layout({ children }) {\n  return <html lang="en"><body><DesignerStudioProvider><header>Old chrome</header>{children}</DesignerStudioProvider></body></html>;\n}\n');
    expect((await check(route)).findings).toContainEqual(expect.objectContaining({ code: "RR2", file: "app/layout.tsx" }));
    // In the emitted page: exact generation is still required (existing RR4).
    await fs.rm(join(root, "app/layout.tsx"));
    await write(route.composition.source.file, emitRegisteredRoutePage("routes.ts", route).replace("<RegisteredProvider><RegisteredRoutePage", "<RegisteredProvider><div><RegisteredRoutePage").replace("/></RegisteredProvider>", "/></div></RegisteredProvider>"));
    expect((await check(route)).findings).toContainEqual(expect.objectContaining({ code: "RR4", file: route.composition.source.file }));
  }, SCAN_TIMEOUT);

  it("(d) a provider component that renders markup itself is refused", async () => {
    for (const visual of [
      nonvisual.replace("return <WholeStudioProvider", "return <div><WholeStudioProvider").replace("</WholeStudioProvider>;", "</WholeStudioProvider></div>;"),
      nonvisual.replace("  const inputs = useStudioInputs();", "  const inputs = useStudioInputs();\n  const chrome = <header>Old chrome</header>;"),
      nonvisual.replace("export function DesignerStudioProvider", "function Chrome() { return <header>Old chrome</header>; }\nexport function DesignerStudioProvider"),
      nonvisual.replace("  const inputs = useStudioInputs();", "  const inputs = useStudioInputs();\n  if (!inputs) return Chrome({ children });"),
      nonvisual.replace("  const inputs = useStudioInputs();", "  const inputs = useStudioInputs();\n  const chrome = createElement(\"header\", null, \"Old chrome\");"),
      nonvisual.replace("  const inputs = useStudioInputs();", "  const inputs = useStudioInputs();\n  useEffect(() => { document.body.insertAdjacentHTML(\"afterbegin\", \"<header/>\"); });"),
      nonvisual.replace("labels={inputs.labels}", "labels={inputs.labels} dangerouslySetInnerHTML={inputs.html}"),
      nonvisual.replace("labels={inputs.labels}", "labels={inputs.labels} {...inputs.rest}"),
      nonvisual.replace("labels={inputs.labels}", "labels={renderLabels()}"),
      nonvisual.replace("labels={inputs.labels}", "labels={inputs.labels} header={inputs.header}"),
      nonvisual.replace("}\n", "}\nexport function Chrome() { return null; }\n"),
      nonvisual.replace("return <WholeStudioProvider adapter={inputs.adapter} labels={inputs.labels}>{children}</WholeStudioProvider>;", "return <><WholeStudioProvider adapter={inputs.adapter} labels={inputs.labels}>{children}</WholeStudioProvider></>;"),
    ]) expect(providerRefused((await check(await setup(designerRoute(), visual))).findings), visual).toBe(true);
    // An absent or symlinked provider module is refused rather than skipped.
    const route = await setup(); await fs.rm(join(root, PROVIDER_FILE));
    expect(providerRefused((await check(route)).findings)).toBe(true);
    await fs.symlink(join(root, "runtime.ts"), join(root, PROVIDER_FILE));
    expect(providerRefused((await check(route)).findings)).toBe(true);
  }, SCAN_TIMEOUT);

  it("(e) exact generation: emitting twice is byte-identical and a route without a provider keeps its prior bytes", () => {
    const withProvider = designerRoute(), without = syntheticRoute();
    expect(emitRegisteredRoutePage("routes.ts", withProvider)).toBe(emitRegisteredRoutePage("routes.ts", structuredClone(withProvider)));
    expect(emitRegisteredRouteAdapter(withProvider)).toBe(emitRegisteredRouteAdapter(structuredClone(withProvider)));
    expect(emitRegisteredRoutePage("routes.ts", without)).toBe([
      '"use client";',
      'import registry from "../routes.ts";',
      'import { RegisteredRoutePage } from "@clossys/publisher/web/registered-route";',
      'import { useRuntime as useRuntime } from "../runtime.ts";',
      "export default function RegisteredPage() {",
      '  return <RegisteredRoutePage registry={registry} routeId="example.tools" useRuntime={useRuntime} />;',
      "}", "",
    ].join("\n"));
    const defaultExport = designerRoute({ id: "designer.whole-studio", source: { file: PROVIDER_FILE, export: "default" } });
    expect(emitRegisteredRoutePage("routes.ts", defaultExport)).toContain('import RegisteredProvider from "../providers/designer.tsx";');
  });

  it("(f) an identifier escape cannot rebind children, substitute the provider or hide imperative markup", async () => {
    const inputs = "  const inputs = useStudioInputs();";
    const probes: (readonly [source: string, resolves: string])[] = [
      // `children` reassigned before the mount, so the registered page is dropped.
      [nonvisual.replace(inputs, `${inputs}\n  chil\\u0064ren = null;`), "children"],
      [nonvisual.replace(inputs, `${inputs}\n  chil\\u{64}ren = null;`), "children"],
      // The registered provider binding shadowed by a substitute component.
      [nonvisual.replace(inputs, `  const \\u0057holeStudioProvider = Fragment;\n${inputs}`), "WholeStudioProvider"],
      [nonvisual.replace(inputs, `  const \\u{57}holeStudioProvider = Fragment;\n${inputs}`), "WholeStudioProvider"],
      // Imperative markup behind an escaped element-factory or document name.
      [nonvisual.replace(inputs, `${inputs}\n  const chrome = React.cr\\u0065ateElement("header", null, "Old chrome");`), "createElement"],
      [nonvisual.replace(inputs, `${inputs}\n  useEffect(() => { docum\\u{65}nt.body.append("Old chrome"); });`), "document"],
    ];
    const refused: boolean[] = [];
    for (const [source, name] of probes) {
      // The TypeScript parser resolves each escape to the guarded name (identifier.text),
      // so every probe is a real rebinding rather than a differently named binding.
      expect(escapedIdentifierNames(source), source).toContain(name);
      refused.push(providerRefused((await check(await setup(designerRoute(), source))).findings));
      // Resolved to its literal spelling, the same module stays refused.
      const resolved = source.replace(/\\u(?:\{([0-9a-fA-F]+)\}|([0-9a-fA-F]{4}))/g, (_, braced: string | undefined, plain: string | undefined) => String.fromCodePoint(parseInt(braced ?? plain!, 16)));
      expect(escapedIdentifierNames(resolved)).toEqual([]);
      expect(providerRefused((await check(await setup(designerRoute(), resolved))).findings), resolved).toBe(true);
    }
    expect(refused, `refused per probe: ${refused}`).toEqual(probes.map(() => true));
  }, SCAN_TIMEOUT);

  it("(g) direct eval cannot rebind children from computed text", async () => {
    const source = nonvisual.replace("  const inputs = useStudioInputs();", '  const inputs = useStudioInputs();\n  eval("chil" + "dren = null");');
    expect(providerRefused((await check(await setup(designerRoute(), source))).findings)).toBe(true);
  }, SCAN_TIMEOUT);

  it("(h) sibling route classifiers never admit a name hidden behind an escape", async () => {
    // A route handler hiding an element or a default export behind an escape is not an HTTP route.
    const route = await setup(), handlers: [refused: boolean, classified: boolean][] = [];
    for (const handler of [
      'export function GET() { return new Response("ok"); }\nexport function Chrome() { return <\\u0064iv />; }\n',
      'export function GET() { return new Response("ok"); }\nexport \\u{64}efault function Page() { return null; }\n',
    ]) {
      await write("app/api/route.tsx", handler);
      const result = await check(route);
      handlers.push([result.findings.some(finding => finding.code === "RR2" && finding.file === "app/api/route.tsx"), result.classifications.some(row => row.file === "app/api/route.tsx")]);
    }
    expect(handlers, `refused, classified per handler: ${JSON.stringify(handlers)}`).toEqual([[true, false], [true, false]]);
    // Redirect and document-layout recognition already fail closed on an escaped name (pinned),
    // while their literal spellings stay admitted.
    const redirect = (call: string) => `import { redirect } from "next/navigation";\nexport default function Page() { ${call}("/x"); }\n`;
    expect([redirect("redirect"), redirect("re\\u0064irect"), redirect("re\\u{64}irect")].map(redirectOnlyRoute)).toEqual([true, false, false]);
    const layout = (param: string, value: string) => `export default function Layout({ ${param} }) { return ${value}; }\n`;
    expect([layout("children", "children"), layout("chil\\u0064ren", "children"), layout("children", "chil\\u{64}ren")].map(documentOnlyLayout)).toEqual([true, false, false]);
  }, SCAN_TIMEOUT);

  it("(i) computed or reflective access cannot reach a refused name the token check never reads", async () => {
    const inputs = "  const inputs = useStudioInputs();", at = (line: string) => nonvisual.replace(inputs, `${inputs}\n  ${line}`);
    const probes = [
      // A computed key on the global object, directly or through an alias.
      at('useEffect(() => { globalThis["docu" + "ment"].body.append("Old chrome"); });'),
      at('const root = window; useEffect(() => { root["docu" + "ment"].body.append("Old chrome"); });'),
      // A computed key on any receiver.
      at("useEffect(() => { inputs.host[inputs.key].body.append(inputs.chrome); });"),
      at("useEffect(() => { inputs.host?.[inputs.key].body.append(inputs.chrome); });"),
      // Reflection and code building reach the same property without a bracket.
      at("useEffect(() => { Reflect.get(inputs.host, inputs.key).body.append(inputs.chrome); });"),
      at('useEffect(() => { Function("ret" + "urn docu" + "ment")().body.append("Old chrome"); });'),
      // A plain literal key that names a refused token.
      at('useEffect(() => { inputs.host["document"].body.append(inputs.chrome); });'),
      at('useEffect(() => { inputs.node["inner" + "HTML"] = inputs.chrome; });'),
    ];
    const refused: boolean[] = [];
    for (const source of probes) refused.push(providerRefused((await check(await setup(designerRoute(), source))).findings));
    expect(refused, `refused per probe: ${refused}`).toEqual(probes.map(() => true));
    // A plain literal key and array destructuring stay admitted.
    for (const source of [
      nonvisual.replace(inputs, `${inputs}\n  const adapter = inputs["adapter"];`).replace("adapter={inputs.adapter}", "adapter={adapter}"),
      withPair(nonvisual.replace(inputs, "  const [inputs] = useStudioInputPair();")),
    ]) expect(providerRefused((await check(await setup(designerRoute(), source))).findings), source).toBe(false);
  }, SCAN_TIMEOUT);

  it("(j) no escape form in a key or name reaches a refused name: the module may hold no backslash", async () => {
    const inputs = "  const inputs = useStudioInputs();", at = (line: string) => nonvisual.replace(inputs, `${inputs}\n  ${line}`);
    // Each form spells "innerHTML": hex, unicode, braced unicode, legacy octal, line continuation, identity.
    const forms = ["inner\\x48TML", "inner\\u0048TML", "inner\\u{48}TML", "inner\\110TML", "inner\\\nHTML", "inner\\HTML"];
    const bracket = (key: string, quote: string) => at(`useEffect(() => { inputs.node[${quote}${key}${quote}] = inputs.chrome; });`);
    const dotted = (key: string) => at(`useEffect(() => { inputs.node.${key} = inputs.chrome; });`);
    for (const key of forms) for (const quote of ['"', "'", "`"]) {
      // The TypeScript parser resolves every quoted form to the refused name.
      const file = ts.createSourceFile("key.tsx", `x[${quote}${key}${quote}] = 1;`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const access = (file.statements[0] as ts.ExpressionStatement).expression as ts.BinaryExpression;
      expect(((access.left as ts.ElementAccessExpression).argumentExpression as ts.StringLiteralLike).text, key).toBe("innerHTML");
    }
    // Identifiers accept only the unicode forms; the parser resolves both to the refused name.
    for (const key of forms.slice(1, 3)) expect(escapedIdentifierNames(dotted(key)), key).toContain("innerHTML");
    const probes = [
      // The round-2 finding, exactly.
      at('useEffect(() => { inputs.node["inner\\x48TML"] = inputs.chrome; });'),
      ...forms.flatMap(key => ['"', "'", "`"].map(quote => bracket(key, quote))),
      ...forms.map(dotted),
      // Without an escape: a computed object key and a property named by a string argument.
      at('useEffect(() => { const patch = { ["inner" + "HTML"]: inputs.chrome }; inputs.apply(inputs.node, patch); });'),
      at('useEffect(() => { Object.defineProperty(inputs.node, "inner" + "HTML", { value: inputs.chrome }); });'),
      // A computed key nested in a destructuring default is still read.
      at("useEffect(() => { const [target = inputs.host[inputs.key]] = inputs.none; target.body.append(inputs.chrome); });"),
    ];
    const refused: boolean[] = [];
    for (const source of probes) refused.push(providerRefused((await check(await setup(designerRoute(), source))).findings));
    expect(refused, `refused per probe: ${refused}`).toEqual(probes.map(() => true));
  }, SCAN_TIMEOUT);

  it("(k) the provider body may not call, assign or delete through its inputs, directly, by alias or in a nested function", async () => {
    const inputs = "  const inputs = useStudioInputs();", at = (line: string) => nonvisual.replace(inputs, `${inputs}\n  ${line}`);
    const probes = [
      // The four reviewer probes: a live DOM input gains visible content or loses the page.
      at('inputs.node.append("Old chrome");'),
      at("inputs.node.textContent = inputs.chrome;"),
      at("inputs.container.append(inputs.chrome);"),
      at("inputs.node.replaceChildren();"),
      // Inside an effect, a layout effect, a hook callback and a named nested function.
      at('useEffect(() => { inputs.node.append("Old chrome"); });'),
      at("useLayoutEffect(() => { inputs.node.replaceChildren(); }, []);"),
      at('const chrome = useMemo(() => inputs.node.append("Old chrome"), []);'),
      at('const reset = function () { inputs.node.textContent = ""; };'),
      at("inputs.nodes.forEach(node => node.remove());"),
      // Through an alias, an object or array destructuring, or a chained read.
      at('const n = inputs.node; n.append("Old chrome");'),
      at('const { node } = inputs; node.append("Old chrome");'),
      at("const [node] = inputs.nodes; node.remove();"),
      at('const { node } = inputs; node.textContent = "Old chrome";'),
      // Compound, logical, update and delete forms.
      at('inputs.node.textContent += "Old chrome";'),
      at('inputs.node.textContent ||= "Old chrome";'),
      at("inputs.count++;"),
      at("--inputs.count;"),
      at("delete inputs.node.dataset.page;"),
      // At module level, outside the function body.
      nonvisual.replace("export function", 'useStudioInputs().node.append("Old chrome");\nexport function'),
      // A hook given any argument, which can be a callback.
      at("const chrome = useStudioChrome(inputs.node);"),
    ];
    const refused: boolean[] = [];
    for (const source of probes) refused.push(providerRefused((await check(await setup(designerRoute(), source))).findings));
    expect(refused, `refused per probe: ${refused}`).toEqual(probes.map(() => true));
    // Reads stay admitted: a hook result, a plain or literal-key member path, and object or array destructuring.
    for (const source of [
      nonvisual,
      nonvisual.replace(inputs, `${inputs}\n  const { adapter, labels } = inputs;`).replace("adapter={inputs.adapter} labels={inputs.labels}", "adapter={adapter} labels={labels}"),
      nonvisual.replace(inputs, `${inputs}\n  const studio = inputs.studio;\n  const adapter = studio["adapter"];`).replace("adapter={inputs.adapter}", "adapter={adapter}"),
      withPair(nonvisual.replace(inputs, "  const [inputs] = useStudioInputPair();")),
    ]) expect(providerRefused((await check(await setup(designerRoute(), source))).findings), source).toBe(false);
  }, SCAN_TIMEOUT);

  it("(l) only a named hook import from the registered runtime module, never rebound, is callable; nothing derived from it is", async () => {
    const inputs = "  const inputs = useStudioInputs();", at = (line: string) => nonvisual.replace(inputs, `${inputs}\n  ${line}`);
    const runtimeImport = 'import { useStudioInputs } from "../runtime.ts";';
    const imports = (line: string) => nonvisual.replace(runtimeImport, line);
    const probes = [
      // The round-2 findings: an inputs callback aliased or destructured into a hook-shaped name.
      at("const useReset = inputs.reset; const ignored = useReset();"),
      at("const { useReset } = inputs; const ignored = useReset();"),
      at("const [useReset] = inputs.callbacks; const ignored = useReset();"),
      // A callback read straight from a hook result, by alias or destructuring.
      at("const studio = useStudioInputs(); const useReset = studio.reset; const ignored = useReset();"),
      at("const { useReset } = useStudioInputs(); const ignored = useReset();"),
      at("const [useReset] = useStudioInputs(); const ignored = useReset();"),
      // The allowlisted import itself, aliased to another name before the call.
      at("const useAlias = useStudioInputs; const ignored = useAlias();"),
      // A hook-shaped callee bound by no import at all: a global, or a local function.
      at("const ignored = useChrome();"),
      nonvisual.replace("export function", "function useChrome() { return null; }\nexport function").replace(inputs, `${inputs}\n  const ignored = useChrome();`),
      // A hook imported from anywhere but the registered runtime module, or not as a plain named value.
      imports(`${runtimeImport}\nimport { useChrome } from "./chrome";`).replace(inputs, `${inputs}\n  const ignored = useChrome();`),
      imports(`${runtimeImport}\nimport { useChrome } from "@clossys/designer/studio/state";`).replace(inputs, `${inputs}\n  const ignored = useChrome();`),
      imports(`${runtimeImport}\nimport type { useChrome } from "../runtime.ts";`).replace(inputs, `${inputs}\n  const ignored = useChrome();`),
      imports(`${runtimeImport}\nimport useChrome from "../runtime.ts";`).replace(inputs, `${inputs}\n  const ignored = useChrome();`),
      imports(`${runtimeImport}\nimport * as runtime from "../runtime.ts";`).replace(inputs, `${inputs}\n  const useChrome = runtime.useChrome; const ignored = useChrome();`),
      imports(`${runtimeImport}\nimport { reset as useReset } from "../runtime.ts";`).replace(inputs, `${inputs}\n  const ignored = useReset();`),
      // An extensionless or differently spelled specifier is resolver-order dependent, so not the registered module.
      imports('import { useStudioInputs } from "../runtime";'),
      imports('import { useStudioInputs } from "../runtime.js";'),
      imports('import { useStudioInputs } from "./../runtime.ts";'),
      // A side-effect or value import of any other module.
      imports(`${runtimeImport}\nimport "./chrome";`),
      imports(`${runtimeImport}\nimport { chrome } from "./chrome";`),
      // The allowlisted hook name shadowed by a body binding before it is called.
      imports('import { useStudioInputs, useStudioCallbacks } from "../runtime.ts";').replace(inputs, "  const callbacks = useStudioCallbacks();\n  const useStudioInputs = callbacks.reset;\n  const inputs = useStudioInputs();"),
      // A body name bound twice, or reusing an import or the export name.
      at("const inputs = useStudioInputs();"),
      at("const DesignerStudioProvider = inputs.chrome;"),
      at("const ReactNode = inputs.chrome;"),
      // A read rooted anywhere but an earlier body binding: a global, an import or a later name.
      at("const node = location.chrome;"),
      at("const node = useStudioInputs.chrome;"),
      nonvisual.replace(inputs, `  const early = inputs.adapter;\n${inputs}`),
      // A mounted prop rooted anywhere but a body binding.
      nonvisual.replace("adapter={inputs.adapter}", "adapter={useStudioInputs}"),
      nonvisual.replace("adapter={inputs.adapter}", "adapter={location.adapter}"),
    ];
    const refused: boolean[] = [];
    for (const source of probes) refused.push(providerRefused((await check(await setup(designerRoute(), source))).findings));
    expect(refused, `refused per probe: ${refused}`).toEqual(probes.map(() => true));
    // Admitted: the exact fixture, several registered hooks, an aliased hook import, and reads chained through body bindings.
    for (const source of [
      nonvisual,
      imports('import { useStudioInputs, useStudioLabels } from "../runtime.ts";').replace(inputs, `${inputs}\n  const labels = useStudioLabels();`).replace("labels={inputs.labels}", "labels={labels}"),
      imports('import { useStudioInputs as useInputs } from "../runtime.ts";').replace("useStudioInputs();", "useInputs();"),
      nonvisual.replace(inputs, `${inputs}\n  const studio = inputs;\n  const { adapter } = studio;\n  const [first] = inputs.items;`).replace("adapter={inputs.adapter}", "adapter={adapter}"),
    ]) expect(providerRefused((await check(await setup(designerRoute(), source))).findings), source).toBe(false);
  }, SCAN_TIMEOUT);
});

/** Identifier names whose source text is an escape, as the TypeScript parser resolves them. */
function escapedIdentifierNames(source: string): string[] {
  const file = ts.createSourceFile("provider.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), names: string[] = [];
  const visit = (node: ts.Node): void => { if (ts.isIdentifier(node) && node.getText(file) !== node.text) names.push(node.text); ts.forEachChild(node, visit); };
  visit(file);
  return names;
}
