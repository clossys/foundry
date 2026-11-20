/**
 * stage-core: the agent-neutral half of a recipe's stage check (slot-constitution.md section 5b;
 * foundry-feedback-0015, -0018). One byte-identical copy lives in each of packages/director, writer,
 * publisher and producer recipes/ (each agent's recipes import only their own folder); every
 * recipes.test.mjs asserts the copies are identical. The Designer recipes (RC-DES) carry the same
 * brief and diverge rules inline in their own stage-check.mjs.
 *
 * brief:   names the slot's standard and a recipe of this agent that produces for it, lists every
 *          requirement id of that standard (plus any the slot contract adds), lists every pinned
 *          upstream input at its pinned sha256 (a finding at its file sha256), reads the taste-log
 *          window, and is one paragraph; before any direction exists.
 * diverge: 3 to 4 one-line directions, a value on every recipe axis, values pairwise distinct per
 *          axis (cosmetic variants fail here, not at R15.7), each citing pinned upstream by id;
 *          refused under a plumb recipe ("plumb: no diverge") and when the recipe lists no axes.
 * draft:   the agent's stage-check.mjs adds a draft check of the candidate it is about to render.
 *
 * Two roots: `root` (every function's first argument, the CLI's --root, else the working directory)
 * is the consumer, the folder holding clossys/ (slots, pins, findings, taste logs); the standards and
 * recipes are read from the installed agent packages next to this one (PACKAGES).
 *
 * Mechanical only: it reads files, never the clock, the network or randomness, and runs no model.
 * Nothing under the judge (src/constitution, certifiers, guards) imports this file (R16.1).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SLOT_ID = /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3}$/;
export const FINDING_REF = /^(?:finding|evidence):([a-z0-9][a-z0-9.-]*)$/;
const SHA256 = /^[0-9a-f]{64}$/;
const AGENTS = ["director", "designer", "writer", "publisher", "producer"];
/** The most taste-log entries a brief reads as preferences (section 5b stage 1). */
export const TASTE_LOG_WINDOW = 20;
/** The direction count bounds of the diverge stage (section 5b stage 2: 3, cap 4). */
export const DIRECTIONS = Object.freeze({ min: 3, max: 4 });
const IDEA_MAX = 160;
const BRIEF_MAX = 1200;

/** The folder holding the agent packages: Foundry's packages/, or a consumer's node_modules/@clossys/. */
export const PACKAGES = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
/** An agent package's own folder (its standards/ and recipes/). */
export const packageDir = agent => join(PACKAGES, agent);

export const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
export const readJson = path => JSON.parse(readFileSync(path, "utf8"));
export const strings = value => Array.isArray(value) ? value.filter(item => typeof item === "string") : [];
const norm = value => typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : JSON.stringify(value);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

/** One issue: the rule it protects, the standard requirement it pre-empts (draft only), what is wrong and how to fix it. */
export const issue = (rule, what, fix, check) => ({ rule, ...(check ? { check } : {}), what, fix });
export const formatIssue = item => `${item.rule}${item.check ? ` ${item.check}:` : ""} ${item.what} -- fix: ${item.fix}`;

/** The pin of a slot id in any agent, or undefined. */
export function pinOf(root, slot) {
  if (typeof slot !== "string" || !SLOT_ID.test(slot)) return undefined;
  for (const agent of AGENTS) {
    const path = join(root, "clossys", "agents", agent, slot, "pin.json");
    if (existsSync(path)) {
      const pin = readJson(path);
      return { agent, candidate: pin.candidate, sha256: pin.sha256 };
    }
  }
  return undefined;
}

