/**
 * The Writer recipes (unit RC-ND): every Writer standard has a valid recipe (R15.5), every craft.md
 * runs the fixed 5b stages with a mechanical self-check per stage, the stage checks pass real pins and
 * fail on the faults they exist for (the 3S-ND worklist classes: copy that does not cite the brand
 * voice, a non-upstream source, a wrong entry id, markup in a value, a value over its limit, a
 * headline not in sentence case, a malformed record, a missing part), the draft check agrees with the
 * judge, and no judge imports a recipe (R16.1).
 *
 *   node --test packages/writer/recipes/recipes.test.mjs
 *
 * It reads the producer's built modules (packages/producer/dist): build the producer first.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { VOICE_SLOT, checkBrief, checkDiverge, checkDraft } from "./stage-check.mjs";
import { pinOf, slotWorld, tasteWindow } from "./stage-core.mjs";

const AGENT = "writer";
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..");
const CONSUMER_ROOT = process.env.CLOSSYS_ROOT ? resolve(process.env.CLOSSYS_ROOT) : join(ROOT, "packages/producer/test-fixtures/consumer");
const CONSUMER = join(CONSUMER_ROOT, "clossys");
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

const RECIPE_IDS = ["create.copy", "create.headline", "create.lexicon"];
const STANDARD_COUNT = 9;

function pinned(slot) {
  const pin = readJson(join(CONSUMER, "agents", AGENT, slot, "pin.json"));
  return { name: pin.candidate, text: readFileSync(join(CONSUMER, "agents", AGENT, slot, "candidates", pin.candidate), "utf8") };
}
const asDraft = ({ name, text }) => { let json; if (name.endsWith(".json")) { try { json = JSON.parse(text); } catch { json = undefined; } } return { name, text, json }; };
async function judge(slot, candidate) {
  const slotDoc = readJson(join(CONSUMER, "agents", AGENT, slot, "slot.json"));
  const standard = readJson(join(ROOT, "packages", AGENT, "standards", slotDoc.standard, "requirements.json"));
  const verdict = await requirementsVerdict({ candidate: { name: candidate.name, bytes: candidate.text }, kind: slotDoc.kind, standard: { id: standard.id, sha256: "0".repeat(64), requirements: standard.requirements.map(item => ({ check: item.check, params: item.params ?? {} })) }, contract: slotDoc.contract, pinSet: "0".repeat(64) });
  return Object.fromEntries(verdict.results.map(result => [result.check, result.pass]));
}
async function failsBoth(slot, candidate, check) {
  const found = checkDraft(CONSUMER_ROOT, slot, asDraft(candidate)).issues.filter(item => item.check === check);
  assert.ok(found.length > 0, `stage-check draft flags ${check}`);
  assert.ok(found.every(item => item.rule === "R15.3" && item.fix), `${check} prints the rule and a fix`);
  assert.equal((await judge(slot, candidate))[check], false, `the judge fails ${check} too`);
}
const edit = (candidate, from, to) => { assert.ok(candidate.text.includes(from), `fixture holds ${JSON.stringify(from)}`); return { name: candidate.name, text: candidate.text.replace(from, to) }; };
const briefFor = (slot, recipe, text) => {
  const world = slotWorld(CONSUMER_ROOT, AGENT, slot);
  const ids = [...new Set([...world.inputs, VOICE_SLOT])];
  return {
    recipe, standard: world.standardId, requirements: [...world.requirements],
    inputs: ids.map(id => ({ slot: id, candidate: pinOf(CONSUMER_ROOT, id).candidate, sha256: pinOf(CONSUMER_ROOT, id).sha256 })),
    tasteLog: tasteWindow(CONSUMER_ROOT, AGENT, world.standardId), brief: text,
  };
};

describe("Writer recipes load clean and cover every standard (R15.5)", () => {
  it("loads exactly the recipe folders, each with no issue", () => {
    assert.deepEqual(recipes.map(recipe => recipe.id), RECIPE_IDS);
    for (const recipe of recipes) {
      assert.deepEqual(recipe.issues, [], recipe.id);
      assert.deepEqual(produceIssues(recipe, standards), [], recipe.id);
      assert.equal(recipe.doc.rung, "create", recipe.id);
      assert.ok(recipe.doc.axes.length >= 3, `${recipe.id} has at least three axes`);
    }
  });

  it("gives every Writer standard at least one valid recipe", () => {
    assert.equal(standards.length, STANDARD_COUNT);
    assert.deepEqual(standards.filter(standard => !recipesFor(recipes, standard).length).map(standard => standard.id), []);
  });

  it("holds no adopt recipe while every Writer standard has no seeds (R15.9 would flag it)", () => {
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
      assert.ok(submitDraft >= 0 && submitCheck > submitDraft && submit.indexOf("--submit") > submitCheck, `${id} checks the draft and preflights before submit`);
      for (const stage of ["brief", "diverge", "render", "critique", "refine"]) assert.match(text, new RegExp(`--stage ${stage} [^\\n]*--recipe ${id.replace(".", "\\.")} `), `${id} records craft:${stage} under its id`);
      assert.doesNotMatch(text, /\.\.\/|packages\/producer\/src/, `${id} names no judge source`);
    });
  }
});

describe("stage-check brief and diverge: each stage checks its own output", () => {
  const slot = "strings.actions";
  const brief = briefFor(slot, "create.copy", "Action labels in the pinned voice: a verb first, plain, short enough for a button, and the same verb for the same act everywhere in Studio.");
  const directions = {
    recipe: "create.copy",
    directions: [
      { id: "verb-first", idea: "Bare verbs with one object", axes: { angle: "verb-first", register: "plain", structure: "verb-object" }, traits: [VOICE_SLOT] },
      { id: "outcome", idea: "Name the outcome the action gives", axes: { angle: "outcome", register: "warm", structure: "verb-result" }, traits: [VOICE_SLOT, "identity.naming.name"] },
      { id: "terse", idea: "One word where one word is enough", axes: { angle: "economy", register: "terse", structure: "single-word" }, traits: [VOICE_SLOT, "finding:writer-owner-answers-2026-11-03"] },
    ],
  };

  it("passes a brief from the pinned voice and three distinct voice-derived directions", () => {
    assert.deepEqual(checkBrief(CONSUMER_ROOT, slot, brief), []);
    assert.deepEqual(checkDiverge(CONSUMER_ROOT, slot, directions), []);
  });

  it("fails a brief without the pinned voice, a stale sha, a path, a Designer input, the wrong recipe (mutation)", () => {
    const noVoice = clone(brief); noVoice.inputs = noVoice.inputs.filter(item => item.slot !== VOICE_SLOT);
    assert.ok(checkBrief(CONSUMER_ROOT, slot, noVoice).some(item => item.rule === "R15.7" && item.what.includes(VOICE_SLOT)));
    const noReq = clone(brief); noReq.requirements = noReq.requirements.slice(1);
    assert.ok(rules(checkBrief(CONSUMER_ROOT, slot, noReq)).includes("R15.3"));
    const stale = clone(brief); stale.inputs[0].sha256 = "f".repeat(64);
    assert.ok(rules(checkBrief(CONSUMER_ROOT, slot, stale)).includes("R12"));
    const path = clone(brief); path.inputs.push({ slot: "clossys/agents/director/identity.verbal.voice/pin.json", candidate: "x", sha256: "0".repeat(64) });
    assert.ok(rules(checkBrief(CONSUMER_ROOT, slot, path)).includes("R06.7"));
    const designer = clone(brief); const pin = pinOf(CONSUMER_ROOT, "frames.studio-shell"); designer.inputs.push({ slot: "frames.studio-shell", candidate: pin.candidate, sha256: pin.sha256 });
    assert.ok(rules(checkBrief(CONSUMER_ROOT, slot, designer)).includes("R20"), "Writer copy derives from Director and Writer pins only");
    const wrongRecipe = clone(brief); wrongRecipe.recipe = "create.lexicon";
    assert.ok(rules(checkBrief(CONSUMER_ROOT, slot, wrongRecipe)).includes("R15.5"));
  });

  it("fails a direction that does not cite the voice, cosmetic variants and off-axis values (mutation)", () => {
    const noVoice = clone(directions); noVoice.directions[1].traits = ["identity.naming.name"];
    assert.ok(checkDiverge(CONSUMER_ROOT, slot, noVoice).some(item => item.rule === "R20" && item.what.includes(VOICE_SLOT)));
    const designer = clone(directions); designer.directions[0].traits.push("frames.studio-shell");
    assert.ok(rules(checkDiverge(CONSUMER_ROOT, slot, designer)).includes("R20"));
    const cosmetic = clone(directions); cosmetic.directions[2].axes.register = "Plain";
    assert.ok(checkDiverge(CONSUMER_ROOT, slot, cosmetic).some(item => item.rule === "R15.7" && /axis register/.test(item.what)));
    const offAxis = clone(directions); offAxis.directions[0].axes.length = "short";
    assert.ok(checkDiverge(CONSUMER_ROOT, slot, offAxis).some(item => /axis length/.test(item.what)));
  });

  it("the stages a craft.md records satisfy R15.7's order and axis rule; a third refine does not", () => {
    const run = ops => ops.map(op => ({ op: `craft:${op}`, recipe: "create.copy", ...(op === "diverge" ? { directions: directions.directions } : {}) }));
    assert.deepEqual(craftIssues(run(["brief", "diverge", "render", "critique", "refine", "render", "critique", "refine", "render", "critique"]), recipes, AGENT), []);
    assert.notDeepEqual(craftIssues(run(["brief", "diverge", "render", "critique", "refine", "render", "critique", "refine", "render", "critique", "refine", "render", "critique"]), recipes, AGENT), []);
  });
});

describe("stage-check draft: the maker's preflight agrees with the judge", () => {
  const SLOTS = ["strings.actions", "passages.hero", "patterns.confirmation", "lexicon.capitalization", "narratives.app-chrome"];
  const fixture = Object.fromEntries(SLOTS.map(slot => [slot, pinned(slot)]));

  it("passes the pinned string, headline, pattern, lexicon and narrative candidates, and the judge passes every requirement", async () => {
    for (const slot of SLOTS) {
      const { issues, judgeOnly } = checkDraft(CONSUMER_ROOT, slot, asDraft(fixture[slot]));
      assert.deepEqual(issues, [], slot);
      assert.deepEqual(judgeOnly, [], `${slot}: every requirement is checked by the maker`);
      assert.ok(Object.values(await judge(slot, fixture[slot])).every(Boolean), `${slot} passes the judge`);
    }
  });

  it("copy whose source does not cite the brand voice fails (worklist)", async () => {
    await failsBoth("strings.actions", edit(fixture["strings.actions"], '"ref":["director:identity.verbal.voice"]', '"ref":["finding:writer-owner-answers-2026-11-03"]'), "copy.voice-derived");
  });

  it("a source ref that is a URL fails; an unpinned upstream slot fails the maker (worklist)", async () => {
    await failsBoth("strings.actions", edit(fixture["strings.actions"], '"ref":["director:identity.verbal.voice"]', '"ref":["director:identity.verbal.voice","https://example.com/voice"]'), "copy.derived-upstream");
    const unpinned = checkDraft(CONSUMER_ROOT, "strings.actions", asDraft(edit(fixture["strings.actions"], '"ref":["director:identity.verbal.voice"]', '"ref":["director:identity.verbal.voice","writer:strings.no-such-slot"]'))).issues;
    assert.ok(unpinned.some(item => item.check === "copy.derived-upstream" && /not a pinned writer slot/.test(item.what)));
  });

  it("an entry whose meta id is not its key fails (worklist)", async () => {
    await failsBoth("strings.actions", edit(fixture["strings.actions"], '{"id":"studio.action.compare"', '{"id":"studio.action.compares"'), "copy.entries");
  });

  it("markup, a placeholder, filler or a broken ICU message in a value fails (worklist: no markup)", async () => {
    await failsBoth("patterns.confirmation", edit(fixture["patterns.confirmation"], "-->\nUndo", "-->\n**Undo**"), "copy.plain-values");
    await failsBoth("patterns.confirmation", edit(fixture["patterns.confirmation"], "-->\nUndo", "-->\nTODO"), "text.no-placeholder");
    await failsBoth("strings.actions", edit(fixture["strings.actions"], "-->\nCopy link", "-->\nCopy link seamlessly"), "lexicon.clean");
    await failsBoth("strings.actions", edit(fixture["strings.actions"], "-->\nCopy link", "-->\nCopy {count, plural, one {# link}}"), "copy.plain-values");
  });

  it("a value over the contract's limit fails (worklist)", async () => {
    await failsBoth("strings.actions", edit(fixture["strings.actions"], "-->\nCopy link", "-->\nCopy the link to this slot to the clipboard now"), "copy.within-limits");
  });

  it("a headline not in sentence case fails (worklist)", async () => {
    await failsBoth("passages.hero", edit(fixture["passages.hero"], "See where every choice came from", "See Where Every Choice Came From"), "copy.sentence-case");
  });

  it("a lexicon record missing a field, a pattern missing a required part and a narrative with no frame fail", async () => {
    await failsBoth("lexicon.capitalization", edit(fixture["lexicon.capitalization"], '"format": "capitalization",', ""), "lexicon.record");
    const lines = fixture["patterns.confirmation"].text.split("\n");
    const at = lines.indexOf("### studio.confirm.dismiss.what-happened");
    await failsBoth("patterns.confirmation", { name: fixture["patterns.confirmation"].name, text: [...lines.slice(0, at), ...lines.slice(at + 4)].join("\n") }, "pattern.parts");
    await failsBoth("narratives.app-chrome", edit(fixture["narratives.app-chrome"], '"frameId": "frames.studio-shell"', '"frameId": "studio-shell"'), "narrative.sequence");
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
