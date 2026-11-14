import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { CRITERIA_ROOT, criteriaCatalog, criterionIds, loadCriterion, readFixtures } from "./catalog.js";
import { CORE_CRITERIA } from "./index.js";
import { icuIssues } from "./markup.js";
import { CERTIFY_KEY_FIELDS, certifyKey, requirementsVerdict, resolveRequirements, subjectOf, type VerdictInputs } from "./verdict.js";

const catalog = criteriaCatalog();
const core = catalog.entries.filter(entry => entry.folder === "core");

describe("criteria catalog (R15.3)", () => {
  it("registers every criterion with a module, an export, a summary and pass and fail fixtures", () => {
    expect(catalog.issues).toEqual([]);
    expect(core.length).toBeGreaterThanOrEqual(26);
  });

  it("joins core/index.json to the static map both ways", async () => {
    expect(core.map(entry => entry.id).sort()).toEqual(Object.keys(CORE_CRITERIA).sort());
    for (const entry of core) expect(await loadCriterion(entry)).toBe(CORE_CRITERIA[entry.id]);
  });

  it("covers the section 5a core list and the section 5b mechanical taste checks", () => {
    const ids = criterionIds();
    for (const id of ["svg.viewbox", "svg.modes", "render.small-size", "color.contrast", "composes.allowed", "apg.roles", "props.declared", "citation.grammar", "icu.valid",
      "space.on-scale", "type.on-scale", "type.levels", "type.measure", "grid.aligned", "tokens.only", "restraint.counts",
      "text.word-limit", "text.reading-grade", "lexicon.clean", "text.voice-rules", "text.plain-verbs"]) expect(ids.has(id), id).toBe(true);
  });

  it("reports a duplicate id, a missing module and a criterion without a fail fixture", () => {
    const root = mkdtempSync(join(tmpdir(), "criteria-"));
    const write = (path: string, value: unknown) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), JSON.stringify(value)); };
    const row = (id: string, module: string) => ({ id, module, export: "check", fixtures: `__fixtures__/${id}.json`, summary: "s" });
    write("a/index.json", { schema: "clossys.criteria/1", criteria: [row("x.one", "mod"), row("x.two", "gone")] });
    write("b/c/index.json", { schema: "clossys.criteria/1", criteria: [row("x.one", "mod")] });
    writeFileSync(join(root, "a/mod.ts"), "export const check = () => [];\n");
    const subject = { kind: "strings", text: "t" };
    write("a/__fixtures__/x.one.json", { pass: [{ subject }], fail: [] });
    write("a/__fixtures__/x.two.json", { pass: [{ subject }], fail: [{ subject }] });
    const issues = criteriaCatalog(root).issues.join("\n");
    expect(issues).toMatch(/x\.one needs at least one pass and one fail fixture/);
    expect(issues).toMatch(/x\.two module gone has no gone\.ts/);
    expect(issues).toMatch(/b\/c\/index\.json: x\.one is already registered in a\/index\.json/);
  });
});

describe.each(core.map(entry => [entry.id, entry] as const))("%s", (_id, entry) => {
  const fixtures = readFixtures(entry, CRITERIA_ROOT);
  it("passes every pass fixture", async () => {
    const fn = await loadCriterion(entry);
    for (const item of fixtures.pass) expect(fn(item.subject, item.params ?? {}), JSON.stringify(item.subject)).toEqual([]);
  });
  it("fails every fail fixture", async () => {
    const fn = await loadCriterion(entry);
    for (const item of fixtures.fail) expect(fn(item.subject, item.params ?? {}).length, JSON.stringify(item)).toBeGreaterThan(0);
  });
});

describe("ICU messages", () => {
  it("accepts nested select inside plural and quoted braces", () => {
    expect(icuIssues("{n, plural, =0 {none} other {{g, select, a {x} other {y}}}}")).toEqual([]);
    expect(icuIssues("'{' literal")).toEqual([]);
  });
});

describe("requirements verdict (R16.4)", () => {
  const inputs: VerdictInputs = {
    candidate: { name: "hero-v1.md", bytes: "---\ntitle: Hero\n---\nWe ship pages fast.\n" },
    kind: "strings",
    standard: { id: "test.headline", sha256: "a".repeat(64), requirements: [{ check: "text.word-limit", params: { max: 3 } }, { check: "lexicon.clean", params: {} }] },
    contract: { requirements: { "text.word-limit": { max: 8 }, "text.no-placeholder": {} } },
    pinSet: "b".repeat(64),
  };

  it("keys the cache on exactly candidate, standard, contract and pin set: no recipe field", () => {
    expect(Object.keys(certifyKey(inputs))).toEqual([...CERTIFY_KEY_FIELDS]);
    expect(CERTIFY_KEY_FIELDS.some(field => /recipe/i.test(field))).toBe(false);
  });

  it("lets the contract parameterise and extend the standard's requirements", () => {
    expect(resolveRequirements(inputs.standard.requirements, inputs.contract)).toEqual([
      { check: "text.word-limit", params: { max: 8 } }, { check: "lexicon.clean", params: {} }, { check: "text.no-placeholder", params: {} },
    ]);
    expect(resolveRequirements(inputs.standard.requirements, { requirements: [{ check: "lexicon.clean", params: { avoid: ["x"] } }] })[1]).toEqual({ check: "lexicon.clean", params: { avoid: ["x"] } });
  });

  it("judges the Markdown body, not its frontmatter, and is byte-identical on a rerun", async () => {
    expect(subjectOf("hero-v1.md", inputs.candidate.bytes, "strings")).toEqual({ kind: "strings", text: "We ship pages fast.\n", json: { title: "Hero" } });
    const first = await requirementsVerdict(inputs);
    expect(first.pass).toBe(true);
    expect(JSON.stringify(await requirementsVerdict(inputs))).toBe(JSON.stringify(first));
  });

  it("fails a requirement naming an unregistered criterion", async () => {
    const verdict = await requirementsVerdict({ ...inputs, standard: { ...inputs.standard, requirements: [{ check: "nope.missing", params: {} }] } });
    expect(verdict.pass).toBe(false);
    expect(verdict.results[0]!.failures[0]).toMatch(/not registered/);
  });
});
