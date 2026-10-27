/** @vitest-environment node */
import * as fs from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkRegisteredRoutes, parseRegisteredRouteContract } from "./registered-route-check.js";
import { emitRegisteredRouteAdapter, emitRegisteredRoutePage } from "./registered-route-source.js";
import { main } from "./registered-route-cli.js";
import { projectRouteRegistry } from "../core/route-registry.js";
import { syntheticPlan, syntheticRoute, SYNTHETIC_ROUTE_REGISTRIES } from "../core/__fixtures__/registered-route.js";
import type { RouteRegistration } from "../core/route-registry.js";

// SYNTHETIC source fixtures. The output root is plain registration data: the
// registry file the contract names plus each consumer-relative source path. These
// tests establish source placement and closure only, never runtime clearance.
let root: string;
beforeEach(async () => { root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "SYNTHETIC-route-output-root-"))); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
async function write(file: string, text: string) { await fs.mkdir(join(root, file, ".."), { recursive: true }); await fs.writeFile(join(root, file), text); }
const SCAN_TIMEOUT = 120_000;

/** The same route placed under an output root: generated/, runtime/ and routes.json move together. */
function rooted(outputRoot: string, appRoot: string): RouteRegistration {
  const route = structuredClone(syntheticRoute());
  return { ...route, entry: { ...route.entry, file: `${appRoot}/tools/tools/page.tsx` }, composition: { ...route.composition, source: { file: `${outputRoot}/generated/example.tools.tsx`, export: "default" }, runtime: { file: `${outputRoot}/runtime/example.tools.ts`, export: "useRuntime" } } };
}
async function place(route: RouteRegistration, registryFile: string, appRoot: string) {
  await write(registryFile, JSON.stringify({ version: 1, consumer: "example", routes: [route] }));
  await write(route.entry.file, emitRegisteredRouteAdapter(route));
  await write(route.composition.source.file, emitRegisteredRoutePage(registryFile, route));
  await write(route.composition.runtime.file, "export function useRuntime(){throw new Error('SYNTHETIC unresolved runtime')}");
  const contract = { version: 2 as const, registry: { file: registryFile, export: "default" as const }, sources: {}, routeRoots: [{ directory: appRoot, basePath: "/" }] };
  await write("route-contract.json", JSON.stringify(contract));
  await write("route-context.json", JSON.stringify({ plan: syntheticPlan([route]), registries: SYNTHETIC_ROUTE_REGISTRIES }));
  return contract;
}
/** Every relative specifier an emitted module imports, resolved from that module's own directory. */
function relativeImports(file: string, text: string): string[] {
  return [...text.matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g)].map(match => resolve("/", dirname(file), match[1]!).slice(1));
}

describe("registered route output root is registration data (synthetic fixtures; no runtime clearance)", () => {
  it("emits under src/publisher and the strict check reports no findings at the new path", async () => {
    const route = rooted("src/publisher", "src/app"), registryFile = "src/publisher/routes.json";
    const contract = await place(route, registryFile, "src/app");
    // Relative imports from the emitted page and adapter resolve to the placed files.
    for (const file of [route.composition.source.file, route.entry.file]) {
      for (const target of relativeImports(file, await fs.readFile(join(root, file), "utf8"))) await expect(fs.access(join(root, target)), `${file} -> ${target}`).resolves.toBeUndefined();
    }
    expect(relativeImports(route.composition.source.file, emitRegisteredRoutePage(registryFile, route))).toEqual(expect.arrayContaining([registryFile, route.composition.runtime.file]));
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

  it("refuses an output root that escapes the consumer root, at every seam", async () => {
    for (const registryFile of ["../routes.json", "/abs/routes.json", "src\\publisher\\routes.json", "src/../routes.json", "./routes.json"]) {
      expect(() => emitRegisteredRoutePage(registryFile, rooted("src/publisher", "src/app")), registryFile).toThrow();
      expect(() => parseRegisteredRouteContract({ version: 2, registry: { file: registryFile, export: "default" }, sources: {}, routeRoots: [{ directory: "src/app", basePath: "/" }] }), registryFile).toThrow();
    }
    for (const outputRoot of ["..", "/abs", "src/..", "src\\publisher"]) {
      const route = rooted(outputRoot, "src/app");
      expect(() => emitRegisteredRoutePage("src/publisher/routes.json", route), outputRoot).toThrow();
      expect(() => emitRegisteredRouteAdapter(route), outputRoot).toThrow();
      expect(projectRouteRegistry({ version: 1, consumer: "example", routes: [route] }, syntheticPlan([route]), SYNTHETIC_ROUTE_REGISTRIES).findings, outputRoot).toContainEqual(expect.objectContaining({ path: "composition" }));
    }
    expect(() => parseRegisteredRouteContract({ version: 2, registry: { file: "src/publisher/routes.json", export: "default" }, sources: {}, routeRoots: [{ directory: "../app", basePath: "/" }] })).toThrow();
  });

  it("keeps the default placement byte-identical and the nested placement relative-equivalent", () => {
    const flat = rooted("publisher", "app"), nested = rooted("src/publisher", "src/app");
    // Moving the whole output root moves no relative import: the emitted page is the same bytes.
    expect(emitRegisteredRoutePage("src/publisher/routes.json", nested)).toBe(emitRegisteredRoutePage("publisher/routes.json", flat));
    expect(emitRegisteredRouteAdapter(nested)).toBe(emitRegisteredRouteAdapter(flat));
    expect(emitRegisteredRouteAdapter(flat)).toBe('export { default } from "../../../publisher/generated/example.tools.tsx";\n');
    // The synthetic default placement is unchanged by any output-root data.
    expect(emitRegisteredRoutePage("routes.json", syntheticRoute())).toBe(emitRegisteredRoutePage("routes.json", structuredClone(syntheticRoute())));
  });
});
