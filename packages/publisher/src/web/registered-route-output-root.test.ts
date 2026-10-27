/** @vitest-environment node */
import * as fs from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkRegisteredRoutes, parseRegisteredRouteContract } from "./registered-route-check.js";
import { emitRegisteredRouteAdapter, emitRegisteredRoutePage, emitRegisteredRouteRegistryModule, registeredRouteRegistryPlacement } from "./registered-route-source.js";
import { main } from "./registered-route-cli.js";
import { projectRouteRegistry } from "../core/route-registry.js";
import { syntheticPlan, syntheticRoute, SYNTHETIC_ROUTE_REGISTRIES } from "../core/__fixtures__/registered-route.js";
import type { RouteRegistration } from "../core/route-registry.js";

// SYNTHETIC source fixtures. The output root is plain registration data: the JSON
// control input the contract names, its typed registry module, and each
// consumer-relative source path. These tests establish source placement and closure
// only, never runtime clearance.
let root: string;
beforeEach(async () => { root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "SYNTHETIC-route-output-root-"))); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
async function write(file: string, text: string) { await fs.mkdir(join(root, file, ".."), { recursive: true }); await fs.writeFile(join(root, file), text); }
const SCAN_TIMEOUT = 120_000;
const JSON_FILE = "publisher/routes.json", MODULE = "src/publisher/routes.ts";

/** The same route placed under an output root: generated/, runtime/ and the typed registry move together. */
function rooted(outputRoot: string, appRoot: string): RouteRegistration {
  const route = structuredClone(syntheticRoute());
  return { ...route, entry: { ...route.entry, file: `${appRoot}/tools/tools/page.tsx` }, composition: { ...route.composition, source: { file: `${outputRoot}/generated/example.tools.tsx`, export: "default" }, runtime: { file: `${outputRoot}/runtime/example.tools.ts`, export: "useRuntime" } } };
}
/** Write exactly what the emitters produce, plus the consumer runtime stub and the check inputs. */
async function place(route: RouteRegistration, registryFile: string, registryModule: string, appRoot: string) {
  const registry = { version: 1 as const, consumer: "example", routes: [route] };
  await write(registryFile, JSON.stringify(registry));
  await write(registryModule, emitRegisteredRouteRegistryModule(registry));
  await write(route.entry.file, emitRegisteredRouteAdapter(route));
  await write(route.composition.source.file, emitRegisteredRoutePage(registryModule, route));
  await write(route.composition.runtime.file, "export function useRuntime(){throw new Error('SYNTHETIC unresolved runtime')}");
  const contract = { version: 2 as const, registry: { file: registryFile, export: "default" as const, module: registryModule }, sources: {}, routeRoots: [{ directory: appRoot, basePath: "/" }] };
  await write("route-contract.json", JSON.stringify(contract));
  await write("route-context.json", JSON.stringify({ plan: syntheticPlan([route]), registries: SYNTHETIC_ROUTE_REGISTRIES }));
  return contract;
}
/** Every relative specifier an emitted module imports, resolved from that module's own directory. */
function relativeImports(file: string, text: string): string[] {
  return [...text.matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g)].map(match => resolve("/", dirname(file), match[1]!).slice(1));
}
async function filesUnder(directory: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(join(root, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) out.push(...await filesUnder(path)); else out.push(path);
  }
  return out.sort();
}

