// The action registry (docs/step-standard.md): every pipeline step is a contract file at
// packages/<package>/actions/<id>/action.json, grouped only by packages/<package>/actions/ia.json,
// with standalone package bins and skill files that are not steps listed in
// packages/<package>/actions/exceptions.json. This module reads the registry and builds the two
// generated files from it: pipeline/actions.json (the contracts in pipeline order, which the runtime
// loads) and pipeline/manifest.json (per agent: steps, verbs, commands, skills, code, exceptions).
// scripts/generate-pipeline-actions.mjs writes them; scripts/check-step-standard.mjs compares them.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO = resolve(PKG, "../..");
export const PKG_REL = relative(REPO, PKG).split(sep).join("/");
/** Packages that own actions, in the pipeline's cascade order (ties inside a stage sort by it). */
export const PACKAGES = Object.freeze(["director", "designer", "writer", "publisher", "producer"]);
export const ACTIONS_DIR = "actions";
export const ACTION_FILE = "action.json";
export const SKILL_FILE = "skill.md";
export const IA_FILE = "ia.json";
export const EXCEPTIONS_FILE = "exceptions.json";
/** Files an action folder may hold: its contract and, for a decide action, its judgment skill. */
export const ACTION_FOLDER_FILES = Object.freeze([ACTION_FILE, SKILL_FILE]);
/** The registry-level files beside the action folders. */
export const REGISTRY_FILES = Object.freeze([IA_FILE, EXCEPTIONS_FILE]);

const SKIP = new Set(["node_modules", "dist", ".next", ".turbo", "coverage", ".cache", ACTIONS_DIR]);
const readJson = file => JSON.parse(readFileSync(file, "utf8"));
const repoPath = (...parts) => posix.normalize(parts.join("/"));

/**
 * Read every package's registry under `packagesDir` (default: this repository's packages/).
 * Unreadable files become problems ({rule, message}) instead of throwing.
 */
export function readRegistry(packagesDir = join(REPO, "packages")) {
  const actions = [];
  const ia = {};
  const exceptions = {};
  const problems = [];
  const stray = [];
  for (const pkg of PACKAGES) {
    const dir = join(packagesDir, pkg, ACTIONS_DIR);
    if (!existsSync(dir)) { problems.push({ rule: "ia.invalid", message: `packages/${pkg}/${ACTIONS_DIR}/ does not exist` }); continue; }
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const rel = `packages/${pkg}/${ACTIONS_DIR}/${name}`;
      if (!statSync(path).isDirectory()) {
        if (!REGISTRY_FILES.includes(name)) stray.push(rel);
        continue;
      }
      const files = readdirSync(path).sort();
      const contractFile = join(path, ACTION_FILE);
      let contract = null;
      if (!existsSync(contractFile)) problems.push({ rule: "action.folder", message: `${rel}/ has no ${ACTION_FILE}` });
      else try { contract = readJson(contractFile); } catch (error) { problems.push({ rule: "action.invalid", message: `${rel}/${ACTION_FILE} is not JSON: ${error.message}` }); }
      const nested = files.filter(file => statSync(join(path, file)).isDirectory());
      actions.push({ package: pkg, folder: name, path: `${rel}/${ACTION_FILE}`, contract, files, nested });
    }
    for (const [file, into, rule] of [[IA_FILE, ia, "ia.invalid"], [EXCEPTIONS_FILE, exceptions, "exception.invalid"]]) {
      const path = join(dir, file);
      if (!existsSync(path)) { problems.push({ rule, message: `packages/${pkg}/${ACTIONS_DIR}/${file} does not exist` }); continue; }
      try { into[pkg] = readJson(path); } catch (error) { problems.push({ rule, message: `packages/${pkg}/${ACTIONS_DIR}/${file} is not JSON: ${error.message}` }); }
    }
  }
  return { actions, ia, exceptions, problems, stray };
}

/** The ia.json order of every action id: [L1 agent, L2 stage, L3 action] rows. */
export function iaRows(tree) {
  const rows = [];
  for (const agent of Array.isArray(tree?.nodes) ? tree.nodes : []) for (const stage of Array.isArray(agent?.children) ? agent.children : []) for (const action of Array.isArray(stage?.actions) ? stage.actions : []) rows.push({ agent: agent.id, stage: stage.id, action });
  return rows;
}

