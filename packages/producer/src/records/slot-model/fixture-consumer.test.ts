/**
 * The synthetic test-fixtures consumer (scripts/generate-fixture-consumer.mjs) is a consumer root
 * built from the package IA with clossys verbs only: every agent IA names a package (or the
 * workspace) as its source, and every placed slot has its slot.json.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { discoverRoot } from "../../cli/root.js";
import { slotPositions } from "./foundry-ia.js";
import type { IaDoc, SlotAgent } from "./types.js";
import { publisherLeaves } from "../../../scripts/place-fixture-publisher.mjs";

export const FIXTURE_CONSUMER_ROOT = fileURLToPath(new URL("../../../test-fixtures/consumer", import.meta.url));
const agents = join(FIXTURE_CONSUMER_ROOT, "clossys", "agents");
const ia = (agent: string): IaDoc => JSON.parse(readFileSync(join(agents, agent, "ia.json"), "utf8")) as IaDoc;

describe("test-fixtures consumer", () => {
  it("is a consumer root of its own", () => {
    expect(discoverRoot(join(FIXTURE_CONSUMER_ROOT, "clossys", "agents"))).toBe(FIXTURE_CONSUMER_ROOT);
  });
  it("takes the Director, Designer and Writer IA from their packages and places every Publisher package leaf in its own workspace IA", () => {
    for (const agent of ["director", "designer", "writer"]) expect(ia(agent).source).toMatch(new RegExp(`^@clossys/${agent}#`));
    // R6: the Publisher IA is the workspace's own (ia publisher --start), and every live package leaf is placed in it
    // (scripts/place-fixture-publisher.mjs), beside the Publisher's loop slots, with each release's publication recorded.
    const publisher = ia("publisher") as IaDoc & { publications?: Record<string, unknown> };
    expect(publisher.source).toBe("workspace#owner");
    const placed = [...slotPositions("publisher", publisher).keys()].filter(id => !id.startsWith("loop."));
    expect(placed.sort()).toEqual(publisherLeaves().leaves.map(leaf => leaf.id).sort());
    expect(placed).toHaveLength(60);
    expect(Object.keys(publisher.publications ?? {}).sort()).toEqual(["admin", "app", "docs", "site", "slides"]);
  });
  it("has a slot.json for every placed slot", () => {
    for (const agent of ["director", "designer", "writer", "publisher"] as SlotAgent[]) {
      const missing = [...slotPositions(agent, ia(agent)).keys()].filter(id => !existsSync(join(agents, agent, id, "slot.json")));
      expect(missing, agent).toEqual([]);
    }
  });
});
