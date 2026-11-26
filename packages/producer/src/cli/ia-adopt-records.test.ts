/**
 * CP1-U3 on a real consumer (`config --init`, `init`, then `ia designer --adopt`):
 * - G6b: the adopted Designer IA keeps the package's layers and axes (layers survive adopt);
 * - G19: every placed slot's ledger records the reuse-or-create decision with its overlaps, as a placement does;
 * - G20: the requests init raised before the Designer IA existed are re-routed by the router, so none is stale.
 */
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isPlacementDecision } from "../migrate/placement.js";
import { consumerFacts, rederive, type WorkKind } from "../queue/routing.js";
import { listRequests } from "../records/request.js";
import { listSlots, readLedger } from "../records/slots.js";
import { designerIa, type IaDoc } from "../records/slot-model/index.js";
import { runCli } from "./main.js";

let root: string;
let consumer: string;
let openBefore: string[];
beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "clossys-adopt-records-")));
  consumer = join(root, "clossys");
  for (const args of [["config", "--init"], ["init"]]) {
    const result = await runCli([...args, "--root", root], root);
    expect(result.exitCode, result.message).toBe(0);
  }
  openBefore = listRequests(consumer).flatMap(read => read.request?.status === "open" && read.request.target.startsWith("designer/") ? [read.request.id] : []);
  const adopt = await runCli(["ia", "designer", "--adopt", "--root", root], root);
  expect(adopt.exitCode, adopt.message).toBe(0);
}, 240_000);
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("ia designer --adopt after init", () => {
  it("keeps the package layers (each naming only placed L1s) and axes", () => {
    const ia = JSON.parse(readFileSync(join(consumer, "agents", "designer", "ia.json"), "utf8")) as IaDoc;
    expect(ia.axes).toEqual(designerIa().ia.axes);
    expect(ia.layers?.length).toBeGreaterThan(0);
    const placed = new Set(ia.nodes.map(node => node.id));
    expect(new Set(ia.layers!.flatMap(layer => layer.nodes))).toEqual(placed);
  });

  it("records a reuse-or-create decision with its overlaps on every placed slot", () => {
    const slots = listSlots(consumer, "designer");
    expect(slots.length).toBeGreaterThan(0);
    const missing = slots.filter(entry => !(readLedger(entry.dir, "slot")?.events ?? []).some(isPlacementDecision)).map(entry => entry.id);
    expect(missing).toEqual([]);
  });

  it("re-routes the open requests init raised, so every route equals the table now", () => {
    expect(openBefore.length).toBeGreaterThan(0);
    const facts = consumerFacts(consumer);
    for (const id of openBefore) {
      const request = listRequests(consumer).find(read => read.request?.id === id)!.request!;
      expect(rederive(facts, { kind: request.kind as WorkKind, target: request.target, assignee: request.assignee, ...(request.route ? { route: request.route } : {}) }), id).toBeUndefined();
      expect(request.events.at(-1)).toMatchObject({ op: "routed", by: "producer" });
    }
  });
});
