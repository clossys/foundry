/**
 * The Publisher recipes (unit RC-ND): every Publisher standard has a valid recipe (R15.5), every
 * craft recipe's craft.md runs the fixed 5b stages with a mechanical self-check per stage, every plumb
 * recipe's craft.md runs clossys verbs only (no model stage) through a real plumb action, the stage checks pass real
 * pins and fail on the faults they exist for (the 3S-ND worklist classes: a page with no Designer frame,
 * an inline title instead of a Writer key), the draft check agrees with the judge, and no judge imports
 * a recipe (R16.1).
 *
 *   node --test recipes.test.mjs
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

const AGENT = "publisher";
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

/** Craft recipes run the 5b stages (rung create, at least three axes); plumb recipes run a plumb action's clossys verbs only. */
const CRAFT_RECIPE_IDS = ["assemble.page"];
const PLUMB_RECIPE_IDS = ["release"];
const RECIPE_IDS = [...CRAFT_RECIPE_IDS, ...PLUMB_RECIPE_IDS].sort();
const STANDARD_COUNT = 3;

/** The faults of a plumb recipe's craft.md: a model stage, a stage not marked deterministic, a command that is not a clossys verb. */
function plumbCraftFaults(text) {
  const faults = [];
  for (const heading of text.match(/^#{1,6}\s.*\(model\b.*$/gim) ?? []) faults.push(`model stage ${heading.trim()}`);
  const stages = text.match(/^### \d+\. .*$/gm) ?? [];
  if (!stages.length) faults.push("no stage");
  for (const heading of stages) if (!/\(deterministic\)$/.test(heading.trim())) faults.push(`stage not deterministic: ${heading.trim()}`);
  const commands = [...text.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)].flatMap(block => block[1].split("\n").map(line => line.trim()).filter(Boolean));
  if (!commands.length) faults.push("no command");
  for (const line of commands) if (!/^clossys [a-z]/.test(line)) faults.push(`not a clossys verb: ${line}`);
  return faults;
}

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
  const found = checkDraft(CONSUMER_ROOT, slot, asDraft(candidate)).issues.filter(item => item.check === check);
  assert.ok(found.length > 0, `stage-check draft flags ${check}`);
  assert.ok(found.every(item => item.rule === "R15.3" && item.fix), `${check} prints the rule and a fix`);
  assert.equal((await judge(slot, candidate))[check], false, `the judge fails ${check} too`);
}
/** A maker-only fault: the draft check flags it under `rule`; the judge's shape checks still pass. */
async function makerOnly(slot, candidate, rule, pattern) {
  const found = checkDraft(CONSUMER_ROOT, slot, asDraft(candidate)).issues.filter(item => item.rule === rule && !item.check);
  assert.ok(found.some(item => pattern.test(item.what) && item.fix), `stage-check draft flags ${rule} ${pattern}`);
  assert.ok(Object.values(await judge(slot, candidate)).every(Boolean), "the judge's shape checks pass: the maker is stricter");
}
const briefFor = (slot, text) => {
  const world = slotWorld(CONSUMER_ROOT, AGENT, slot);
  return {
    recipe: "assemble.page", standard: world.standardId, requirements: [...world.requirements],
    inputs: world.inputs.map(id => ({ slot: id, candidate: pinOf(CONSUMER_ROOT, id).candidate, sha256: pinOf(CONSUMER_ROOT, id).sha256 })),
    tasteLog: tasteWindow(CONSUMER_ROOT, AGENT, world.standardId), brief: text,
  };
};

describe("Publisher recipes load clean and cover every standard (R15.5)", () => {
  it("loads exactly the recipe folders, each with no issue", () => {
    assert.deepEqual(recipes.map(recipe => recipe.id), RECIPE_IDS);
    for (const recipe of recipes) {
      assert.deepEqual(recipe.issues, [], recipe.id);
      assert.deepEqual(produceIssues(recipe, standards), [], recipe.id);
    }
    for (const recipe of recipes.filter(item => CRAFT_RECIPE_IDS.includes(item.id))) {
      assert.equal(recipe.doc.rung, "create", recipe.id);
      assert.ok(recipe.doc.axes.length >= 3, `${recipe.id} has at least three axes`);
      assert.equal(recipe.doc.action, undefined, `${recipe.id} is crafted and names no plumb action`);
    }
  });

  it("every plumb recipe names a real plumb action that produces for its standards, with no axes and no generator", () => {
    for (const recipe of recipes.filter(item => PLUMB_RECIPE_IDS.includes(item.id))) {
      assert.equal(recipe.doc.rung, "plumb", recipe.id);
      assert.deepEqual(recipe.doc.axes, [], `${recipe.id} has no diverge axes`);
      assert.equal(recipe.doc.generator, undefined, `${recipe.id} has no generator`);
      const action = readJson(join(ROOT, recipe.action.path));
      assert.equal(action.id, recipe.doc.action, recipe.id);
      assert.equal(action.kind, "plumb", `${recipe.id}: ${recipe.doc.action} is a plumb action`);
      for (const id of recipe.doc.produces) assert.ok(action.standards.includes(`${AGENT}/${id}`), `${recipe.doc.action} produces for ${AGENT}/${id}`);
    }
  });

  it("gives every Publisher standard at least one valid recipe", () => {
    assert.equal(standards.length, STANDARD_COUNT);
    assert.deepEqual(standards.filter(standard => !recipesFor(recipes, standard).length).map(standard => standard.id), []);
  });

  it("holds no adopt recipe while every Publisher standard has no seeds (R15.9 would flag it)", () => {
    for (const standard of standards) assert.deepEqual(standard.doc.seeds, [], standard.id);
    assert.equal(recipes.filter(recipe => recipe.doc.rung === "adopt").length, 0);
  });

  it("ships the one stage core byte-identical in every non-Designer recipes folder", () => {
    const core = readFileSync(join(HERE, "stage-core.mjs"), "utf8");
    for (const agent of ["director", "writer", "publisher", "producer"]) assert.equal(readFileSync(join(ROOT, "packages", agent, "recipes", "stage-core.mjs"), "utf8"), core, agent);
  });
});

describe("a plumb recipe's craft.md runs clossys verbs only, with no model stage", () => {
  it("the fault finder refuses a model stage, an unmarked stage and a non-clossys command (mutation)", () => {
    const good = "### 1. build (deterministic)\n\n```sh\nclossys publisher release <pub> --build\n```\n";
    assert.deepEqual(plumbCraftFaults(good), []);
    assert.ok(plumbCraftFaults(good.replace("build (deterministic)", "brief (model)")).some(fault => fault.startsWith("model stage")));
    assert.ok(plumbCraftFaults(good.replace(" (deterministic)", "")).some(fault => fault.startsWith("stage not deterministic")));
    assert.ok(plumbCraftFaults(good.replace("clossys publisher release <pub> --build", "node stage-check.mjs draft")).some(fault => fault.startsWith("not a clossys verb")));
  });
  for (const id of PLUMB_RECIPE_IDS) {
    it(`${id}: deterministic clossys stages only, no model node, no craft event`, () => {
      const text = readFileSync(join(HERE, id, "craft.md"), "utf8");
      assert.deepEqual(plumbCraftFaults(text), [], id);
      assert.doesNotMatch(text, /--stage (?:brief|diverge|render|critique|refine)\b/, `${id} records no craft event`);
      assert.doesNotMatch(text, /\.\.\/|packages\/producer\/src/, `${id} names no judge source`);
      assert.doesNotMatch(text, /\bnode (?:--test )?packages\//, `${id} runs its tools by recipe id, not by a repository path`);
    });
  }
  it("release: builds, writes the manifest, runs the gates, then checks the release slot, in that order", () => {
    const text = readFileSync(join(HERE, "release", "craft.md"), "utf8");
    const commands = [...text.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)].flatMap(block => block[1].split("\n").map(line => line.trim()).filter(Boolean));
    assert.deepEqual(commands, [
      "clossys publisher release <pub> --build",
      "clossys publisher release <pub> --manifest",
      "clossys publisher release <pub> --gates",
      "clossys check --constitution --slot publisher/release.<pub>",
    ]);
    assert.doesNotMatch(text, /--ready\b/, "the owner writes the ready-pin, never the recipe");
  });
});

describe("craft.md runs the fixed 5b stages with a check at each", () => {
  const STAGES = ["### 0. Preconditions", "### 1. brief (model)", "### 2. diverge (model)", "### 3. render (deterministic)", "### 4. critique (model, fresh critic)", "### 5. refine (at most 2 rounds)", "### 6. submit (deterministic)"];
  for (const id of CRAFT_RECIPE_IDS) {
    it(`${id}: stages in order, judgement only at brief, diverge and critique, a check before every record`, () => {
      const text = readFileSync(join(HERE, id, "craft.md"), "utf8");
      const at = STAGES.map(heading => text.indexOf(heading));
      assert.ok(at.every(index => index >= 0), `${id} has every stage heading`);
      assert.deepEqual([...at].sort((a, b) => a - b), at, `${id} stages are in order`);
      assert.equal((text.match(/^### \d\. .*\(model/gm) ?? []).length, 3, `${id} marks exactly three model nodes`);
      const section = n => text.slice(at[n], at[n + 1] ?? text.length);
      assert.match(section(1), new RegExp(`clossys recipe check ${id.replace(".", "\\.")} brief <slot> brief\\.json\\nclossys next ${AGENT}/<slot> --stage brief `), `${id} checks the brief before recording it`);
      assert.match(section(2), new RegExp(`clossys recipe check ${id.replace(".", "\\.")} diverge <slot> directions\\.json\\nclossys next ${AGENT}/<slot> --stage diverge `), `${id} checks the axes before recording diverge`);
      const render = section(3);
      const draft = render.indexOf(`clossys recipe check ${id} draft <slot> <draft>`), rendered = render.indexOf("clossys render <slot> --draft <direction file>"), slotCheck = render.indexOf(`clossys check --constitution --slot ${AGENT}/<slot>`);
      assert.ok(draft >= 0 && rendered > draft && slotCheck > rendered, `${id} checks the draft, renders, then preflights`);
      assert.match(section(4), new RegExp(`clossys critique-packet ${AGENT}/<slot> --standard <standard>`));
      assert.match(section(4), new RegExp(`clossys critique ${AGENT}/<slot> --record critique\\.json`));
      assert.match(section(5), new RegExp(`clossys recipe check ${id.replace(".", "\\.")} diverge <slot> directions\\.json`), `${id} re-checks a refine against the other directions`);
      const submit = section(6);
      const submitDraft = submit.indexOf(`clossys recipe check ${id} draft <slot> <draft>`), submitCheck = submit.indexOf(`clossys check --constitution --slot ${AGENT}/<slot>`);
      assert.ok(submitDraft >= 0 && submitCheck > submitDraft && submit.indexOf("--submit") > submitCheck, `${id} checks the draft and preflights before submit`);
      for (const stage of ["brief", "diverge", "render", "critique", "refine"]) assert.match(text, new RegExp(`--stage ${stage} [^\\n]*--recipe ${id.replace(".", "\\.")} `), `${id} records craft:${stage} under its id`);
      assert.doesNotMatch(text, /\.\.\/|packages\/producer\/src/, `${id} names no judge source`);
      assert.doesNotMatch(text, /\bnode (?:--test )?packages\//, `${id} runs its tools by recipe id, not by a repository path`);
    });
  }
});

describe("stage-check brief and diverge: each stage checks its own output", () => {
  const page = "page.home";
  const brief = briefFor(page, "Home assembles the pinned Studio shell with the decisions waiting first, then the agents' work, then the pipeline, every string a Writer key.");
  const directions = {
    recipe: "assemble.page",
    directions: [
      { id: "needs-first", idea: "Lead with the decisions waiting for the owner", axes: { lead: "needs", order: "needs-work-pipeline", grouping: "by-urgency" }, traits: ["frames.studio-shell", "sections.task-list"] },
      { id: "work-first", idea: "Lead with what the agents have written", axes: { lead: "work", order: "work-needs-pipeline", grouping: "by-agent" }, traits: ["frames.studio-shell", "sections.studio.home"] },
      { id: "header-first", idea: "Lead with the page header and one summary line", axes: { lead: "header", order: "header-work-needs", grouping: "by-stage" }, traits: ["frames.studio-shell", "sections.studio.page-header"] },
    ],
  };

  it("passes a page brief from its pinned frame and sections, and three directions that each name the one frame", () => {
    assert.deepEqual(checkBrief(CONSUMER_ROOT, page, brief), []);
    assert.deepEqual(checkDiverge(CONSUMER_ROOT, page, directions), []);
  });

  it("fails a brief missing the frame, listing an input the slot does not name, a stale sha, the wrong standard (mutation)", () => {
    const noFrame = clone(brief); noFrame.inputs = noFrame.inputs.filter(item => item.slot !== "frames.studio-shell");
    assert.ok(checkBrief(CONSUMER_ROOT, page, noFrame).some(item => item.rule === "R15.7" && item.what.includes("frames.studio-shell")));
    const unlisted = clone(brief); const pin = pinOf(CONSUMER_ROOT, "identity.verbal.voice"); unlisted.inputs.push({ slot: "identity.verbal.voice", candidate: pin.candidate, sha256: pin.sha256 });
    assert.ok(rules(checkBrief(CONSUMER_ROOT, page, unlisted)).includes("R20"), "Publisher assembles only what the slot names");
    const stale = clone(brief); stale.inputs[0].sha256 = "f".repeat(64);
    assert.ok(rules(checkBrief(CONSUMER_ROOT, page, stale)).includes("R12"));
    const standard = clone(brief); standard.standard = "publication";
    assert.ok(rules(checkBrief(CONSUMER_ROOT, page, standard)).includes("R15.1"));
  });

  it("fails a page direction with no frame or two, a trait the slot does not list, cosmetic variants (mutation)", () => {
    const noFrame = clone(directions); noFrame.directions[0].traits = ["sections.task-list"];
    assert.ok(checkDiverge(CONSUMER_ROOT, page, noFrame).some(item => item.rule === "R20" && /0 frames/.test(item.what)));
    const twoFrames = clone(directions); twoFrames.directions[1].traits = ["frames.studio-shell", "frames.studio-shell"];
    assert.ok(checkDiverge(CONSUMER_ROOT, page, twoFrames).some(item => item.rule === "R20" && /2 frames/.test(item.what)));
    const unlisted = clone(directions); unlisted.directions[2].traits.push("identity.verbal.voice");
    assert.ok(rules(checkDiverge(CONSUMER_ROOT, page, unlisted)).includes("R20"));
    const cosmetic = clone(directions); cosmetic.directions[2].axes.grouping = "By-Agent";
    assert.ok(checkDiverge(CONSUMER_ROOT, page, cosmetic).some(item => item.rule === "R15.7" && /axis grouping/.test(item.what)));
  });

  it("a publication's directions order the slot's own pinned pages", () => {
    const slot = "publication.studio";
    const pubBrief = briefFor(slot, "Studio orders its pinned pages so Home and the pipeline come first, then each agent's pages in pipeline order.");
    assert.deepEqual(checkBrief(CONSUMER_ROOT, slot, pubBrief), []);
    const pub = {
      recipe: "assemble.page",
      directions: [
        { id: "pipeline", idea: "Pages in pipeline order", axes: { lead: "home", order: "pipeline", grouping: "by-agent" }, traits: ["page.home", "page.producer-pipeline"] },
        { id: "activity", idea: "Pages by recent activity", axes: { lead: "pipeline", order: "activity", grouping: "by-stage" }, traits: ["page.producer-pipeline", "page.run-overview"] },
        { id: "owner", idea: "Owner pages first", axes: { lead: "decisions", order: "owner-first", grouping: "flat" }, traits: ["page.home", "page.director-identity"] },
      ],
    };
    assert.deepEqual(checkDiverge(CONSUMER_ROOT, slot, pub), []);
    const noPage = clone(pub); noPage.directions[0].traits = [];
    assert.ok(checkDiverge(CONSUMER_ROOT, slot, noPage).some(item => item.rule === "R20" && /orders no page/.test(item.what)));
  });

  it("the stages a craft.md records satisfy R15.7's order and axis rule; a third refine does not", () => {
    const run = ops => ops.map(op => ({ op: `craft:${op}`, recipe: "assemble.page", ...(op === "diverge" ? { directions: directions.directions } : {}) }));
    assert.deepEqual(craftIssues(run(["brief", "diverge", "render", "critique", "refine", "render", "critique", "refine", "render", "critique"]), recipes, AGENT), []);
    assert.notDeepEqual(craftIssues(run(["brief", "diverge", "render", "critique", "refine", "render", "critique", "refine", "render", "critique", "refine", "render", "critique"]), recipes, AGENT), []);
  });
});

describe("stage-check draft: the maker's preflight agrees with the judge", () => {
  const home = pinned("page.home");
  const studio = pinned("publication.studio");

  it("passes the pinned Home page and the Studio publication, and the judge passes every requirement", async () => {
    for (const [slot, candidate] of [["page.home", home], ["publication.studio", studio]]) {
      const { issues, judgeOnly } = checkDraft(CONSUMER_ROOT, slot, asDraft(candidate));
      assert.deepEqual(issues, [], slot);
      assert.deepEqual(judgeOnly, [], `${slot}: every requirement is checked by the maker`);
      assert.ok(Object.values(await judge(slot, candidate)).every(Boolean), `${slot} passes the judge`);
    }
  });

  it("a page with no Designer frame fails (worklist: frame null)", async () => {
    await failsBoth("page.home", withJson(home, json => { json.frame = null; }), "page.assembled");
  });

  it("an inline title or label instead of a Writer key fails (worklist: inline title)", async () => {
    const inline = withJson(home, json => { json.title = "Home"; });
    await failsBoth("page.home", inline, "page.assembled");
    await failsBoth("page.home", inline, "page.no-inline-copy");
    await failsBoth("page.home", withJson(home, json => { json.meta.entry.blocks.Actions[0].label = "Needs"; }), "page.no-inline-copy");
  });

  it("a frame or section that is not pinned, or a key no pinned Writer slot defines, fails the maker (stricter than the judge)", async () => {
    await makerOnly("page.home", withJson(home, json => { json.frame = "frames.no-such-frame"; }), "R07", /frames\.no-such-frame/);
    await makerOnly("page.home", withJson(home, json => { json.sections.push("sections.no-such-section"); }), "R07", /sections\.no-such-section/);
    await makerOnly("page.home", withJson(home, json => { json.title = "studio.page.no-such-key"; }), "R20", /studio\.page\.no-such-key/);
  });

  it("a publication that places a page twice or homes outside its order fails; one that drops an input page fails the maker", async () => {
    await failsBoth("publication.studio", withJson(studio, json => { json.meta.tree.children[0].cells.push("page.home"); }), "publication.routes");
    await failsBoth("publication.studio", withJson(studio, json => { json.routePack.homeRouteId = "nowhere"; }), "publication.routes");
    await makerOnly("publication.studio", withJson(studio, json => { json.meta.tree.children[0].cells = json.meta.tree.children[0].cells.filter(cell => cell !== "page.run-overview"); }), "R20", /page\.run-overview/);
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

describe("stage-check diverge reads the recipe rung (census row 75)", () => {
  // A temp packages/ tree holding this agent's own stage-check bytes, the Publisher's real release recipe (plumb, axes []),
  // a crafted recipe with no axes, the release standard and a consumer slot: the copied check resolves its recipes there.
  const world = async () => {
    const { cpSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), "stage-check-plumb-")));
    const recipes = join(tmp, "packages", "publisher", "recipes");
    mkdirSync(recipes, { recursive: true });
    for (const name of ["stage-check.mjs", "stage-core.mjs"]) cpSync(join(HERE, name), join(recipes, name));
    cpSync(join(ROOT, "packages", "publisher", "recipes", "release"), join(recipes, "release"), { recursive: true });
    mkdirSync(join(recipes, "flat"));
    writeFileSync(join(recipes, "flat", "recipe.json"), JSON.stringify({ schema: "clossys.recipe/1", id: "flat", produces: ["release"], rung: "create", axes: [] }));
    cpSync(join(ROOT, "packages", "publisher", "standards", "release"), join(tmp, "packages", "publisher", "standards", "release"), { recursive: true });
    const slot = join(tmp, "clossys", "agents", "publisher", "release.site");
    mkdirSync(slot, { recursive: true });
    writeFileSync(join(slot, "slot.json"), JSON.stringify({ schema: "clossys.slot/1", id: "release.site", agent: "publisher", standard: "release", contract: {}, inputs: [] }));
    const { checkDiverge: diverge } = await import(pathToFileURL(join(recipes, "stage-check.mjs")).href);
    return { tmp, diverge };
  };
  const directions = [1, 2, 3].map(n => ({ id: `d${n}`, idea: `idea ${n}`, axes: {}, traits: [] }));

  it("refuses diverge under a plumb recipe with an explicit plumb: no diverge issue, never a green", async () => {
    const { tmp, diverge } = await world();
    const found = diverge(tmp, "release.site", { recipe: "release", directions });
    assert.ok(found.length > 0, "a plumb diverge is not clean");
    assert.ok(found.some(item => item.rule === "R15.7" && /recipe release is plumb: plumb: no diverge/.test(item.what)), JSON.stringify(found));
  });

  it("does not pass axes: [] vacuously", async () => {
    const { tmp, diverge } = await world();
    const found = diverge(tmp, "release.site", { recipe: "flat", directions });
    assert.ok(found.some(item => item.rule === "R15.7" && /recipe flat lists no axes/.test(item.what)), JSON.stringify(found));
  });
});
