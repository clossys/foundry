// @vitest-environment node
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { emitRegisteredRouteAdapter, emitRegisteredRoutePage, emitRegisteredRouteRegistryModule, registeredRouteRegistryPlacement } from "./registered-route-source.js";
import { syntheticRoute } from "../core/__fixtures__/registered-route.js";
import type { RouteRegistration, RouteRegistry } from "../core/route-registry.js";

/**
 * Type-level regression for generated consumers. Imported JSON widens `version: 1`
 * and every literal union, so an emitted page that passed the JSON straight to
 * `RegisteredRoutePage` failed TS2322 in a real consumer. This runs the TypeScript
 * checker (noEmit) over the exact emitted page, adapter and registry binding, with
 * consumer compiler options, against this package's own published types (resolved
 * through its package exports). SYNTHETIC registration data; no runtime clearance.
 */
const packageSrc = resolve(import.meta.dirname, "..");
// Virtual files live inside the package so its own exports and "react" resolve for real.
const root = resolve(packageSrc, "__route_binding_typecheck__");

function typecheck(files: Record<string, string>): string[] {
  const virtual = new Map(Object.entries(files).map(([path, content]) => [resolve(root, path), content]));
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
    strict: true, noEmit: true, skipLibCheck: true, isolatedModules: true, esModuleInterop: true, types: [],
    resolveJsonModule: true, allowImportingTsExtensions: true,
  };
  const host = ts.createCompilerHost(options, true);
  const { fileExists, readFile, getSourceFile } = host;
  host.fileExists = name => virtual.has(name) || fileExists.call(host, name);
  host.readFile = name => virtual.get(name) ?? readFile.call(host, name);
  host.directoryExists = name => [...virtual.keys()].some(path => dirname(path).startsWith(name)) || ts.sys.directoryExists(name);
  host.getSourceFile = (name, language, onError, create) => virtual.has(name)
    ? ts.createSourceFile(name, virtual.get(name)!, language, true, name.endsWith(".tsx") ? ts.ScriptKind.TSX : name.endsWith(".json") ? ts.ScriptKind.JSON : ts.ScriptKind.TS)
    : getSourceFile.call(host, name, language, onError, create);
  const program = ts.createProgram([...virtual.keys()].filter(path => !path.endsWith(".json")), options, host);
  return ts.getPreEmitDiagnostics(program).map(diagnostic => {
    const where = diagnostic.file ? `${diagnostic.file.fileName.replace(root + "/", "")}:${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1}` : "";
    return `${where} TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`;
  });
}

const JSON_FILE = "publisher/routes.json", MODULE = "src/publisher/routes.ts";
/** One generated consumer: the JSON control input outside src, and under src its typed
 * registry module, emitted pages and adapters. */
function consumer(routes: readonly RouteRegistration[], extra: Record<string, string> = {}): Record<string, string> {
  const registry: RouteRegistry = { version: 1, consumer: "example", routes };
  registeredRouteRegistryPlacement(JSON_FILE, MODULE);
  return {
    [JSON_FILE]: `${JSON.stringify(registry, null, 2)}\n`,
    [MODULE]: emitRegisteredRouteRegistryModule(registry),
    ...Object.fromEntries(routes.flatMap(route => [[route.composition.source.file, emitRegisteredRoutePage(MODULE, route)], [route.entry.file, emitRegisteredRouteAdapter(route)]])),
    "src/publisher/runtime/routes.ts": 'import type { RegisteredRouteRuntimeHook } from "@clossys/publisher/web/registered-route";\nexport const useRuntime: RegisteredRouteRuntimeHook = () => { throw new Error("SYNTHETIC unresolved runtime"); };\n',
    ...extra,
  };
}
function placed(id: string): RouteRegistration {
  const route = structuredClone(syntheticRoute(id)), leaf = id.split(".").at(-1)!;
  return { ...route, entry: { file: `src/app/tools/${leaf}/page.tsx`, export: "default" }, composition: { ...route.composition, source: { file: `src/publisher/generated/${id}.tsx`, export: "default" }, runtime: { file: "src/publisher/runtime/routes.ts", export: "useRuntime" } } };
}
function designer(): RouteRegistration {
  const route = placed("example.designer");
  return { ...route, composition: { ...route.composition, binding: { ...route.composition.binding, body: { ...route.composition.binding.body!, source: { kind: "derived", query: { id: "designer.layer-boards", version: 1 } } } } as RouteRegistration["composition"]["binding"], provider: { id: "designer.whole-studio", source: { file: "src/publisher/providers/designer.tsx", export: "DesignerStudioProvider" } } } };
}
const provider = 'import type { ReactNode } from "react";\nexport function DesignerStudioProvider({ children }: { children: ReactNode }) {\n  return <>{children}</>;\n}\n';

