import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkRegisteredRoutes, parseRegisteredRouteContract, redirectOnlyRoute, documentOnlyLayout } from "./registered-route-check.js";
import { emitRegisteredRouteAdapter, emitRegisteredRoutePage } from "./registered-route-source.js";
import { syntheticPlan, syntheticRoute, SYNTHETIC_ROUTE_REGISTRIES } from "../core/__fixtures__/registered-route.js";

import { parseConsumerDogfoodContract } from "@clossys/designer/catalog/server";
let root: string;
beforeEach(async () => { root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "SYNTHETIC-route-source-"))); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
const route = () => syntheticRoute();
async function write(file: string, text: string) { await fs.mkdir(join(root, file, ".."), { recursive: true }); await fs.writeFile(join(root, file), text); }
const contract = () => ({ version: 2 as const, registry: { file: "routes.json", export: "default" as const }, sources: {}, routeRoots: [{ directory: "app", basePath: "/" }] });
async function setup() {
  const r = route(); await write("routes.json", JSON.stringify({ version: 1, consumer: "example", routes: [r] }));
  await write(r.entry.file, emitRegisteredRouteAdapter(r)); await write(r.composition.source.file, emitRegisteredRoutePage("routes.json", r)); await write("runtime.ts", "export function useRuntime(){throw new Error('SYNTHETIC unresolved runtime')}");
  return r;
}
const check = () => checkRegisteredRoutes({ root, contract: contract(), plan: syntheticPlan([route()]), registries: SYNTHETIC_ROUTE_REGISTRIES });
describe("strict registered route source closure (synthetic fixtures; no runtime clearance)", () => {
  it("keeps v1 strict and rejects route-mode fields, empty roots and unknown v2 fields", () => {
    expect(() => parseConsumerDogfoodContract({ ...contract(), version: 1 })).toThrow();
    expect(() => parseRegisteredRouteContract({ ...contract(), pages: [] })).toThrow();
    expect(() => parseRegisteredRouteContract({ ...contract(), routeRoots: [] })).toThrow();
    expect(() => parseRegisteredRouteContract({ ...contract(), routeRoots: [{ directory: "../escape", basePath: "/" }] })).toThrow();
    expect(() => parseRegisteredRouteContract({ ...contract(), sources: { "@clossys/publisher/web/registered-route": "fake.tsx" } })).toThrow(/cannot be remapped/);
    expect(parseRegisteredRouteContract(contract())).toEqual(contract());
  });
  it("unregistered-page-entry: filesystem discovery refuses a new executable page absent from registry", async () => {
    await setup(); await write("app/unregistered/page.tsx", "export default function Page(){return null}");
    expect((await check()).findings).toContainEqual(expect.objectContaining({ code: "RR3", file: "app/unregistered/page.tsx" }));
  });
  it("registry-without-composition: missing generated source fails despite an entry import", async () => {
    const r = await setup(); await fs.unlink(join(root, r.composition.source.file));
    expect((await check()).findings).toContainEqual(expect.objectContaining({ code: "RR4", file: r.entry.file }));
  });
  it("unused-composition-old-body: descriptor import plus old renderer cannot match emitted source", async () => {
    const r = await setup(); await write(r.composition.source.file, 'import registry from "../routes.json"; import { OldPage } from "../old"; export default function Page(){return <OldPage/>}'); await write("old.tsx", "export function OldPage(){return <h1>Old title</h1>}");
    const result = await check(); expect(result.findings).toContainEqual(expect.objectContaining({ code: "RR4", file: r.composition.source.file }));
    expect(result.dogfood?.findings.some(f => f.code === "DF7" && f.file === "old.tsx")).toBe(true);
  });
  it("classifies literal redirects from actual imports; redirect-like comments/helpers never exempt pages", async () => {
    const source = 'import { redirect as go } from "next/navigation"; export default function Page(){go("/tools/tools")}';
    expect(redirectOnlyRoute(source)).toBe(true);
    for (const falseSource of [source + " function Hidden(){return <h1/>}", source.replace('go("', 'other("'), '// redirect("/x")\nexport default function Page(){return <h1/>}']) expect(redirectOnlyRoute(falseSource)).toBe(false);
    await setup(); await write("app/page.tsx", source); const result = await check();
    expect(result.classifications).toContainEqual({ file: "app/page.tsx", kind: "redirect" });
    expect(result.findings.some(f => f.code === "RR3" && f.file === "app/page.tsx")).toBe(false);
  });
  it("classifies only an actual closed document wrapper; implicit visual layout chrome is never filename-exempt", async () => {
    const closed = 'export default function Root({children}){return <html lang="en"><body>{children}</body></html>}';
    expect(documentOnlyLayout(closed)).toBe(true);
    for (const visual of [closed.replace("{children}</body>", "<header>Old chrome</header>{children}</body>"), 'import { OldPage } from "./old"; export default function Root({children}){return <OldPage>{children}</OldPage>}']) expect(documentOnlyLayout(visual)).toBe(false);
    await setup(); await write("app/layout.tsx", closed.replace("{children}</body>", "<header>Old chrome</header>{children}</body>"));
    expect((await check()).findings).toContainEqual(expect.objectContaining({ code: "RR2", file: "app/layout.tsx" }));
  });
  it("registry orphan and path drift fail and outside roots are never claimed as covered", async () => {
    const r = await setup(); await write("outside/page.tsx", "export default function Page(){return null}");
    await write("routes.json", JSON.stringify({ version: 1, consumer: "example", routes: [{ ...r, path: "/changed" }] }));
    const result = await check(); expect(result.findings.some(f => f.code === "RR3")).toBe(true); expect(result.classifications.some(c => c.file.startsWith("outside/"))).toBe(false);
    expect(result.scope).toEqual([{ directory: "app", basePath: "/" }]); expect(result.runtime).toBe("pending");
  });
  it("rejects source symlinks instead of following a claimed route boundary", async () => {
    const r = await setup(); await fs.unlink(join(root, r.composition.source.file)); await fs.symlink(join(root, "runtime.ts"), join(root, r.composition.source.file));
    expect((await check()).findings.some(f => f.code === "RR4")).toBe(true);
  });
  it("rejects a raw Publisher header and inline style inside a reachable runtime helper", async () => {
    await setup(); await write("runtime.ts", 'import "./raw.tsx"; export function useRuntime(){throw new Error("SYNTHETIC unavailable")}'); await write("raw.tsx", 'export function RawPublisher(){return <header style={{gap:"var(--spacing-lg)"}}>Raw page chrome</header>}');
    const result = await check();
    expect(result.dogfood?.findings.some(finding => finding.code === "DF2" && finding.file === "raw.tsx")).toBe(true);
    expect(result.dogfood?.findings.some(finding => finding.code === "DF7" && finding.file === "raw.tsx")).toBe(true);
    expect(result.ok).toBe(false);
  });
  it("follows the actual installed binder without a provenance waiver; fixed Layout source has zero DF2 inline attributes but missing CSS and real header stay pending", async () => {
    await setup(); const result = await check();
    const findings = result.dogfood?.findings.filter(finding => finding.code === "DF2" && finding.file.endsWith("publisher/src/web/layouts/Stack.tsx") && finding.evidence.includes("inline styles")) ?? [];
    expect(findings).toEqual([]);
    expect(result.dogfood?.findings.some(finding => finding.code === "DF2" && finding.evidence.includes("unresolved class utilities"))).toBe(true);
    expect(result.dogfood?.findings.some(finding => finding.code === "DF8")).toBe(true);
    expect(result.ok).toBe(false); expect(result.sourceEvidence).toEqual([]);
    if (process.env.ROUTE_GATE_DIAGNOSTIC === "1") console.info(JSON.stringify(findings.map(finding => ({ ...finding, file: "packages/publisher/src/web/layouts/Stack.tsx" }))));
  });
});