describe("registered route output root is registration data (synthetic fixtures; no runtime clearance)", () => {
  it("emits under src/publisher with no JSON under src, and the strict check reports no findings at the new path", async () => {
    const route = rooted("src/publisher", "src/app");
    const contract = await place(route, JSON_FILE, MODULE, "src/app");
    // The emitted source tree holds code only: the JSON control input stays outside src.
    const src = await filesUnder("src");
    expect(src).toEqual([MODULE, route.entry.file, route.composition.source.file, route.composition.runtime.file].sort());
    expect(src.filter(file => file.endsWith(".json"))).toEqual([]);
    // Every generated module imports only inside src, and the page reads only the typed registry.
    for (const file of src) {
      const text = await fs.readFile(join(root, file), "utf8");
      expect(text, file).not.toMatch(/\.json["']|with\s*\{\s*type\s*:\s*["']json["']/);
      for (const target of relativeImports(file, text)) {
        expect(target.startsWith("src/"), `${file} -> ${target}`).toBe(true);
        await expect(fs.access(join(root, target)), `${file} -> ${target}`).resolves.toBeUndefined();
      }
    }
    expect(relativeImports(route.composition.source.file, emitRegisteredRoutePage(MODULE, route))).toEqual([MODULE, route.composition.runtime.file]);
    expect(relativeImports(MODULE, emitRegisteredRouteRegistryModule({ version: 1, consumer: "example", routes: [route] }))).toEqual([]);
    expect(relativeImports(route.entry.file, emitRegisteredRouteAdapter(route))).toEqual([route.composition.source.file]);
    const result = await checkRegisteredRoutes({ root, contract, plan: syntheticPlan([route]), registries: SYNTHETIC_ROUTE_REGISTRIES });
    expect(result.findings).toEqual([]);
    expect(result.classifications).toContainEqual({ file: route.entry.file, kind: "page" });
    // Same closure as the default placement: only styling/runtime evidence remains pending.
    expect(result.ok).toBe(false); expect(result.sourceEvidencePending).toEqual(["Exact selected styling profile and reached consumer stylesheets pending"]);
    // The CLI takes the output root from the contract it is given; nothing else changes.
    const out: string[] = [], errors: string[] = [];
    const status = await main(["--root", root, "--contract", "route-contract.json", "--context", "route-context.json"], { out: line => out.push(line), error: line => errors.push(line) });
    expect(errors).toEqual([]); expect(status).toBe(1);
    expect(JSON.parse(out[0]!).findings).toEqual([]);
  }, SCAN_TIMEOUT);

  it("reports a typed registry module that is absent or differs from the JSON control input", async () => {
    const route = rooted("src/publisher", "src/app");
    const contract = await place(route, JSON_FILE, MODULE, "src/app");
    await write(MODULE, emitRegisteredRouteRegistryModule({ version: 1, consumer: "example", routes: [{ ...route, title: "Changed" }] }));
    expect((await checkRegisteredRoutes({ root, contract, plan: syntheticPlan([route]), registries: SYNTHETIC_ROUTE_REGISTRIES })).findings).toContainEqual({ code: "RR4", file: MODULE, message: "Typed registry module differs from its deterministic registered JSON" });
    await fs.rm(join(root, MODULE));
    expect((await checkRegisteredRoutes({ root, contract, plan: syntheticPlan([route]), registries: SYNTHETIC_ROUTE_REGISTRIES })).findings).toContainEqual({ code: "RR4", file: MODULE, message: "Typed registry module is absent or invalid" });
  }, SCAN_TIMEOUT);

  it("refuses an output root that escapes the consumer root, or JSON inside the source tree, at every seam", () => {
    const contractFor = (file: string, module: string, directory = "src/app") => ({ version: 2, registry: { file, export: "default", module }, sources: {}, routeRoots: [{ directory, basePath: "/" }] });
    for (const module of ["../routes.ts", "/abs/routes.ts", "src\\publisher\\routes.ts", "src/../routes.ts", "./routes.ts", "src/publisher/routes.json", "src/publisher/routes.d.ts", "src/publisher/.ts"]) {
      expect(() => emitRegisteredRoutePage(module, rooted("src/publisher", "src/app")), module).toThrow();
      expect(() => parseRegisteredRouteContract(contractFor(JSON_FILE, module)), module).toThrow();
    }
    for (const file of ["../routes.json", "/abs/routes.json", "publisher\\routes.json", "src/../routes.json", "./routes.json", "publisher/routes.ts", "publisher/.json"]) {
      expect(() => parseRegisteredRouteContract(contractFor(file, MODULE)), file).toThrow();
    }
    // The JSON control input never lands under the typed module's source tree.
    for (const file of ["src/publisher/routes.json", "src/routes.json", "src/app/routes.json"]) {
      expect(() => registeredRouteRegistryPlacement(file, MODULE), file).toThrow("JSON registry control input must stay outside the typed registry module's source tree");
      expect(() => parseRegisteredRouteContract(contractFor(file, MODULE)), file).toThrow();
    }
    expect(registeredRouteRegistryPlacement(JSON_FILE, MODULE)).toEqual({ file: JSON_FILE, module: MODULE });
    expect(parseRegisteredRouteContract(contractFor(JSON_FILE, MODULE)).registry).toEqual({ file: JSON_FILE, export: "default", module: MODULE });
    expect(() => parseRegisteredRouteContract({ version: 2, registry: { file: JSON_FILE, export: "default" }, sources: {}, routeRoots: [{ directory: "src/app", basePath: "/" }] })).toThrow();
    // A generated page never imports from outside the typed module's source tree.
    const outside = rooted("src/publisher", "src/app");
    expect(() => emitRegisteredRoutePage(MODULE, { ...outside, composition: { ...outside.composition, runtime: { file: "publisher/runtime/example.tools.ts", export: "useRuntime" } } })).toThrow("Generated page imports must stay inside the typed registry module's source tree");
    expect(() => emitRegisteredRoutePage(MODULE, rooted("publisher", "src/app"))).toThrow("Generated page imports must stay inside the typed registry module's source tree");
    for (const outputRoot of ["..", "/abs", "src/..", "src\\publisher"]) {
      const route = rooted(outputRoot, "src/app");
      expect(() => emitRegisteredRoutePage("routes.ts", route), outputRoot).toThrow();
      expect(() => emitRegisteredRouteAdapter(route), outputRoot).toThrow();
      expect(projectRouteRegistry({ version: 1, consumer: "example", routes: [route] }, syntheticPlan([route]), SYNTHETIC_ROUTE_REGISTRIES).findings, outputRoot).toContainEqual(expect.objectContaining({ path: "composition" }));
    }
    expect(() => parseRegisteredRouteContract(contractFor(JSON_FILE, MODULE, "../app"))).toThrow();
  });

  it("keeps the default placement byte-identical and the nested placement relative-equivalent", () => {
    const flat = rooted("publisher", "app"), nested = rooted("src/publisher", "src/app");
    // Moving the whole output root moves no relative import: the emitted page is the same bytes.
    expect(emitRegisteredRoutePage(MODULE, nested)).toBe(emitRegisteredRoutePage("publisher/routes.ts", flat));
    expect(emitRegisteredRouteAdapter(nested)).toBe(emitRegisteredRouteAdapter(flat));
    expect(emitRegisteredRouteAdapter(flat)).toBe('export { default } from "../../../publisher/generated/example.tools.tsx";\n');
    // The synthetic default placement is unchanged by any output-root data.
    expect(emitRegisteredRoutePage("routes.ts", syntheticRoute())).toBe(emitRegisteredRoutePage("routes.ts", structuredClone(syntheticRoute())));
  });
});
