#!/usr/bin/env node
// R-PIPELINE-IS-CODE: every pipeline step is a `defineStep` call in
// src/pipeline/steps/, and this check fails when the code and those definitions
// disagree. It loads the built definitions (dist/pipeline; run after the build),
// reads source and tracked data, regenerates the graph in memory and compares it
// with the committed pipeline/graph.json. It never runs a step and writes nothing.
//
//   node scripts/check-pipeline.mjs [--json] [--steps <module>] [--graph <file>] [--scan <dir>]
//
// --steps loads STEPS and CHECKS from another module (mutation proofs); --graph
// compares against another committed graph file; --scan adds the source files
// under a directory (a fixture) to the files the writer rules read.
//
// Failure rules (each finding names one):
//   dist.missing      dist/pipeline is absent or older than src/pipeline; build first
//   step.invalid      a step definition does not load (defineStep refused it) or is malformed
//   stage.missing     a step names no stage, or a stage that is not one of define.ts STAGES (WHEN:
//                     the canvas's columns, `<round>.<stage>` in (round, stage) order)
//   lane.unrostered   a step's seat holder (its seat file's `by`, else derived from its kind; WHO:
//                     the canvas's lanes) is not a roster entry (roster.ts ROSTER)
//   stage.orphan      a step outside the first stage (direct.brief) that no derived edge feeds: it
//                     reads nothing another step produces, so it starts the flow mid-way. Only a
//                     first-stage step may start it; declare the typed files the step really reads
//   edge.declared     an edge, option or config listed by hand; edges are derived from output/input globs
//   graph.stale       pipeline/graph.json differs from the graph built from the definitions
//   edges.stale       its edges differ from the derived edges (an edge needs the same schema on
//                     both ports and overlapping globs), named by from->to
//   layout.stale      a node's layout {lane, rank, x, y}, the lanes or the cycle breaks differ from
//                     the generator's deterministic layout, named by step id (layout.crossings too)
//   layout.nondeterministic  two builds of the graph from the same definitions differ
//   edge.schema-mismatch  an output and an input overlap by glob but name different schemas
//   schema.missing    a port names a schema with no file under pipeline/schemas/
//   schema.invalid    a committed file an output glob matches fails its port schema (reported by step id)
//   output.zero       a tracked data file, or a step input, that no step produces
//   output.multiple   one file (or one JSON field) produced by two steps, or one CLI mode (verb, flags
//                     and `<agent>/` target) declared by two steps
//   entry.missing     a step names an entry, module, script, npm script or skill that does not exist
//   entry.stale       a pending step whose branch has landed (or whose removal already happened)
//   verb.undeclared   a CLI verb no step declares; verb.unknown is the reverse
//   check.undeclared  a check script or npm check no defineCheck declares
//   check.unknown     a step cites a check id the registry lacks; check.orphan: no step runs it
//   runner.bypass     CLI code reaches a step entry without the pipeline runner
//   plumb.model-client  a plumb step's code reaches an agent or model client
//   decide.foreign-writer  code outside a decide step's declared entry can write its outputs inside
//                     the repository (a write whose path resolves, symlinks included, outside the
//                     repository root, such as a scratch copy under os.tmpdir(), is not a repo write)
//   seat.invalid      a seat file (clossys/agents/producer/<step>/seat.json) fails the seat schema,
//                     names a missing prompt file or an unknown clossys command, or has no decide step;
//                     or a pick.<agent> seat's llm differs from its make step <agent>.candidates (W4)
//   option.unknown    a flag the step's CLI parser does not define
//
// A missing seat file, or a seat part set to null, is listed as OPEN (unassigned), never as passing.
// A step whose holder does not resolve at all sits in the `unassigned` lane and is listed as OPEN.
// A workspace port that names no schema feeds no edge; each one is listed as UNTYPED (and in
// graph.json "untyped"), never dropped silently. Cycle edges the layout skips are listed as CYCLE;
// the layout's edge crossings before and after its barycenter ordering are listed as CROSSINGS.
//
// Steps declared `pending` (they land on another branch) are reported as PENDING,
// never as passing. A pending step's own entry may be absent; when it exists the
// pending marker is stale and fails.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(PKG, "../..");
const PKG_REL = relative(REPO, PKG).split(sep).join("/");
const argv = process.argv.slice(2);
const json = argv.includes("--json");
const argOf = flag => { const at = argv.indexOf(flag); return at >= 0 ? resolve(argv[at + 1]) : null; };
const DIST = join(PKG, "dist", "pipeline");
const STEPS_MODULE = argOf("--steps") ?? join(DIST, "steps", "index.js");
const GRAPH = argOf("--graph") ?? join(PKG, "pipeline", "graph.json");
const SCAN = argOf("--scan");

const failures = [];
const pending = [];
const open = [];
let untyped = [];
let cycleBreaks = [];
let crossings = null;
const fail = (rule, message) => failures.push({ rule, message });
const note = (step, message) => pending.push({ step, message });
function report() {
  const summary = { ok: failures.length === 0, steps: steps.length, pendingSteps: steps.filter(isPending).map(step => step.id), failures, pending, open, untyped, cycleBreaks, crossings, unscanned };
  if (json) console.log(JSON.stringify(summary, null, 2));
  else {
    for (const { rule, message } of failures) console.log(`FAIL ${rule}: ${message}`);
    for (const { step, message } of pending) console.log(`PENDING ${step}: ${message}`);
    for (const { step, field } of open) console.log(`OPEN ${step}: ${field} is unassigned`);
    for (const { step, port, glob } of untyped) console.log(`UNTYPED ${step}: ${port} ${glob} names no schema, so it feeds no edge`);
    for (const { from, to } of cycleBreaks) console.log(`CYCLE ${from} -> ${to}: edge closes a cycle; the layout ranks without it (step id order)`);
    if (crossings) console.log(`CROSSINGS ${crossings.before} -> ${crossings.after}: edge crossings with steps in id order, then after the layout's barycenter ordering`);
    for (const { step, output } of unscanned) console.log(`INFO ${step}: ${output} has no file-name marker; its writers are found through the step's other outputs`);
    console.log(failures.length ? `check:pipeline FAIL (${failures.length} findings, ${pending.length} pending)` : `check:pipeline PASS (${steps.length} steps, ${edgeCount} edges, ${summary.pendingSteps.length} pending, ${pending.length} pending notes, ${open.length} open, ${untyped.length} untyped ports, ${cycleBreaks.length} cycle breaks)`);
  }
  // exitCode, not exit(): exit() can cut piped stdout at the 64 KiB pipe buffer.
  process.exitCode = failures.length ? 1 : 0;
}
let steps = [];
let edgeCount = 0;
let verbCache;
const unscanned = [];
const isPending = step => step.pending !== undefined;
const isDecide = step => typeof step?.kind === "string" && step.kind.startsWith("decide:");

