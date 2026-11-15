/**
 * The Producer recipes (unit RC-ND): every Producer standard has a valid recipe (R15.5), every
 * craft.md runs the fixed 5b stages with a mechanical self-check per stage, the stage checks pass real
 * pins and fail on the faults they exist for (the 3S-ND worklist classes: an invalid seat holder, a prompt
 * file of another agent), the draft check agrees with the judge, and no judge imports
 * a recipe (R16.1).
 *
 *   node --test packages/publisher/recipes/recipes.test.mjs
 *
 * It reads the producer's built modules (packages/producer/dist): build the producer first.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { checkBrief, checkDiverge, checkDraft } from "./stage-check.mjs";
import { pinOf, slotWorld, tasteWindow } from "./stage-core.mjs";

const AGENT = "producer";
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..");
const CONSUMER = process.env.CLOSSYS_ROOT ? join(process.env.CLOSSYS_ROOT, "clossys") : join(ROOT, "packages/producer/test-fixtures/consumer/clossys");
const dist = path => import(pathToFileURL(join(ROOT, "packages", "producer", "dist", path)).href);
const { loadRecipes, produceIssues, recipesFor } = await dist("records/recipes.js");
const { loadStandards } = await dist("records/standards.js");
const { craftIssues } = await dist("constitution/rules/r15.js");
const { importSpecifiers, importsRecipe, judgeFiles } = await dist("constitution/rules/r16.js");
const { requirementsVerdict } = await dist("constitution/criteria/core/verdict.js");

const recipes = loadRecipes(ROOT).filter(recipe => recipe.agent === AGENT);
const standards = loadStandards(ROOT).filter(standard => standard.agent === AGENT);
const readJson = path => JSON.parse(readFileSync(path, "utf8"));
const clone = value => structuredClone(value);
const rules = issues => issues.map(item => item.rule);

const RECIPE_IDS = ["seat.configure"];
const STANDARD_COUNT = 1;

function pinned(slot) {
  const pin = readJson(join(CONSUMER, "agents", AGENT, slot, "pin.json"));
  return { name: pin.candidate, text: readFileSync(join(CONSUMER, "agents", AGENT, slot, "candidates", pin.candidate), "utf8") };
}
const asDraft = ({ name, text }) => { let json; if (name.endsWith(".json")) { try { json = JSON.parse(text); } catch { json = undefined; } } return { name, text, json }; };
const withJson = (candidate, change) => { const json = JSON.parse(candidate.text); change(json); return { name: candidate.name, text: JSON.stringify(json, null, 2) }; };
async function judge(slot, candidate) {
  const slotDoc = readJson(join(CONSUMER, "agents", AGENT, slot, "slot.json"));
  const standard = readJson(join(ROOT, "packages", AGENT, "standards", slotDoc.standard, "requirements.json"));
  const verdict = await requirementsVerdict({ candidate: { name: candidate.name, bytes: candidate.text }, kind: slotDoc.kind, standard: { id: standard.id, sha256: "0".repeat(64), requirements: standard.requirements.map(item => ({ check: item.check, params: item.params ?? {} })) }, contract: slotDoc.contract, pinSet: "0".repeat(64) });
  return Object.fromEntries(verdict.results.map(result => [result.check, result.pass]));
}
async function failsBoth(slot, candidate, check) {
  const found = checkDraft(ROOT, slot, asDraft(candidate)).issues.filter(item => item.check === check);
  assert.ok(found.length > 0, `stage-check draft flags ${check}`);
  assert.ok(found.every(item => item.rule === "R15.3" && item.fix), `${check} prints the rule and a fix`);
  assert.equal((await judge(slot, candidate))[check], false, `the judge fails ${check} too`);
}
/** A maker-only fault: the draft check flags it under `rule`; the judge's shape checks still pass. */
async function makerOnly(slot, candidate, rule, pattern) {
  const found = checkDraft(ROOT, slot, asDraft(candidate)).issues.filter(item => item.rule === rule && !item.check);
  assert.ok(found.some(item => pattern.test(item.what) && item.fix), `stage-check draft flags ${rule} ${pattern}`);
  assert.ok(Object.values(await judge(slot, candidate)).every(Boolean), "the judge's shape checks pass: the maker is stricter");
}
const briefFor = (slot, text) => {
  const world = slotWorld(ROOT, AGENT, slot);
  return {
    recipe: "seat.configure", standard: world.standardId, requirements: [...world.requirements],
    inputs: world.inputs.map(id => ({ slot: id, candidate: pinOf(ROOT, id).candidate, sha256: pinOf(ROOT, id).sha256 })),
    step: world.slotDoc.contract.step, tasteLog: tasteWindow(ROOT, AGENT, world.standardId), brief: text,
  };
};