describe("generated consumers typecheck through the literal-safe registry binding (synthetic data; no runtime clearance)", () => {
  it("the raw JSON import is the TS2322 this binding exists for (harness control)", () => {
    const files = consumer([placed("example.tools")]), page = "src/publisher/generated/example.tools.tsx";
    const raw = { ...files, [page]: files[page]!.replace('import registry from "../routes.ts";', 'import registry from "../../../publisher/routes.json" with { type: "json" };') };
    expect(raw[page]).not.toBe(files[page]);
    expect(typecheck(raw)).toContainEqual(expect.stringMatching(new RegExp(`^${page.replace(/\./g, "\\.")}:\\d+ TS2322: `)));
  }, 60_000);

  it("emitted pages, adapters and the registry binding pass a real consumer typecheck with no casts", () => {
    const files = consumer([placed("example.tools"), designer()], { "src/publisher/providers/designer.tsx": provider });
    // No consumer-side cast or weakened type anywhere in generated output.
    for (const [file, text] of Object.entries(files)) if (!file.endsWith(".json")) expect(text, file).not.toMatch(/\bas\s+(?:unknown|any|const|RouteRegistry\b)|<RouteRegistry>|:\s*any\b|@ts-(?:ignore|expect-error|nocheck)/);
    expect(files[MODULE]).toContain('const registry: RegisteredRoutePageProps["registry"] =');
    // No JSON under src; each generated page imports the typed registry and nothing outside src.
    expect(Object.keys(files).filter(file => file.startsWith("src/") && file.endsWith(".json"))).toEqual([]);
    for (const page of ["src/publisher/generated/example.tools.tsx", "src/publisher/generated/example.designer.tsx"]) {
      const specifiers = [...files[page]!.matchAll(/from\s+"([^"]+)"/g)].map(match => match[1]!);
      expect(specifiers.filter(specifier => specifier.startsWith(".")).map(specifier => resolve("/", dirname(page), specifier).slice(1)).every(path => path.startsWith("src/")), page).toBe(true);
      expect(specifiers, page).toContain("../routes.ts");
      expect(specifiers.some(specifier => specifier.endsWith(".json")), page).toBe(false);
    }
    expect(typecheck(files)).toEqual([]);
  }, 60_000);

  it("heterogeneous section fills typecheck in the actual generated consumer", () => {
    const first = placed("example.first"), second = placed("example.second");
    const firstFill = Object.values(first.composition.binding.fills)[0]!;
    first.composition.binding.fills = { "sections.first": firstFill };
    second.composition.binding.fills = { "sections.second": firstFill };
    const files = consumer([first, second]);
    expect(typecheck(files)).toEqual([]);
    // Control: satisfies preserves an inferred union with undefined-valued absent
    // fill keys, which cannot satisfy the public Record<string, SectionFill[]>.
    const inferred = { ...files, [MODULE]: files[MODULE]!.replace('const registry: RegisteredRoutePageProps["registry"] =', 'const registry =').replace(/;\nexport default/, ' satisfies RegisteredRoutePageProps["registry"];\nexport default') };
    expect(typecheck(inferred).some(message => message.includes("TS2322"))).toBe(true);
  }, 60_000);

  it("the typed registry is exact, deterministic, self-contained generation and refuses a non-version-1 registry", () => {
    const registry: RouteRegistry = { version: 1, consumer: "example", routes: [placed("example.tools")] };
    const text = emitRegisteredRouteRegistryModule(registry);
    expect(text).toBe(emitRegisteredRouteRegistryModule(structuredClone(registry)));
    expect(text).toBe(['import type { RegisteredRoutePageProps } from "@clossys/publisher/web/registered-route";', `const registry: RegisteredRoutePageProps["registry"] = ${JSON.stringify(registry, null, 2)};`, "export default registry;", ""].join("\n"));
    // The only import is the type-only package import: nothing relative, no JSON.
    expect([...text.matchAll(/^import\b.*$/gm)].map(match => match[0])).toEqual(['import type { RegisteredRoutePageProps } from "@clossys/publisher/web/registered-route";']);
    expect(() => emitRegisteredRouteRegistryModule({ ...registry, version: 2 } as unknown as RouteRegistry)).toThrow("Version 1 route registry required");
  });
});
