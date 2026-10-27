/** @vitest-environment node */
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkRegisteredRoutes } from "./registered-route-check.js";
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
});
