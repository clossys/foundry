/** @vitest-environment node */
import * as fs from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkRegisteredRoutes } from "./registered-route-check.js";
import { emitRegisteredRouteAdapter, emitRegisteredRoutePage, emitRegisteredRouteRegistryModule } from "./registered-route-source.js";
import { registeredRouteServerData } from "../core/route-server-data.js";
import { projectRouteRegistry, routeServerLoader } from "../core/route-registry.js";
import { syntheticPlan, syntheticRoute, SYNTHETIC_ROUTE_REGISTRIES } from "../core/__fixtures__/registered-route.js";
import type { RouteRegistration } from "../core/route-registry.js";

// SYNTHETIC fixtures: neutral consumer data establishing the server data seam's source
// closure, emitted bytes and types only, never a runtime, provider or rendered qualification.
let root: string;
beforeEach(async () => { root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "SYNTHETIC-route-loader-"))); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
async function write(file: string, text: string) { await fs.mkdir(join(root, file, ".."), { recursive: true }); await fs.writeFile(join(root, file), text); }

const LOADER_FILE = "server/tools.ts";
const loaded = (loader: unknown = { file: LOADER_FILE, export: "loadTools" }): RouteRegistration => ({ ...structuredClone(syntheticRoute()), composition: { ...structuredClone(syntheticRoute().composition), loader } as RouteRegistration["composition"] });
const loaderModule = 'export async function loadTools() {\n  return { count: 1, label: "Tools" };\n}\n';
const contract = () => ({ version: 2 as const, registry: { file: "routes.json", export: "default" as const, module: "routes.ts" }, sources: {}, routeRoots: [{ directory: "app", basePath: "/" }] });
async function setup(route = loaded(), loader = loaderModule) {
  await write("routes.json", JSON.stringify({ version: 1, consumer: "example", routes: [route] })); await write("routes.ts", emitRegisteredRouteRegistryModule({ version: 1, consumer: "example", routes: [route] }));
  await write(route.entry.file, emitRegisteredRouteAdapter(route)); await write(route.composition.source.file, emitRegisteredRoutePage("routes.ts", route));
  await write("runtime.ts", "export function useRuntime(){throw new Error('SYNTHETIC unresolved runtime')}");
  await write(LOADER_FILE, loader);
  return route;
}
const check = (route: RouteRegistration) => checkRegisteredRoutes({ root, contract: contract(), plan: syntheticPlan([route]), registries: SYNTHETIC_ROUTE_REGISTRIES });
const SCAN_TIMEOUT = 120_000;
const refusedAt = (findings: readonly { code: string; file: string }[], file: string, code = "RR4") => findings.some(finding => finding.code === code && finding.file === file);

const SERVER_PAGE = [
  'import { registeredRouteServerData } from "@clossys/publisher/core";',
  'import { loadTools as registeredLoader } from "../../../server/tools.ts";',
  'import RegisteredPage from "../../../generated/example.tools.tsx";',
  "export default async function RegisteredServerPage() {",
  "  return <RegisteredPage data={registeredRouteServerData(await registeredLoader())} />;",
  "}", "",
].join("\n");

