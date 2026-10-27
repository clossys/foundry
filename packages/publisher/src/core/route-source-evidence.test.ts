/** @vitest-environment node */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { libraryHash, runtimeHash } from "@clossys/designer/catalog";
import { compileRegisteredRouteFixture, type CompiledRegisteredRoute } from "../web/__fixtures__/registered-route-runtime.js";
import { syntheticDerivedRoute } from "../web/__fixtures__/registered-route-bootstrap.js";
import { materializeRegisteredDesignerRoute } from "../web/registered-route-query.js";
import { materializeRegisteredRouteSourceEvidence } from "../web/registered-route.js";
import { isCurrentRegisteredRouteLiveSourceEvidence, isCurrentRegisteredRouteSourceEvidence, recordRegisteredRouteSourceEvidence, registeredRouteSourceBootstrap } from "./route-source-evidence.js";
import { syntheticRoute } from "./__fixtures__/registered-route.js";

// SYNTHETIC fixtures: these exercise the bootstrap's checks only, never a captured
// provider, selected runtime or rendered qualification.
let temporary: string, compiled: CompiledRegisteredRoute;
beforeAll(async () => { temporary = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "SYNTHETIC-route-bootstrap-"))); compiled = await compileRegisteredRouteFixture(temporary); }, 60_000);
afterAll(async () => { await fs.rm(temporary, { recursive: true, force: true }); });
const IDENTITY = { kind: "git" as const, head: "1".repeat(40), tree: "2".repeat(40) };

function serverSide() {
  const f = syntheticDerivedRoute(compiled);
  const result = materializeRegisteredDesignerRoute(f.route.composition.binding, f.engine, f.registries, f.instanceLibrary, f.designerQuery);
  if (result.status !== "materialized") throw new Error(result.findings.join("; "));
  const source = recordRegisteredRouteSourceEvidence(f.registry, f.route, IDENTITY, { "app/tools/tools/page.tsx": runtimeHash("SYNTHETIC page") }, undefined, f.styling, result.materialization.digest);
  const bootstrap = registeredRouteSourceBootstrap({ registry: f.registry, route: f.route, source, engine: f.engine, materialization: result.materialization });
  // The payload actually crosses the wire as JSON text.
  const wire = JSON.parse(JSON.stringify(bootstrap)) as unknown;
  return { ...f, source, materialization: result.materialization, bootstrap, wire };
}
const client = (f: ReturnType<typeof serverSide>, payload: unknown, runtime = f.runtime()) => materializeRegisteredRouteSourceEvidence(payload, f.registry, f.route.routeId, runtime);
const edit = (f: ReturnType<typeof serverSide>, change: (payload: { library: string; source: Record<string, unknown> }) => void) => { const payload = structuredClone(f.wire) as { library: string; source: Record<string, unknown> }; change(payload); return payload; };

