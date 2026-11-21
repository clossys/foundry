#!/usr/bin/env node
/**
 * stage-check: the maker's own check of a craft stage's output, run before the stage is recorded
 * (slot-constitution.md section 5b; foundry-feedback-0018: problems surface at the stage, not at the
 * final Done-when). Every recipe under packages/designer/recipes/ calls it.
 *
 *   node packages/designer/recipes/stage-check.mjs brief   <slot> <brief.json>      [--root <dir>]
 *   node packages/designer/recipes/stage-check.mjs diverge <slot> <directions.json> [--root <dir>]
 *
 * brief:   the brief names the slot's standard and a recipe that produces for it, lists every
 *          requirement id of that standard, and lists every pinned upstream input (the slot's
 *          `inputs` plus the Director traits the standard derives from) at its pinned sha256, before
 *          any direction exists.
 * diverge: 3 to 4 directions, each one line, each with a value on every recipe axis, values pairwise
 *          distinct per axis (so cosmetic variants fail here, not at R15.7), each citing the pinned
 *          Director traits the standard requires; a kept reference default carries a Director reason;
 *          refused under a plumb recipe ("plumb: no diverge") and when the recipe lists no axes.
 *
 * Mechanical only: it reads files, never the clock, the network or randomness, and runs no model.
 * Exit 0 clean, 1 with one line per issue (rule id, the issue, the fix), 2 on a usage error.
 * Nothing under the judge (src/constitution, certifiers, guards) imports this file (R16.1).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Two roots: `root` (every function's first argument, the CLI's --root, else the working directory)
 * is the consumer, the folder holding clossys/; the standards and recipes are this package's own.
 */
const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SLOT_ID = /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const AGENTS = ["director", "designer", "writer", "publisher", "producer"];
/** The most taste-log entries a brief reads as preferences (section 5b stage 1). */
export const TASTE_LOG_WINDOW = 20;
/** The direction count bounds of the diverge stage (section 5b stage 2: 3, cap 4). */
export const DIRECTIONS = Object.freeze({ min: 3, max: 4 });
const IDEA_MAX = 160;
const BRIEF_MAX = 1200;

const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const readJson = path => JSON.parse(readFileSync(path, "utf8"));
const norm = value => typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : JSON.stringify(value);

/** One issue line: the rule it protects, what is wrong and how to fix it. */
const issue = (rule, what, fix) => ({ rule, what, fix });
export const formatIssue = item => `${item.rule} ${item.what} -- fix: ${item.fix}`;

/** The pin of a slot id in any agent, or undefined. */
export function pinOf(root, slot) {
  for (const agent of AGENTS) {
    const path = join(root, "clossys", "agents", agent, slot, "pin.json");
    if (existsSync(path)) {
      const pin = readJson(path);
      return { agent, candidate: pin.candidate, sha256: pin.sha256 };
    }
  }
  return undefined;
}

/** What a stage check reads: the slot, its standard, the standard's requirements and Director traits. */
export function stageWorld(root, slot) {
  const slotPath = join(root, "clossys", "agents", "designer", slot, "slot.json");
  if (!existsSync(slotPath)) throw new Error(`designer slot ${slot} has no slot.json under clossys/agents/designer/`);
  const slotDoc = readJson(slotPath);
  const standardId = typeof slotDoc.standard === "string" ? slotDoc.standard : undefined;
  if (!standardId) throw new Error(`designer/${slot} names no standard (R15.1): run the 3S unit first`);
  const reqPath = join(PACKAGE, "standards", standardId, "requirements.json");
  if (!existsSync(reqPath)) throw new Error(`standard ${standardId} has no requirements.json under packages/designer/standards/`);
  const standard = readJson(reqPath);
  const requirements = (standard.requirements ?? []).map(item => item.check);
  const derive = (standard.requirements ?? []).find(item => item.check === "derive.director");
  const traits = derive ? [...(derive.params?.traits ?? [])] : [];
  const required = derive ? [...(derive.params?.required ?? [])] : [];
  const inputs = Array.isArray(slotDoc.inputs) ? slotDoc.inputs.filter(id => typeof id === "string") : [];
  return { slot, slotDoc, standardId, standard, requirements, traits, required, inputs };
}