describe("registered server data loader (synthetic fixtures; no runtime clearance)", () => {
  it("emits one server page passing typed loader data to the client page; routes without a loader keep exact bytes", () => {
    const route = loaded();
    expect(emitRegisteredRouteAdapter(route)).toBe(SERVER_PAGE);
    expect(emitRegisteredRoutePage("routes.ts", route)).toBe([
      '"use client";',
      'import registry from "../routes.ts";',
      'import { RegisteredServerDataRoutePage } from "@clossys/publisher/web/registered-route";',
      'import type { RegisteredRouteServerData } from "@clossys/publisher/web/registered-route";',
      'import type { loadTools as RegisteredLoader } from "../server/tools.ts";',
      'import { useRuntime as useRuntime } from "../runtime.ts";',
      "export default function RegisteredPage({ data }: { readonly data: RegisteredRouteServerData<typeof RegisteredLoader> }) {",
      '  return <RegisteredServerDataRoutePage registry={registry} routeId="example.tools" data={data} useRuntime={useRuntime} />;',
      "}", "",
    ].join("\n"));
    const fallback = loaded({ file: "server/tools.ts", export: "default" });
    expect(emitRegisteredRouteAdapter(fallback).split("\n")[1]).toBe('import registeredLoader from "../../../server/tools.ts";');
    expect(emitRegisteredRoutePage("routes.ts", fallback)).toContain('import type RegisteredLoader from "../server/tools.ts";');
    // A route without a loader: exactly the prior adapter and page bytes.
    const plain = syntheticRoute();
    expect(emitRegisteredRouteAdapter(plain)).toBe('export { default } from "../../../generated/example.tools.tsx";\n');
    expect(emitRegisteredRoutePage("routes.ts", plain)).toBe([
      '"use client";', 'import registry from "../routes.ts";', 'import { RegisteredRoutePage } from "@clossys/publisher/web/registered-route";', 'import { useRuntime as useRuntime } from "../runtime.ts";',
      "export default function RegisteredPage() {", '  return <RegisteredRoutePage registry={registry} routeId="example.tools" useRuntime={useRuntime} />;', "}", "",
    ].join("\n"));
  });

  it("registration admits one consumer loader module export and refuses page, entry, runtime or special-file loaders", () => {
    expect(routeServerLoader(loaded())).toEqual({ file: LOADER_FILE, export: "loadTools" });
    const project = (route: RouteRegistration) => projectRouteRegistry({ version: 1, consumer: "example", routes: [route] }, syntheticPlan([route]), SYNTHETIC_ROUTE_REGISTRIES).findings;
    expect(project(loaded())).toEqual([]);
    for (const loader of [
      { file: "app/tools/tools/page.tsx", export: "default" }, { file: "generated/example.tools.tsx", export: "default" }, { file: "runtime.ts", export: "useRuntime" },
      { file: "app/tools/tools/layout.tsx", export: "default" }, { file: "server/route.ts", export: "GET" }, { file: "server/tools.d.ts", export: "loadTools" },
      { file: "../outside.ts", export: "loadTools" }, { file: LOADER_FILE, export: "" }, { file: LOADER_FILE }, "server/tools.ts", null,
    ]) {
      expect(routeServerLoader(loaded(loader)), JSON.stringify(loader)).toBeUndefined();
      expect(project(loaded(loader)), JSON.stringify(loader)).toContainEqual(expect.objectContaining({ path: "composition.loader" }));
      expect(() => emitRegisteredRouteAdapter(loaded(loader))).toThrow();
    }
  });

  it("the checker admits exactly the registered loader", async () => {
    const route = await setup();
    const result = await check(route);
    expect(result.findings).toEqual([]);
    expect(result.dogfood?.consumerBoundary.sourceImports[`${route.entry.file}:../../../server/tools.ts`]).toBe(LOADER_FILE);
    expect(result.runtime).toBe("pending");
  }, SCAN_TIMEOUT);

  it("refuses an unregistered loader module or export", async () => {
    // The module does not export the registered name.
    let route = await setup(loaded(), 'export async function loadOther() {\n  return { count: 1 };\n}\n');
    expect(refusedAt((await check(route)).findings, LOADER_FILE)).toBe(true);
    // A second export a page could reach.
    route = await setup(loaded(), `${loaderModule}export const secret = 1;\n`);
    expect(refusedAt((await check(route)).findings, LOADER_FILE)).toBe(true);
    // A loader that takes request arguments or is a server-action endpoint.
    route = await setup(loaded(), 'export async function loadTools(id) {\n  return { id };\n}\n');
    expect(refusedAt((await check(route)).findings, LOADER_FILE)).toBe(true);
    route = await setup(loaded(), `"use server";\n${loaderModule}`);
    expect(refusedAt((await check(route)).findings, LOADER_FILE)).toBe(true);
    route = await setup(loaded(), `${loaderModule}module.exports.secret = 1;\n`);
    expect(refusedAt((await check(route)).findings, LOADER_FILE)).toBe(true);
    // The server page imports an unregistered module or export instead.
    route = await setup();
    await write("server/other.ts", loaderModule.replace("loadTools", "loadOther"));
    await write(route.entry.file, SERVER_PAGE.replace('import { loadTools as registeredLoader } from "../../../server/tools.ts";', 'import { loadOther as registeredLoader } from "../../../server/other.ts";'));
    expect(refusedAt((await check(route)).findings, route.entry.file)).toBe(true);
    await write(route.entry.file, SERVER_PAGE.replace("loadTools as registeredLoader", "loadOther as registeredLoader"));
    expect(refusedAt((await check(route)).findings, route.entry.file)).toBe(true);
    // A registration that names the client page as its loader never reaches the checker's admission.
    const misbound = loaded({ file: "generated/example.tools.tsx", export: "default" }), misboundRegistry = { version: 1 as const, consumer: "example", routes: [misbound] };
    await write("routes.json", JSON.stringify(misboundRegistry)); await write("routes.ts", emitRegisteredRouteRegistryModule(misboundRegistry));
    expect((await check(misbound)).findings).toContainEqual(expect.objectContaining({ code: "RR1" }));
  }, SCAN_TIMEOUT);

  it("refuses an extra import, fetch, dynamic import or ad hoc endpoint beside the server page", async () => {
    const route = await setup();
    for (const page of [
      `import "../../../server/side-effect.ts";\n${SERVER_PAGE}`,
      SERVER_PAGE.replace("await registeredLoader()", 'await (await fetch("https://example.test/data")).json()'),
      SERVER_PAGE.replace("await registeredLoader()", 'await import("../../../server/tools.ts").then(module => module.loadTools())'),
      SERVER_PAGE.replace("await registeredLoader()", "{ ...await registeredLoader(), extra: true }"),
      `${SERVER_PAGE}export const dynamic = "force-dynamic";\n`,
    ]) {
      await write("server/side-effect.ts", "export {};\n");
      await write(route.entry.file, page);
      expect(refusedAt((await check(route)).findings, route.entry.file), page).toBe(true);
    }
    // A loader never admits an ad hoc layout beside the server page.
    await write(route.entry.file, SERVER_PAGE);
    await write("app/tools/tools/layout.tsx", "export default function Layout({ children }) {\n  return <section>{children}</section>;\n}\n");
    expect((await check(route)).findings.some(finding => finding.file === "app/tools/tools/layout.tsx")).toBe(true);
  }, SCAN_TIMEOUT);

  it("refuses escaped identifiers, eval and computed access that could forge the loader name", async () => {
    let route = await setup(loaded(), loaderModule.replace("loadTools", "l\\u006fadTools"));
    expect(refusedAt((await check(route)).findings, LOADER_FILE)).toBe(true);
    route = await setup(loaded(), `${loaderModule.replace("return { count: 1, label: \"Tools\" };", 'return eval("({ count: 1 })");')}`);
    expect(refusedAt((await check(route)).findings, LOADER_FILE)).toBe(true);
    route = await setup(loaded(), loaderModule.replace('return { count: 1, label: "Tools" };', 'const key = "label"; return { [key]: globalThis[key] };'));
    expect(refusedAt((await check(route)).findings, LOADER_FILE)).toBe(true);
    route = await setup();
    for (const page of [
      SERVER_PAGE.replace("loadTools as registeredLoader", "l\\u006fadTools as registeredLoader"),
      SERVER_PAGE.replace("loadTools as registeredLoader", "loadTools as registered\\u004coader"),
      SERVER_PAGE.replace("await registeredLoader()", 'await globalThis["registered" + "Loader"]()'),
    ]) {
      await write(route.entry.file, page);
      expect(refusedAt((await check(route)).findings, route.entry.file), page).toBe(true);
    }
  }, SCAN_TIMEOUT);

  it("refuses non-serializable loader data at runtime", () => {
    const data = { count: 1, nested: [{ label: "Tools", empty: null, missing: undefined }] };
    expect(registeredRouteServerData(data)).toBe(data);
    const cyclic: Record<string, unknown> = { count: 1 }; cyclic.self = cyclic;
    const getter = Object.defineProperty({}, "count", { get: () => 1, enumerable: true });
    const sparse = [1, , 3];
    for (const value of [
      () => 1, { run: () => 1 }, new Date(0), new Map(), { at: new Date(0) }, Symbol("SYNTHETIC"), { [Symbol("SYNTHETIC")]: 1 }, 1n, { value: Number.NaN }, Number.POSITIVE_INFINITY, cyclic, getter, sparse,
      new (class Tools { count = 1; })(), Object.assign(Object.create({ inherited: true }), { count: 1 }),
    ]) expect(() => (registeredRouteServerData as (value: unknown) => unknown)(value), String(typeof value)).toThrow(TypeError);
    // Extra arguments are only ever a compile-time refusal; at runtime they still refuse.
    expect(() => (registeredRouteServerData as (value: unknown, extra: unknown) => unknown)({ count: 1 }, undefined)).toThrow(TypeError);
  });
});

