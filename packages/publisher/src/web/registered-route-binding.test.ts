/** @vitest-environment node */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runtimeHash } from "@clossys/designer/catalog";
import { recordRegisteredRouteSourceEvidence, registeredRouteSourceBootstrap } from "../core/route-source-evidence.js";
import { compileRegisteredRouteFixture, type CompiledRegisteredRoute } from "./__fixtures__/registered-route-runtime.js";
import { syntheticDerivedRoute } from "./__fixtures__/registered-route-bootstrap.js";
import { materializeRegisteredDesignerRoute } from "./registered-route-query.js";
import { liveDesignerQueries } from "./registered-route-provider-context.js";
import { materializeRegisteredRouteSourceEvidence, prepareRegisteredRoute } from "./registered-route.js";

// SYNTHETIC fixtures: the live gate is exercised up to its Stage port only. No Stage,
// renderer, captured provider or rendered qualification is claimed here.
let temporary: string, compiled: CompiledRegisteredRoute;
beforeAll(async () => { temporary = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "SYNTHETIC-route-live-bootstrap-"))); compiled = await compileRegisteredRouteFixture(temporary); }, 60_000);
afterAll(async () => { await fs.rm(temporary, { recursive: true, force: true }); });
const STAGE_PENDING = "Exact derived body Stage unavailable";
const SOURCE_PENDING = "Current reached original provider/query source materialization evidence unavailable";

/** Server half: the Node check mints evidence and the server page serializes it. */
function serverPayload() {
  const f = syntheticDerivedRoute(compiled);
  const result = materializeRegisteredDesignerRoute(f.route.composition.binding, f.engine, f.registries, f.instanceLibrary, f.designerQuery);
  if (result.status !== "materialized") throw new Error(result.findings.join("; "));
  const source = recordRegisteredRouteSourceEvidence(f.registry, f.route, { kind: "git", head: "3".repeat(40), tree: "4".repeat(40) }, { "app/tools/tools/page.tsx": runtimeHash("SYNTHETIC page") }, undefined, f.styling, result.materialization.digest);
  const text = JSON.stringify(registeredRouteSourceBootstrap({ registry: f.registry, route: f.route, source, engine: f.engine, materialization: result.materialization }));
  return { ...f, text };
}
/** Client half: a fresh parse of the wire text, the original mounted provider/query
 * association, then the live route gate. */
function live(f: ReturnType<typeof serverPayload>, source: Parameters<typeof f.runtime>[0]) {
  liveDesignerQueries.set(f.designerQuery, runtimeHash(f.designerQuery.input.projection));
  try { return prepareRegisteredRoute(f.registry, f.route.routeId, f.runtime(source)); }
  finally { liveDesignerQueries.delete(f.designerQuery); }
}
const findings = (result: { readonly status: string; readonly findings?: readonly string[] }) => "findings" in result ? result.findings : [];

describe("live route gate with a JSON round-tripped source bootstrap (synthetic fixtures)", () => {
  it("a real JSON round-tripped bootstrap re-materialized through the public API reaches the live route", () => {
    const f = serverPayload(), payload = JSON.parse(f.text) as unknown;
    const minted = materializeRegisteredRouteSourceEvidence(payload, f.registry, f.route.routeId, f.runtime());
    expect(minted.status, JSON.stringify(minted)).toBe("materialized");
    if (minted.status !== "materialized") return;
    const result = live(f, minted.source);
    // Past provider association, materialization and source evidence: only the Stage port remains.
    expect(result.status).toBe("pending");
    expect(findings(result)).toEqual([STAGE_PENDING]);
  }, 60_000);

  it("without the API, the parsed payload or its evidence is never accepted", () => {
    const f = serverPayload(), payload = JSON.parse(f.text) as { source: never };
    expect(findings(live(f, payload.source))).toEqual([SOURCE_PENDING]);
    expect(findings(live(f, structuredClone(payload.source)))).toEqual([SOURCE_PENDING]);
    expect(findings(live(f, undefined))).toEqual([SOURCE_PENDING]);
  }, 60_000);

  it("a minted copy, or minted evidence without the original provider/query association, stays pending", () => {
    const f = serverPayload(), minted = materializeRegisteredRouteSourceEvidence(JSON.parse(f.text), f.registry, f.route.routeId, f.runtime());
    if (minted.status !== "materialized") throw new Error("expected minted evidence");
    expect(findings(live(f, { ...minted.source }))).toEqual([SOURCE_PENDING]);
    const unmounted = prepareRegisteredRoute(f.registry, f.route.routeId, f.runtime(minted.source));
    expect(unmounted.status).toBe("pending");
    expect(findings(unmounted)).toEqual(["Actual mounted original Designer provider association unavailable"]);
  }, 60_000);

  it("forged, stale or source-mismatched payloads never mint live evidence", () => {
    const f = serverPayload();
    const variants: readonly ((payload: { library: string; source: Record<string, unknown> }) => void)[] = [
      payload => { payload.library = runtimeHash("stale library"); },
      payload => { payload.source.materialization = runtimeHash("stale materialization"); },
      payload => { payload.source.composition = runtimeHash("another composition"); },
      payload => { payload.source.routeId = "example.other"; },
      payload => { payload.source.forged = true; },
    ];
    for (const change of variants) {
      const payload = JSON.parse(f.text) as { library: string; source: Record<string, unknown> }; change(payload);
      const minted = materializeRegisteredRouteSourceEvidence(payload, f.registry, f.route.routeId, f.runtime());
      expect(minted.status).not.toBe("materialized");
      expect(findings(live(f, payload.source as never))).toEqual([SOURCE_PENDING]);
    }
  }, 60_000);
});