// ---------------------------------------------------------------- definitions
/** The step definitions are code; the build is the only way to load them on Node 20. */
const newest = (dir, ext) => {
  let latest = 0;
  if (!existsSync(dir)) return latest;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) latest = Math.max(latest, newest(path, ext));
    else if (name.endsWith(ext) && !name.endsWith(".d.ts") && !/\.test\./.test(name)) latest = Math.max(latest, stat.mtimeMs);
  }
  return latest;
};
if (!existsSync(join(PKG, "src", "pipeline", "steps"))) fail("step.invalid", "src/pipeline/steps/ does not exist; every step must be a defineStep call there");
// Without loadable definitions the check still runs every source and data rule, against no steps.
let mod = {}, lib = null;
if (!existsSync(join(DIST, "steps", "index.js"))) fail("dist.missing", "dist/pipeline/steps/index.js does not exist; build src/pipeline before check:pipeline");
else if (newest(join(PKG, "src", "pipeline"), ".ts") > newest(DIST, ".js")) fail("dist.missing", "dist/pipeline is older than src/pipeline; rebuild before check:pipeline");
else try {
  mod = await import(pathToFileURL(STEPS_MODULE).href);
  lib = {
    define: await import(pathToFileURL(join(DIST, "define.js")).href),
    graph: await import(pathToFileURL(join(DIST, "graph.js")).href),
    globs: await import(pathToFileURL(join(DIST, "globs.js")).href),
    schema: await import(pathToFileURL(join(DIST, "schema.js")).href),
    seats: await import(pathToFileURL(join(DIST, "seats.js")).href),
    roster: await import(pathToFileURL(join(DIST, "roster.js")).href),
  };
} catch (error) {
  const rule = /listed by hand/.test(error?.message ?? "") ? "edge.declared" : "step.invalid";
  fail(rule, `step definitions do not load: ${error?.message ?? error}`);
  mod = {}; lib = null;
}
const defined = Array.isArray(mod.STEPS) ? mod.STEPS : [];
const checkList = Array.isArray(mod.CHECKS) ? mod.CHECKS : [];
const HAND_LISTED = lib?.define.HAND_LISTED ?? ["edges", "next", "after", "before", "upstream", "downstream", "dependsOn", "options", "config", "configKeys"];
const byId = new Map();
/** The checker's view of a step: ports as glob strings, `run` for what runs it. */
steps = defined.map(step => ({ ...step, ports: step.outputs, inputs: step.inputs.map(port => port.glob), outputs: step.outputs.map(port => port.glob), run: step.command }));
for (const step of steps) {
  const where = `step ${JSON.stringify(step?.id)}`;
  if (byId.has(step.id)) fail("step.invalid", `${where}: defined twice`);
  byId.set(step.id, step);
  for (const key of HAND_LISTED) if (step[key] !== undefined || step.command?.[key] !== undefined) fail("edge.declared", `${where}: ${key} is listed by hand; edges, options and config are derived`);
  if (!lib) continue;
  if (!lib.define.STEP_KINDS.includes(step.kind)) fail("step.invalid", `${where}: kind must be ${lib.define.STEP_KINDS.join(", ")}`);
  if (step.stage === undefined) fail("stage.missing", `${where}: names no stage; every step names one of ${lib.define.STAGES.join(", ")}`);
  else if (!lib.define.STAGES.includes(step.stage)) fail("stage.missing", `${where}: stage ${JSON.stringify(step.stage)} is not one of ${lib.define.STAGES.join(", ")}`);
  if (step.kind === "plumb" && step.seat !== undefined) fail("seat.invalid", `${where}: a plumb step has no seat`);
  if (isDecide(step) && step.seat !== lib.define.seatPath(step.id)) fail("seat.invalid", `${where}: its seat must be ${lib.define.seatPath(step.id)}`);
}
for (const key of HAND_LISTED) if (mod[key] !== undefined) fail("edge.declared", `the steps module exports ${key}; edges, options and config are derived`);
const checks = Object.fromEntries(checkList.map(check => [check.id, check]));
const pendingWhy = step => `pending: ${step.pending.change === "adds" ? "lands on" : "removed by"} ${step.pending.branch}`;

// ---------------------------------------------------------------- graph
/** pipeline/graph.json is generated output: regenerate it and fail on any difference. */
const regenerated = lib ? lib.graph.graphJson(lib.graph.buildGraph(REPO, defined, PKG)) : null;
if (!existsSync(GRAPH)) fail("graph.stale", `${relative(REPO, GRAPH)} does not exist; run npm run generate:pipeline-graph`);
else if (regenerated !== null && readFileSync(GRAPH, "utf8") !== regenerated) {
  const committed = readFileSync(GRAPH, "utf8").split("\n"), fresh = regenerated.split("\n");
  const line = committed.findIndex((text, index) => text !== fresh[index]);
  fail("graph.stale", `${relative(REPO, GRAPH)} differs from the graph built from the step definitions (first at line ${line + 1}); run npm run generate:pipeline-graph`);
}
/** Edges and layout are compared field by field, so a hand-edited edge or position names itself. */
if (lib) {
  const fresh = JSON.parse(regenerated);
  if (lib.graph.graphJson(lib.graph.buildGraph(REPO, defined, PKG)) !== regenerated) fail("layout.nondeterministic", "two builds of the graph from the same step definitions differ");
  edgeCount = fresh.edges.length;
  // WHEN: only a first-stage step may start the flow; every later step is fed by a derived edge.
  const fed = new Set(fresh.edges.map(edge => edge.to));
  for (const step of defined) {
    if (step.stage === undefined || !lib.define.STAGES.includes(step.stage) || step.stage === lib.define.STAGES[0] || fed.has(step.id)) continue;
    fail("stage.orphan", `step ${JSON.stringify(step.id)} (${step.stage}): no derived edge feeds it, so it starts the flow outside ${lib.define.STAGES[0]}; declare the typed files it reads`);
  }
  untyped = fresh.untyped ?? [];
  cycleBreaks = fresh.layout?.cycleBreaks ?? [];
  crossings = fresh.layout?.crossings ?? null;
  for (const m of lib.graph.schemaMismatches(defined)) fail("edge.schema-mismatch", `${m.from} -> ${m.to}: ${m.output} (${m.outputSchema}) overlaps ${m.input} (${m.inputSchema}); one file has one schema`);
  let committed = null;
  try { committed = existsSync(GRAPH) ? JSON.parse(readFileSync(GRAPH, "utf8")) : null; } catch { fail("graph.stale", `${relative(REPO, GRAPH)} is not valid JSON`); }
  if (committed) {
    const edgeKey = edge => `${edge?.from}->${edge?.to}`;
    const edgeMap = list => new Map((Array.isArray(list) ? list : []).map(edge => [edgeKey(edge), JSON.stringify(edge)]));
    const want = edgeMap(fresh.edges), have = edgeMap(committed.edges);
    const missing = [...want.keys()].filter(key => !have.has(key));
    const extra = [...have.keys()].filter(key => !want.has(key));
    const changed = [...want.keys()].filter(key => have.has(key) && have.get(key) !== want.get(key));
    if (missing.length || extra.length || changed.length) fail("edges.stale", `${relative(REPO, GRAPH)} edges differ from the derived edges (${fresh.edges.length} derived, ${have.size} committed): ${[...missing.map(k => `missing ${k}`), ...extra.map(k => `not derived ${k}`), ...changed.map(k => `changed ${k}`)].slice(0, 10).join(", ")}`);
    const layoutOf = list => new Map((Array.isArray(list) ? list : []).map(node => [node?.id, JSON.stringify(node?.layout ?? null)]));
    const wantLayout = layoutOf(fresh.nodes), haveLayout = layoutOf(committed.nodes);
    const moved = [...wantLayout.keys()].filter(id => haveLayout.get(id) !== wantLayout.get(id));
    for (const id of moved.slice(0, 10)) fail("layout.stale", `${id}: committed layout ${haveLayout.get(id) ?? "(none)"} differs from the generated ${wantLayout.get(id)}`);
    if (moved.length > 10) fail("layout.stale", `${moved.length - 10} more nodes have a stale layout`);
    for (const key of ["lanes", "cycleBreaks", "constants", "crossings"]) if (JSON.stringify(committed.layout?.[key] ?? null) !== JSON.stringify(fresh.layout[key])) fail("layout.stale", `layout.${key} differs from the generated layout`);
  }
}