/** The recipe a stage file names, checked to produce for the slot's standard. */
function recipeIssues(root, recipeId, world, out) {
  if (typeof recipeId !== "string" || !recipeId) {
    out.push(issue("R15.5", "the stage file names no recipe", "set \"recipe\" to the recipe id (packages/designer/recipes/<id>/)"));
    return undefined;
  }
  const path = join(PACKAGE, "recipes", recipeId, "recipe.json");
  if (!existsSync(path)) { out.push(issue("R15.5", `recipe ${recipeId} does not exist`, "name a recipe folder under packages/designer/recipes/")); return undefined; }
  const recipe = readJson(path);
  if (!Array.isArray(recipe.produces) || !recipe.produces.includes(world.standardId)) {
    out.push(issue("R15.5", `recipe ${recipeId} does not produce for ${world.standardId}`, `use a recipe whose produces[] lists ${world.standardId}`));
    return recipe;
  }
  // Code chooses a run's recipe: the one recipe producing for the standard (the producer's records/recipes.ts standardRecipe).
  const producing = readdirSync(join(PACKAGE, "recipes"), { withFileTypes: true }).filter(entry => entry.isDirectory() && existsSync(join(PACKAGE, "recipes", entry.name, "recipe.json")))
    .filter(entry => { const doc = readJson(join(PACKAGE, "recipes", entry.name, "recipe.json")); return Array.isArray(doc.produces) && doc.produces.includes(world.standardId); }).map(entry => entry.name).sort();
  if (producing.length !== 1) {
    out.push(issue("R15.5", `recipes ${producing.join(", ")} all produce for ${world.standardId}; a standard has exactly one producing recipe`, "give the standard one producing recipe"));
  }
  return recipe;
}

/** The taste-log entry count a brief must have read (the newest 20, or all when fewer). */
export function tasteWindow(root, standardId) {
  const path = join(root, "clossys", "agents", "designer", "taste", standardId, "taste-log.json");
  if (!existsSync(path)) return 0;
  const log = readJson(path);
  return Math.min(TASTE_LOG_WINDOW, Array.isArray(log.entries) ? log.entries.length : 0);
}