/** The pinned candidate's text of a slot, or undefined. */
export function pinnedText(root, slot) {
  const pin = pinOf(root, slot);
  if (!pin || typeof pin.candidate !== "string") return undefined;
  const path = join(root, "clossys", "agents", pin.agent, slot, "candidates", pin.candidate);
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

/** A Director finding (`finding:<id>` or `evidence:<id>`) recorded under clossys/evidence/director/, with its file sha256. */
export function findingOf(root, ref) {
  const match = typeof ref === "string" ? FINDING_REF.exec(ref) : null;
  if (!match) return undefined;
  const path = join(root, "clossys", "evidence", "director", `${match[1]}.md`);
  return existsSync(path) ? { finding: ref, sha256: sha256(readFileSync(path)) } : undefined;
}

/** The requirement ids a candidate of the slot is judged by: the standard's, then any the slot contract adds. */
function requirementIds(standard, contract) {
  const ids = (standard.requirements ?? []).map(item => item.check);
  const raw = isRecord(contract) ? contract.requirements : undefined;
  const extra = Array.isArray(raw) ? raw.filter(isRecord).map(item => item.check).filter(id => typeof id === "string") : isRecord(raw) ? Object.keys(raw) : [];
  return [...new Set([...ids, ...extra])];
}

/** The standard's requirements with "$contract" bound to the slot contract (the maker's copy of the binding). */
export function boundRequirements(world) {
  const contract = isRecord(world.slotDoc.contract) ? world.slotDoc.contract : {};
  return (world.standard.requirements ?? []).map(item => ({
    check: item.check,
    params: Object.fromEntries(Object.entries(item.params ?? {}).map(([key, value]) => [key, value === "$contract" ? contract : value])),
  }));
}

/** What a stage check reads: the slot, its standard and the standard's requirement ids. */
export function slotWorld(root, agent, slot) {
  const slotPath = join(root, "clossys", "agents", agent, slot, "slot.json");
  if (!existsSync(slotPath)) throw new Error(`${agent} slot ${slot} has no slot.json under clossys/agents/${agent}/`);
  const slotDoc = readJson(slotPath);
  const standardId = typeof slotDoc.standard === "string" ? slotDoc.standard : undefined;
  if (!standardId) throw new Error(`${agent}/${slot} names no standard (R15.1): run the 3S unit first`);
  const reqPath = join(packageDir(agent), "standards", standardId, "requirements.json");
  if (!existsSync(reqPath)) throw new Error(`standard ${standardId} has no requirements.json under packages/${agent}/standards/`);
  const standard = readJson(reqPath);
  const inputs = strings(slotDoc.inputs);
  return { agent, slot, slotDoc, standardId, standard, requirements: requirementIds(standard, slotDoc.contract), inputs };
}

/** The recipe a stage file names, checked to produce for the slot's standard. */
export function recipeOf(root, world, recipeId, out) {
  const base = `packages/${world.agent}/recipes`;
  if (typeof recipeId !== "string" || !recipeId) {
    out.push(issue("R15.5", "the stage file names no recipe", `set "recipe" to the recipe id (${base}/<id>/)`));
    return undefined;
  }
  const path = join(packageDir(world.agent), "recipes", recipeId, "recipe.json");
  if (!existsSync(path)) { out.push(issue("R15.5", `recipe ${recipeId} does not exist`, `name a recipe folder under ${base}/`)); return undefined; }
  const recipe = readJson(path);
  if (!Array.isArray(recipe.produces) || !recipe.produces.includes(world.standardId)) {
    out.push(issue("R15.5", `recipe ${recipeId} does not produce for ${world.standardId}`, `use a recipe whose produces[] lists ${world.standardId}`));
  }
  return recipe;
}

/** The taste-log entry count a brief must have read (the newest 20, or all when fewer). */
export function tasteWindow(root, agent, standardId) {
  const path = join(root, "clossys", "agents", agent, "taste", standardId, "taste-log.json");
  if (!existsSync(path)) return 0;
  const log = readJson(path);
  return Math.min(TASTE_LOG_WINDOW, Array.isArray(log.entries) ? log.entries.length : 0);
}

/**
 * Stage 1 (brief). `hooks.needed(world)` names the slot ids the brief must list pinned (the slot's
 * inputs plus what the agent derives from); `hooks.brief(root, world, brief, out)` adds agent rules.
 */
export function checkBriefWith(root, agent, slot, brief, hooks = {}) {
  const out = [];
  let world;
  try { world = slotWorld(root, agent, slot); } catch (error) { return [issue("R15.1", error.message, "fix the slot before crafting")]; }
  if (!isRecord(brief)) return [issue("R15.7", "the brief is not a JSON object", "write {recipe, standard, requirements, inputs, tasteLog, brief}")];
  recipeOf(root, world, brief.recipe, out);
  if (brief.standard !== world.standardId) out.push(issue("R15.1", `the brief names standard ${String(brief.standard)}, the slot names ${world.standardId}`, `set "standard" to ${world.standardId}`));
  const listed = Array.isArray(brief.requirements) ? brief.requirements : [];
  const missing = world.requirements.filter(id => !listed.includes(id));
  const extra = listed.filter(id => !world.requirements.includes(id));
  if (missing.length) out.push(issue("R15.3", `the brief does not list requirement ${missing.join(", ")}`, `list every requirement id of ${world.standardId}: ${world.requirements.join(", ")}`));
  if (extra.length) out.push(issue("R15.3", `the brief lists ${extra.join(", ")}, not a requirement of ${world.standardId}`, "list the standard's requirement ids only"));
  const inputs = Array.isArray(brief.inputs) ? brief.inputs.filter(isRecord) : [];
  const seen = new Map(inputs.filter(item => typeof item.slot === "string").map(item => [item.slot, item]));
  const needed = [...new Set([...world.inputs, ...(hooks.needed ? hooks.needed(world) : [])])];
  for (const id of needed) {
    const pin = pinOf(root, id);
    const given = seen.get(id);
    if (!pin) { out.push(issue("R07", `input ${id} is not pinned`, `pin ${id} upstream first; craft stops here`)); continue; }
    if (!given) { out.push(issue("R15.7", `the brief does not list pinned input ${id}`, `add {"slot": "${id}", "candidate": "${pin.candidate}", "sha256": "${pin.sha256}"}`)); continue; }
    if (given.candidate !== pin.candidate || given.sha256 !== pin.sha256) out.push(issue("R12", `input ${id} is listed at ${String(given.candidate)}@${String(given.sha256).slice(0, 12)}, pinned at ${pin.candidate}@${pin.sha256.slice(0, 12)}`, "brief from the current pin"));
  }
  for (const item of inputs) {
    if (typeof item.finding === "string") {
      const found = findingOf(root, item.finding);
      if (!found) out.push(issue("R06.7", `input ${JSON.stringify(item.finding)} is not a recorded finding`, "record outside evidence with clossys evidence and cite finding:<id>"));
      else if (item.sha256 !== found.sha256) out.push(issue("R12", `finding ${item.finding} is listed at ${String(item.sha256).slice(0, 12)}, recorded at ${found.sha256.slice(0, 12)}`, "brief from the recorded finding"));
      continue;
    }
    if (typeof item.slot !== "string" || !SLOT_ID.test(item.slot)) { out.push(issue("R06.7", `input ${JSON.stringify(item.slot)} is not a slot id`, "cite upstream by slot id (or finding:<id>) only, never a file path")); continue; }
    if (typeof item.sha256 !== "string" || !SHA256.test(item.sha256)) { out.push(issue("R12", `input ${item.slot} has no pinned sha256`, "copy sha256 from its pin.json")); continue; }
    const pin = pinOf(root, item.slot);
    if (!pin) out.push(issue("R07", `input ${item.slot} is not pinned`, `pin ${item.slot} first`));
    else if (!needed.includes(item.slot) && (item.candidate !== pin.candidate || item.sha256 !== pin.sha256)) out.push(issue("R12", `input ${item.slot} is not listed at its pin`, "brief from the current pin"));
  }
  if (hooks.brief) hooks.brief(root, world, brief, out, inputs);
  const window = tasteWindow(root, agent, world.standardId);
  if (brief.tasteLog !== window) out.push(issue("R15.8", `the brief read ${String(brief.tasteLog)} taste-log entries; the window is ${window}`, `read the newest ${window} entries of clossys/agents/${agent}/taste/${world.standardId}/taste-log.json as preferences and set "tasteLog": ${window}`));
  const text = typeof brief.brief === "string" ? brief.brief.trim() : "";
  if (!text) out.push(issue("R15.7", "the brief paragraph is empty", "write one paragraph from the pinned upstream, the contract and the standard"));
  else if (/\n\s*\n/.test(text)) out.push(issue("R15.7", "the brief is more than one paragraph", "write one paragraph"));
  else if (text.length > BRIEF_MAX) out.push(issue("R15.7", `the brief is ${text.length} characters`, `keep it under ${BRIEF_MAX}`));
  return out;
}

/**
 * Stage 2 (diverge). Every direction's `traits` cite pinned slots (or recorded findings) by id;
 * `hooks.direction(root, world, direction, at, out)` adds the agent's derivation rule.
 */
export function checkDivergeWith(root, agent, slot, file, hooks = {}) {
  const out = [];
  let world;
  try { world = slotWorld(root, agent, slot); } catch (error) { return [issue("R15.1", error.message, "fix the slot before crafting")]; }
  const doc = Array.isArray(file) ? { directions: file } : isRecord(file) ? file : {};
  const recipe = recipeOf(root, world, doc.recipe, out);
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
    for (const id of traits) {
      if (typeof id === "string" && FINDING_REF.test(id)) { if (!findingOf(root, id)) out.push(issue("R06.7", `${at} cites ${id}, which is not a recorded finding`, "record it with clossys evidence first")); continue; }
      if (typeof id !== "string" || !SLOT_ID.test(id)) out.push(issue("R06.7", `${at} cites ${JSON.stringify(id)}`, "cite a slot id or finding:<id>, never a file path"));
      else if (!pinOf(root, id)) out.push(issue("R07", `${at} cites unpinned ${id}`, `pin ${id} first`));
    }
    if (hooks.direction) hooks.direction(root, world, direction, at, out, traits);
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

/** Frontmatter fields (surrounding quotes stripped) and the body of a Markdown candidate. */
export function frontmatter(text) {
  const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!front) return { fields: undefined, body: text };
  const fields = {};
  for (const line of front[1].split(/\r?\n/)) {
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (match) fields[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return { fields, body: text.slice(front[0].length) };
}

/** A frontmatter field that holds JSON, parsed; or the reason it cannot be read. */
export function jsonField(fields, name) {
  const raw = fields?.[name];
  if (raw === undefined) return { error: `the frontmatter has no ${name}` };
  if (typeof raw !== "string") return { value: raw };
  try { return { value: JSON.parse(raw) }; } catch { return { error: `the frontmatter ${name} is not JSON` }; }
}

/** Words: letter or digit runs, apostrophes and hyphens inside. */
export const words = text => text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];
/** Sentences: runs ended by . ! ? (or the end), ignoring blank ones. */
export function sentences(text) {
  const plain = text.replace(/^#+\s*/gm, "").replace(/\s+/g, " ").trim();
  if (!plain) return [];
  return (plain.match(/[^.!?]+(?:[.!?]+|$)/g) ?? []).map(item => item.trim()).filter(item => words(item).length > 0);
}
export const excerpt = (text, max = 60) => {
  const flat = String(text).replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/**
 * Stage 3 preflight (draft): runs each `checks[<requirement id>]` the slot's standard names over the
 * draft, with "$contract" bound; a requirement this file has no check for is listed as left to
 * `clossys check --constitution --slot` (the judge's own preflight). `extra(world, draft)` adds maker-only rules.
 */
export function checkDraftWith(root, agent, slot, draft, checks, extra) {
  let world;
  try { world = slotWorld(root, agent, slot); } catch (error) { return { issues: [issue("R15.1", error.message, "fix the slot before crafting")], judgeOnly: [] }; }
  const out = [];
  const judgeOnly = [];
  for (const requirement of boundRequirements(world)) {
    const check = checks[requirement.check];
    if (!check) { judgeOnly.push(requirement.check); continue; }
    for (const found of check(draft, requirement.params, world, root)) out.push(issue("R15.3", found.what ?? found, found.fix ?? `meet ${requirement.check} of ${world.standardId} (packages/${agent}/standards/${world.standardId}/requirements.json)`, requirement.check));
  }
  if (extra) out.push(...extra(root, world, draft));
  return { issues: out, judgeOnly };
}

/** Reads a draft file: its name, text and (for .json) parsed value. */
export function readDraft(path) {
  const text = readFileSync(path, "utf8");
  let json;
  if (path.endsWith(".json")) { try { json = JSON.parse(text); } catch { json = undefined; } }
  return { name: path, text, json };
}

/** The CLI: brief | diverge | draft, exit 0 clean, 1 with one line per issue, 2 on a usage error. */
export function runStageCli(agent, api, argv, cwd) {
  const usage = `Usage: node packages/${agent}/recipes/stage-check.mjs brief|diverge|draft <slot> <file> [--root <dir>]\n`;
  const args = [...argv];
  let root = cwd;
  const at = args.indexOf("--root");
  if (at >= 0) { root = resolve(cwd, args[at + 1] ?? ""); args.splice(at, 2); }
  const [stage, slot, path] = args;
  if (!["brief", "diverge", "draft"].includes(stage) || !slot || !path) return { code: 2, text: usage };
  if (stage === "draft") {
    let draft;
    try { draft = readDraft(resolve(cwd, path)); } catch (error) { return { code: 2, text: `stage-check: cannot read ${path}: ${error.message}\n` }; }
    const { issues, judgeOnly } = api.draft(root, slot, draft);
    const tail = judgeOnly.length ? ` (left to clossys check --constitution --slot: ${judgeOnly.join(", ")})` : "";
    if (!issues.length) return { code: 0, text: `stage-check draft ${agent}/${slot}: clean${tail}\n` };
    return { code: 1, text: issues.map(formatIssue).join("\n") + "\n" };
  }
  let file;
  try { file = readJson(resolve(cwd, path)); } catch (error) { return { code: 2, text: `stage-check: cannot read ${path} as JSON: ${error.message}\n` }; }
  const found = stage === "brief" ? api.brief(root, slot, file) : api.diverge(root, slot, file);
  if (!found.length) return { code: 0, text: `stage-check ${stage} ${agent}/${slot}: clean\n` };
  return { code: 1, text: found.map(formatIssue).join("\n") + "\n" };
}
