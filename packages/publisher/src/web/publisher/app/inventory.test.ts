import { describe, expect, it } from "vitest";
import { APP_STAGES, APP_DETAIL_TAB_STAGES, deriveAppRouteStages, projectAppInventory } from "./inventory.js";
import { genericInventory } from "./__fixtures__/generic.js";
import { loadExternalAppInventory } from "./__fixtures__/external-inventory.js";
import { genericProjection } from "./__fixtures__/binding.js";

it("normalizes explicit page owners and nested subrows without retaining private evidence", () => {
  const raw = genericProjection();
  const inventory = projectAppInventory({ ...raw, evidence: { omitted: true }, fallback: { path: null } });
  expect(inventory.routes.filter(route => route.kind !== "detail-tab")).toHaveLength(1);
  expect(inventory.routes.filter(route => route.kind === "detail-tab")).toHaveLength(2);
  expect(inventory.routes[2]).toMatchObject({ parentRecordRoute: "sample.record", parentSubrowId: "sample.tab", frame: "frames.app-shell" });
  expect(inventory.routes[0]?.declaredStates.loading).toMatchObject({ applicability: "required", scopeKind: "page" });
  expect(inventory).not.toHaveProperty("evidence");
  expect(inventory).not.toHaveProperty("fallback");
});
it.each(["owner", "frame", "layout", "cycle", "parent panel", "state scope", "applicability", "decision identity"])("rejects structured inventory mutation: %s", mutation => {
  const raw: any = genericProjection();
  if (mutation === "owner") raw.subrows[0].parentPageId = "foreign";
  if (mutation === "frame") raw.subrows[0].frame = "frames.app-shell";
  if (mutation === "layout") raw.subrows[0].layoutConfig = "stack.focus";
  if (mutation === "cycle") raw.subrows[0].parentSubrowId = raw.subrows[1].id;
  if (mutation === "parent panel") raw.subrows[1].parentSubrowId = "foreign";
  if (mutation === "state scope") raw.pages[0].declaredStates.loading.scopeKind = "none";
  if (mutation === "applicability") delete raw.pages[0].declaredStates.loading.applicability;
  if (mutation === "decision identity") raw.missingDecisions[0].id = raw.pages[0].id;
  expect(() => projectAppInventory(raw)).toThrow();
});
it("accepts actual host pages in all six lanes without inventing them", () => {
  const raw = genericProjection(), page = raw.pages[0]!;
  const inventory = projectAppInventory({ ...raw, pages: ["Dashboard", "Collection", "Record", "Settings", "Studio", "Status"].map((lane, index) => ({ ...page, id: `sample.page.${index}`, path: `/#/sample-${index}`, lane })), subrows: [], missingDecisions: [] });
  expect(inventory.routes.map(route => route.lane)).toEqual(["Dashboard", "Collection", "Record", "Settings", "Studio", "Status"]);
});