/** Stage 1 (brief): requirement ids and pinned inputs listed before any direction. */
export function checkBrief(root, slot, brief) {
  const out = [];
  let world;
  try { world = stageWorld(root, slot); } catch (error) { return [issue("R15.1", error.message, "fix the slot before crafting")]; }
  if (!isRecord(brief)) return [issue("R15.7", "the brief is not a JSON object", "write {recipe, standard, requirements, inputs, tasteLog, brief}")];
  recipeIssues(root, brief.recipe, world, out);
  if (brief.standard !== world.standardId) out.push(issue("R15.1", `the brief names standard ${String(brief.standard)}, the slot names ${world.standardId}`, `set "standard" to ${world.standardId}`));
  const listed = Array.isArray(brief.requirements) ? brief.requirements : [];
  const missing = world.requirements.filter(id => !listed.includes(id));
  const extra = listed.filter(id => !world.requirements.includes(id));
  if (missing.length) out.push(issue("R15.3", `the brief does not list requirement ${missing.join(", ")}`, `list every requirement id of ${world.standardId}: ${world.requirements.join(", ")}`));
  if (extra.length) out.push(issue("R15.3", `the brief lists ${extra.join(", ")}, not a requirement of ${world.standardId}`, "list the standard's requirement ids only"));
  const inputs = Array.isArray(brief.inputs) ? brief.inputs.filter(isRecord) : [];
  const seen = new Map(inputs.map(item => [item.slot, item]));
  const needed = [...new Set([...world.inputs, ...world.required, ...world.traits.filter(id => pinOf(root, id))])];
  for (const id of needed) {
    const pin = pinOf(root, id);
    const given = seen.get(id);
    if (!pin) { out.push(issue("R07", `input ${id} is not pinned`, `pin ${id} upstream first (Director before Designer); craft stops here`)); continue; }
    if (!given) { out.push(issue("R15.7", `the brief does not list pinned input ${id}`, `add {"slot": "${id}", "candidate": "${pin.candidate}", "sha256": "${pin.sha256}"}`)); continue; }
    if (given.candidate !== pin.candidate || given.sha256 !== pin.sha256) out.push(issue("R12", `input ${id} is listed at ${String(given.candidate)}@${String(given.sha256).slice(0, 12)}, pinned at ${pin.candidate}@${pin.sha256.slice(0, 12)}`, "brief from the current pin"));
  }
  for (const item of inputs) {
    if (typeof item.slot !== "string" || !SLOT_ID.test(item.slot)) out.push(issue("R06.7", `input ${JSON.stringify(item.slot)} is not a slot id`, "cite upstream by slot id only, never a file path"));
    else if (typeof item.sha256 !== "string" || !SHA256.test(item.sha256)) out.push(issue("R12", `input ${item.slot} has no pinned sha256`, "copy sha256 from its pin.json"));
  }
  if (world.traits.length && !world.traits.some(id => seen.has(id) && pinOf(root, id))) out.push(issue("R20", `the brief lists none of the Director traits ${world.traits.join(", ")}`, "brief from at least one pinned trait the standard derives from"));
  const window = tasteWindow(root, world.standardId);
  if (brief.tasteLog !== window) out.push(issue("R15.8", `the brief read ${String(brief.tasteLog)} taste-log entries; the window is ${window}`, `read the newest ${window} entries of clossys/agents/designer/taste/${world.standardId}/taste-log.json as preferences and set "tasteLog": ${window}`));
  const text = typeof brief.brief === "string" ? brief.brief.trim() : "";
  if (!text) out.push(issue("R15.7", "the brief paragraph is empty", "write one paragraph from the pinned upstream, the contract and the standard"));
  else if (/\n\s*\n/.test(text)) out.push(issue("R15.7", "the brief is more than one paragraph", "write one paragraph"));
  else if (text.length > BRIEF_MAX) out.push(issue("R15.7", `the brief is ${text.length} characters`, `keep it under ${BRIEF_MAX}`));
  return out;
}