/** Pipeline order: (stage, package cascade order, ia.json order). */
export function orderActions(actions, ia, stages) {
  const iaIndex = new Map();
  for (const pkg of PACKAGES) iaRows(ia[pkg]).forEach((row, index) => iaIndex.set(`${pkg}/${row.action}`, index));
  const key = action => [stages.indexOf(action.contract.stage), PACKAGES.indexOf(action.package), iaIndex.get(`${action.package}/${action.contract.id}`) ?? Number.MAX_SAFE_INTEGER];
  return [...actions].sort((a, b) => {
    const [x, y] = [key(a), key(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || a.contract.id.localeCompare(b.contract.id);
  });
}

export const snapshotOf = (ordered, schema) => ({ schema, actions: ordered.map(action => ({ package: action.package, path: action.path, contract: action.contract })) });

/** A package's declared bins (package.json `bin`). */
export function packageBins(packagesDir, pkg) {
  const file = join(packagesDir, pkg, "package.json");
  if (!existsSync(file)) return [];
  const manifest = readJson(file);
  if (typeof manifest.bin === "string") return [String(manifest.name ?? pkg).replace(/^@[^/]+\//, "")];
  return Object.keys(manifest.bin ?? {}).sort();
}

/** A package's npm scripts. */
export function packageScripts(packagesDir, pkg) {
  const file = join(packagesDir, pkg, "package.json");
  return existsSync(file) ? readJson(file).scripts ?? {} : {};
}

/** A package's skill files: every .md under a `skill/` directory, package-relative (action folders excluded). */
export function packageSkills(packagesDir, pkg) {
  const root = join(packagesDir, pkg);
  const out = [];
  const walk = (dir, inSkill) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      if (SKIP.has(name) && (dir === root || name === "node_modules")) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path, inSkill || name === "skill");
      else if (inSkill && name.endsWith(".md")) out.push(relative(root, path).split(sep).join("/"));
    }
  };
  walk(root, false);
  return out;
}

/** What one contract's run and uses cover: the clossys bin, `bin:<name>` uses and skill-file uses. */
export function coverageOf(action) {
  const bins = new Set();
  const skills = new Set();
  if (typeof action.contract?.run === "string" && action.contract.run.startsWith("clossys ")) bins.add("clossys");
  for (const use of Array.isArray(action.contract?.uses) ? action.contract.uses : []) {
    if (use.startsWith("bin:")) bins.add(use.slice(4));
    else skills.add(`${action.package}:${use}`);
  }
  return { bins, skills };
}

/** Package-relative binding refs as repository paths (`src/cli/pin.ts#runPinCli` -> packages/producer/src/cli/pin.ts#runPinCli). */
const codeRef = ref => { const [file, name] = String(ref).split("#"); return `${repoPath(PKG_REL, file)}${name ? `#${name}` : ""}`; };
export function bindingRefs(binding) {
  if (!binding) return [];
  return [binding.entry, binding.parser, binding.script, ...[binding.module ?? []].flat()].filter(Boolean).map(codeRef);
}

/** The traced command inside `clossys pipeline trace <id> -- <command>`, else null. */
export function tracedCommand(run) {
  const words = String(run ?? "").trim().split(/\s+/);
  if (words[0] !== "clossys" || words[1] !== "pipeline" || words[2] !== "trace") return null;
  const split = words.indexOf("--");
  return split < 0 ? null : words.slice(split + 1).join(" ");
}

/**
 * Per agent (each contract's `agent`): the packages its actions live in, its step ids, the clossys verbs
 * its runs use, the standalone commands (traced commands and bins it uses), its skill files (decide
 * skills and skill files it uses), the code its bindings name, and its package's listed exceptions.
 */
export function manifestOf(ordered, exceptions, bindings, schema) {
  const agents = {};
  const of = agent => agents[agent] ??= { packages: new Set(), steps: [], verbs: new Set(), commands: new Set(), skills: new Set(), code: new Set(), exceptions: [] };
  for (const action of ordered) {
    const contract = action.contract;
    const entry = of(contract.agent);
    entry.packages.add(action.package);
    entry.steps.push(contract.id);
    const words = String(contract.run ?? "").trim().split(/\s+/);
    if (words[0] === "clossys" && words[1]) entry.verbs.add(words[1]);
    const traced = tracedCommand(contract.run);
    if (traced) entry.commands.add(traced);
    for (const use of contract.uses ?? []) {
      if (use.startsWith("bin:")) entry.commands.add(use.slice(4));
      else entry.skills.add(repoPath("packages", action.package, use));
    }
    if (contract.kind !== "plumb") entry.skills.add(repoPath("packages", action.package, ACTIONS_DIR, contract.id, SKILL_FILE));
    for (const ref of bindingRefs(bindings[contract.id])) entry.code.add(ref);
  }
  for (const pkg of PACKAGES) for (const row of Array.isArray(exceptions[pkg]?.exceptions) ? exceptions[pkg].exceptions : []) {
    of(pkg).exceptions.push({ package: pkg, item: row.item, unit: row.unit, reason: row.reason });
  }
  const sorted = set => [...set].sort();
  return {
    schema,
    agents: Object.fromEntries(Object.keys(agents).sort().map(agent => {
      const entry = agents[agent];
      return [agent, { packages: sorted(entry.packages), steps: entry.steps, verbs: sorted(entry.verbs), commands: sorted(entry.commands), skills: sorted(entry.skills), code: sorted(entry.code), exceptions: entry.exceptions }];
    })),
  };
}

export const stableJson = value => `${JSON.stringify(value, null, 2)}\n`;