describe("serialized route source bootstrap (synthetic fixtures; no runtime clearance)", () => {
  it("server bootstrap is plain JSON of Node-verified evidence only", () => {
    const f = serverSide();
    expect(f.bootstrap).toEqual(f.wire);
    expect(f.bootstrap).toMatchObject({ kind: "publisher.route-source-bootstrap", version: 1, library: libraryHash(f.engine.library), source: { routeId: f.route.routeId, materialization: f.materialization.digest } });
    // A plain copy is never Node evidence, so it cannot be re-bootstrapped or Node-verified.
    expect(() => registeredRouteSourceBootstrap({ registry: f.registry, route: f.route, source: structuredClone(f.source), engine: f.engine, materialization: f.materialization })).toThrow(/Node-verified/);
    expect(() => registeredRouteSourceBootstrap({ registry: f.registry, route: f.route, source: f.source, engine: f.engine, materialization: structuredClone(f.materialization) })).toThrow(/sealed/);
    expect(isCurrentRegisteredRouteSourceEvidence(f.bootstrap.source, f.registry, f.route, f.materialization.digest)).toBe(false);
  }, 60_000);

  it("the client API mints evidence only after library, materialization and source checks", () => {
    const f = serverSide(), result = client(f, f.wire);
    expect(result.status, JSON.stringify(result)).toBe("materialized");
    if (result.status !== "materialized") return;
    expect(result.source).toEqual(f.source);
    expect(result.source).not.toBe(f.wire);
    expect(Object.isFrozen(result.source) && Object.isFrozen(result.source.identity) && Object.isFrozen(result.source.files)).toBe(true);
    expect(isCurrentRegisteredRouteLiveSourceEvidence(result.source, f.registry, f.route, f.materialization.digest)).toBe(true);
    // Client-minted evidence never satisfies a Node, lifecycle or bootstrap path.
    expect(isCurrentRegisteredRouteSourceEvidence(result.source, f.registry, f.route, f.materialization.digest)).toBe(false);
    expect(() => registeredRouteSourceBootstrap({ registry: f.registry, route: f.route, source: result.source, engine: f.engine, materialization: f.materialization })).toThrow();
  }, 60_000);

  it("ordinary objects are never evidence: the payload, its copies or a copied minted identity", () => {
    const f = serverSide(), minted = client(f, f.wire);
    if (minted.status !== "materialized") throw new Error("expected minted evidence");
    for (const plain of [(f.wire as { source: never }).source, structuredClone(f.source), JSON.parse(JSON.stringify(f.source)), structuredClone(minted.source), { ...minted.source }]) {
      expect(isCurrentRegisteredRouteLiveSourceEvidence(plain, f.registry, f.route, f.materialization.digest)).toBe(false);
    }
  }, 60_000);

  it("forged payloads are refused", () => {
    const f = serverSide();
    for (const forged of [
      undefined, null, "bootstrap", [], { ...(f.wire as object), extra: true },
      edit(f, p => { (p as Record<string, unknown>).kind = "publisher.route-projection"; }),
      edit(f, p => { p.source.extra = true; }),
      edit(f, p => { p.source.identity = { kind: "git", head: "not-a-commit", tree: "2".repeat(40) }; }),
      edit(f, p => { p.source.files = { "app/page.tsx": "not-a-digest" }; }),
      edit(f, p => { delete p.source.composition; }),
      // A hand-written registry or composition digest for a different registration.
      edit(f, p => { p.source.composition = runtimeHash("forged composition"); }),
      edit(f, p => { p.source.registry = runtimeHash("forged registry"); }),
    ]) expect(client(f, forged).status, JSON.stringify(forged)?.slice(0, 120)).toBe("refused");
    // Accessors and class instances are not plain payload data.
    const getter = edit(f, () => undefined); Object.defineProperty(getter, "library", { get: () => libraryHash(f.engine.library), enumerable: true });
    expect(client(f, getter).status).toBe("refused");
    expect(client(f, Object.assign(Object.create({ inherited: true }), f.wire)).status).toBe("refused");
  }, 60_000);

  it("stale library hash or materialization id stays refused or pending", () => {
    const f = serverSide();
    expect(client(f, edit(f, p => { p.library = runtimeHash("stale library"); })).status).toBe("refused");
    expect(client(f, edit(f, p => { (p.source.styling as { profile: string }).profile = runtimeHash("stale profile"); })).status).toBe("refused");
    expect(client(f, edit(f, p => { p.source.materialization = runtimeHash("stale materialization"); })).status).toBe("pending");
    expect(client(f, edit(f, p => { delete p.source.materialization; })).status).toBe("pending");
    // The client's own current query moved on: the server payload is stale.
    const projection = { ...f.designerQuery.input.projection, session: { ...f.designerQuery.input.projection.session, revision: 2, edits: [{ operationsHash: runtimeHash("SYNTHETIC edit") }] } };
    const moved = { ...f.designerQuery, input: { ...f.designerQuery.input, projection, projectionHash: runtimeHash(projection), arrangement: { kind: "grid" as const, columns: 2, gap: { x: 12, y: 8 } } } };
    expect(client(f, f.wire, f.runtime(undefined, moved)).status).toBe("pending");
    // No query at all, or a query for a static route.
    expect(client(f, f.wire, { ...f.runtime(), designerQuery: undefined }).status).toBe("pending");
  }, 60_000);

  it("source-mismatched payloads stay refused: another route, registry or composition", () => {
    const f = serverSide();
    const other = { ...f.route, title: "Other tools", composition: { ...f.route.composition, header: { ...f.route.composition.header, data: { ...f.route.composition.header.data, title: "Other tools" } } } };
    expect(materializeRegisteredRouteSourceEvidence(f.wire, { ...f.registry, routes: [other] }, f.route.routeId, f.runtime()).status).toBe("refused");
    expect(materializeRegisteredRouteSourceEvidence(f.wire, { ...f.registry, consumer: `${f.registry.consumer}-other` }, f.route.routeId, f.runtime()).status).not.toBe("materialized");
    expect(client(f, edit(f, p => { p.source.routeId = "example.other"; })).status).toBe("refused");
    const staticRoute = syntheticRoute(), staticRegistry = { version: 1 as const, consumer: "example", routes: [staticRoute] };
    expect(materializeRegisteredRouteSourceEvidence(f.wire, staticRegistry, staticRoute.routeId, { ...f.runtime(), designerQuery: undefined }).status).toBe("refused");
  }, 60_000);
});
