#!/usr/bin/env node
// The step standard (docs/step-standard.md): every pipeline step is one action contract,
// packages/<package>/actions/<id>/action.json, bound to its code by id (src/pipeline/steps/bindings.ts),
// and every package bin and skill file is a step's or a listed exception. This check reads the
// registry, the bindings and the built steps (dist; run after the build) and writes nothing.
//
//   node scripts/check-step-standard.mjs [--json] [--packages <dir>] [--bindings <module>] [--steps <module>]
//                                        [--dist <dir>] [--steps-src <dir>] [--cli-src <dir>]
//
// The options exist for mutation proofs (scripts/check-step-standard.test.mjs): --packages reads the
// registries, package.json files, skill files and generated files from another packages directory;
// --bindings and --steps load BINDINGS and STEPS from another module; --dist, --steps-src and
// --cli-src read the built pipeline, src/pipeline/steps/ and src/cli/ from another directory. Other
// code facts (handlers, scripts, schemas, checks) are always this repository's.
//
// Failure rules (each finding names one):
//   action.invalid     an action.json is not JSON or fails pipeline/schemas/action.schema.json
//   action.folder      an action folder is not flat, is not named by its id, holds a file other than
//                      action.json and (decide only) skill.md, or a stray file sits in actions/
//   action.duplicate   two contracts share one id
//   action.agent       a contract's agent is not its package (producer holds producer and owner actions)
//   action.manual      a contract names `manual`: a decision names the clossys verb that records it, or is a gap
//   port.untyped       an input or output names no schema
//   port.schema-missing  a port names a schema with no file under pipeline/schemas/
//   run.invalid        a run is not one clossys command, or a plumb action is a gap
//   run.verb-unknown   a run names a clossys verb the CLI does not have
//   run.trace-id       a traced run (`clossys pipeline trace <id> -- <command>`) traces another id
//   run.untraced       a traced command is not `npm run <script>` or `node <file>`
//   run.target-missing a traced command's npm script or file does not exist in the action's package
//   gap.stale          a gap awaits a clossys verb the CLI now has: name the run and drop the gap
//   chain.missing      a plumb run holds a placeholder (`<file>`) and names no chain command or skip
//   chain.mismatch     a chain command is not its run with each placeholder filled (same verb, flags, order)
//   chain.invalid      a decide action names a chain: decide steps stop the chain (clossys next), never run in it
//   pass.invalid       a pass is not a clossys command with the 0/1/2 exit contract, or a traced pass
//                      does not trace `check:<id>`, or its command or verb does not resolve
//   pass.uncited       a traced pass's check is not one of the contract's checks
//   check.unknown      a contract cites a check id src/pipeline/steps/checks.ts does not define
//   record.invalid     a contract's record is not the run-record format clossys.pipeline-run/1
//   decide.incomplete  a decide action lacks decider, packet or skill.md (or a plumb action has one), or
//                      an owner action is not owner-decided
//   packet.invalid     a packet hands an input, writes a port or names a check its contract does not declare
//   uses.missing       a contract uses a bin or file its package does not have
//   ia.invalid         a package's ia.json is missing or fails actions-ia.schema.json
//   ia.placement       an action is not placed exactly once in its package's ia.json under its own
//                      agent (L1) and stage (L2), or ia.json places an unknown action
//   binding.missing    a run action has no binding in src/pipeline/steps/bindings.ts
//   binding.orphan     a binding names no action contract
//   binding.mismatch   a binding disagrees with its run: a clossys verb binds no handler entry, a traced
//                      run's command does not run the bound script, or a gap binds an entry or script
//   binding.unresolved a binding names a file or export that does not exist
//   handler.unknown    a binding's entry is not a src/pipeline/handlers.ts handler
//   handler.unbound    a handler no binding names
//   bin.unlisted       a package bin that is neither used by an action nor a listed exception
//   skill.unlisted     a package skill file (.md under skill/) neither used by an action nor a listed exception
//   exception.invalid  an exceptions.json is missing, fails its schema or lists one item twice
//   exception.stale    an exception names an item that does not exist or that an action already uses
//   snapshot.stale     pipeline/actions.json differs from the registry (npm run generate:pipeline-actions)
//   manifest.stale     pipeline/manifest.json differs from the registry and bindings
//   steps.drift        the built STEPS are not the registry's contracts, in order, with their runs
//   step.hand-written  a src/pipeline/steps/ module defines a step by hand (defineStep) instead of a contract
//   pending.stale      a pending marker whose change has landed (a pending check's command exists)
//   dist.missing       dist/pipeline is absent or older than src/pipeline; build first
//
// A check with `pending` waits on its branch: it is listed as PENDING, never as passing. Exit 0 pass, 1 findings, 2 could not run.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ACTION_FOLDER_FILES, ACTIONS_DIR, coverageOf, iaRows, manifestOf, orderActions, PACKAGES, packageBins, packageScripts,
  packageSkills, PKG, readRegistry, REPO, SKILL_FILE, snapshotOf, stableJson, tracedCommand,
} from "./action-registry.mjs";