/** Stage 2 (diverge): 3-4 one-line directions, pairwise distinct on every recipe axis, Director-cited. */
export function checkDiverge(root, slot, file) {
  const out = [];
  let world;
  try { world = stageWorld(root, slot); } catch (error) { return [issue("R15.1", error.message, "fix the slot before crafting")]; }
  const doc = Array.isArray(file) ? { directions: file } : isRecord(file) ? file : {};
  const recipe = recipeIssues(root, doc.recipe, world, out);
  // A plumb recipe has no diverge stage (R15.7): its plumb action computes the candidate. Refused, never judged by axes.
  if (recipe?.rung === "plumb") return [...out, issue("R15.7", `recipe ${String(doc.recipe)} is plumb: plumb: no diverge`, `compute the candidate with the recipe's plumb action (${String(recipe.action)}) and record no craft stage`)];
  const axes = Array.isArray(recipe?.axes) ? recipe.axes : [];
  // No recipe axes means nothing for the directions to differ on: never a vacuous pass.
  if (recipe && !axes.length) out.push(issue("R15.7", `recipe ${String(doc.recipe)} lists no axes`, "list the recipe's diverge axes in recipe.json (a crafted recipe has at least one)"));
  const directions = Array.isArray(doc.directions) ? doc.directions : [];
  if (directions.length < DIRECTIONS.min || directions.length > DIRECTIONS.max) out.push(issue("R15.7", `${directions.length} directions`, `write ${DIRECTIONS.min} directions (cap ${DIRECTIONS.max})`));
  const ids = new Set();
  directions.forEach((direction, index) => {
    const at = `direction ${index + 1}`;
    if (!isRecord(direction)) { out.push(issue("R15.7", `${at} is not an object`, "write {id, idea, axes, traits}")); return; }
    if (typeof direction.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(direction.id)) out.push(issue("R15.7", `${at} has no slug id`, "give it a lower-case slug id"));
    else if (ids.has(direction.id)) out.push(issue("R15.7", `${at} repeats id ${direction.id}`, "give every direction its own id")); else ids.add(direction.id);
    const idea = typeof direction.idea === "string" ? direction.idea.trim() : "";
    if (!idea || /\n/.test(idea) || idea.length > IDEA_MAX) out.push(issue("R15.7", `${at} idea is not one line under ${IDEA_MAX} characters`, "state the idea in one line"));
    const values = isRecord(direction.axes) ? direction.axes : {};
    for (const key of Object.keys(values)) if (!axes.includes(key)) out.push(issue("R15.7", `${at} sets axis ${key}, not an axis of recipe ${String(doc.recipe)}`, `use the recipe axes only: ${axes.join(", ")}`));
    const traits = Array.isArray(direction.traits) ? direction.traits : [];
    for (const id of traits) if (typeof id !== "string" || !SLOT_ID.test(id)) out.push(issue("R06.7", `${at} cites trait ${JSON.stringify(id)}`, "cite a Director slot id"));
    else if (!pinOf(root, id)) out.push(issue("R07", `${at} cites unpinned trait ${id}`, `pin ${id} first`));
    if (world.traits.length && !world.traits.some(id => traits.includes(id))) out.push(issue("R20", `${at} realises none of ${world.traits.join(", ")}`, "name the pinned Director trait this direction realises; a reference value is a base, not a reason"));
    for (const id of world.required.filter(each => !traits.includes(each))) out.push(issue("R20", `${at} does not cite required trait ${id}`, `derive the direction from ${id}`));
    const keeps = Array.isArray(direction.keeps) ? direction.keeps : [];
    for (const keep of keeps) {
      const because = isRecord(keep) && typeof keep.because === "string" ? keep.because : "";
      const cites = [...because.matchAll(/director:([a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3})/g)].map(match => match[1]);
      const pool = world.traits.length ? world.traits : world.required;
      if (!cites.length || (pool.length && !cites.some(id => pool.includes(id)))) out.push(issue("R20", `${at} keeps default ${isRecord(keep) ? String(keep.ref) : "?"} without a Director reason`, "keeping a default needs because: \"director:<trait> ...\" naming the trait it serves"));
    }
  });
  for (const axis of axes) {
    const values = directions.map(direction => isRecord(direction) && isRecord(direction.axes) ? direction.axes[axis] : undefined);
    if (values.some(value => value === undefined || value === null || value === "")) { out.push(issue("R15.7", `a direction has no value on axis ${axis}`, `give every direction a value on ${axis}`)); continue; }
    const keys = values.map(norm);
    if (new Set(keys).size !== keys.length) out.push(issue("R15.7", `directions repeat a value on axis ${axis}: cosmetic variants`, `make every direction's ${axis} different, or drop the copy`));
  }
  const ideas = directions.filter(isRecord).map(direction => norm(direction.idea ?? ""));
  if (new Set(ideas).size !== ideas.length) out.push(issue("R15.7", "two directions share one idea", "one idea per direction"));
  return out;
}

const USAGE = "Usage: node packages/designer/recipes/stage-check.mjs brief|diverge <slot> <file.json> [--root <dir>]\n";

export function main(argv, cwd = process.cwd()) {
  const args = [...argv];
  let root = cwd;
  const at = args.indexOf("--root");
  if (at >= 0) { root = resolve(cwd, args[at + 1] ?? ""); args.splice(at, 2); }
  const [stage, slot, path] = args;
  if (!["brief", "diverge"].includes(stage) || !slot || !path) return { code: 2, text: USAGE };
  let file;
  try { file = readJson(resolve(cwd, path)); } catch (error) { return { code: 2, text: `stage-check: cannot read ${path} as JSON: ${error.message}\n` }; }
  const found = stage === "brief" ? checkBrief(root, slot, file) : checkDiverge(root, slot, file);
  if (!found.length) return { code: 0, text: `stage-check ${stage} designer/${slot}: clean\n` };
  return { code: 1, text: found.map(formatIssue).join("\n") + "\n" };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = main(process.argv.slice(2));
  (result.code === 0 ? process.stdout : process.stderr).write(result.text);
  process.exitCode = result.code;
}
