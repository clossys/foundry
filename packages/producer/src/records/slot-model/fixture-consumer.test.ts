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

export const FIXTURE_CONSUMER_ROOT = fileURLToPath(new URL("../../../test-fixtures/consumer", import.meta.url));
const agents = join(FIXTURE_CONSUMER_ROOT, "clossys", "agents");
const ia = (agent: string): IaDoc => JSON.parse(readFileSync(join(agents, agent, "ia.json"), "utf8")) as IaDoc;

describe("test-fixtures consumer", () => {
  it("is a consumer root of its own", () => {
    expect(discoverRoot(join(FIXTURE_CONSUMER_ROOT, "clossys", "agents"))).toBe(FIXTURE_CONSUMER_ROOT);
  });
  it("takes the Director, Designer and Writer IA from their packages and starts the Publisher IA empty", () => {
    for (const agent of ["director", "designer", "writer"]) expect(ia(agent).source).toMatch(new RegExp(`^@clossys/${agent}#`));
    expect(ia("publisher")).toMatchObject({ source: "workspace#owner", nodes: [] });
  });
  it("has a slot.json for every placed slot", () => {
    for (const agent of ["director", "designer", "writer"] as SlotAgent[]) {
      const missing = [...slotPositions(agent, ia(agent)).keys()].filter(id => !existsSync(join(agents, agent, id, "slot.json")));
      expect(missing, agent).toEqual([]);
    }
  });
});