describe("Producer recipes load clean and cover every standard (R15.5)", () => {
  it("loads exactly the recipe folders, each with no issue", () => {
    assert.deepEqual(recipes.map(recipe => recipe.id), RECIPE_IDS);
    for (const recipe of recipes) {
      assert.deepEqual(recipe.issues, [], recipe.id);
      assert.deepEqual(produceIssues(recipe, standards), [], recipe.id);
      assert.equal(recipe.doc.rung, "create", recipe.id);
      assert.ok(recipe.doc.axes.length >= 3, `${recipe.id} has at least three axes`);
    }
  });

  it("gives every Producer standard at least one valid recipe", () => {
    assert.equal(standards.length, STANDARD_COUNT);
    assert.deepEqual(standards.filter(standard => !recipesFor(recipes, standard).length).map(standard => standard.id), []);
  });

  it("holds no adopt recipe while every Producer standard has no seeds (R15.9 would flag it)", () => {
    for (const standard of standards) assert.deepEqual(standard.doc.seeds, [], standard.id);
    assert.equal(recipes.filter(recipe => recipe.doc.rung === "adopt").length, 0);
  });

  it("ships the one stage core byte-identical in every non-Designer recipes folder", () => {
    const core = readFileSync(join(HERE, "stage-core.mjs"), "utf8");
    for (const agent of ["director", "writer", "publisher", "producer"]) assert.equal(readFileSync(join(ROOT, "packages", agent, "recipes", "stage-core.mjs"), "utf8"), core, agent);
  });
});

