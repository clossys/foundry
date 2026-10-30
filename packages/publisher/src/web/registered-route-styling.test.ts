/** @vitest-environment node */
import * as fs from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emit, emittedTokenManifest, resolve, runtimeHash } from "@clossys/designer/catalog";
import { checkRegisteredRoutes, registeredDesignerQuerySources } from "./registered-route-check.js";
import { emitRegisteredRouteAdapter, emitRegisteredRoutePage, emitRegisteredRouteRegistryModule } from "./registered-route-source.js";
import { syntheticPlan } from "../core/__fixtures__/registered-route.js";
import { compileRegisteredRouteFixture, syntheticRegisteredRoute, type CompiledRegisteredRoute } from "./__fixtures__/registered-route-runtime.js";
let temporary: string, compiled: CompiledRegisteredRoute;
beforeAll(async () => {
  temporary = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "SYNTHETIC-route-styling-")));
  compiled = await compileRegisteredRouteFixture(temporary);
}, 30000);
afterAll(async () => { await fs.rm(temporary, { recursive: true, force: true }); });
describe("registered route filesystem styling joins (synthetic selection; no clearance)", () => {
  it("joins actual reached CSS and exact selected styling inputs, refusing foreign manifests and stale profiles", async () => {
    const { route, registry, engine, manifest, registries } = syntheticRegisteredRoute(compiled), root = join(temporary, "source-styling");
    const write = async (file: string, contents: string) => { await fs.mkdir(dirname(join(root, file)), { recursive: true }); await fs.writeFile(join(root, file), contents); };
    await write("routes.json", JSON.stringify(registry)); await write("routes.ts", emitRegisteredRouteRegistryModule(registry));
    await write(route.entry.file, emitRegisteredRouteAdapter(route));
    await write(route.composition.source.file, emitRegisteredRoutePage("routes.ts", route));
    await write("runtime.ts", 'import "./selected.css"; export function useRuntime(){throw new Error("SYNTHETIC unresolved runtime")}');
    await write("actions.tsx", 'export function Actions(){return null}');
    const values = resolve(engine).values;
    const selectedCss = emit(values, ["css-scales"], { header: false })[0]!.contents;
    const definition = emittedTokenManifest(values, ["css-scales"]).definitions.find(row => row.theme === "light" && row.selector === ":root" && !row.atRules.length)!;
    expect(definition).toBeDefined();
    expect(selectedCss).toContain(`${definition.property}: ${definition.value};`);
    await write("selected.css", selectedCss);
    const input = { root, contract: { version: 2 as const, sources: {}, registry: { file: "routes.json", export: "default" as const, module: "routes.ts" }, routeRoots: [{ directory: "app", basePath: "/" }] }, plan: syntheticPlan([route]), registries };
    const styling = { engine, manifest };
    const current = await checkRegisteredRoutes({ ...input, styling });
    expect(current.findings.filter(finding => finding.code === "RR5")).toEqual([]);
    expect(current.dogfood!.findings.filter(finding => finding.code === "DF2" && finding.file.endsWith("selected.css"))).toEqual([]);
    expect(current.sourceEvidencePending).not.toContain("Exact selected styling profile and reached consumer stylesheets pending");
    // Existing DF2/DF4/DF8 findings are preserved; this synthetic fixture cannot mint evidence.
    expect(current.ok).toBe(false); expect(current.sourceEvidence).toEqual([]);
    // A self-consistent caller source descriptor cannot replace the reached fixed query.
    const originalBinding = route.composition.binding;
    Object.assign(route.composition, { binding: { ...originalBinding, body: { ...originalBinding.body!, source: { kind: "derived", query: { id: "designer.layer-boards", version: 1 } } } } });
    await write("routes.json", JSON.stringify(registry)); await write("routes.ts", emitRegisteredRouteRegistryModule(registry));
    const actual = await registeredDesignerQuerySources(), foreignSource = { ...actual.implementation.source, files: { ...actual.implementation.source.files, [actual.implementation.source.entry]: "// foreign self-hashed query" } };
    const foreign = await checkRegisteredRoutes({ ...input, styling: { ...styling, designer: { [route.routeId]: { query: { ...actual, input: {} as never, implementation: { ...actual.implementation, source: foreignSource, sourceHash: runtimeHash(foreignSource) } }, instanceLibrary: { id: registry.consumer, role: "consumer", resolveFill: () => undefined, resolveContent: ref => ref } } } } });
    expect(foreign.findings).toContainEqual(expect.objectContaining({ code: "RR5", message: expect.stringContaining("Fixed query/original provider bytes differ from actual public implementation") }));
    expect(foreign.sourceEvidence).toEqual([]);
    Object.assign(route.composition, { binding: originalBinding });
    await write("routes.json", JSON.stringify(registry)); await write("routes.ts", emitRegisteredRouteRegistryModule(registry));
    const absent = await checkRegisteredRoutes(input);
    expect(absent.dogfood!.findings).toContainEqual(expect.objectContaining({ code: "DF2", file: expect.stringMatching(/selected\.css$/), evidence: expect.stringContaining("Selected token library input unavailable") }));
    expect(absent.ok).toBe(false); expect(absent.sourceEvidence).toEqual([]);
    const wrongCss = selectedCss.replace(`${definition.property}: ${definition.value};`, `${definition.property}: 99999;`);
    expect(wrongCss).not.toBe(selectedCss);
    await write("selected.css", wrongCss);
    const wrong = await checkRegisteredRoutes({ ...input, styling });
    expect(wrong.findings.filter(finding => finding.code === "RR5")).toEqual([]);
    expect(wrong.dogfood!.findings).toContainEqual(expect.objectContaining({ code: "DF2", file: expect.stringMatching(/selected\.css$/), evidence: `Token definition value mismatch: ${definition.property}` }));
    expect(wrong.ok).toBe(false); expect(wrong.sourceEvidence).toEqual([]);
    await write("selected.css", selectedCss);
    for (const manifest of [{ ...styling.manifest, consumer: "foreign" }, { ...styling.manifest, selectionHash: `sha256:${"0".repeat(64)}` as const }]) {
      const result = await checkRegisteredRoutes({ ...input, styling: { ...styling, manifest } });
      expect(result.findings).toContainEqual(expect.objectContaining({ code: "RR5", message: "Current styling profile/manifest differs from exact selected route bindings" }));
      expect(result.sourceEvidence).toEqual([]);
    }
    await fs.unlink(join(root, "selected.css"));
    const missing = await checkRegisteredRoutes({ ...input, styling });
    expect(missing.ok).toBe(false); expect(missing.sourceEvidence).toEqual([]);
    expect(missing.findings).toContainEqual(expect.objectContaining({ code: "RR5", message: expect.stringMatching(/Unresolved project source:.*selected\.css/) }));
  });
});