// ---------------------------------------------------------------- globs
const toRepoGlob = glob => glob.startsWith("pkg:") ? `${PKG_REL}/${glob.slice(4)}` : glob;
const splitField = glob => { const at = glob.indexOf("#"); return at < 0 ? [glob, null] : [glob.slice(0, at), glob.slice(at + 1)]; };
/** The same glob semantics edges are derived with (src/pipeline/globs.ts); a copy runs when the build is absent. */
function fallbackGlobRegex(path) {
  const parts = path.split("/").map(segment => segment === "**" ? null : segment.split("*").map(part => part.replace(/[.+^$()|[\]\\{}?]/g, "\\$&")).join("[^/]*"));
  return new RegExp(`^${parts.map((part, index) => part === null ? (index === parts.length - 1 ? ".*" : "(?:[^/]+/)*") : part + (index === parts.length - 1 ? "" : "/")).join("")}$`);
}
const globRegex = glob => lib ? lib.globs.globRegex(glob) : fallbackGlobRegex(glob);
const sampleOf = glob => glob.replace(/\*\*/g, "x/x").replace(/\*/g, "x");

// ---------------------------------------------------------------- outputs
const DATA_ROOTS = ["clossys/", `${PKG_REL}/studio/generated/`, `${PKG_REL}/pipeline/graph.json`];
let tracked = [];
try { tracked = execFileSync("git", ["ls-files", "-z", "--", ...DATA_ROOTS], { cwd: REPO, encoding: "utf8" }).split("\0").filter(Boolean); }
catch { fail("step.invalid", "git ls-files failed; the check reads tracked data files"); }
const claims = [];
const declaredOutputs = new Map();
for (const step of steps) for (const output of step.outputs ?? []) {
  if (output.startsWith("arg:")) continue;
  const [glob, field] = splitField(toRepoGlob(output));
  const key = `${glob}#${field ?? ""}`;
  const previous = declaredOutputs.get(key);
  if (previous && previous !== step.id) fail("output.multiple", `${output} is declared by both ${previous} and ${step.id}`);
  declaredOutputs.set(key, step.id);
  claims.push({ step, glob, field, re: globRegex(glob), pending: isPending(step) });
}
const pendingFiles = new Map();
for (const file of tracked) {
  const mine = claims.filter(claim => claim.re.test(file));
  const whole = mine.filter(claim => claim.field === null);
  if (mine.length === 0) { fail("output.zero", `${file} is tracked but no step produces it`); continue; }
  const active = [...new Map(whole.filter(claim => !claim.pending).map(claim => [claim.step.id, claim])).values()];
  if (active.length > 1) fail("output.multiple", `${file} is produced by ${active.map(c => c.step.id).join(" and ")}`);
  if (whole.length === 0) fail("output.zero", `${file}: only field claims (${mine.map(c => `${c.step.id}#${c.field}`).join(", ")}); no step produces the file`);
  const fields = new Map();
  for (const claim of mine.filter(c => c.field !== null && !c.pending)) {
    if (fields.has(claim.field) && fields.get(claim.field) !== claim.step.id) fail("output.multiple", `${file}#${claim.field} is produced by ${fields.get(claim.field)} and ${claim.step.id}`);
    fields.set(claim.field, claim.step.id);
  }
  if (active.length === 0 && whole.length > 0) for (const claim of whole) pendingFiles.set(claim.step.id, (pendingFiles.get(claim.step.id) ?? 0) + 1);
}
for (const [id, count] of pendingFiles) note(id, `${count} tracked files are produced only by this step (${pendingWhy(byId.get(id))})`);
for (const step of steps) for (const input of step.inputs ?? []) {
  if (input.startsWith("arg:")) continue;
  const [glob] = splitField(toRepoGlob(input));
  const sample = sampleOf(glob);
  const covered = claims.some(claim => claim.glob === glob || claim.re.test(sample) || tracked.some(file => globRegex(glob).test(file) && claim.re.test(file)));
  if (!covered) fail("output.zero", `${step.id} reads ${input}, which no step produces`);
}

// ---------------------------------------------------------------- port schemas
/** Every committed file an output glob matches must pass that port's schema. */
for (const step of steps) for (const port of defined.find(def => def.id === step.id)?.inputs ?? []) {
  if (!port.schema || !lib) continue;
  if (!lib.schema.hasSchema(port.schema, PKG)) fail("schema.missing", `${step.id}: input ${port.glob} names schema ${port.schema}, which pipeline/schemas/${port.schema}.schema.json does not define`);
}
for (const step of steps) for (const port of step.ports) {
  if (!port.schema) continue;
  if (!lib) break;
  if (!lib.schema.hasSchema(port.schema, PKG)) { fail("schema.missing", `${step.id}: ${port.glob} names schema ${port.schema}, which pipeline/schemas/${port.schema}.schema.json does not define`); continue; }
  if (port.glob.startsWith("arg:")) continue;
  const [glob] = splitField(toRepoGlob(port.glob));
  const re = globRegex(glob);
  const files = trackedAll().filter(file => re.test(file));
  let bad = 0;
  for (const file of files) {
    const issues = lib.schema.validateFile(port.schema, file, readFileSync(join(REPO, file), "utf8"), PKG);
    if (issues.length === 0) continue;
    if (++bad <= 20) fail("schema.invalid", `${step.id}: ${file} fails ${port.schema}: ${issues.slice(0, 3).map(issue => `${issue.path} ${issue.message}`).join("; ")}`);
  }
  if (bad > 20) fail("schema.invalid", `${step.id}: ${bad - 20} more files under ${port.glob} fail ${port.schema}`);
}
function trackedAll() {
  return trackedAll.cache ??= execFileSync("git", ["ls-files", "-z", "--", "clossys/", PKG_REL], { cwd: REPO, encoding: "utf8" }).split("\0").filter(Boolean);
}

// ---------------------------------------------------------------- source index
const SOURCE_EXT = /\.(ts|tsx|mts|cts|mjs|cjs|js)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", ".next", ".turbo", "coverage", "__fixtures__", "fixtures", "generated", ".cache"]);
const isTestFile = file => /\.(test|spec)\.[a-z]+$/.test(file) || /(^|\/)fixtures?\.[a-z]+$/.test(file) || /\.d\.(ts|mts|cts)$/.test(file) || file.includes("/test/") || file.includes("/__tests__/");
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, out);
    else if (SOURCE_EXT.test(name) && !isTestFile(path.split(sep).join("/"))) out.push(path);
  }
  return out;
}
const textCache = new Map();
const text = file => { if (!textCache.has(file)) textCache.set(file, readFileSync(file, "utf8")); return textCache.get(file); };
const repoRel = file => relative(REPO, file).split(sep).join("/");
const pkgRel = file => relative(PKG, file).split(sep).join("/");
const packageDirs = existsSync(join(REPO, "packages")) ? readdirSync(join(REPO, "packages")).map(name => join(REPO, "packages", name)).filter(dir => existsSync(join(dir, "package.json"))) : [];
const scanFiles = [...packageDirs.flatMap(dir => ["src", "scripts", "bin", "studio"].flatMap(sub => walk(join(dir, sub)))), ...walk(join(REPO, "scripts"))];
if (SCAN) {
  if (!existsSync(SCAN) || !statSync(SCAN).isDirectory()) fail("step.invalid", `--scan ${SCAN} is not a directory`);
  else for (const file of walk(SCAN)) if (!scanFiles.includes(file)) scanFiles.push(file);
}

