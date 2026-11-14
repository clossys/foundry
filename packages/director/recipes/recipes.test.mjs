/**
 * The Director recipes (unit RC-ND): every Director standard has a valid recipe (R15.5), every
 * craft.md runs the fixed 5b stages with a mechanical self-check per stage, the stage checks pass real
 * pins and fail on the faults they exist for (the 3S-ND worklist classes: a watch line with no time
 * window, an uncited Because, a non-Director source, a long or code-marked Direction), the draft check
 * agrees with the judge, and no judge imports a recipe (R16.1).
 *
 *   node --test packages/director/recipes/recipes.test.mjs
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

const AGENT = "director";
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..");
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

const RECIPE_IDS = ["create.statement", "create.structured"];
const STANDARD_COUNT = 4;

/** The pinned candidate of a slot: its name and text. */
function pinned(slot) {
  const pin = readJson(join(ROOT, "clossys", "agents", AGENT, slot, "pin.json"));
  return { name: pin.candidate, text: readFileSync(join(ROOT, "clossys", "agents", AGENT, slot, "candidates", pin.candidate), "utf8") };
}
const asDraft = ({ name, text }) => { let json; if (name.endsWith(".json")) { try { json = JSON.parse(text); } catch { json = undefined; } } return { name, text, json }; };
/** The judge's verdict per requirement id, as the certifier runs it (the standard's criteria, $contract bound). */
async function judge(slot, candidate) {
  const slotDoc = readJson(join(ROOT, "clossys", "agents", AGENT, slot, "slot.json"));
  const standard = readJson(join(ROOT, "packages", AGENT, "standards", slotDoc.standard, "requirements.json"));
  const verdict = await requirementsVerdict({ candidate: { name: candidate.name, bytes: candidate.text }, kind: slotDoc.kind, standard: { id: standard.id, sha256: "0".repeat(64), requirements: standard.requirements.map(item => ({ check: item.check, params: item.params ?? {} })) }, contract: slotDoc.contract, pinSet: "0".repeat(64) });
  return Object.fromEntries(verdict.results.map(result => [result.check, result.pass]));
}
/** A mutant fails the draft check on `check` and the judge on the same requirement. */
async function failsBoth(slot, candidate, check) {
  const found = checkDraft(ROOT, slot, asDraft(candidate)).issues.filter(item => item.check === check);
  assert.ok(found.length > 0, `stage-check draft flags ${check}`);
  assert.ok(found.every(item => item.rule === "R15.3" && item.fix), `${check} prints the rule and a fix`);
  assert.equal((await judge(slot, candidate))[check], false, `the judge fails ${check} too`);
}
const briefFor = (slot, recipe, text) => {
  const world = slotWorld(ROOT, AGENT, slot);
  return {
    recipe, standard: world.standardId, requirements: [...world.requirements],
    inputs: world.inputs.map(id => ({ slot: id, candidate: pinOf(ROOT, id).candidate, sha256: pinOf(ROOT, id).sha256 })),
    tasteLog: tasteWindow(ROOT, AGENT, world.standardId), brief: text,
  };
};

describe("Director recipes load clean and cover every standard (R15.5)", () => {
  it("loads exactly the recipe folders, each with no issue", () => {
    assert.deepEqual(recipes.map(recipe => recipe.id), RECIPE_IDS);
    for (const recipe of recipes) {
      assert.deepEqual(recipe.issues, [], recipe.id);
      assert.deepEqual(produceIssues(recipe, standards), [], recipe.id);
      assert.equal(recipe.doc.rung, "create", recipe.id);
      assert.ok(recipe.doc.axes.length >= 3, `${recipe.id} has at least three axes`);
    }
  });

  it("gives every Director standard at least one valid recipe", () => {
    assert.equal(standards.length, STANDARD_COUNT);
    assert.deepEqual(standards.filter(standard => !recipesFor(recipes, standard).length).map(standard => standard.id), []);
  });

  it("holds no adopt recipe while every Director standard has no seeds (R15.9 would flag it)", () => {
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
      const draft = render.indexOf(`stage-check.mjs draft <slot> <draft>`), rendered = render.indexOf("clossys render <slot> <candidate>"), slotCheck = render.indexOf(`clossys check --slot ${AGENT}/<slot>`);
      assert.ok(draft >= 0 && rendered > draft && slotCheck > rendered, `${id} checks the draft, renders, then preflights`);
      assert.match(section(4), new RegExp(`clossys critique-packet ${AGENT}/<slot> --standard <standard>`));
      assert.match(section(4), new RegExp(`clossys critique ${AGENT}/<slot> --record critique\\.json`));
      assert.match(section(5), /stage-check\.mjs diverge <slot> directions\.json/, `${id} re-checks a refine against the other directions`);
      const submit = section(6);
      const submitDraft = submit.indexOf("stage-check.mjs draft <slot> <draft>"), submitCheck = submit.indexOf(`clossys check --slot ${AGENT}/<slot>`);
      assert.ok(submitDraft >= 0 && submitCheck > submitDraft && submit.indexOf("--submit") > submitCheck, `${id} checks the draft and preflights before submit`);
      for (const stage of ["brief", "diverge", "render", "critique", "refine"]) assert.match(text, new RegExp(`--stage ${stage} [^\\n]*--recipe ${id.replace(".", "\\.")} `), `${id} records craft:${stage} under its id`);
      assert.doesNotMatch(text, /\.\.\/|packages\/producer\/src/, `${id} names no judge source`);
    });
  }
});

