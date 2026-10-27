/** @vitest-environment node */
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkWiring } from "@clossys/designer/catalog";
import type { WiringRoutes } from "@clossys/designer/catalog";
import { registeredRouteWiringRoutes } from "./registered-route-wiring.js";
import { emitRegisteredRouteAdapter, emitRegisteredRoutePage, emitRegisteredRouteRegistryModule } from "./registered-route-source.js";
import { syntheticPlan, syntheticRoute, SYNTHETIC_ROUTE_REGISTRIES } from "../core/__fixtures__/registered-route.js";
import type { RouteRegistration } from "../core/route-registry.js";

// SYNTHETIC source fixtures: WL10 source admission only, never runtime or provider-state clearance.
let root: string;
beforeEach(async () => { root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "SYNTHETIC-route-wiring-"))); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
async function write(file: string, text: string) { await fs.mkdir(join(root, file, ".."), { recursive: true }); await fs.writeFile(join(root, file), text); }

const PROVIDER_FILE = "providers/designer.tsx";
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
  'import { useStudioInputs } from "../runtime";',
  "export function DesignerStudioProvider({ children }: { children: ReactNode }) {",
  "  const inputs = useStudioInputs();",
  "  return <WholeStudioProvider adapter={inputs.adapter} labels={inputs.labels}>{children}</WholeStudioProvider>;",
  "}", "",
].join("\n");
const contract = () => ({ version: 2 as const, registry: { file: "routes.json", export: "default" as const, module: "routes.ts" }, sources: {} as Record<string, string>, routeRoots: [{ directory: "app", basePath: "/" }] });
async function setup(route = designerRoute(), provider = nonvisual) {
  await write("routes.json", JSON.stringify({ version: 1, consumer: "example", routes: [route] })); await write("routes.ts", emitRegisteredRouteRegistryModule({ version: 1, consumer: "example", routes: [route] }));
  await write(route.entry.file, emitRegisteredRouteAdapter(route)); await write(route.composition.source.file, emitRegisteredRoutePage("routes.ts", route));
  await write("runtime.ts", "export function useRuntime(){throw new Error('SYNTHETIC unresolved runtime')}\nexport function useStudioInputs(){throw new Error('SYNTHETIC unresolved provider inputs')}");
  await write(PROVIDER_FILE, provider);
  return route;
}
const produce = (route: RouteRegistration) => registeredRouteWiringRoutes({ root, contract: contract(), plan: syntheticPlan([route]), registries: SYNTHETIC_ROUTE_REGISTRIES });
const wl10 = (routes: WiringRoutes) => checkWiring({ sources: [], routes }).findings.filter(row => row.code === "WL10");
const wrapperReported = (routes: WiringRoutes) => wl10(routes).some(row => row.evidence === "Route module renders <RegisteredProvider> outside the runtime assembly");
const sha = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const SCAN_TIMEOUT = 120_000;