const argv = process.argv.slice(2);
const json = argv.includes("--json");
const argOf = flag => { const at = argv.indexOf(flag); return at >= 0 ? resolve(argv[at + 1]) : null; };
const PACKAGES_DIR = argOf("--packages") ?? join(REPO, "packages");
const DIST = argOf("--dist") ?? join(PKG, "dist", "pipeline");
const STEPS_SRC = argOf("--steps-src") ?? join(PKG, "src", "pipeline", "steps");
const CLI_SRC = argOf("--cli-src") ?? join(PKG, "src", "cli");
const STEPS_MODULE = argOf("--steps") ?? join(DIST, "steps", "index.js");
const BINDINGS_MODULE = argOf("--bindings") ?? join(DIST, "steps", "bindings.js");

const failures = [];
const pending = [];
const fail = (rule, message) => failures.push({ rule, message });
function report() {
  if (json) console.log(JSON.stringify({ failures, pending }, null, 2));
  else {
    for (const row of pending) console.log(`PENDING ${row.subject}: ${row.message}`);
    for (const row of failures) console.error(`FAIL ${row.rule}: ${row.message}`);
    console.log(`check:step-standard: ${failures.length ? `${failures.length} finding(s)` : "pass"}`);
  }
  process.exitCode = failures.length ? 1 : 0;
}

// ---------------------------------------------------------------- dist
const LOADED = ["define.js", "actions.js", "schema.js", "steps/index.js", "steps/bindings.js", "steps/checks.js"];
const distStale = LOADED.filter(file => {
  const built = join(DIST, file);
  const source = join(PKG, "src", "pipeline", file.replace(/\.js$/, ".ts"));
  return !existsSync(built) || (existsSync(source) && statSync(source).mtimeMs > statSync(built).mtimeMs);
});
if (distStale.length) {
  fail("dist.missing", `dist/pipeline is absent or older than src for ${distStale.join(", ")}; build before check:step-standard`);
  report();
  process.exit(1);
}
let define, actionsLib, schemaLib, CHECKS, BINDINGS;
try {
  define = await import(pathToFileURL(join(DIST, "define.js")).href);
  actionsLib = await import(pathToFileURL(join(DIST, "actions.js")).href);
  schemaLib = await import(pathToFileURL(join(DIST, "schema.js")).href);
  ({ CHECKS } = await import(pathToFileURL(join(DIST, "steps", "checks.js")).href));
  ({ BINDINGS } = await import(pathToFileURL(BINDINGS_MODULE).href));
} catch (error) {
  console.error(`check:step-standard: could not load dist/pipeline: ${error?.message ?? error}`);
  process.exit(2);
}