// ---------------------------------------------------------------- entries
function exportsName(file, name) {
  const source = text(file);
  return new RegExp(`export\\s+(?:default\\s+)?(?:async\\s+)?(?:function\\*?|const|let|class)\\s+${name}\\b`).test(source)
    || new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(source)
    || new RegExp(`(?:module\\.)?exports\\.${name}\\s*=`).test(source);
}
const pkgScripts = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")).scripts ?? {};
const rootScripts = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).scripts ?? {};
/** Every thing a step names, resolved: [label, exists]. */
function stepRefs(step) {
  const run = step.run ?? {};
  const refs = [];
  for (const key of ["entry", "module"]) for (const ref of [run[key] ?? []].flat()) {
    const [file, name] = String(ref).split("#");
    const path = join(PKG, file);
    refs.push([`${key} ${ref}`, existsSync(path) && (!name || exportsName(path, name)), path]);
  }
  if (run.script !== undefined) refs.push([`script ${run.script}`, existsSync(join(PKG, run.script)), join(PKG, run.script)]);
  if (run.npm !== undefined) refs.push([`npm ${run.npm}`, pkgScripts[run.npm] !== undefined, null]);
  if (run.skill !== undefined) refs.push([`skill ${run.skill}`, existsSync(join(REPO, run.skill)), null]);
  return refs;
}
const entryFiles = new Map();
for (const step of steps) {
  for (const id of step.run?.steps ?? []) {
    if (!byId.has(id)) fail("entry.missing", `${step.id} composes unknown step ${id}`);
    else if (typeof byId.get(id).run?.module !== "string") fail("step.invalid", `${step.id} composes ${id}, which declares no single module entry to compose`);
  }
  const refs = stepRefs(step);
  const missing = refs.filter(([, exists]) => !exists);
  if (!isPending(step)) for (const [label] of missing) fail("entry.missing", `${step.id}: ${label} does not exist`);
  else if (step.pending.change === "adds") {
    if (refs.length > 0 && missing.length === 0 && (step.run?.cli === undefined || cliVerbsLater().has(step.run.cli.verb))) fail("entry.stale", `${step.id} is marked pending on ${step.pending.branch}, but everything it names exists; drop the pending marker`);
    else note(step.id, `${pendingWhy(step)}; not yet here: ${missing.map(([label]) => label).join(", ") || "its CLI verb"}`);
  } else {
    if (missing.length > 0) fail("entry.stale", `${step.id} is pending removal on ${step.pending.branch}, but ${missing.map(([l]) => l).join(", ")} is already gone; delete the step`);
    else note(step.id, `${pendingWhy(step)}; still runnable here`);
  }
  entryFiles.set(step.id, refs.filter(([, exists, path]) => exists && path).map(([, , path]) => path));
}