describe("stage-check brief and diverge: each stage checks its own output", () => {
  const slot = "advantage.proposition.promise";
  const brief = briefFor(slot, "create.statement", "Promise the core segment the one thing the alternative cannot: a direction written once that the agents build from, checked and on the record.");
  const directions = {
    recipe: "create.statement",
    directions: [
      { id: "record", idea: "Promise a record of every choice", axes: { stance: "assertive", scope: "whole-studio", horizon: "now" }, traits: ["context.customer.need", "context.competition.alternative"] },
      { id: "once", idea: "Promise direction written once", axes: { stance: "plain", scope: "one-brief", horizon: "next-release" }, traits: ["context.customer.need", "focus.segment.core"] },
      { id: "judgment", idea: "Promise judgement spent only where it counts", axes: { stance: "contrast", scope: "owner-calls", horizon: "year" }, traits: ["focus.segment.core", "finding:foundry-public-readme"] },
    ],
  };

  it("passes a brief listing every requirement and pinned input, and three distinct Director-derived directions", () => {
    assert.deepEqual(checkBrief(ROOT, slot, brief), []);
    assert.deepEqual(checkDiverge(ROOT, slot, directions), []);
  });

  it("fails a brief missing a requirement or an input, a stale sha, a path, the wrong recipe (mutation)", () => {
    const noReq = clone(brief); noReq.requirements = noReq.requirements.slice(1);
    assert.ok(rules(checkBrief(ROOT, slot, noReq)).includes("R15.3"));
    const noInput = clone(brief); noInput.inputs = [];
    assert.ok(rules(checkBrief(ROOT, slot, noInput)).includes("R15.7"));
    assert.ok(rules(checkBrief(ROOT, slot, noInput)).includes("R20"), "a brief cites Director slots");
    const stale = clone(brief); stale.inputs[0].sha256 = "f".repeat(64);
    assert.ok(rules(checkBrief(ROOT, slot, stale)).includes("R12"));
    const path = clone(brief); path.inputs.push({ slot: "clossys/agents/director/focus.segment.core/pin.json", candidate: "x", sha256: "0".repeat(64) });
    assert.ok(rules(checkBrief(ROOT, slot, path)).includes("R06.7"));
    const writer = clone(brief); const pin = pinOf(ROOT, "strings.actions"); writer.inputs.push({ slot: "strings.actions", candidate: pin.candidate, sha256: pin.sha256 });
    assert.ok(rules(checkBrief(ROOT, slot, writer)).includes("R20"), "a Writer slot is no Director input");
    const wrongRecipe = clone(brief); wrongRecipe.recipe = "create.structured";
    assert.ok(rules(checkBrief(ROOT, slot, wrongRecipe)).includes("R15.5"));
    const taste = clone(brief); taste.tasteLog = 99;
    assert.ok(rules(checkBrief(ROOT, slot, taste)).includes("R15.8"));
  });

  it("fails cosmetic variants, a direction with no Director trait, a non-Director trait, an unrecorded finding (mutation)", () => {
    const cosmetic = clone(directions); cosmetic.directions[2].axes.stance = " Assertive ";
    assert.ok(checkDiverge(ROOT, slot, cosmetic).some(item => item.rule === "R15.7" && /axis stance/.test(item.what)));
    const noTrait = clone(directions); noTrait.directions[1].traits = [];
    assert.ok(rules(checkDiverge(ROOT, slot, noTrait)).includes("R20"));
    const writer = clone(directions); writer.directions[0].traits.push("strings.actions");
    assert.ok(rules(checkDiverge(ROOT, slot, writer)).includes("R20"));
    const finding = clone(directions); finding.directions[2].traits = ["finding:no-such-finding"];
    assert.ok(rules(checkDiverge(ROOT, slot, finding)).includes("R06.7"));
    const two = clone(directions); two.directions = two.directions.slice(0, 2);
    assert.ok(checkDiverge(ROOT, slot, two).some(item => /2 directions/.test(item.what)));
    const offAxis = clone(directions); offAxis.directions[0].axes.mood = "x";
    assert.ok(checkDiverge(ROOT, slot, offAxis).some(item => /axis mood/.test(item.what)));
  });

  it("the stages a craft.md records satisfy R15.7's order and axis rule; a third refine does not", () => {
    const run = ops => ops.map(op => ({ op: `craft:${op}`, recipe: "create.statement", ...(op === "diverge" ? { directions: directions.directions } : {}) }));
    assert.deepEqual(craftIssues(run(["brief", "diverge", "render", "critique", "refine", "render", "critique", "refine", "render", "critique"]), recipes, AGENT), []);
    assert.notDeepEqual(craftIssues(run(["brief", "diverge", "render", "critique", "refine", "render", "critique", "refine", "render", "critique", "refine", "render", "critique"]), recipes, AGENT), []);
  });
});