/** Type-level regression: the TypeScript checker over the exact emitted consumer files,
 * with the package specifiers mapped onto this package's source (no build). */
const packageSrc = resolve(import.meta.dirname, "..");
const typeRoot = resolve(packageSrc, "__route_loader_typecheck__");
function typecheck(files: Record<string, string>): string[] {
  const virtual = new Map(Object.entries(files).map(([path, content]) => [resolve(typeRoot, path), content]));
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
    strict: true, noEmit: true, skipLibCheck: true, isolatedModules: true, esModuleInterop: true, types: ["node"],
    resolveJsonModule: true, allowImportingTsExtensions: true,
    paths: { "@clossys/publisher/core": [resolve(packageSrc, "core/index.ts")], "@clossys/publisher/web/registered-route": [resolve(packageSrc, "web/registered-route.tsx")] },
  };
  const host = ts.createCompilerHost(options, true);
  const { fileExists, readFile, getSourceFile } = host;
  host.fileExists = name => virtual.has(name) || fileExists.call(host, name);
  host.readFile = name => virtual.get(name) ?? readFile.call(host, name);
  host.directoryExists = name => [...virtual.keys()].some(path => dirname(path).startsWith(name)) || ts.sys.directoryExists(name);
  host.getSourceFile = (name, language, onError, create) => virtual.has(name)
    ? ts.createSourceFile(name, virtual.get(name)!, language, true, name.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    : getSourceFile.call(host, name, language, onError, create);
  const program = ts.createProgram([...virtual.keys()], options, host);
  return [...virtual.keys()].flatMap(name => ts.getPreEmitDiagnostics(program, program.getSourceFile(name))).map(diagnostic => {
    const where = diagnostic.file ? `${diagnostic.file.fileName.replace(typeRoot + "/", "")}:${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1}` : "";
    return `${where} TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`;
  });
}
function placed(loaderText: string, runtimeData = "{ readonly count: number; readonly label: string }", providerData?: string): Record<string, string> {
  const base = syntheticRoute(), route: RouteRegistration = { ...base, entry: { file: "src/app/tools/tools/page.tsx", export: "default" }, composition: { ...base.composition, source: { file: "src/publisher/generated/example.tools.tsx", export: "default" }, runtime: { file: "src/publisher/runtime/routes.ts", export: "useRuntime" }, loader: { file: "src/publisher/server/tools.ts", export: "loadTools" } } };
  if (providerData) {
    Object.assign(route.composition.binding, { body: { ...route.composition.binding.body, source: { kind: "derived", query: { id: "designer.layer-boards", version: 1 } } } });
    Object.assign(route.composition, { provider: { id: "designer.whole-studio", source: { file: "src/publisher/providers/designer.tsx", export: "DesignerStudioProvider" } } });
  }
  const registry = { version: 1 as const, consumer: "example", routes: [route] };
  return {
    ...(providerData ? { "src/publisher/providers/designer.tsx": `import type { ReactNode } from "react";\nexport function DesignerStudioProvider({children, data}: {children: ReactNode; data: ${providerData}}) {\n  return <>{children}{data ? null : null}</>;\n}\n` } : {}),
    "src/publisher/routes.ts": emitRegisteredRouteRegistryModule(registry),
    [route.composition.source.file]: emitRegisteredRoutePage("src/publisher/routes.ts", route),
    [route.entry.file]: emitRegisteredRouteAdapter(route),
    "src/publisher/server/tools.ts": loaderText,
    "src/publisher/runtime/routes.ts": `import type { RegisteredRouteRuntime } from "@clossys/publisher/web/registered-route";\nexport function useRuntime(_route: unknown, data: ${runtimeData}): RegisteredRouteRuntime {\n  throw new Error(\`SYNTHETIC unresolved runtime \${String(data)}\`);\n}\n`,
  };
}
describe("registered server data types (synthetic data; no runtime clearance)", () => {
  it("typed loader data flows from the server page to the runtime hook with no cast", () => {
    const files = placed(loaderModule);
    for (const [file, text] of Object.entries(files)) expect(text, file).not.toMatch(/\bas\s+(?:unknown|any)\b|:\s*any\b|@ts-(?:ignore|expect-error|nocheck)/);
    expect(typecheck(files)).toEqual([]);
  }, SCAN_TIMEOUT);

  it("the emitted provider receives the exact loader result type and rejects an incompatible provider data type", () => {
    const matching = placed(loaderModule, "{ readonly count: number; readonly label: string }", "{ readonly count: number; readonly label: string }");
    expect(matching["src/publisher/generated/example.tools.tsx"]).toContain('<RegisteredProvider data={data}>');
    expect(typecheck(matching)).toEqual([]);
    const mismatched = typecheck(placed(loaderModule, "unknown", "{ readonly count: string }"));
    expect(mismatched.some(line => line.startsWith("src/publisher/generated/example.tools.tsx:") && line.includes("TS2322")), mismatched.join("\n")).toBe(true);
  }, SCAN_TIMEOUT);

  it("a non-serializable loader result or a mismatched runtime data type fails the typecheck", () => {
    for (const result of ["{ at: new Date(0) }", "{ run: () => 1 }", "{ key: Symbol(\"SYNTHETIC\") }", "{ big: 1n }", "new Map<string, number>()"]) {
      const diagnostics = typecheck(placed(`export async function loadTools() {\n  return ${result};\n}\n`, "unknown"));
      expect(diagnostics.some(line => line.startsWith("src/app/tools/tools/page.tsx:")), `${result}: ${diagnostics.join("\n")}`).toBe(true);
    }
    const mismatched = typecheck(placed(loaderModule, "{ readonly count: string }"));
    expect(mismatched.some(line => line.startsWith("src/publisher/generated/example.tools.tsx:")), mismatched.join("\n")).toBe(true);
  }, SCAN_TIMEOUT);
});
