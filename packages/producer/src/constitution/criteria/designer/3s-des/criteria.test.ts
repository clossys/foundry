import { describe, expect, it } from "vitest";
import { syncCriterion } from "../../../certify/requirements.js";
import { AGENT_CRITERIA, AGENT_CRITERIA_FOLDERS } from "../../agent-criteria.js";
import { CRITERIA_ROOT, criteriaCatalog, loadCriterion, readFixtures } from "../../core/catalog.js";
import { CORE_CRITERIA } from "../../core/index.js";
import { directorCitations } from "./derive.js";
import { DESIGNER_STANDARD_CRITERIA } from "./index.js";

const FOLDER = "designer/3s-des";
const catalog = criteriaCatalog();
const entries = catalog.entries.filter(entry => entry.folder === FOLDER);

describe("Designer standards criteria (3S-DES, R15.3)", () => {
  it("registers every criterion with a module, an export, a summary and pass and fail fixtures", () => {
    expect(catalog.issues).toEqual([]);
    expect(entries.map(entry => entry.id).sort()).toEqual(["asset.svg-files", "compose.layers", "derive.director", "source.ref", "token.dtcg"]);
  });

  it("joins index.json to the static map both ways", async () => {
    expect(entries.map(entry => entry.id).sort()).toEqual(Object.keys(DESIGNER_STANDARD_CRITERIA).sort());
    for (const entry of entries) expect(await loadCriterion(entry)).toBe(DESIGNER_STANDARD_CRITERIA[entry.id]);
  });

  it("is resolved by certification's synchronous resolver, with no id shadowing a core criterion", () => {
    for (const id of Object.keys(DESIGNER_STANDARD_CRITERIA)) {
      expect(Object.hasOwn(CORE_CRITERIA, id), id).toBe(false);
      expect(AGENT_CRITERIA[id]).toBe(DESIGNER_STANDARD_CRITERIA[id]);
      expect(AGENT_CRITERIA_FOLDERS[FOLDER]![id]).toBe(DESIGNER_STANDARD_CRITERIA[id]);
      expect(syncCriterion(id)).toBe(DESIGNER_STANDARD_CRITERIA[id]);
    }
    expect(() => syncCriterion("nope.missing")).toThrow(/not a registered criterion/);
  });
});

describe.each(entries.map(entry => [entry.id, entry] as const))("%s", (_id, entry) => {
  const fixtures = readFixtures(entry, CRITERIA_ROOT);
  it("passes every pass fixture", async () => {
    const fn = await loadCriterion(entry);
    for (const item of fixtures.pass) expect(fn(item.subject, item.params ?? {}), JSON.stringify(item.note ?? item.subject)).toEqual([]);
  });
  it("fails every fail fixture", async () => {
    const fn = await loadCriterion(entry);
    for (const item of fixtures.fail) expect(fn(item.subject, item.params ?? {}).length, JSON.stringify(item.note ?? item)).toBeGreaterThan(0);
  });
});

describe("derive.director", () => {
  it("reads director citations with keys and punctuation, and keeps a version suffix visible", () => {
    expect(directorCitations("from director:identity.visual.style#colour, and director:identity.brand.essence.")).toEqual(["identity.visual.style", "identity.brand.essence"]);
    expect(directorCitations("director:identity.visual.style@v9")).toEqual(["identity.visual.style@v9"]);
    expect(directorCitations("notdirector:identity.visual.style")).toEqual([]);
  });

  it("fails the bulk theme pin reason shape and names the traits it expects", () => {
    const subject = { kind: "element", text: "", json: { meta: { element: { reason: "shadcn neutral --background mapped to the Foundry default brand value." } } } };
    const failures = DESIGNER_STANDARD_CRITERIA["derive.director"]!(subject, { traits: ["identity.visual.style"] });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/cites no Director trait.*identity\.visual\.style.*a reference value is a base, not a reason/);
  });
});
