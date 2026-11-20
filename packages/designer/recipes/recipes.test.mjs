/**
 * The Designer recipes (unit RC-DES, RC-Des1 and RC-Des2): every Designer standard has a valid recipe
 * (R15.5), every craft.md runs the fixed 5b stages with a mechanical self-check per stage, the
 * create.tokens generator is deterministic and its output meets the standard's own criteria, the
 * stage checks fail on the faults they exist for, and no judge imports a recipe (R16.1).
 *
 *   node --test packages/designer/recipes/recipes.test.mjs
 *
 * It reads the producer's built modules (packages/producer/dist): build the producer first.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { checkBrief, checkDiverge, pinOf, stageWorld, tasteWindow } from "./stage-check.mjs";
import { generate, generateBytes } from "./create.tokens/generate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..");
const CONSUMER_ROOT = process.env.CLOSSYS_ROOT ? resolve(process.env.CLOSSYS_ROOT) : join(ROOT, "packages/producer/test-fixtures/consumer");
const CONSUMER = join(CONSUMER_ROOT, "clossys");
const dist = path => import(pathToFileURL(join(ROOT, "packages", "producer", "dist", path)).href);
const { generatorIssues, loadRecipes, produceIssues, recipesFor } = await dist("records/recipes.js");
const { loadStandards } = await dist("records/standards.js");
const { craftIssues } = await dist("constitution/rules/r15.js");
const { importSpecifiers, importsRecipe, judgeFiles } = await dist("constitution/rules/r16.js");
const { DESIGNER_STANDARD_CRITERIA } = await dist("constitution/criteria/designer/3s-des/index.js");

const recipes = loadRecipes(ROOT).filter(recipe => recipe.agent === "designer");
const standards = loadStandards(ROOT).filter(standard => standard.agent === "designer");
const readJson = path => JSON.parse(readFileSync(path, "utf8"));
const clone = value => structuredClone(value);
const rules = issues => issues.map(item => item.rule);

const RECIPE_IDS = ["create.component", "create.element", "create.glyph", "create.mark", "create.marketing-section", "create.tokens"];

describe("Designer recipes load clean and cover every standard (R15.5)", () => {
  it("loads exactly the six recipe folders, each with no issue", () => {
    assert.deepEqual(recipes.map(recipe => recipe.id), RECIPE_IDS);
    for (const recipe of recipes) {
      assert.deepEqual(recipe.issues, [], recipe.id);
      assert.deepEqual(produceIssues(recipe, standards), [], recipe.id);
      assert.equal(recipe.doc.rung, "create", recipe.id);
      assert.ok(recipe.doc.axes.length >= 3, `${recipe.id} has at least three axes`);
    }
  });

  it("gives every one of the eleven Designer standards at least one valid recipe", () => {
    assert.equal(standards.length, 11);
    const uncovered = standards.filter(standard => !recipesFor(recipes, standard).length).map(standard => standard.id);
    assert.deepEqual(uncovered, []);
  });

  it("holds no adopt recipe while every Designer standard has no seeds (R15.9 would flag it)", () => {
    for (const standard of standards) assert.deepEqual(standard.doc.seeds, [], standard.id);
    assert.equal(recipes.filter(recipe => recipe.doc.rung === "adopt").length, 0);
  });
});

describe("craft.md runs the fixed 5b stages with a check at each", () => {
  const STAGES = ["### 0. Preconditions", "### 1. brief (model)", "### 2. diverge (model)", "### 3. render (deterministic)", "### 4. critique (model, fresh critic)", "### 5. refine (at most 2 rounds)", "### 6. submit (deterministic)"];
  for (const id of RECIPE_IDS) {
    it(`${id}: stages in order, judgement only at brief, diverge and critique, preflight after render and before submit`, () => {
      const text = readFileSync(join(HERE, id, "craft.md"), "utf8");
      const at = STAGES.map(heading => text.indexOf(heading));
      assert.ok(at.every(index => index >= 0), `${id} has every stage heading`);
      assert.deepEqual([...at].sort((a, b) => a - b), at, `${id} stages are in order`);
      assert.equal((text.match(/^### \d\. .*\(model/gm) ?? []).length, 3, `${id} marks exactly three model nodes`);
      const section = n => text.slice(at[n], at[n + 1] ?? text.length);
      assert.match(section(1), /stage-check\.mjs brief <slot> brief\.json\n.*--stage brief /, `${id} checks the brief before recording it`);
      assert.match(section(2), /stage-check\.mjs diverge <slot> directions\.json\n.*--stage diverge /, `${id} checks the axes before recording diverge`);
      const render = section(3);
      assert.ok(render.indexOf("clossys render <slot> --draft <direction file>") >= 0 && render.indexOf("clossys check --constitution --slot designer/<slot>") > render.indexOf("clossys render <slot> --draft <direction file>"), `${id} preflights after each render`);
      assert.match(section(4), /clossys critique-packet designer\/<slot> --standard <standard>/);
      assert.match(section(4), /clossys critique designer\/<slot> --record critique\.json/);
      assert.match(section(5), /stage-check\.mjs diverge <slot> directions\.json/, `${id} re-checks a refine against the other directions`);
      const submit = section(6);
      assert.ok(submit.indexOf("clossys check --constitution --slot designer/<slot>") >= 0 && submit.indexOf("--submit") > submit.indexOf("clossys check --constitution --slot designer/<slot>"), `${id} preflights before submit`);
      for (const stage of ["brief", "diverge", "render", "critique", "refine"]) assert.match(text, new RegExp(`--stage ${stage} [^\\n]*--recipe ${id.replace(".", "\\.")} `), `${id} records craft:${stage} under its id`);
      assert.doesNotMatch(text, /\.\.\/|packages\/producer\/src/, `${id} names no judge source`);
    });
  }
});

describe("create.tokens generator: deterministic plumbing that meets the standard", () => {
  const slot = "themes.background";
  const spec = {
    slot,
    members: { default: { light: "oklch(0.985 0 0)", dark: "oklch(0.145 0 0)" } },
    reason: "Realises director:identity.visual.style (quiet and exact, restrained colour): keeps default:shadcn/neutral@4.23.0 because the neutral base is the restraint the style asks for; director:identity.brand.personality (calm).",
    source: { kind: "derived", ref: ["shadcn/neutral@4.23.0"], hash: `sha256:${"0".repeat(64)}`, license: "MIT" },
    provenance: { default: { sourceLabel: "shadcn", sourceVariable: "--background" } },
    createdAt: "2026-11-14T00:00:00.000Z",
  };
  const standard = readJson(join(ROOT, "packages", "designer", "standards", "token.color", "requirements.json"));

  it("has no nondeterministic source (R15.5 generator scan)", () => {
    assert.deepEqual(generatorIssues(readFileSync(join(HERE, "create.tokens", "generate.mjs"), "utf8")), []);
  });

  it("gives identical bytes for the same spec, whatever the spec's key order", () => {
    const first = generateBytes(spec, CONSUMER_ROOT);
    assert.equal(generateBytes(clone(spec), CONSUMER_ROOT), first);
    const reordered = Object.fromEntries(Object.entries(spec).reverse());
    reordered.members = { default: { dark: spec.members.default.dark, light: spec.members.default.light } };
    assert.equal(generateBytes(reordered, CONSUMER_ROOT), first);
  });

  it("meets every requirement of token.color on a real slot contract", () => {
    const json = JSON.parse(generateBytes(spec, CONSUMER_ROOT));
    const subject = { kind: "element/token", text: JSON.stringify(json), json };
    for (const requirement of standard.requirements) {
      const criterion = DESIGNER_STANDARD_CRITERIA[requirement.check];
      assert.ok(criterion, `criterion ${requirement.check} is registered`);
      assert.deepEqual(criterion(subject, requirement.params ?? {}), [], requirement.check);
    }
    assert.deepEqual(Object.keys(json.cssVars).sort(), ["dark", "light"]);
  });

  it("refuses a spec that does not fit the contract or gives no Director reason (mutation)", () => {
    const contract = readJson(join(CONSUMER, "agents", "designer", slot, "slot.json")).contract;
    const noDark = clone(spec); noDark.members.default = { light: "oklch(0.985 0 0)" };
    assert.throws(() => generate(noDark, contract), /no dark value/);
    const extra = clone(spec); extra.members.accent = "oklch(0.5 0.1 250)";
    assert.throws(() => generate(extra, contract), /closed set/);
    const baseOnly = clone(spec); baseOnly.reason = "shadcn default";
    assert.throws(() => generate(baseOnly, contract), /director:/);
  });

  it("a reason without a Director citation fails derive.director (the generator's refusal is not the only guard)", () => {
    const json = generate(spec, readJson(join(CONSUMER, "agents", "designer", slot, "slot.json")).contract);
    json.meta.element.reason = "keeps default:shadcn/neutral@4.23.0";
    const derive = standard.requirements.find(item => item.check === "derive.director");
    assert.notDeepEqual(DESIGNER_STANDARD_CRITERIA["derive.director"]({ kind: "element/token", text: "", json }, derive.params), []);
  });
});

describe("stage-check: each stage checks its own output", () => {
  const slot = "themes.background";
  const world = stageWorld(CONSUMER_ROOT, slot);
  const needed = [...new Set([...world.inputs, ...world.required, ...world.traits])];
  const brief = {
    recipe: "create.tokens",
    standard: "token.color",
    requirements: [...world.requirements],
    inputs: needed.map(id => ({ slot: id, candidate: pinOf(CONSUMER_ROOT, id).candidate, sha256: pinOf(CONSUMER_ROOT, id).sha256 })),
    tasteLog: tasteWindow(CONSUMER_ROOT, "token.color"),
    brief: "Background for a quiet, exact studio: restrained neutral surfaces from the pinned visual style and a calm personality.",
  };
  const directions = {
    recipe: "create.tokens",
    directions: [
      { id: "cool-keep", idea: "Cool neutral that keeps the shadcn neutral lightness", axes: { temperament: "cool", departure: "keep", emphasis: "primary-only" }, traits: ["identity.visual.style"], keeps: [{ ref: "shadcn/neutral", because: "director:identity.visual.style asks for stock shadcn with restrained colour" }] },
      { id: "neutral-shift", idea: "True neutral shifted a step toward paper", axes: { temperament: "neutral", departure: "shift", emphasis: "primary-and-ring" }, traits: ["identity.visual.style", "identity.brand.personality"] },
      { id: "warm-replace", idea: "Warm grey that replaces the base with a calmer surface", axes: { temperament: "warm", departure: "replace", emphasis: "charts" }, traits: ["identity.brand.personality", "identity.brand.essence"] },
    ],
  };

  it("passes a brief listing every requirement id and every pinned input, and three distinct directions", () => {
    assert.deepEqual(checkBrief(CONSUMER_ROOT, slot, brief), []);
    assert.deepEqual(checkDiverge(CONSUMER_ROOT, slot, directions), []);
  });

  it("fails a brief missing a requirement, a pinned input, or listing a stale sha (mutation)", () => {
    const noReq = clone(brief); noReq.requirements = noReq.requirements.slice(1);
    assert.ok(rules(checkBrief(CONSUMER_ROOT, slot, noReq)).includes("R15.3"));
    const noInput = clone(brief); noInput.inputs = noInput.inputs.filter(item => item.slot !== "identity.visual.style");
    assert.ok(rules(checkBrief(CONSUMER_ROOT, slot, noInput)).includes("R15.7"));
    const stale = clone(brief); stale.inputs[0].sha256 = "f".repeat(64);
    assert.ok(rules(checkBrief(CONSUMER_ROOT, slot, stale)).includes("R12"));
    const path = clone(brief); path.inputs.push({ slot: "clossys/agents/director/identity.visual.style/pin.json", candidate: "x", sha256: "0".repeat(64) });
    assert.ok(rules(checkBrief(CONSUMER_ROOT, slot, path)).includes("R06.7"));
    const wrongRecipe = clone(brief); wrongRecipe.recipe = "create.mark";
    assert.ok(rules(checkBrief(CONSUMER_ROOT, slot, wrongRecipe)).includes("R15.5"));
  });

  it("fails cosmetic variants, a direction with no Director trait and a default kept without a reason (mutation)", () => {
    const cosmetic = clone(directions); cosmetic.directions[2].axes.temperament = " Cool ";
    assert.ok(checkDiverge(CONSUMER_ROOT, slot, cosmetic).some(item => item.rule === "R15.7" && /axis temperament/.test(item.what)));
    const noTrait = clone(directions); noTrait.directions[1].traits = [];
    assert.ok(rules(checkDiverge(CONSUMER_ROOT, slot, noTrait)).includes("R20"));
    const bareKeep = clone(directions); bareKeep.directions[0].keeps = [{ ref: "shadcn/neutral", because: "it is the default" }];
    assert.ok(rules(checkDiverge(CONSUMER_ROOT, slot, bareKeep)).includes("R20"));
    const two = clone(directions); two.directions = two.directions.slice(0, 2);
    assert.ok(checkDiverge(CONSUMER_ROOT, slot, two).some(item => /2 directions/.test(item.what)));
    const offAxis = clone(directions); offAxis.directions[0].axes.mood = "x";
    assert.ok(checkDiverge(CONSUMER_ROOT, slot, offAxis).some(item => /axis mood/.test(item.what)));
  });

  it("requires identity.visual.imagery on every create.mark direction (assets derive from imagery)", () => {
    const mark = {
      recipe: "create.mark",
      directions: [
        { id: "grid", idea: "Square grid monogram", axes: { construction: "grid", reduction: "full", metaphor: "precision" }, traits: ["identity.visual.imagery", "identity.brand.personality"] },
        { id: "letter", idea: "Letterform cut from the name", axes: { construction: "letterform", reduction: "silhouette", metaphor: "judgement" }, traits: ["identity.visual.imagery", "identity.naming.name"] },
        { id: "space", idea: "Negative-space check", axes: { construction: "negative-space", reduction: "single-stroke", metaphor: "calm" }, traits: ["identity.brand.essence"] },
      ],
    };
    const found = checkDiverge(CONSUMER_ROOT, "assets.mark", mark);
    assert.deepEqual(found.map(item => item.what), ["direction 3 does not cite required trait identity.visual.imagery"]);
    mark.directions[2].traits.push("identity.visual.imagery");
    assert.deepEqual(checkDiverge(CONSUMER_ROOT, "assets.mark", mark), []);
  });

  it("the stages a craft.md records satisfy R15.7's order and axis rule; a third refine does not", () => {
    const run = ops => ops.map(op => ({ op: `craft:${op}`, recipe: "create.tokens", ...(op === "diverge" ? { directions: directions.directions } : {}) }));
    assert.deepEqual(craftIssues(run(["brief", "diverge", "render", "critique", "refine", "render", "critique", "refine", "render", "critique"]), recipes, "designer"), []);
    assert.notDeepEqual(craftIssues(run(["brief", "diverge", "render", "critique", "refine", "render", "critique", "refine", "render", "critique", "refine", "render", "critique"]), recipes, "designer"), []);
  });
});

describe("judge independence (R16.1)", () => {
  it("no judge file imports anything under packages/*/recipes", () => {
    const files = judgeFiles(ROOT);
    assert.ok(files.length > 0);
    const offenders = files.flatMap(file => importSpecifiers(readFileSync(join(ROOT, file), "utf8")).filter(specifier => importsRecipe(file, specifier)).map(specifier => `${file} -> ${specifier}`));
    assert.deepEqual(offenders, []);
  });

  it("the recipes import only node builtins and each other (no judge, no package)", () => {
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
    const recipes = join(tmp, "packages", "designer", "recipes");
    mkdirSync(recipes, { recursive: true });
    for (const name of ["stage-check.mjs"]) cpSync(join(HERE, name), join(recipes, name));
    cpSync(join(ROOT, "packages", "publisher", "recipes", "release"), join(recipes, "release"), { recursive: true });
    mkdirSync(join(recipes, "flat"));
    writeFileSync(join(recipes, "flat", "recipe.json"), JSON.stringify({ schema: "clossys.recipe/1", id: "flat", produces: ["release"], rung: "create", axes: [] }));
    cpSync(join(ROOT, "packages", "publisher", "standards", "release"), join(tmp, "packages", "designer", "standards", "release"), { recursive: true });
    const slot = join(tmp, "clossys", "agents", "designer", "release.site");
    mkdirSync(slot, { recursive: true });
    writeFileSync(join(slot, "slot.json"), JSON.stringify({ schema: "clossys.slot/1", id: "release.site", agent: "designer", standard: "release", contract: {}, inputs: [] }));
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