describe("stage-check draft: the maker's preflight agrees with the judge", () => {
  const promise = pinned("advantage.proposition.promise");
  const pricing = pinned("advantage.model.pricing");
  const need = pinned("context.customer.need");
  const edit = (candidate, from, to) => { assert.ok(candidate.text.includes(from), `fixture holds ${JSON.stringify(from)}`); return { name: candidate.name, text: candidate.text.replace(from, to) }; };

  it("passes the pinned statement, measure and profile briefs, and the judge passes every requirement", async () => {
    for (const [slot, candidate] of [["advantage.proposition.promise", promise], ["advantage.model.pricing", pricing], ["context.customer.need", need]]) {
      const { issues, judgeOnly } = checkDraft(ROOT, slot, asDraft(candidate));
      assert.deepEqual(issues, [], slot);
      assert.deepEqual(judgeOnly, [], `${slot}: every requirement is checked by the maker`);
      assert.ok(Object.values(await judge(slot, candidate)).every(Boolean), `${slot} passes the judge`);
    }
  });

  it("a watch line with no time window or not in the If ... then form fails (worklist)", async () => {
    await failsBoth("advantage.proposition.promise", edit(promise, " in any month,", ","), "brief.watch-trigger");
    await failsBoth("advantage.proposition.promise", { name: promise.name, text: promise.text.replace(/## Watch\n- .*/, "## Watch\n- Keep an eye on hand edits.") }, "brief.watch-trigger");
  });

  it("a Because line with no citation fails (worklist)", async () => {
    await failsBoth("advantage.proposition.promise", edit(promise, " (focus.segment.core)", ""), "brief.because-cited");
  });

  it("a source that cites a URL or a non-Director slot fails (worklist)", async () => {
    await failsBoth("advantage.proposition.promise", edit(promise, '"ref": ["context.customer.need"', '"ref": ["https://example.com/notes", "context.customer.need"'), "brief.derived-upstream");
    const writer = checkDraft(ROOT, "advantage.proposition.promise", asDraft(edit(promise, '"ref": ["context.customer.need"', '"ref": ["strings.actions", "context.customer.need"'))).issues;
    assert.ok(writer.some(item => item.check === "brief.derived-upstream" && /writer slot/.test(item.what)), "the maker refuses a Writer slot as a brief source");
  });

  it("a Direction value too long, or holding code markup, fails (worklist)", async () => {
    const long = "Promise: " + Array.from({ length: 34 }, (_, index) => `word${index}`).join(" ") + ".";
    await failsBoth("advantage.proposition.promise", { name: promise.name, text: promise.text.replace(/- Promise: .*/, `- ${long}`) }, "brief.direction-values");
    await failsBoth("advantage.proposition.promise", edit(promise, "- For: developers", "- For: `developers`"), "brief.plain-direction");
  });

  it("a measure brief with one quantity and a profile brief with no boundary fail (worklist)", async () => {
    await failsBoth("advantage.model.pricing", edit(pricing, "- Metric: none; Foundry is not sold.", "- Metric: Foundry is not sold."), "brief.quantified");
    const lines = need.text.split("\n");
    const start = lines.indexOf("## Direction"), end = lines.indexOf("## Because");
    const noBoundary = [...lines.slice(0, start + 1), ...lines.slice(start + 1, end).filter(line => !/\b(?:not|never|no|avoid|without|rather than|instead of|in place of|only)\b/i.test(line) && !/^- (?:Not|Never|Avoid)/.test(line)), ...lines.slice(end)].join("\n");
    await failsBoth("context.customer.need", { name: need.name, text: noBoundary }, "brief.boundary");
  });

  it("missing or misordered sections and a missing contract key fail", async () => {
    await failsBoth("advantage.proposition.promise", edit(promise, "## Because", "## Reasons"), "brief.sections");
    await failsBoth("advantage.proposition.promise", edit(promise, "- Versus: ", "- Against: "), "brief.keys");
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