// ---------------------------------------------------------------- code facts (this repository)
const text = file => existsSync(file) ? readFileSync(file, "utf8") : "";
const handlersText = text(join(PKG, "src", "pipeline", "handlers.ts"));
const objectKeys = name => {
  const at = handlersText.indexOf(`export const ${name}`);
  if (at < 0) return [];
  const open = handlersText.indexOf("{", handlersText.indexOf("=", at));
  let depth = 0, end = open;
  for (; end < handlersText.length; end++) { if (handlersText[end] === "{") depth++; else if (handlersText[end] === "}" && --depth === 0) break; }
  return [...handlersText.slice(open, end).matchAll(/^\s*["']([^"']+#[A-Za-z0-9_$]+)["']\s*:/gm)].map(match => match[1]);
};
const HANDLERS = new Set(objectKeys("HANDLERS"));
const MODULE_HANDLERS = new Set(objectKeys("MODULE_HANDLERS"));
const SHARED_VERBS = new Set([...text(join(CLI_SRC, "args.ts")).matchAll(/export const VERBS\s*=\s*\[([^\]]*)\]/g)].flatMap(match => [...match[1].matchAll(/["']([a-z][a-z-]*)["']/g)].map(verb => verb[1])));
const exportsName = (file, name) => new RegExp(`export\\s+(?:async\\s+)?(?:function\\*?|const|let|class)\\s+${name.replace(/\$/g, "\\$")}\\b|export\\s*\\{[^}]*\\b${name.replace(/\$/g, "\\$")}\\b`).test(text(file));
const resolves = ref => { const [file, name] = String(ref).split("#"); const path = join(PKG, file); return existsSync(path) && (!name || exportsName(path, name)); };
const checkIds = new Set((CHECKS ?? []).map(check => check.id));
const hasSchema = name => existsSync(join(PKG, "pipeline", "schemas", `${name}.schema.json`));
const actionSchema = schemaLib.loadSchema("action", PKG);
const iaSchema = schemaLib.loadSchema("actions-ia", PKG);
const exceptionsSchema = schemaLib.loadSchema("action-exceptions", PKG);
const issues = (value, schema) => schemaLib.validateValue(value, schema, PKG);
const words = command => String(command ?? "").trim().split(/\s+/);

// ---------------------------------------------------------------- registry
const registry = readRegistry(PACKAGES_DIR);
for (const problem of registry.problems) fail(problem.rule, problem.message);
for (const file of registry.stray) fail("action.folder", `${file} is not an action folder; actions/ holds action folders, ia.json and exceptions.json only`);
const loaded = registry.actions.filter(action => action.contract && typeof action.contract === "object");
const ids = new Map();
for (const action of loaded) {
  const id = action.contract.id;
  if (ids.has(id)) fail("action.duplicate", `${id} is declared by ${ids.get(id).path} and ${action.path}`);
  else ids.set(id, action);
}
// A clossys verb is a shared-parser verb (src/cli/args.ts VERBS) or a verb with its own parser that a
// bound handler serves (the runner dispatches it by the action that declares it).
const VERBS = new Set(SHARED_VERBS);
for (const action of loaded) {
  const binding = BINDINGS?.[action.contract.id];
  const verb = words(action.contract.run)[1];
  if (verb && binding?.parser && existsSync(join(PKG, binding.parser)) && HANDLERS.has(binding.entry)) VERBS.add(verb);
}
const hasManual = value => value && typeof value === "object" && Object.entries(value).some(([key, inner]) => key === "manual" || hasManual(inner));
/** Resolve a traced command inside a package: [ok, reason, script file]. */
function innerTarget(command, pkg) {
  const parts = words(command);
  const scripts = packageScripts(PACKAGES_DIR, pkg);
  if (parts[0] === "npm" && parts[1] === "run") {
    const name = parts.slice(2).find(word => !word.startsWith("-"));
    if (!name || scripts[name] === undefined) return { ok: false, reason: `npm script ${name ?? "(none)"} is not in packages/${pkg}/package.json` };
    const node = /(?:^|&&\s*)node\s+(\S+)/.exec(String(scripts[name]));
    return { ok: true, script: node?.[1] };
  }
  if (parts[0] === "node") {
    const file = parts.slice(1).find(word => !word.startsWith("-"));
    if (!file || !existsSync(join(REPO, "packages", pkg, file))) return { ok: false, reason: `file ${file ?? "(none)"} does not exist in packages/${pkg}` };
    return { ok: true, script: file };
  }
  return null;
}
const allBins = new Set(PACKAGES.flatMap(pkg => packageBins(PACKAGES_DIR, pkg)));
const EXIT = JSON.stringify(define.EXIT_CONTRACT);

for (const action of loaded) {
  const contract = action.contract;
  const id = contract.id ?? action.folder;
  const where = action.path;
  for (const issue of issues(contract, actionSchema)) fail("action.invalid", `${where}${issue.path === "$" ? "" : ` ${issue.path}`}: ${issue.message}`);
  if (hasManual(contract) || /\bmanual\b/.test(`${contract.run ?? ""} ${contract.pass?.command ?? ""}`)) fail("action.manual", `${id} names manual; name the clossys verb that records the decision, or list the action as a gap`);
  // Folder shape.
  if (action.folder !== contract.id) fail("action.folder", `${where}: folder ${action.folder} is not named by its id ${contract.id}`);
  for (const dir of action.nested) fail("action.folder", `${where}: ${dir}/ nests inside an action folder; action folders are flat (grouping lives in ia.json)`);
  for (const file of action.files.filter(file => !action.nested.includes(file) && !ACTION_FOLDER_FILES.includes(file))) fail("action.folder", `${where}: ${file} is not action.json or skill.md`);
  const decide = typeof contract.kind === "string" && contract.kind.startsWith("decide:");
  const hasSkill = action.files.includes(SKILL_FILE);
  if (!decide && hasSkill) fail("action.folder", `${id} is plumb but holds ${SKILL_FILE}; only a decide action carries judgment`);
  // Agent.
  const agents = action.package === "producer" ? ["producer", "owner"] : [action.package];
  if (!agents.includes(contract.agent)) fail("action.agent", `${id} in packages/${action.package} has agent ${contract.agent}; expected ${agents.join(" or ")}`);
  // Ports.
  for (const side of ["inputs", "outputs"]) for (const port of Array.isArray(contract[side]) ? contract[side] : []) {
    if (typeof port?.schema !== "string" || !port.schema) fail("port.untyped", `${id} ${side.slice(0, -1)} ${port?.glob ?? JSON.stringify(port)} names no schema`);
    else if (!hasSchema(port.schema)) fail("port.schema-missing", `${id} ${side.slice(0, -1)} ${port.glob} names schema ${port.schema}, which has no pipeline/schemas/${port.schema}.schema.json`);
  }
  // Run or gap.
  if ((contract.run === undefined) === (contract.gap === undefined)) fail("run.invalid", `${id} names ${contract.run === undefined ? "neither" : "both"} run and gap; exactly one`);
  if (contract.gap !== undefined && !decide) fail("run.invalid", `${id} is plumb but is a gap; a plumb action names its run`);
  const awaited = typeof contract.gap?.awaits === "string" ? words(contract.gap.awaits)[1] : undefined;
  if (awaited && VERBS.has(awaited)) fail("gap.stale", `${id} is a gap awaiting clossys ${awaited}, which the CLI now has; name its run and drop the gap`);
  // Chain: what clossys run executes for a plumb step.
  const chain = contract.chain;
  if (chain !== undefined && decide) fail("chain.invalid", `${id} is ${contract.kind} but names a chain; a decide step stops the chain (clossys next) and never runs in it`);
  else if (!decide && typeof contract.run === "string") {
    const runWords = words(contract.run);
    const placeholder = word => /<[^>]*>/.test(word);
    if (chain === undefined && runWords.some(placeholder)) fail("chain.missing", `${id} runs \`${contract.run}\`, which holds a placeholder; name the chain command clossys run executes, or a chain skip with its reason`);
    if (typeof chain === "string") {
      const chainWords = words(chain);
      const differs = chainWords.length !== runWords.length || runWords.some((word, index) => !placeholder(word) && word !== chainWords[index]) || chainWords.some(placeholder);
      if (differs) fail("chain.mismatch", `${id} chains \`${chain}\`, which is not its run \`${contract.run}\` with each placeholder filled`);
    }
  }
  if (typeof contract.run === "string") {
    let run = null;
    try { run = define.parseRun(contract.run); } catch (error) { fail("run.invalid", `${id}: ${error.message}`); }
    if (run && !VERBS.has(run.form === "trace" ? "pipeline" : run.verb)) fail("run.verb-unknown", `${id} runs clossys ${run.verb}, which the CLI does not have`);
    if (run?.form === "trace") {
      if (run.step !== contract.id) fail("run.trace-id", `${id} traces ${run.step}; a traced run records its own id`);
      const target = innerTarget(tracedCommand(contract.run), action.package);
      if (target === null) fail("run.untraced", `${id} traces \`${tracedCommand(contract.run)}\`; a traced command is npm run <script> or node <file>`);
      else if (!target.ok) fail("run.target-missing", `${id}: ${target.reason}`);
    }
  }
  // Pass.
  const pass = contract.pass;
  if (typeof pass?.command === "string") {
    let parsed = null;
    try { parsed = define.parseRun(pass.command); } catch (error) { fail("pass.invalid", `${id}: ${error.message}`); }
    if (parsed?.form === "trace") {
      const check = /^check:([a-z][a-z0-9-]*)$/.exec(parsed.step)?.[1];
      if (!check) fail("pass.invalid", `${id} pass traces ${parsed.step}; a traced pass traces check:<id>`);
      else {
        if (!(contract.checks ?? []).includes(check)) fail("pass.uncited", `${id} passes by check ${check}, which its checks do not cite`);
        if (!checkIds.has(check)) fail("check.unknown", `${id} passes by check ${check}, which src/pipeline/steps/checks.ts does not define`);
      }
      const target = innerTarget(tracedCommand(pass.command), action.package);
      if (target === null || !target.ok) fail("pass.invalid", `${id} pass \`${tracedCommand(pass.command)}\` does not resolve${target ? `: ${target.reason}` : ""}`);
    } else if (parsed && !VERBS.has(parsed.verb)) fail("pass.invalid", `${id} passes by clossys ${parsed.verb}, which the CLI does not have`);
  } else fail("pass.invalid", `${id} names no pass command`);
  if (JSON.stringify(pass?.exit) !== EXIT) fail("pass.invalid", `${id} pass exit contract is not ${EXIT}`);
  for (const check of Array.isArray(contract.checks) ? contract.checks : []) if (!checkIds.has(check)) fail("check.unknown", `${id} cites check ${check}, which src/pipeline/steps/checks.ts does not define`);
  if (contract.record !== define.RUN_RECORD) fail("record.invalid", `${id} record is ${JSON.stringify(contract.record)}; every step writes ${define.RUN_RECORD} rows`);
  // Decide.
  if (decide) {
    const missing = [["decider", contract.decider], ["packet", contract.packet], ["skill", contract.skill], [SKILL_FILE, hasSkill || undefined]].filter(([, value]) => value === undefined).map(([name]) => name);
    if (missing.length) fail("decide.incomplete", `${id} is ${contract.kind} without ${missing.join(", ")}`);
    if (contract.agent === "owner" && contract.decider !== "owner") fail("decide.incomplete", `${id} is an owner action decided by ${contract.decider}`);
    const packet = contract.packet ?? {};
    const inputGlobs = new Set((contract.inputs ?? []).map(port => port.glob));
    const outputKeys = new Set((contract.outputs ?? []).map(port => `${port.glob}|${port.schema}`));
    for (const glob of packet.inputs ?? []) if (!inputGlobs.has(glob)) fail("packet.invalid", `${id} packet hands ${glob}, which is not one of its inputs`);
    for (const port of packet.write ?? []) if (!outputKeys.has(`${port.glob}|${port.schema}`)) fail("packet.invalid", `${id} packet writes ${port.glob} (${port.schema}), which is not one of its outputs`);
    for (const check of packet.checks ?? []) if (!(contract.checks ?? []).includes(check)) fail("packet.invalid", `${id} packet must pass ${check}, which its checks do not cite`);
  } else {
    const extra = ["decider", "packet", "skill"].filter(key => contract[key] !== undefined);
    if (extra.length) fail("decide.incomplete", `${id} is plumb but names ${extra.join(", ")}`);
  }
  for (const use of Array.isArray(contract.uses) ? contract.uses : []) {
    if (use.startsWith("bin:") ? !allBins.has(use.slice(4)) : !existsSync(join(PACKAGES_DIR, action.package, use))) fail("uses.missing", `${id} uses ${use}, which ${use.startsWith("bin:") ? "no package declares as a bin" : `packages/${action.package} does not have`}`);
  }
}

// ---------------------------------------------------------------- ia.json
for (const pkg of PACKAGES) {
  const tree = registry.ia[pkg];
  if (tree === undefined) continue;
  for (const issue of issues(tree, iaSchema)) fail("ia.invalid", `packages/${pkg}/${ACTIONS_DIR}/ia.json${issue.path === "$" ? "" : ` ${issue.path}`}: ${issue.message}`);
  const rows = iaRows(tree);
  const own = loaded.filter(action => action.package === pkg);
  for (const row of rows) if (!own.some(action => action.contract.id === row.action)) fail("ia.placement", `packages/${pkg}/${ACTIONS_DIR}/ia.json places ${row.action}, which has no action folder in packages/${pkg}`);
  for (const action of own) {
    const placed = rows.filter(row => row.action === action.contract.id);
    if (placed.length !== 1) fail("ia.placement", `${action.contract.id} is placed ${placed.length} times in packages/${pkg}/${ACTIONS_DIR}/ia.json; exactly once`);
    else if (placed[0].agent !== action.contract.agent || placed[0].stage !== action.contract.stage) fail("ia.placement", `${action.contract.id} sits under ${placed[0].agent}/${placed[0].stage} in ia.json but its contract is ${action.contract.agent}/${action.contract.stage}`);
  }
}

// ---------------------------------------------------------------- bindings
const bound = BINDINGS ?? {};
for (const action of loaded) {
  const contract = action.contract;
  const binding = bound[contract.id];
  if (typeof contract.run === "string") {
    if (!binding) { fail("binding.missing", `${contract.id} runs \`${contract.run}\` but src/pipeline/steps/bindings.ts binds no code to it`); continue; }
    if (tracedCommand(contract.run) === null) {
      if (!binding.entry) fail("binding.mismatch", `${contract.id} runs a clossys verb but its binding names no handler entry`);
      else if (!HANDLERS.has(binding.entry)) fail("handler.unknown", `${contract.id} binds entry ${binding.entry}, which is not a src/pipeline/handlers.ts HANDLERS key`);
      if (binding.script) fail("binding.mismatch", `${contract.id} runs a clossys verb but binds script ${binding.script}`);
    } else {
      const target = innerTarget(tracedCommand(contract.run), action.package);
      if (!binding.script) fail("binding.mismatch", `${contract.id} is a traced run but binds no script`);
      else if (target?.ok && target.script !== binding.script) fail("binding.mismatch", `${contract.id} traces \`${tracedCommand(contract.run)}\`, which runs ${target.script ?? "no node script"}, not its bound script ${binding.script}`);
      if (binding.entry) fail("binding.mismatch", `${contract.id} is a traced run but binds entry ${binding.entry}`);
    }
  } else if (binding && (binding.entry || binding.script || binding.parser)) fail("binding.mismatch", `${contract.id} is a gap (no run) but binds ${binding.entry ?? binding.script ?? binding.parser}; a gap may bind only the modules its decider uses`);
}
for (const [id, binding] of Object.entries(bound)) {
  if (!ids.has(id)) fail("binding.orphan", `src/pipeline/steps/bindings.ts binds ${id}, which no action contract declares`);
  for (const ref of [binding.entry, binding.parser, binding.script, ...[binding.module ?? []].flat()].filter(Boolean)) if (!resolves(ref)) fail("binding.unresolved", `${id} binds ${ref}, which does not exist`);
}
const boundEntries = new Set(Object.values(bound).flatMap(binding => [binding.entry, ...[binding.module ?? []].flat()].filter(Boolean)));
for (const key of [...HANDLERS, ...MODULE_HANDLERS]) if (!boundEntries.has(key)) fail("handler.unbound", `handler ${key} is bound to no action contract`);

// ---------------------------------------------------------------- bins, skills, exceptions
const coveredBins = new Set();
const coveredSkills = new Set();
for (const action of loaded) { const cover = coverageOf(action); cover.bins.forEach(bin => coveredBins.add(bin)); cover.skills.forEach(skill => coveredSkills.add(skill)); }
for (const pkg of PACKAGES) {
  const listed = registry.exceptions[pkg];
  if (listed === undefined) continue;
  for (const issue of issues(listed, exceptionsSchema)) fail("exception.invalid", `packages/${pkg}/${ACTIONS_DIR}/exceptions.json${issue.path === "$" ? "" : ` ${issue.path}`}: ${issue.message}`);
  const rows = Array.isArray(listed.exceptions) ? listed.exceptions : [];
  const items = rows.map(row => row?.item);
  for (const item of new Set(items.filter((item, index) => items.indexOf(item) !== index))) fail("exception.invalid", `packages/${pkg} lists exception ${item} more than once`);
  const bins = packageBins(PACKAGES_DIR, pkg);
  const skills = packageSkills(PACKAGES_DIR, pkg);
  for (const item of items.filter(item => typeof item === "string")) {
    const bin = item.startsWith("bin:") ? item.slice(4) : null;
    if (bin !== null ? !bins.includes(bin) : !skills.includes(item)) fail("exception.stale", `packages/${pkg} lists exception ${item}, which the package does not have`);
    else if (bin !== null ? coveredBins.has(bin) : coveredSkills.has(`${pkg}:${item}`)) fail("exception.stale", `packages/${pkg} lists exception ${item}, which an action already uses; drop the exception`);
  }
  for (const bin of bins) if (!coveredBins.has(bin) && !items.includes(`bin:${bin}`)) fail("bin.unlisted", `packages/${pkg} bin ${bin} is used by no action and is not a listed exception`);
  for (const skill of skills) if (!coveredSkills.has(`${pkg}:${skill}`) && !items.includes(skill)) fail("skill.unlisted", `packages/${pkg}/${skill} is used by no action and is not a listed exception`);
}

// ---------------------------------------------------------------- generated files
const ordered = registry.problems.length || loaded.length !== registry.actions.length ? null : orderActions(loaded, registry.ia, define.STAGES);
if (ordered) {
  for (const [rule, file, value] of [
    ["snapshot.stale", actionsLib.ACTIONS_FILE, snapshotOf(ordered, actionsLib.ACTIONS_SCHEMA)],
    ["manifest.stale", actionsLib.MANIFEST_FILE, manifestOf(ordered, registry.exceptions, bound, actionsLib.MANIFEST_SCHEMA)],
  ]) {
    const path = join(PACKAGES_DIR, "producer", file);
    if (!existsSync(path) || readFileSync(path, "utf8") !== stableJson(value)) fail(rule, `packages/producer/${file} differs from the registry; run npm run generate:pipeline-actions`);
  }
  let steps = null;
  try { steps = (await import(pathToFileURL(STEPS_MODULE).href)).STEPS; } catch (error) { fail("steps.drift", `the built STEPS do not load: ${error?.message ?? error}`); }
  if (Array.isArray(steps)) {
    const want = ordered.map(action => action.contract.id).join(" ");
    const have = steps.map(step => step.id).join(" ");
    if (want !== have) fail("steps.drift", `the built STEPS are [${have}], not the registry's contracts in order [${want}]`);
    for (const step of steps) {
      const contract = ids.get(step.id)?.contract;
      if (contract && (step.run !== contract.run || JSON.stringify(step.pass) !== JSON.stringify(contract.pass) || step.record !== contract.record)) fail("steps.drift", `step ${step.id} differs from its contract (run, pass or record)`);
    }
  }
}
const stepsDir = STEPS_SRC;
for (const file of existsSync(stepsDir) ? readdirSync(stepsDir).filter(name => /\.(ts|mts)$/.test(name) && !name.includes(".test.")) : []) {
  if (/\bdefineStep\s*\(/.test(text(join(stepsDir, file)))) fail("step.hand-written", `src/pipeline/steps/${file} defines a step with defineStep; every step is a packages/<package>/actions/<id>/action.json contract`);
}

// ---------------------------------------------------------------- pending
for (const check of CHECKS ?? []) if (check.pending && check.command) {
  const [, verb, sub] = words(check.command);
  const source = text(join(CLI_SRC, `${verb}.ts`));
  if (sub && new RegExp(`["']${sub}["']`).test(source)) fail("pending.stale", `check ${check.id} is pending on ${check.pending.branch}, but \`${check.command}\` exists; drop the pending marker`);
  else pending.push({ subject: `check:${check.id}`, message: `\`${check.command}\` lands on ${check.pending.branch}` });
}
report();
