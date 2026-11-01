/** @vitest-environment node */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { tmpdir } from "node:os";
import { libraryHash, runtimeHash } from "@clossys/designer/catalog";
import { compileRegisteredRouteFixture, type CompiledRegisteredRoute } from "../web/__fixtures__/registered-route-runtime.js";
import { syntheticDerivedRoute } from "../web/__fixtures__/registered-route-bootstrap.js";
import { materializeRegisteredDesignerRoute } from "../web/registered-route-query.js";
import { materializeRegisteredRouteSourceEvidence, prepareRegisteredRouteFromNode } from "../web/registered-route.js";
import { routeCompositionDigest, routeRegistryDigest } from "./route-registry.js";
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
  it("Node evidence owns frozen nested snapshots while caller inputs remain mutable", () => {
    const f = serverSide(), identity = { ...IDENTITY };
    const files = { "app/tools/tools/page.tsx": runtimeHash("SYNTHETIC page") };
    const css = { ...f.styling.css }, styling = { ...f.styling, css };
    const source = recordRegisteredRouteSourceEvidence(f.registry, f.route, identity, files, runtimeHash("SYNTHETIC plan"), styling, f.materialization.digest);
    const expected = structuredClone(source);
    const bootstrap = () => JSON.stringify(registeredRouteSourceBootstrap({ registry: f.registry, route: f.route, source, engine: f.engine, materialization: f.materialization }));
    const serialized = bootstrap();

    identity.head = "3".repeat(40);
    identity.tree = "4".repeat(40);
    files["app/tools/tools/page.tsx"] = runtimeHash("SYNTHETIC changed page");
    styling.profile = runtimeHash("SYNTHETIC changed profile");
    styling.manifest = runtimeHash("SYNTHETIC changed manifest");
    css["app/SYNTHETIC.css"] = runtimeHash("SYNTHETIC changed CSS");
    expect(source).toEqual(expected);
    expect(bootstrap()).toBe(serialized);
    expect(isCurrentRegisteredRouteSourceEvidence(source, f.registry, f.route, f.materialization.digest)).toBe(true);
    for (const [owned, original] of [[source.identity, identity], [source.files, files], [source.styling!, styling], [source.styling!.css, css]]) {
      expect(owned).not.toBe(original);
      expect(Object.isFrozen(owned)).toBe(true);
      expect(Object.isFrozen(original)).toBe(false);
    }
    expect(Object.isFrozen(source)).toBe(true);
    for (const [owned, key, value] of [[source.identity, "head", "5".repeat(40)], [source.files, "app/tools/tools/page.tsx", runtimeHash("SYNTHETIC forged page")], [source.styling!, "manifest", runtimeHash("SYNTHETIC forged manifest")], [source.styling!.css, "app/SYNTHETIC.css", runtimeHash("SYNTHETIC forged CSS")]] as const) {
      expect(Reflect.set(owned, key, value)).toBe(false);
    }
    expect(source).toEqual(expected);
    expect(bootstrap()).toBe(serialized);
  }, 60_000);

  it("two routes sharing mutable input maps receive independent frozen Node snapshots", () => {
    const f = serverSide(), other = syntheticRoute("example.other");
    const registry = { ...f.registry, routes: [f.route, other] };
    const identity = { ...IDENTITY }, files = { "app/shared.tsx": runtimeHash("SYNTHETIC shared page") };
    const css = { ...f.styling.css }, styling = { ...f.styling, css };
    const first = recordRegisteredRouteSourceEvidence(registry, f.route, identity, files, undefined, styling, f.materialization.digest);
    const second = recordRegisteredRouteSourceEvidence(registry, other, identity, files, undefined, styling);
    const expected = [structuredClone(first), structuredClone(second)];
    const bootstrap = () => JSON.stringify([
      registeredRouteSourceBootstrap({ registry, route: f.route, source: first, engine: f.engine, materialization: f.materialization }),
      registeredRouteSourceBootstrap({ registry, route: other, source: second, engine: f.engine }),
    ]);
    const serialized = bootstrap();
    for (const [a, b, original] of [[first.identity, second.identity, identity], [first.files, second.files, files], [first.styling!, second.styling!, styling], [first.styling!.css, second.styling!.css, css]]) {
      expect(a).not.toBe(b);
      expect(a).not.toBe(original);
      expect(b).not.toBe(original);
      expect(Object.isFrozen(a) && Object.isFrozen(b)).toBe(true);
      expect(Object.isFrozen(original)).toBe(false);
    }
    identity.head = "7".repeat(40);
    files["app/shared.tsx"] = runtimeHash("SYNTHETIC changed shared page");
    styling.manifest = runtimeHash("SYNTHETIC changed shared manifest");
    css["app/SYNTHETIC.css"] = runtimeHash("SYNTHETIC changed shared CSS");
    expect([first, second]).toEqual(expected);
    expect(Reflect.set(first.files, "app/shared.tsx", runtimeHash("SYNTHETIC first route mutation"))).toBe(false);
    expect([first, second]).toEqual(expected);
    expect(bootstrap()).toBe(serialized);
    expect(isCurrentRegisteredRouteSourceEvidence(first, registry, f.route, f.materialization.digest)).toBe(true);
    expect(isCurrentRegisteredRouteSourceEvidence(second, registry, other)).toBe(true);
  }, 60_000);

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
  it("a hand-built, digest-consistent payload mints client-only evidence that every Node, lifecycle and bootstrap consumer refuses", () => {
    // Accepted residual (unsigned bootstrap): a client can compute every public digest
    // itself. What it mints must stay live-display-only.
    const f = syntheticDerivedRoute(compiled);
    const query = materializeRegisteredDesignerRoute(f.route.composition.binding, f.engine, f.registries, f.instanceLibrary, f.designerQuery);
    if (query.status !== "materialized") throw new Error(query.findings.join("; "));
    const handBuilt = { kind: "publisher.route-source-bootstrap", version: 1, library: libraryHash(f.engine.library), source: { routeId: f.route.routeId, registry: routeRegistryDigest(f.registry), composition: routeCompositionDigest(f.route), identity: { kind: "git", head: "5".repeat(40), tree: "6".repeat(40) }, files: {}, materialization: query.materialization.digest } };
    const minted = materializeRegisteredRouteSourceEvidence(handBuilt, f.registry, f.route.routeId, f.runtime());
    expect(minted.status, JSON.stringify(minted)).toBe("materialized");
    if (minted.status !== "materialized") return;
    const digest = query.materialization.digest;
    expect(isCurrentRegisteredRouteLiveSourceEvidence(minted.source, f.registry, f.route, digest)).toBe(true);
    // Node predicate (shared by the Node-current transaction, lifecycle and checker joins).
    expect(isCurrentRegisteredRouteSourceEvidence(minted.source, f.registry, f.route, digest)).toBe(false);
    // Server bootstrap: client evidence can never be re-serialized as Node evidence.
    expect(() => registeredRouteSourceBootstrap({ registry: f.registry, route: f.route, source: minted.source, engine: f.engine, materialization: query.materialization })).toThrow(/Node-verified/);
    // Node entry to the binder.
    const node = prepareRegisteredRouteFromNode(f.registry, f.route.routeId, f.runtime(), { source: minted.source, materialization: query.materialization });
    expect(node).toEqual({ status: "refused", findings: ["Current authenticated Node source/materialization receipts required"] });
    // Lifecycle and Node-current consumers import only the Node predicate.
    for (const file of ["route-lifecycle.ts", "route-node-current.ts"]) {
      const text = readFileSync(resolvePath(import.meta.dirname, file), "utf8");
      expect(text, file).toContain("isCurrentRegisteredRouteSourceEvidence(");
      expect(text, file).not.toContain("isCurrentRegisteredRouteLiveSourceEvidence");
    }
  }, 60_000);
});