describe("WL10 checked registered nonvisual provider from the registered-route check (synthetic fixtures)", () => {
  it("the actual emitter output for a registered provider route has WL10 = 0", async () => {
    const route = await setup();
    const { routes, refused } = await produce(route);
    expect(refused).toEqual([]);
    // The route module is the real emitter's output, wrapping RegisteredRoutePage in RegisteredProvider.
    const emitted = emitRegisteredRoutePage("routes.ts", route);
    expect(emitted).toContain("<RegisteredProvider><RegisteredRoutePage");
    expect(routes.modules).toEqual([{ path: route.composition.source.file, content: emitted }]);
    expect(routes.providers).toEqual([expect.objectContaining({ route: route.composition.source.file, module: "../providers/designer.tsx", export: "DesignerStudioProvider" })]);
    expect(routes.providers![0]!.proof).toEqual(expect.objectContaining({ route: { path: route.composition.source.file, hash: sha(emitted) }, provider: { file: PROVIDER_FILE, export: "DesignerStudioProvider", hash: sha(nonvisual) }, mount: "designer.whole-studio" }));
    expect(wl10(routes)).toEqual([]);
    // The same output without the checked evidence is the WL10 the emitter used to fail.
    expect(wrapperReported({ ...routes, providers: [] })).toBe(true);
    // A route with no provider needs no evidence.
    const plain = await setup(syntheticRoute());
    const without = await produce(plain);
    expect(without.routes.providers).toEqual([]);
    expect(wl10(without.routes)).toEqual([]);
  }, SCAN_TIMEOUT);

  it("a custom visual provider gets no proof and its wrapper still fails", async () => {
    for (const visual of [
      nonvisual.replace(">{children}</WholeStudioProvider>", "><header>Old chrome</header>{children}</WholeStudioProvider>"),
      nonvisual.replace("return <WholeStudioProvider", "return <div><WholeStudioProvider").replace("</WholeStudioProvider>;", "</WholeStudioProvider></div>;"),
      nonvisual.replace('import { WholeStudioProvider } from "@clossys/designer/studio/state";', 'import { WholeStudioProvider } from "./fake-provider";'),
    ]) {
      const { routes, refused } = await produce(await setup(designerRoute(), visual));
      expect(routes.providers, visual).toEqual([]);
      expect(refused, visual).toHaveLength(1);
      expect(wrapperReported(routes), visual).toBe(true);
    }
  }, SCAN_TIMEOUT);

  it("a provider that mutates its inputs gets no proof and its wrapper still fails", async () => {
    const inputs = "  const inputs = useStudioInputs();", at = (line: string) => nonvisual.replace(inputs, `${inputs}\n  ${line}`);
    const probes = [
      at('inputs.node.append("Old chrome");'),
      at("inputs.node.textContent = inputs.chrome;"),
      at("inputs.container.append(inputs.chrome);"),
      at("inputs.node.replaceChildren();"),
      at('useEffect(() => { inputs.node.append("Old chrome"); });'),
      at('const n = inputs.node; n.append("Old chrome");'),
      at('const { node } = inputs; node.append("Old chrome");'),
      at('inputs.node.textContent += "Old chrome";'),
    ];
    const proved: boolean[] = [];
    for (const mutating of probes) {
      const { routes, refused } = await produce(await setup(designerRoute(), mutating));
      proved.push(routes.providers!.length > 0 || refused.length === 0 || !wrapperReported(routes));
    }
    expect(proved, `proof issued per probe: ${proved}`).toEqual(probes.map(() => false));
  }, SCAN_TIMEOUT);

  it("an altered emitted mount gets no proof and still fails", async () => {
    const route = await setup(), emitted = emitRegisteredRoutePage("routes.ts", route);
    for (const altered of [
      emitted.replace("</RegisteredProvider>", "<footer /></RegisteredProvider>"),
      emitted.replace("<RegisteredProvider>", '<RegisteredProvider theme="dark">'),
      emitted.replace("<RegisteredProvider><RegisteredRoutePage", "<RegisteredProvider><div><RegisteredRoutePage").replace("/></RegisteredProvider>", "/></div></RegisteredProvider>"),
      emitted.replace("return <RegisteredProvider>", "return <div><RegisteredProvider>").replace("</RegisteredProvider>;", "</RegisteredProvider></div>;"),
      emitted.replace('from "../providers/designer.tsx"', 'from "../providers/other.tsx"'),
      emitted.replace("DesignerStudioProvider as", "OtherProvider as"),
    ]) {
      expect(altered).not.toBe(emitted);
      await write(route.composition.source.file, altered);
      const { routes, refused } = await produce(route);
      expect(routes.providers, altered).toEqual([]);
      expect(refused, altered).toHaveLength(1);
      expect(wrapperReported(routes), altered).toBe(true);
    }
  }, SCAN_TIMEOUT);

  it("an identity without the issued proof, or a proof for other bytes, still fails", async () => {
    const route = await setup(), { routes } = await produce(route), issued = routes.providers![0]!;
    const bare = { route: issued.route, module: issued.module, export: issued.export };
    for (const providers of [[bare], [{ ...issued, proof: { ...issued.proof, mount: "designer.other" } }]]) expect(wrapperReported({ ...routes, providers: providers as never })).toBe(true);
    // The issued proof binds the checked bytes: an escaped identifier added to the route is refused.
    const escape = `${String.fromCharCode(92)}u0052egisteredProvider`;
    const module = { ...routes.modules[0]!, content: `${routes.modules[0]!.content}export const leaked = ${escape};\n` };
    expect(wrapperReported({ ...routes, modules: [module] })).toBe(true);
  }, SCAN_TIMEOUT);
});