it("projects only browser presentation fields and retains distinct route identities", () => {
  const raw = genericInventory();
  const projected = projectAppInventory({ ...raw, evidence: [{ privateEvidence: true }], redirects: ["unregistered"] });
  expect(projected.routes).toHaveLength(4);
  expect(projected.routes[2]?.parentRecordRoute).toBe("sample.record");
  expect(projected).not.toHaveProperty("evidence");
  expect(projected).not.toHaveProperty("redirects");
  expect(projected.routes[0]).not.toBe(raw.routes[0]);
});
it("never promotes inventory defaults or state declarations into check passes or failures", () => {
  const route = projectAppInventory(genericInventory()).routes[0]!;
  const stages = deriveAppRouteStages(route);
  expect(stages.map(stage => stage.name)).toEqual(APP_STAGES);
  expect(stages.every(stage => stage.status === "pending")).toBe(true);
  expect(stages.find(stage => stage.name === "Checks")?.reasons.join()).toContain("Configure");
  expect(stages.find(stage => stage.name === "States")?.reasons.join()).toContain("Configure");
});
it.each(["schema", "lane", "duplicate", "parent", "state", "fills", "identity", "local-tab"])("rejects %s inventory mutation", mutation => {
  const raw: any = genericInventory();
  if (mutation === "schema") raw.schemaVersion = 2;
  if (mutation === "lane") raw.routes[0].lane = "Dashboard";
  if (mutation === "duplicate") raw.routes[1].id = raw.routes[0].id;
  if (mutation === "parent") raw.routes[2].parentRecordRoute = raw.routes[0].id;
  if (mutation === "state") raw.routes[0].declaredStates.empty.declared = "yes";
  if (mutation === "fills") raw.routes[0].fills = "ready";
  if (mutation === "identity") raw.routes[0].path = "https://example.org";
  if (mutation === "local-tab") raw.nonAddressableTabs[0].routeIdentity = "/invented";
  expect(() => projectAppInventory(raw)).toThrow();
});
describe.skipIf(!process.env.PUBLISHER_APP_INVENTORY)("external App inventory", () => {
  it("loads the pinned source outside the repository without copying raw evidence", async () => {
    const { inventory, sha256 } = await loadExternalAppInventory();
    expect(sha256).toHaveLength(64);
    expect(inventory.routes).toHaveLength(34);
    expect(inventory.routes.filter(route => route.kind !== "detail-tab")).toHaveLength(8);
    expect(inventory.missingDecisions?.map(decision => decision.id)).toEqual(["home", "settings", "not-found", "error"]);
    expect(inventory.routes.filter(route => route.kind === "detail-tab")).toHaveLength(26);
    expect(inventory.routes.filter(route => route.transport === "hash" && route.kind !== "detail-tab")).toHaveLength(6);
    expect(inventory.routes.filter(route => route.kind === "native-page")).toHaveLength(2);
    expect(Object.fromEntries(["Dashboard", "Collection", "Record", "Settings", "Studio", "Status"].map(lane => [lane, inventory.routes.filter(route => route.kind !== "detail-tab" && route.lane === lane).length]))).toEqual({ Dashboard: 0, Collection: 3, Record: 3, Settings: 0, Studio: 2, Status: 0 });
    expect(JSON.stringify(inventory)).not.toContain('"evidence"');
  });
  it("refuses a changed digest and a foreign source head", async () => {
    const expected = { head: "wrong", tree: "wrong", sha256: "wrong" };
    await expect(loadExternalAppInventory(undefined, expected)).rejects.toThrow("digest mismatch");
    const { APP_FIXTURE_SOURCE } = await import("./__fixtures__/external-inventory.js");
    await expect(loadExternalAppInventory(undefined, { ...APP_FIXTURE_SOURCE, head: "wrong" })).rejects.toThrow("source mismatch");
  });
});

it("gives detail tabs only their own stages and retains pending evidence", () => {
  const tab = projectAppInventory(genericInventory()).routes.find(route => route.kind === "detail-tab")!;
  const stages = deriveAppRouteStages(tab);
  expect(stages.map(stage => stage.name)).toEqual(APP_DETAIL_TAB_STAGES);
  expect(stages.every(stage => stage.status === "pending")).toBe(true);
  expect(stages.some(stage => stage.name === "Frame" || stage.name === "Layout")).toBe(false);
});
it("copies only missing-decision presentation fields and rejects duplicate identities", () => {
  const decision = { id: "home", label: "Home", lane: "Dashboard" as const, path: "/invented" };
  const projected = projectAppInventory(genericInventory(), [decision]);
  expect(projected.missingDecisions).toEqual([{ id: "home", label: "Home", lane: "Dashboard" }]);
  expect(projected.routes).toHaveLength(4);
  expect(() => projectAppInventory(genericInventory(), [decision, decision])).toThrow("Duplicate missing decision identity");
});

it("adds derived delivery states only to parent pages and keeps detail tabs at their five owned stages", async () => {
  const { STANDARD_PACK_REGISTRIES } = await import("../__fixtures__/standard-website.js");
  const inventory = projectAppInventory(genericInventory());
  const settings = { format: "web.page.responsive" as const, frame: { leaf: "frames.app-shell" as const }, layout: { leaf: "layouts.stack" as const, config: "stack.index" }, deliveries: [{ id: "static-site-bundle" as const }], deploymentSurface: "fixture.app-preview" };
  const parent = inventory.routes.find(route => route.kind === "details")!;
  expect(deriveAppRouteStages(parent, settings, STANDARD_PACK_REGISTRIES).slice(-2)).toMatchObject([{ name: "Export", status: "concept-only" }, { name: "Deploy", status: "unknown" }]);
  expect(deriveAppRouteStages(inventory.routes.find(route => route.kind === "detail-tab")!, settings, STANDARD_PACK_REGISTRIES)).toHaveLength(5);
});
