import { describe, expect, it } from "vitest";
import { syncCriterion } from "../certify/requirements.js";
import { AGENT_CRITERIA, AGENT_CRITERIA_FOLDERS } from "./agent-criteria.js";
import { CRITERIA_ROOT, criteriaCatalog, loadCriterion, readFixtures } from "./core/catalog.js";
import { CORE_CRITERIA } from "./core/index.js";

const catalog = criteriaCatalog();
const agents = catalog.entries.filter(entry => entry.folder !== "core");

describe("agent criteria registry (R15.3, ST-D / ST-W / ST-P)", () => {
  it("has no catalog issues and registers every agent folder", () => {
    expect(catalog.issues).toEqual([]);
    expect([...new Set(agents.map(entry => entry.folder))].sort()).toEqual(Object.keys(AGENT_CRITERIA_FOLDERS).sort());
  });

  it.each(Object.entries(AGENT_CRITERIA_FOLDERS))("joins %s/index.json to its static map both ways", async (folder, map) => {
    const rows = agents.filter(entry => entry.folder === folder);
    expect(rows.map(entry => entry.id).sort()).toEqual(Object.keys(map).sort());
    for (const entry of rows) expect(await loadCriterion(entry)).toBe(map[entry.id]);
  });

  it("never shadows a core criterion", () => {
    for (const id of Object.keys(AGENT_CRITERIA)) expect(Object.hasOwn(CORE_CRITERIA, id), id).toBe(false);
  });

  it("resolves agent criteria in certification and fails an unregistered id", () => {
    for (const [id, fn] of Object.entries(AGENT_CRITERIA)) expect(syncCriterion(id)).toBe(fn);
    expect(() => syncCriterion("brief.not-registered")).toThrow(/not a registered criterion/);
  });
});

describe.each(agents.map(entry => [entry.id, entry] as const))("%s", (_id, entry) => {
  const fixtures = readFixtures(entry, CRITERIA_ROOT);
  it("passes every pass fixture", async () => {
    const fn = await loadCriterion(entry);
    for (const item of fixtures.pass) expect(fn(item.subject, item.params ?? {}), JSON.stringify(item.subject).slice(0, 300)).toEqual([]);
  });
  it("fails every fail fixture", async () => {
    const fn = await loadCriterion(entry);
    for (const item of fixtures.fail) expect(fn(item.subject, item.params ?? {}).length, JSON.stringify(item).slice(0, 300)).toBeGreaterThan(0);
  });
});