describe("craft.md runs the fixed 5b stages with a check at each", () => {
  const STAGES = ["### 0. Preconditions", "### 1. brief (model)", "### 2. diverge (model)", "### 3. render (deterministic)", "### 4. critique (model, fresh critic)", "### 5. refine (at most 2 rounds)", "### 6. submit (deterministic)"];
  for (const id of RECIPE_IDS) {
    it(`${id}: stages in order, judgement only at brief, diverge and critique, a check before every record`, () => {
      const text = readFileSync(join(HERE, id, "craft.md"), "utf8");
      const at = STAGES.map(heading => text.indexOf(heading));
      assert.ok(at.every(index => index >= 0), `${id} has every stage heading`);
      assert.deepEqual([...at].sort((a, b) => a - b), at, `${id} stages are in order`);
      assert.equal((text.match(/^### \d\. .*\(model/gm) ?? []).length, 3, `${id} marks exactly three model nodes`);
      const section = n => text.slice(at[n], at[n + 1] ?? text.length);
      assert.match(section(1), new RegExp(`stage-check\\.mjs brief <slot> brief\\.json\\nclossys next ${AGENT}/<slot> --stage brief `), `${id} checks the brief before recording it`);
      assert.match(section(2), new RegExp(`stage-check\\.mjs diverge <slot> directions\\.json\\nclossys next ${AGENT}/<slot> --stage diverge `), `${id} checks the axes before recording diverge`);
      const render = section(3);
      const draft = render.indexOf(`stage-check.mjs draft <slot> <draft>`), rendered = render.indexOf("clossys render <slot> --draft <direction file>"), slotCheck = render.indexOf(`clossys check --constitution --slot ${AGENT}/<slot>`);
      assert.ok(draft >= 0 && rendered > draft && slotCheck > rendered, `${id} checks the draft, renders, then preflights`);
      assert.match(section(4), new RegExp(`clossys critique-packet ${AGENT}/<slot> --standard <standard>`));
      assert.match(section(4), new RegExp(`clossys critique ${AGENT}/<slot> --record critique\\.json`));
      assert.match(section(5), /stage-check\.mjs diverge <slot> directions\.json/, `${id} re-checks a refine against the other directions`);
      const submit = section(6);
      const submitDraft = submit.indexOf("stage-check.mjs draft <slot> <draft>"), submitCheck = submit.indexOf(`clossys check --constitution --slot ${AGENT}/<slot>`);
      assert.ok(submitDraft >= 0 && submitCheck > submitDraft && submit.indexOf("clossys seat <step> --by <holder>") > submitCheck, `${id} checks the draft and preflights before clossys seat writes it`);
      for (const stage of ["brief", "diverge", "render", "critique", "refine"]) assert.match(text, new RegExp(`--stage ${stage} [^\\n]*--recipe ${id.replace(".", "\\.")} `), `${id} records craft:${stage} under its id`);
      assert.doesNotMatch(text, /\.\.\/|packages\/producer\/src/, `${id} names no judge source`);
    });
  }
});

describe("stage-check brief and diverge: each stage checks its own output", () => {
  const slot = "seat.writer.candidates";
  const brief = briefFor(slot, "The Writer candidates step is held by the Writer at a mapped tier, with a human procedure the owner can run by hand when the llm is off.");
  const directions = {
    recipe: "seat.configure",
    directions: [
      { id: "writer-mid", idea: "The Writer holds the step at mid with a human fallback", axes: { holder: "agent:writer", tier: "mid", hand: "llm+human" }, traits: [] },
      { id: "planner-high", idea: "The planner runs the step at high", axes: { holder: "planner", tier: "high", hand: "llm" }, traits: [] },
      { id: "owner-hand", idea: "The owner writes the candidates by hand", axes: { holder: "owner", tier: "none", hand: "human" }, traits: [] },
    ],
  };

  it("passes a seat brief naming the contract's step, and three feasible seats", () => {
    assert.deepEqual(checkBrief(ROOT, slot, brief), []);
    assert.deepEqual(checkDiverge(ROOT, slot, directions), []);
  });

  it("fails a brief that names another step, the wrong standard, or no taste log (mutation)", () => {
    const step = clone(brief); step.step = "designer.candidates";
    assert.ok(checkBrief(ROOT, slot, step).some(item => item.rule === "R15.7" && /writer\.candidates/.test(item.what) && item.fix));
    const standard = clone(brief); standard.standard = "statement";
    assert.ok(rules(checkBrief(ROOT, slot, standard)).includes("R15.1"));
    const taste = clone(brief); delete taste.tasteLog;
    assert.notDeepEqual(checkBrief(ROOT, slot, taste), []);
  });

  it("fails an infeasible seat: an owner with an llm only, an unmapped tier, a human hand with a tier, a bad holder (mutation)", () => {
    const at = (change) => { const file = clone(directions); change(file.directions); return checkDiverge(ROOT, slot, file); };
    assert.ok(at(d => { d[2].axes.hand = "llm"; d[2].axes.tier = "mid"; d[0].axes.tier = "high"; d[1].axes.holder = "agent:producer"; }).some(item => item.rule === "R15.7" && /owner seat with no human hand/.test(item.what)));
    assert.ok(at(d => { d[0].axes.tier = "low"; }).some(item => item.rule === "R15.7" && /tier "low" has no model/.test(item.what)));
    assert.ok(at(d => { d[2].axes.tier = "mid"; d[0].axes.tier = "high"; d[1].axes.tier = "none"; d[1].axes.hand = "human"; }).some(item => item.rule === "R15.7" && /human only but sets tier/.test(item.what)));
    assert.ok(at(d => { d[1].axes.holder = "bot"; }).some(item => item.rule === "R15.7" && /holder "bot"/.test(item.what)));
    assert.ok(at(d => { d[1].axes.hand = "robot"; }).some(item => item.rule === "R15.7" && /hand "robot"/.test(item.what)));
    assert.ok(at(d => { d[2].axes.holder = "Planner"; }).some(item => item.rule === "R15.7"), "a cosmetic or invalid holder fails");
  });

  it("the stages a craft.md records satisfy R15.7's order and axis rule; a third refine does not", () => {
    const run = ops => ops.map(op => ({ op: `craft:${op}`, recipe: "seat.configure", ...(op === "diverge" ? { directions: directions.directions } : {}) }));
    assert.deepEqual(craftIssues(run(["brief", "diverge", "render", "critique", "refine", "render", "critique", "refine", "render", "critique"]), recipes, AGENT), []);
    assert.notDeepEqual(craftIssues(run(["brief", "diverge", "render", "critique", "refine", "render", "critique", "refine", "render", "critique", "refine", "render", "critique"]), recipes, AGENT), []);
  });
});

describe("stage-check draft: the maker's preflight agrees with the judge", () => {
  const slot = "seat.writer.candidates";
  const seat = pinned(slot);

  it("passes the pinned Writer seat, and the judge passes every requirement", async () => {
    const { issues, judgeOnly } = checkDraft(ROOT, slot, asDraft(seat));
    assert.deepEqual(issues, []);
    assert.deepEqual(judgeOnly, [], "every requirement is checked by the maker");
    assert.ok(Object.values(await judge(slot, seat)).every(Boolean));
  });

  it("a holder that is not owner, planner or agent:<agent> fails (worklist: invalid holder)", async () => {
    await failsBoth(slot, withJson(seat, json => { json.by = "bot"; }), "seat.assigned");
    await failsBoth(slot, withJson(seat, json => { json.llm.tier = "turbo"; }), "seat.assigned");
    await failsBoth(slot, withJson(seat, json => { json.by = "owner"; json.human = null; }), "seat.assigned");
  });

  it("a prompt file of another agent fails (worklist: prompt of another agent)", async () => {
    await failsBoth(slot, withJson(seat, json => { json.llm.promptFile = "packages/designer/actions/designer.candidates/skill.md"; }), "seat.prompt-owner");
  });

  it("a model the seat policy does not map, or a skill file that does not exist, fails the maker (stricter than the judge)", async () => {
    await makerOnly(slot, withJson(seat, json => { json.llm.model = "other-model"; }), "R20", /other-model/);
    await makerOnly(slot, withJson(seat, json => { json.llm.promptFile = "packages/writer/actions/writer.no-such-step/skill.md"; }), "R07", /writer\.no-such-step/);
  });
});

describe("judge independence (R16.1)", () => {
  it("no judge file imports anything under packages/*/recipes", () => {
    const files = judgeFiles(ROOT);
    assert.ok(files.length > 0);
    const offenders = files.flatMap(file => importSpecifiers(readFileSync(join(ROOT, file), "utf8")).filter(specifier => importsRecipe(file, specifier)).map(specifier => `${file} -> ${specifier}`));
    assert.deepEqual(offenders, []);
  });

  it("the recipes import only node builtins and files of this folder (no judge, no package)", () => {
    const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(dir, entry.name)) : /\.m?js$/.test(entry.name) ? [join(dir, entry.name)] : []);
    for (const file of walk(HERE).filter(path => !path.endsWith(".test.mjs"))) {
      for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
        assert.ok(specifier.startsWith("node:") || (specifier.startsWith("./") || specifier.startsWith("../")) && resolve(dirname(file), specifier).startsWith(HERE), `${relative(ROOT, file)} imports ${specifier}`);
      }
    }
  });
});