// ---------------------------------------------------------------- CLI verbs
function cliVerbs() {
  const verbs = new Set();
  const cliDir = join(PKG, "src", "cli");
  const args = existsSync(join(cliDir, "args.ts")) ? text(join(cliDir, "args.ts")) : "";
  for (const match of args.matchAll(/export const (?:VERBS|COMMANDS)\s*=\s*\[([^\]]*)\]/g)) for (const verb of match[1].matchAll(/["']([a-z][a-z-]*)["']/g)) verbs.add(verb[1]);
  for (const file of [...walk(cliDir), ...walk(join(PKG, "src", "pipeline"))]) for (const match of text(file).matchAll(/argv\[0\]\s*===\s*["']([a-z][a-z-]*)["']/g)) verbs.add(match[1]);
  // The runner hands a verb with its own parser to that step's handler: it is a verb when the parser exists and a handler is registered.
  const handlers = existsSync(join(PKG, "src", "pipeline", "handlers.ts")) ? text(join(PKG, "src", "pipeline", "handlers.ts")) : "";
  for (const step of steps) {
    const cli = step.run?.cli;
    if (cli?.parser && step.run.entry && existsSync(join(PKG, cli.parser)) && new RegExp(`["']${step.run.entry.replace(/[.$]/g, "\\$&")}["']\\s*:`).test(handlers)) verbs.add(cli.verb);
  }
  return verbs;
}
function cliVerbsLater() { return verbCache ??= cliVerbs(); }
const verbs = cliVerbsLater();
const declaredVerbs = new Map();
for (const step of steps) if (step.run?.cli?.verb) {
  const verb = step.run.cli.verb;
  declaredVerbs.set(verb, [...(declaredVerbs.get(verb) ?? []), step]);
  if (!verbs.has(verb) && !(isPending(step) && step.pending.change === "adds")) fail("verb.unknown", `${step.id} declares verb ${verb}, which the CLI does not have`);
}
for (const verb of verbs) {
  const owners = declaredVerbs.get(verb);
  if (!owners) { fail("verb.undeclared", `clossys ${verb} runs, but no step declares it`); continue; }
  const modes = new Map();
  for (const step of owners) {
    // A mode is the step's flags, plus the `<agent>/` its first argument names when the verb takes a target.
    const mode = [...(step.run.cli.flags ?? []), ...(step.run.cli.target !== undefined ? [`${step.run.cli.target}/<slot>`] : [])].join(" ") || "default";
    if (modes.has(mode)) fail("output.multiple", `clossys ${verb} (${mode}) is declared by ${modes.get(mode)} and ${step.id}`);
    modes.set(mode, step.id);
  }
}

// ---------------------------------------------------------------- options
/** Flags each parser defines, read from the parser source; `own` verbs parse their own argv. */
function parserFlags(file) {
  if (!existsSync(file)) return new Set();
  return new Set([...text(file).matchAll(/(?:case\s+|===\s*)["'](--[a-z][a-z0-9-]*)["']/g)].map(match => match[1]));
}
const SHARED_PARSER = join(PKG, "src", "cli", "args.ts");
function flagsFor(step) {
  const own = step.run?.cli?.parser;
  return parserFlags(own ? join(PKG, own) : SHARED_PARSER);
}
for (const step of steps) {
  const cli = step.run?.cli;
  if (!cli) continue;
  if (cli.parser !== undefined && !existsSync(join(PKG, cli.parser)) && !(isPending(step) && step.pending.change === "adds")) fail("entry.missing", `${step.id}: parser ${cli.parser} does not exist`);
  const known = flagsFor(step);
  if (isPending(step) && step.pending.change === "adds" && known.size === 0) continue;
  for (const flag of cli.flags ?? []) if (!known.has(flag)) fail("option.unknown", `${step.id} lists ${flag}, which ${cli.parser ?? "src/cli/args.ts"} does not define`);
}
// ---------------------------------------------------------------- seats
/** Seats are decision files, read from the workspace; a missing file or a null part is OPEN. */
const seatReports = lib ? lib.seats.readSeats(REPO, defined) : {};
for (const [id, seat] of Object.entries(seatReports)) {
  if (seat.state === "invalid") { for (const issue of seat.issues) fail("seat.invalid", `${seat.path}: ${issue.path} ${issue.message}`); continue; }
  if (seat.state === "unassigned") { open.push({ step: id, field: `seat (${seat.path} missing)` }); continue; }
  for (const part of ["llm", "human"]) if (seat[part] === "open") open.push({ step: id, field: `seat.${part}` });
  if (seat.llm !== "open" && !existsSync(join(REPO, seat.llm.promptFile))) fail("seat.invalid", `${seat.path}: llm.promptFile ${seat.llm.promptFile} does not exist`);
  if (seat.human === "open") continue;
  const [, verb, ...rest] = seat.human.command.split(/\s+/);
  const owners = steps.filter(other => other.run?.cli?.verb === verb);
  if (!verbs.has(verb) && !owners.some(owner => isPending(owner) && owner.pending.change === "adds")) { fail("seat.invalid", `${seat.path}: human.command runs clossys ${verb}, which no CLI or pending step defines`); continue; }
  const flags = new Set(owners.flatMap(owner => [...flagsFor(owner)]));
  if (owners.every(owner => isPending(owner)) && flags.size === 0) continue;
  for (const flag of rest.filter(word => word.startsWith("--"))) if (!flags.has(flag)) fail("option.unknown", `${seat.path}: human.command uses ${flag}, which the clossys ${verb} parser does not define`);
}
/** W4: a pick seat's llm is its agent's make step's llm (seats.ts llmSourceOf); open on both sides is the same. */
if (lib) for (const [id, seat] of Object.entries(seatReports)) {
  const source = lib.seats.llmSourceOf(id);
  if (!source || seat.state === "invalid") continue;
  const made = seatReports[source];
  if (!made) { fail("seat.invalid", `${seat.path}: its llm comes from the make step ${source}, which is not a decide step`); continue; }
  if (made.state !== "invalid" && JSON.stringify(seat.llm) !== JSON.stringify(made.llm)) fail("seat.invalid", `${seat.path}: llm ${JSON.stringify(seat.llm)} differs from the make step ${source} llm ${JSON.stringify(made.llm)}; a pick seat uses its agent's make llm`);
}
/** WHO: every step's holder is a roster entry (the canvas's lanes are the roster); an unresolved holder is OPEN. */
if (lib) for (const step of defined) {
  const holder = lib.roster.holderOf(step, seatReports[step.id]);
  if (holder.id === lib.roster.UNASSIGNED) open.push({ step: step.id, field: "holder (no seat file, and its kind and actor name no roster entry)" });
  else if (!lib.roster.isRostered(holder.id)) fail("lane.unrostered", `step ${JSON.stringify(step.id)}: its holder ${holder.id} (${holder.source === "file" ? `${seatReports[step.id]?.path} by` : "derived from its actor"}) is not a roster entry (${lib.roster.ROSTER.join(", ")})`);
}
const seatDir = join(REPO, "clossys", "agents", "producer");
if (existsSync(seatDir)) for (const name of readdirSync(seatDir)) {
  if (!statSync(join(seatDir, name)).isDirectory()) continue;
  const step = byId.get(name);
  if (!step || !isDecide(step)) fail("seat.invalid", `clossys/agents/producer/${name}/ has a seat, but ${step ? "that step is plumb" : "no step has that id"}`);
}
/** The seat kind's IA (producer ia.json) places each seat under its step's round (L1) and stage (L2). */
const seatIa = join(seatDir, "ia.json");
if (existsSync(seatIa)) {
  let ia;
  try { ia = JSON.parse(readFileSync(seatIa, "utf8")); } catch { fail("seat.invalid", "clossys/agents/producer/ia.json is not JSON"); }
  for (const node of Array.isArray(ia?.nodes) ? ia.nodes : []) for (const child of Array.isArray(node?.children) ? node.children : []) for (const id of Array.isArray(child?.slots) ? child.slots : []) {
    const step = byId.get(id);
    if (!step || !isDecide(step)) { fail("seat.invalid", `clossys/agents/producer/ia.json places ${id}, which is not a decide step`); continue; }
    if (node.id !== step.stage.split(".")[0] || child.id !== step.stage) fail("seat.invalid", `clossys/agents/producer/ia.json places ${id} under ${node.id}/${child.id}; its step's stage is ${step.stage}`);
  }
}

// ---------------------------------------------------------------- runner
const RUNNER = join(PKG, "src", "pipeline", "runner.ts");
const HANDLERS = join(PKG, "src", "pipeline", "handlers.ts");
const main = join(PKG, "src", "cli", "main.ts");
if (!existsSync(RUNNER) || !existsSync(HANDLERS)) fail("runner.bypass", "src/pipeline/runner.ts and src/pipeline/handlers.ts must exist; the CLI runs steps only through them");
if (existsSync(main) && !/from\s+["']\.\.\/pipeline\/runner\.js["']/.test(text(main))) fail("runner.bypass", "src/cli/main.ts does not dispatch through ../pipeline/runner.js");
/** Importing a step's entry function (or the whole module) anywhere in the CLI except handlers.ts runs it around the pipeline runner. */
const cliEntries = new Map();
for (const step of steps.filter(step => step.run?.cli && step.run?.entry)) {
  const [file, name] = step.run.entry.split("#");
  const path = join(PKG, file);
  cliEntries.set(path, new Set([...(cliEntries.get(path) ?? []), name]));
}
for (const file of [...walk(join(PKG, "src", "cli")), ...walk(join(PKG, "src", "pipeline"))]) {
  if (file === HANDLERS) continue;
  for (const match of text(file).matchAll(/import\s+(type\s+)?([^'";]*?)\s+from\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    if (match[1]) continue;
    const target = resolveImport(file, match[3] ?? match[4]);
    if (!target || target === file || !cliEntries.has(target)) continue;
    const clause = match[2] ?? "*";
    const named = /^\{([^}]*)\}$/.exec(clause.trim());
    const names = named ? named[1].split(",").map(part => part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]).filter(Boolean) : null;
    const hit = names === null ? [...cliEntries.get(target)] : names.filter(name => cliEntries.get(target).has(name));
    if (hit.length) fail("runner.bypass", `${pkgRel(file)} imports ${hit.join(", ")} from step entry ${pkgRel(target)}; only src/pipeline/handlers.ts may`);
  }
}
if (existsSync(HANDLERS)) {
  const handlerKeys = new Set([...text(HANDLERS).matchAll(/["'](src\/[^"'#]+#[A-Za-z_$][\w$]*)["']\s*:/g)].map(m => m[1]));
  const composed = new Set(steps.flatMap(step => step.run?.steps ?? []));
  const runnable = new Set(steps.filter(step => !isPending(step)).flatMap(step => [step.run?.cli ? step.run.entry : undefined, composed.has(step.id) ? step.run?.module : undefined].filter(Boolean)));
  for (const key of handlerKeys) if (!steps.some(step => step.run?.entry === key || [step.run?.module ?? []].flat().includes(key))) fail("runner.bypass", `handlers.ts can run ${key}, which no step declares`);
  for (const key of runnable) if (!handlerKeys.has(key)) fail("entry.missing", `no handler is registered for ${key}`);
}

// ---------------------------------------------------------------- checks
const checkIds = new Set(Object.keys(checks));
const referenced = new Set(steps.flatMap(step => step.checks ?? []));
for (const step of steps) for (const id of step.checks ?? []) if (!checkIds.has(id)) fail("check.unknown", `${step.id} cites check ${id}, which the checks registry lacks`);
const declaredScripts = new Set();
const declaredNpm = new Set();
const declaredRootNpm = new Set();
for (const [id, check] of Object.entries(checks)) {
  const pendingCheck = check?.pending !== undefined;
  if (!referenced.has(id)) fail("check.orphan", `check ${id} is declared, but no step runs it`);
  for (const file of check?.files ?? []) {
    declaredScripts.add(file);
    if (!existsSync(join(PKG, file)) && !pendingCheck) fail("entry.missing", `check ${id}: ${file} does not exist`);
  }
  for (const name of check?.npm ?? []) {
    declaredNpm.add(name);
    if (pkgScripts[name] === undefined && !pendingCheck) fail("entry.missing", `check ${id}: npm script ${name} does not exist`);
  }
  for (const name of check?.rootNpm ?? []) {
    declaredRootNpm.add(name);
    if (rootScripts[name] === undefined && !pendingCheck) fail("entry.missing", `check ${id}: root npm script ${name} does not exist`);
  }
  if (check?.cli !== undefined && !verbs.has(check.cli)) fail("entry.missing", `check ${id}: CLI verb ${check.cli} does not exist`);
  if (pendingCheck) {
    const present = [...(check.files ?? []).filter(file => existsSync(join(PKG, file))), ...(check.npm ?? []).filter(name => pkgScripts[name] !== undefined)];
    if (present.length > 0 && present.length === (check.files ?? []).length + (check.npm ?? []).length) fail("entry.stale", `check ${id} is pending on ${check.pending.branch}, but it exists here; drop the pending marker`);
    else note(`check:${id}`, `pending: lands on ${check.pending.branch}`);
  }
}
const CHECK_SCRIPT = /^(check|studio|test|capture|generate):/;
for (const file of [...walk(join(PKG, "scripts")), ...walk(join(PKG, "studio", "checks"))].map(pkgRel)) {
  const isCheck = file.startsWith("studio/checks/") || /^scripts\/(check|compose|capture)-/.test(file);
  if (isCheck && !declaredScripts.has(file) && !steps.some(step => step.run?.script === file)) fail("check.undeclared", `${file} is a check script no defineCheck declares`);
}
for (const name of Object.keys(pkgScripts)) if (CHECK_SCRIPT.test(name) && !declaredNpm.has(name) && !steps.some(step => step.run?.npm === name)) fail("check.undeclared", `npm run ${name} (packages/producer) is not declared by a defineCheck`);
for (const [name, command] of Object.entries(rootScripts)) if (!name.startsWith("//") && command.includes(PKG_REL) && !declaredRootNpm.has(name)) fail("check.undeclared", `root npm run ${name} runs producer code but is not declared by a defineCheck`);

// ---------------------------------------------------------------- import graph
function importSpecifiers(source) {
  const specs = new Set();
  for (const match of source.matchAll(/(?:^|[\s;])(?:import|export)\s[^'"`;]*?from\s*["']([^"']+)["']/gm)) specs.add(match[1]);
  for (const match of source.matchAll(/(?:^|[\s;])import\s*["']([^"']+)["']/gm)) specs.add(match[1]);
  for (const match of source.matchAll(/\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g)) specs.add(match[1]);
  return specs;
}
function resolveImport(from, spec) {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(from), spec);
  const stems = [base, base.replace(/\.(m|c)?js$/, "")];
  for (const stem of stems) for (const ext of ["", ".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", "/index.ts", "/index.js"]) {
    const candidate = stem + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}
const MODEL_CLIENT = /^(@anthropic-ai\/|anthropic$|openai$|@openai\/|@ai-sdk\/|ai$|@google\/generative-ai|@google\/genai|@mistralai\/|cohere-ai$|ollama$|@langchain\/|langchain$|@modelcontextprotocol\/)/;
const MODEL_SPAWN = /\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\(\s*["'`](?:claude|codex|cursor-agent|openai|anthropic|gemini|ollama)\b/;
const MODEL_HOST = /api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis\.com/;
function workspacePackageDeps(spec) {
  const match = /^@clossys\/([a-z0-9-]+)/.exec(spec);
  if (!match) return [];
  const manifestPath = join(REPO, "packages", match[1], "package.json");
  if (!existsSync(manifestPath)) return [];
  const pkg = JSON.parse(readFileSync(manifestPath, "utf8"));
  return Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies });
}
function graph(entries) {
  const seen = new Set();
  const external = new Set();
  const stack = [...entries];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of importSpecifiers(text(file))) {
      const target = resolveImport(file, spec);
      if (target) stack.push(target);
      else if (!spec.startsWith(".")) external.add(spec);
    }
  }
  return { files: seen, external };
}
const graphs = new Map(steps.map(step => [step.id, graph(entryFiles.get(step.id) ?? [])]));
for (const step of steps.filter(step => step.kind === "plumb")) {
  const { files, external } = graphs.get(step.id);
  for (const spec of external) {
    if (MODEL_CLIENT.test(spec)) fail("plumb.model-client", `${step.id} (plumb) imports model client ${spec}`);
    for (const dep of workspacePackageDeps(spec)) if (MODEL_CLIENT.test(dep)) fail("plumb.model-client", `${step.id} (plumb) imports ${spec}, which depends on model client ${dep}`);
  }
  for (const file of files) {
    if (MODEL_SPAWN.test(text(file))) fail("plumb.model-client", `${step.id} (plumb) reaches ${repoRel(file)}, which spawns an agent CLI`);
    if (MODEL_HOST.test(text(file))) fail("plumb.model-client", `${step.id} (plumb) reaches ${repoRel(file)}, which calls a model API host`);
  }
}

// ---------------------------------------------------------------- decision writers
/** A write's path argument names a decision file when it holds the marker literal or a value derived from it. */
const WRITE_CALL = /\b(writeFileSync|writeFile|appendFileSync|appendFile|copyFileSync|copyFile|cpSync|cp|renameSync|rename|rmSync|rm|unlinkSync|unlink|createWriteStream|outputFile|outputJson|writeJson|openSync|open)\s*\(/g;
const IDENT = /[A-Za-z_$][\w$]*/g;
function callArgs(source, start) {
  let depth = 0; let quote = null; let current = ""; const args = [];
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (quote) { current += c; if (c === "\\") { current += source[++i] ?? ""; continue; } if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === "`") { quote = c; current += c; continue; }
    if ("([{".includes(c)) depth++;
    if (")]}".includes(c)) { if (depth === 0) { args.push(current); return args; } depth--; }
    if (c === "," && depth === 0) { args.push(current); current = ""; continue; }
    current += c;
  }
  return args;
}
/** The file or directory name a write must spell: the last literal segment, followed by at most one wildcard segment. */
const markerOf = glob => {
  const [path] = splitField(toRepoGlob(glob));
  const segments = path.split("/");
  const last = segments.findLastIndex(segment => !/[*?{]/.test(segment));
  return last >= 0 && segments.length - last <= 2 && !segments.slice(last + 1).includes("**") ? segments[last] : null;
};
const decideOutputs = [];
for (const step of steps.filter(isDecide)) for (const output of step.outputs) {
  if (output.startsWith("arg:")) continue;
  const marker = markerOf(output);
  if (marker && marker !== "clossys") decideOutputs.push({ step, output, marker, field: splitField(output)[1] });
  else unscanned.push({ step: step.id, output });
}
const markers = [...new Set(decideOutputs.map(item => item.marker))];
const quoted = marker => new RegExp(`["'\`/]${marker.replace(/[.+^$()|[\]\\]/g, "\\$&")}["'\`/]`);
/** Exported constants and one-line helpers that carry a marker, across every scanned file. */
const taint = new Map(markers.map(marker => [marker, new Set()]));
for (const marker of markers) {
  const names = taint.get(marker);
  const literal = quoted(marker);
  for (let changed = true; changed;) {
    changed = false;
    for (const file of scanFiles) for (const line of text(file).split("\n")) {
      const match = /^\s*export\s+const\s+([A-Za-z_$][\w$]*)/.exec(line);
      if (!match || names.has(match[1])) continue;
      const rest = line.slice(match.index + match[0].length);
      if (literal.test(rest) || [...rest.matchAll(IDENT)].some(id => names.has(id[0]))) { names.add(match[1]); changed = true; }
    }
  }
}
/**
 * Where a write lands. Only a write whose resolved real path is inside the repository root is a
 * repository write; a scratch copy under os.tmpdir() is not. A path argument is traced to an
 * absolute location only through tmpdir(), an absolute string literal, mkdtemp of a traced prefix,
 * join/resolve of a traced base with plain relative literals (no ".."), a template literal
 * `${base}/literal`, and a const declared once in the file that is never reassigned or shadowed by a
 * parameter, loop variable or destructured name, and holds one of these. Anything else (the module's own
 * directory, process.cwd(), a --root argument) is untraced and judged as a repository write.
 */
function realLocation(path) {
  let head = resolve(path);
  const rest = [];
  while (!existsSync(head)) {
    const parent = dirname(head);
    if (parent === head) break;
    rest.unshift(basename(head));
    head = parent;
  }
  try { return join(realpathSync(head), ...rest); } catch { return resolve(path); }
}
const REPO_REAL = realLocation(REPO);
const insideRepo = path => { const real = realLocation(path); return real === REPO_REAL || real.startsWith(REPO_REAL + sep); };
const PLAIN_RELATIVE = /^(["'])((?!\/)(?:(?!\1)[^\\$`])*)\1$/;
const plainRelative = arg => { const match = PLAIN_RELATIVE.exec(arg.trim()); return match && !match[2].split("/").includes("..") ? match[2] : null; };
/** `callee(args)` when the whole expression is one call, else null. */
function wholeCall(expr) {
  const match = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/.exec(expr);
  if (!match) return null;
  let depth = 0; let quote = null;
  for (let i = match[0].length - 1; i < expr.length; i++) {
    const c = expr[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === "`") { quote = c; continue; }
    if (c === "(") depth++;
    if (c === ")" && --depth === 0) return i === expr.length - 1 ? { callee: match[1], args: callArgs(expr, match[0].length) } : null;
  }
  return null;
}
/** The absolute path an expression stands for, or null when it cannot be traced. */
function locate(expr, names) {
  const source = expr.trim().replace(/^await\s+/, "");
  if (/^(?:os\.)?tmpdir\(\s*\)$/.test(source)) return tmpdir();
  if (/^[A-Za-z_$][\w$]*$/.test(source)) return names.get(source) ?? null;
  const absolute = /^(["'])(\/(?:(?!\1)[^\\$`])*)\1$/.exec(source);
  if (absolute) return absolute[2].split("/").includes("..") ? null : absolute[2];
  const template = /^`\$\{([^{}`]+)\}((?:\/[^`$\\]*)?)`$/.exec(source);
  if (template) {
    const base = locate(template[1], names);
    return base && !template[2].split("/").includes("..") ? join(base, template[2]) : null;
  }
  const call = wholeCall(source);
  if (!call || !call.args.length) return null;
  if (/^(?:[A-Za-z_$][\w$]*\.)?mkdtemp(?:Sync)?$/.test(call.callee)) {
    // mkdtemp creates a fresh directory beside its prefix; the placeholder stands for the random suffix.
    const prefix = locate(call.args[0], names);
    return prefix ? `${prefix}XXXXXX` : null;
  }
  if (/^(?:(?:path|posix|nodePath)\.)?(?:join|resolve)$/.test(call.callee)) {
    const base = locate(call.args[0], names);
    const rest = call.args.slice(1).map(plainRelative);
    return base && rest.every(part => part !== null) ? join(base, ...rest) : null;
  }
  return null;
}
/** Locations of a file's traceable consts (the comment above realLocation says what is traced). */
function locations(source) {
  const shadowed = new Set();
  const identifiers = list => { for (const id of list.matchAll(IDENT)) shadowed.add(id[0]); };
  for (const match of source.matchAll(/\(([^()]*)\)\s*(?:\{|=>)/g)) identifiers(match[1]);
  for (const match of source.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) shadowed.add(match[1]);
  for (const match of source.matchAll(/\b(?:const|let|var)\s*[{[]([^=]*)=/g)) identifiers(match[1]);
  for (const match of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+(?:of|in)\b/g)) shadowed.add(match[1]);
  for (const match of source.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) shadowed.add(match[1]);
  const declared = new Map();
  for (const match of source.matchAll(/\b(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]*)/g)) {
    declared.set(match[2], declared.has(match[2]) ? null : match[1] === "const" ? match[3] : null);
  }
  const assigned = name => [...source.matchAll(new RegExp(`(?<![\\w$.])${name.replace(/\$/g, "\\$")}\\s*(?:[-+*/%&|^]|\\*\\*|<<|>>>?|&&|\\|\\||\\?\\?)?=(?![=>])`, "g"))].length > 1
    || new RegExp(`(?:\\+\\+|--)${name.replace(/\$/g, "\\$")}\\b|(?<![\\w$])${name.replace(/\$/g, "\\$")}(?:\\+\\+|--)`).test(source);
  const names = new Map();
  for (let changed = true; changed;) {
    changed = false;
    for (const [name, value] of declared) {
      if (names.has(name) || value === null || shadowed.has(name) || assigned(name)) continue;
      const at = locate(value, names);
      if (at !== null) { names.set(name, at); changed = true; }
    }
  }
  return names;
}
/** True when an expression's traced location is outside the repository root. */
const outsideRepo = (expr, names) => { const at = locate(expr, names); return at !== null && !insideRepo(at); };
/**
 * Files that write each marker, with a local taint fixpoint and write wrappers. A local name is
 * tainted by a declaration whose value spells the marker, calls a tainted exported helper, or
 * reads (not calls) a tainted local. Outside this package a bare literal does not count: the
 * write must go through this package's layout helpers or spell a path under clossys/. A write
 * whose path traces to a location outside the repository root is not a writer.
 */
function writersOf(marker) {
  const ownLiteral = quoted(marker);
  const workspaceLiteral = new RegExp(`["'\`]clossys/[^"'\`]*${marker.replace(/[.+^$()|[\]\\]/g, "\\$&")}`);
  const global = taint.get(marker);
  const writers = new Set();
  const mentions = (expr, local, inPackage) => (inPackage ? ownLiteral.test(expr) : workspaceLiteral.test(expr))
    || [...expr.matchAll(IDENT)].some(id => global.has(id[0]) || (local.has(id[0]) && !/^\s*\(/.test(expr.slice(id.index + id[0].length))));
  for (const file of scanFiles) {
    const source = text(file);
    const inPackage = file.startsWith(PKG + sep);
    if (!(inPackage ? ownLiteral : workspaceLiteral).test(source) && ![...source.matchAll(IDENT)].some(id => global.has(id[0]))) continue;
    const local = new Set();
    for (let changed = true; changed;) {
      changed = false;
      for (const match of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]*)/g)) {
        if (local.has(match[1])) continue;
        if (mentions(match[2], local, inPackage)) { local.add(match[1]); changed = true; }
      }
    }
    // A function whose own parameter reaches a write is a write wrapper.
    const wrappers = new Set();
    for (const match of source.matchAll(/(?:function\s+([A-Za-z_$][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(\s*([A-Za-z_$][\w$]*))/g)) {
      const name = match[1] ?? match[3]; const param = match[2] ?? match[4];
      const body = source.slice(match.index, match.index + 1200);
      for (const call of body.matchAll(WRITE_CALL)) if ((callArgs(body, call.index + call[0].length)[0] ?? "").trim() === param) wrappers.add(name);
    }
    const isWrite = (name, args) => {
      if (name === "open" || name === "openSync") return /["'`][wa]x?\+?["'`]|O_WRONLY|O_CREAT|O_RDWR|O_TRUNC/.test(args.slice(1).join(","));
      if (name === "rm" || name === "rmSync") return true;
      return true;
    };
    const names = locations(source);
    const calls = [...source.matchAll(WRITE_CALL)].map(call => [call[1], call.index + call[0].length]);
    for (const name of wrappers) for (const call of source.matchAll(new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\s*\\(`, "g"))) calls.push([name, call.index + call[0].length]);
    for (const [name, at] of calls) {
      if (source[at - name.length - 2] === ".") { /* method on an object: still a write when its path is a decision file */ }
      const args = callArgs(source, at);
      if (!isWrite(name, args)) continue;
      const paths = ["cp", "cpSync", "copyFile", "copyFileSync", "rename", "renameSync"].includes(name) ? args.slice(0, 2) : args.slice(0, 1);
      if (paths.some(arg => mentions(arg, local, inPackage) && !outsideRepo(arg, names))) { writers.add(file); break; }
    }
  }
  return writers;
}
const writerCache = new Map();
for (const { step, output, marker } of decideOutputs) {
  if (!writerCache.has(marker)) writerCache.set(marker, writersOf(marker));
  const owners = steps.filter(other => other.outputs?.some(out => markerOf(out) === marker));
  const ownGraph = graphs.get(step.id)?.files ?? new Set();
  const legit = new Set([...owners.flatMap(owner => [...(graphs.get(owner.id)?.files ?? [])])]);
  const removed = new Set(steps.filter(s => s.pending?.change === "removes").flatMap(s => [...(graphs.get(s.id)?.files ?? [])]));
  const foreign = [...writerCache.get(marker)].filter(file => !legit.has(file));
  const dueToRemoval = foreign.filter(file => removed.has(file));
  const hard = foreign.filter(file => !removed.has(file));
  if (dueToRemoval.length) note(step.id, `${output} is also written by ${dueToRemoval.map(repoRel).join(", ")}, removed by a pending step`);
  if (hard.length === 0) continue;
  if (isPending(step)) note(step.id, `${output} has no landed CLI yet (${pendingWhy(step)}); current writers: ${hard.map(repoRel).join(", ")}`);
  else fail("decide.foreign-writer", `${step.id} (decide) owns ${output}, but ${hard.map(repoRel).join(", ")} can write it outside ${[...ownGraph].length ? "the step's declared entry" : "any declared entry"}`);
}

report();
