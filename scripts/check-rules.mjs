#!/usr/bin/env node
/**
 * check:rules: every owner rule is code, not prose. scripts/rules/registry.json lists each rule with the
 * owner's words, the checks that enforce it and a minimal violation fixture each check must fail
 * on. This meta-check fails when:
 *
 *   unenforced           a rule has `status: "unenforced"`, or claims enforcement with no check;
 *   unwired              a rule has `status: "pending-wire"`: its check is being built on the branch
 *                        named in `pending_wire` and is not wired here yet (still a failing rule);
 *   unknown-check        a listed check names no package script or no check:studio sub-check;
 *   unreachable          a listed check is not reachable from root `check`/`test`
 *                        (the scripts/check-orphan-checks.mjs graph), counting a step after
 *                        check:rules in an `&&` chain as unreached whenever check:rules has findings;
 *   fixture-missing      an enforcing check has no fixture run, or its fixture path is absent;
 *   fixture-passed       a check exits 0 (or not with the expected code) on its fixture;
 *   fixture-not-detected a check fails on its fixture without reporting the expected violation;
 *   fixture-unrelated    a fixture run executes none of the files the listed check's own commands
 *                        name (sharing a library file the check imports is not enough);
 *   unmapped             a check:studio sub-check or root meta-check maps to no rule (directly or
 *                        through a package script its command runs) and has no exemption;
 *   exemption-*          an exemption is malformed, names no governed check, or is also mapped;
 *   shape                a registry row breaks scripts/rules/registry.schema.json (`expect_exit`, when
 *                        given, is an exit code 1-255: a fixture run expecting 0 proves nothing), or
 *                        the registry falls below RULE_FLOOR: a rule row it lists is gone, or a check
 *                        it lists no longer enforces that rule;
 *   fixture-missing      also: an enforcing check has fewer fixture runs than RULE_FLOOR records;
 *   unknown-check        also: a root script in ROOT_SCRIPT_FLOOR (`check`, `test`, the meta-checks)
 *                        is gone from the root package.json.
 *
 * The floor is code, not registry data, so the pre-push ratchet's overlay applies it to the base and
 * the head alike: deleting a rule, an enforcing check, a fixture run or a root script is a finding
 * until the floor itself is lowered in a reviewed code change. It is a lower bound: new rules,
 * checks and fixture runs need no floor entry.
 *
 * A check reference is `<package dir>#<npm script>` (root dir ".") or `check:studio#<sub-check id>`.
 * Fixture runs execute `run` with /bin/sh in `<root>/<cwd>`; `{fixture}` becomes the absolute fixture
 * path and `{out}` a fresh temporary directory. Nothing is skipped: every fixture run runs.
 *
 * Usage: node scripts/check-rules.mjs [--root DIR] [--json]
 * Exit 0 when every rule is enforced and every check is mapped, 1 on any finding, 2 on a read error.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { reachable, repositoryFiles, workspaces } from "./check-orphan-checks.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const REGISTRY = "scripts/rules/registry.json";
export const STUDIO_MANIFEST = "packages/producer/scripts/check-studio.json";
export const STUDIO_SCRIPT = "packages/producer#check:studio";
/** Root scripts that are themselves rule checks and must map to a rule. */
export const META_CHECKS = Object.freeze(["check:orphan-checks", "check:rules"]);
const SUB = "check:studio#";
/** This meta-check's own script: it exits 1 whenever it reports a finding. */
const SELF = ".#check:rules";
const ID = /^R-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CODE = /\.(?:mjs|cjs|js|jsx|ts|tsx|mts|cts)$/;

/**
 * Registry floor: every rule id the registry must keep, and for each enforced rule the checks that
 * must keep enforcing it with at least this many fixture runs each. Raise it as rules land; lower it
 * only together with the reviewed removal.
 */
export const RULE_FLOOR = Object.freeze({
  "R-ASSEMBLE-ONLY": { "packages/producer#check:assemble-only": 1, "check:studio#producer check-no-page-jsx": 1 },
  "R-DS-ONLY": {},
  "R-SHADCN-STOCK": { "packages/designer#check:ref-verbatim": 4 },
  "R-VENDORED-SOURCES": { "packages/designer#check:provenance": 1 },
  "R-WRITER-COPY": {},
  "R-CONTENT-MAP": { "packages/producer#check:studio-map": 1 },
  "R-FLAT-SLOTS": {},
  "R-SLOT-PINS": {},
  "R-ONE-BRAND": {},
  "R-STUDIO-CARD-DETAIL": { "packages/producer#check:studio-template": 1 },
  "R-REAL-SPECIMENS": {},
  "R-USAGE-GRAPH": {},
  "R-CLI-DETERMINISTIC": {},
  "R-CHECKS-WIRED": { ".#check:orphan-checks": 1, ".#check:rules": 1 },
  "R-NO-HIDDEN-FALLBACKS": {},
  "R-SLOT-STATE": {},
  "R-COMPILE-PURE": {},
  "R-DECISIONS-BY-CLI": { ".#check:decisions": 1 },
  "R-GIT-CMS": { ".#check:git-cms": 4 },
  "R-SLOT-OPTIONS": { ".#check:slot-options": 1 },
  "R-PIPELINE-IS-CODE": { ".#check:pipeline": 4 },
  "R-PIPELINE-CANVAS": { ".#check:pipeline-canvas": 10 },
  "R-ROUTES-PUBLISHED": { "packages/producer#check:routes-published": 5, "packages/producer#check:studio-routes": 2, "packages/producer#check:route-parity": 2 },
  "R-SINGLE-READER": { ".#check:single-reader": 1 },
  "R-PIN-PROPAGATION": { ".#check:pin-propagation": 1 },
  "R-EVERY-CANDIDATE-PREVIEWABLE": { ".#check:every-candidate-previewable": 1 },
});
/** Root scripts that must exist: the two entries every reachability trace starts from, and the meta-checks. */
export const ROOT_SCRIPT_FLOOR = Object.freeze(["check", "test", ...META_CHECKS]);
export const DEFAULT_FLOOR = Object.freeze({ rules: RULE_FLOOR, scripts: ROOT_SCRIPT_FLOOR });
/** The repository the floor belongs to (its root package name). */
export const FLOOR_REPOSITORY = "foundry-packages";
/**
 * The floor binds this repository: a root named FLOOR_REPOSITORY, or a registry that still lists any
 * floored rule (so emptying the registry and renaming the root at once is the only way out, and both
 * are visible). Other repositories, such as the throwaway trees tests build, carry their own rules.
 */
export function floorApplies(doc, rootManifest, floor = DEFAULT_FLOOR) {
  return rootManifest?.name === FLOOR_REPOSITORY || (doc?.rules ?? []).some(row => Object.hasOwn(floor.rules ?? {}, row?.id));
}
const validExit = code => Number.isInteger(code) && code >= 1 && code <= 255;

const readJson = path => JSON.parse(readFileSync(path, "utf8"));
const oneLine = text => typeof text === "string" && text.trim() !== "" && !/\n/.test(text);

/** Shape findings for one registry document (the schema in scripts/rules/registry.schema.json, by hand). */
export function shapeFindings(doc) {
  const out = [];
  const bad = (id, message) => out.push({ rule: "shape", id, message });
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.rules)) { bad(REGISTRY, "expected { rules: [...], exemptions: [...] }"); return out; }
  const seen = new Set();
  for (const row of doc.rules) {
    const id = typeof row?.id === "string" ? row.id : "(no id)";
    if (!ID.test(id)) bad(id, "id must look like R-NAME");
    if (seen.has(id)) bad(id, "listed twice");
    seen.add(id);
    if (!oneLine(row?.owner_words?.quote) || row.owner_words.quote.length > 200) bad(id, "owner_words.quote must be one short line");
    if (!DATE.test(row?.owner_words?.date ?? "")) bad(id, "owner_words.date must be YYYY-MM-DD");
    if (!["enforced", "unenforced", "pending-wire"].includes(row?.status)) bad(id, 'status must be "enforced", "unenforced" or "pending-wire"');
    if (row?.status === "pending-wire" && (!oneLine(row?.pending_wire?.check) || !oneLine(row?.pending_wire?.branch))) bad(id, "a pending-wire rule needs pending_wire { check, branch }");
    for (const key of ["checks", "related"]) if (row?.[key] !== undefined && (!Array.isArray(row[key]) || row[key].some(ref => typeof ref !== "string"))) bad(id, `${key} must be a list of check references`);
    if (row?.status === "enforced" && typeof row?.fixture !== "string") bad(id, "an enforced rule needs a fixture path");
    if (row?.status === "unenforced" && !oneLine(row?.note)) bad(id, "an unenforced rule needs a one-line note saying what is missing");
    for (const run of row?.fixture_runs ?? []) {
      if (typeof run?.check !== "string" || typeof run?.run !== "string" || typeof run?.cwd !== "string" || typeof run?.expect !== "string") bad(id, "a fixture run needs check, cwd, run and expect");
      else { try { new RegExp(run.expect, "m"); } catch { bad(id, `fixture run expect is not a regular expression: ${run.expect}`); } }
      if (run && run.expect_exit !== undefined && !validExit(run.expect_exit)) bad(id, `fixture run expect_exit must be an exit code 1-255, not ${JSON.stringify(run.expect_exit)}: a check that exits 0 on its fixture enforces nothing`);
    }
  }
  if (doc.exemptions !== undefined && !Array.isArray(doc.exemptions)) bad(REGISTRY, "exemptions must be a list");
  return out;
}

/** Findings for a registry (and root manifest) that fell below the floor. */
export function floorFindings(doc, rootManifest, floor = DEFAULT_FLOOR) {
  const out = [];
  const rows = new Map((doc?.rules ?? []).map(row => [row?.id, row]));
  for (const [id, checks] of Object.entries(floor.rules ?? {})) {
    const row = rows.get(id);
    if (!row) { out.push({ rule: "shape", id, message: `rule row removed: ${id} is in the registry floor (RULE_FLOOR in scripts/check-rules.mjs); retire a rule by lowering the floor in code` }); continue; }
    for (const [ref, min] of Object.entries(checks)) {
      if (!(row.checks ?? []).includes(ref)) { out.push({ rule: "shape", id, message: `${ref} no longer enforces ${id}, but RULE_FLOOR lists it` }); continue; }
      const runs = (row.fixture_runs ?? []).filter(run => run?.check === ref).length;
      if (runs < min) out.push({ rule: "fixture-missing", id, message: `${ref} has ${runs} fixture run(s); RULE_FLOOR records ${min}` });
    }
  }
  for (const name of floor.scripts ?? []) {
    if (typeof rootManifest?.scripts?.[name] !== "string") out.push({ rule: "unknown-check", id: `.#${name}`, message: `root script ${name} is gone from package.json, but ROOT_SCRIPT_FLOOR lists it` });
  }
  return out;
}

/** The trace entry a check reference runs from: an npm script or a check:studio sub-check command. */
function entryOf(ref, packages, subChecks) {
  if (ref.startsWith(SUB)) {
    const sub = subChecks.get(ref.slice(SUB.length));
    return sub ? { cwd: sub.cwd ?? ".", run: sub.run } : undefined;
  }
  const at = ref.lastIndexOf("#");
  if (at <= 0) return undefined;
  const dir = ref.slice(0, at), script = ref.slice(at + 1);
  return typeof packages.get(dir)?.scripts?.[script] === "string" ? { dir, script } : undefined;
}

function runFixture(command, cwd, timeoutMs) {
  return new Promise(accept => {
    const child = spawn("/bin/sh", ["-c", command], { cwd, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let output = "";
    const collect = chunk => { output += chunk; if (output.length > 4_000_000) output = output.slice(-2_000_000); };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => { output += `\ncheck:rules: timed out after ${timeoutMs / 1000}s\n`; try { process.kill(-child.pid, "SIGTERM"); } catch {} }, timeoutMs);
    child.on("close", code => { clearTimeout(timer); accept({ code: code ?? 1, output }); });
  });
}

const fill = (text, fixture, out) => text.replaceAll("{fixture}", fixture).replaceAll("{out}", out);

export async function ruleFindings(root, { timeoutMs = 600_000, log = () => {}, floor = DEFAULT_FLOOR } = {}) {
  const path = join(root, REGISTRY);
  if (!existsSync(path)) throw new Error(`${REGISTRY} is missing`);
  const doc = readJson(path);
  const findings = shapeFindings(doc);
  if (findings.some(finding => finding.id === REGISTRY)) return { rules: 0, enforced: 0, findings };
  const add = (rule, id, message) => findings.push({ rule, id, message });
  const packages = workspaces(root);
  if (floorApplies(doc, packages.get("."), floor)) findings.push(...floorFindings(doc, packages.get("."), floor));
  const files = repositoryFiles(root);
  const wiring = [];
  const subChecks = new Map(existsSync(join(root, STUDIO_MANIFEST)) ? (readJson(join(root, STUDIO_MANIFEST)).checks ?? []).map(check => [check.id, check]) : []);
  const traces = new Map();
  const trace = async (key, entry) => {
    if (!traces.has(key)) traces.set(key, await reachable(root, { entries: [entry], files }));
    return traces.get(key);
  };

  const listed = new Set();
  let enforced = 0;
  for (const row of doc.rules) {
    const refs = [...(row.checks ?? []), ...(row.related ?? [])];
    for (const ref of refs) {
      listed.add(ref);
      const entry = entryOf(ref, packages, subChecks);
      if (!entry) { add("unknown-check", row.id, `${ref} names no package script or check:studio sub-check`); continue; }
      wiring.push({ id: row.id, ref });
    }
    if (row.status === "unenforced") { add("unenforced", row.id, row.note ?? "no check enforces this rule"); continue; }
    if (row.status === "pending-wire") {
      const { check, branch } = row.pending_wire;
      const present = [...packages].filter(([, manifest]) => typeof manifest?.scripts?.[check] === "string").map(([dir]) => dir);
      add("unwired", row.id, `${check} is pending wire from ${branch}; ${present.length ? `it now exists in ${present.join(", ")}: list it in checks with a fixture and set status enforced` : "it is not on this branch yet"}`);
      continue;
    }
    if (!(row.checks ?? []).length) { add("unenforced", row.id, "status is enforced but no check is listed"); continue; }
    let held = true;
    const fixtureRoot = resolve(root, row.fixture);
    if (!existsSync(fixtureRoot)) { add("fixture-missing", row.id, `fixture ${row.fixture} does not exist`); held = false; }
    for (const ref of row.checks) {
      const runs = (row.fixture_runs ?? []).filter(run => run.check === ref);
      if (!runs.length) { add("fixture-missing", row.id, `${ref} has no fixture run`); held = false; continue; }
      const entry = entryOf(ref, packages, subChecks);
      for (const run of runs) {
        const fixture = run.fixture ? resolve(root, run.fixture) : fixtureRoot;
        if (!existsSync(fixture)) { add("fixture-missing", row.id, `fixture ${run.fixture} does not exist`); held = false; continue; }
        if (entry) {
          // The check's own entry files (what its commands name), not every library it imports: a
          // fixture run of another check that shares one helper module does not exercise this one.
          const checkFiles = (await trace(JSON.stringify(entry), entry)).direct;
          const runEntry = { cwd: run.cwd, run: fill(run.run, fixture, "/tmp/out") };
          const runFiles = (await trace(JSON.stringify(runEntry), runEntry)).reached;
          if (![...checkFiles].some(file => CODE.test(file) && runFiles.has(file))) { add("fixture-unrelated", row.id, `the fixture run for ${ref} executes none of the files ${ref}'s commands run`); held = false; }
        }
        const out = mkdtempSync(join(tmpdir(), "check-rules-"));
        const started = Date.now();
        const result = await runFixture(fill(run.run, fixture, out), join(root, run.cwd), timeoutMs);
        const expectExit = run.expect_exit ?? 1;
        if (!validExit(expectExit)) { held = false; continue; }
        log(`${result.code === expectExit && new RegExp(run.expect, "m").test(result.output) ? "FAILS AS REQUIRED" : "DOES NOT FAIL"}  ${row.id}  ${ref}  (exit ${result.code}, ${Math.round((Date.now() - started) / 100) / 10}s)`);
        if (result.code !== expectExit) { add("fixture-passed", row.id, `${ref} exited ${result.code} on its fixture, expected ${expectExit}`); held = false; }
        else if (!new RegExp(run.expect, "m").test(result.output)) { add("fixture-not-detected", row.id, `${ref} failed on its fixture without reporting /${run.expect}/`); held = false; }
      }
    }
    if (held) enforced++;
  }

  // Every governed check maps to a rule, or carries a by-design exemption.
  const governed = [...[...subChecks.keys()].map(id => `${SUB}${id}`), ...META_CHECKS.filter(name => packages.get(".")?.scripts?.[name]).map(name => `.#${name}`)];
  const exemptions = new Map();
  for (const exemption of doc.exemptions ?? []) {
    const ref = exemption?.check;
    if (typeof ref !== "string") { add("exemption-shape", REGISTRY, "an exemption has no check"); continue; }
    if (!oneLine(exemption.reason)) add("exemption-reason", ref, "an exemption needs a non-empty one-line reason");
    if (exemptions.has(ref)) add("exemption-duplicate", ref, "exempt twice");
    if (!governed.includes(ref)) add("exemption-stale", ref, "exempts no governed check");
    exemptions.set(ref, exemption.reason);
  }
  for (const ref of governed) {
    let mapped = listed.has(ref);
    if (!mapped && ref.startsWith(SUB)) {
      const sub = subChecks.get(ref.slice(SUB.length));
      const scripts = (await trace(`sub:${ref}`, { cwd: sub.cwd ?? ".", run: sub.run })).scripts;
      mapped = [...scripts].some(script => listed.has(script));
    }
    if (mapped && exemptions.has(ref)) add("exemption-stale", ref, "exempt, but a rule lists it: drop the exemption");
    if (!mapped && !exemptions.has(ref)) add("unmapped", ref, "no rule lists this check and it has no exemption");
  }
  // Reachability last: check:rules exits 1 on any finding, so a step after it in an `&&` chain cannot
  // run then. Trace first as if it passed; if anything is found (or the trace itself finds a gap),
  // trace again with check:rules failing and count only what still runs.
  const wired = graph => ({ ref }) => ref.startsWith(SUB) ? graph.scripts.has(STUDIO_SCRIPT) : graph.scripts.has(ref);
  const passing = await reachable(root, { files });
  let gaps = wiring.filter(item => !wired(passing)(item));
  const failing = findings.length || gaps.length ? await reachable(root, { files, failing: new Set([SELF]) }) : passing;
  gaps = wiring.filter(item => !wired(failing)(item));
  for (const { id, ref } of gaps) {
    add("unreachable", id, wired(passing)({ ref })
      ? `${ref} is not reachable from root check or test: it runs only after ${SELF.slice(2)} in an && chain, and ${SELF.slice(2)} exits 1 on these findings`
      : `${ref} is not reachable from root check or test`);
  }
  return { rules: doc.rules.length, enforced, findings };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--root");
  const root = resolve(at >= 0 ? args[at + 1] ?? "" : join(here, ".."));
  try {
    const result = await ruleFindings(root, { log: args.includes("--json") ? () => {} : console.log });
    if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
    else {
      for (const finding of result.findings) console.log(`${finding.rule}\t${finding.id}\t${finding.message}`);
      const failing = [...new Set(result.findings.filter(finding => /^R-/.test(finding.id)).map(finding => finding.id))];
      const unmapped = result.findings.filter(finding => finding.rule === "unmapped").length;
      console.log(`check:rules: ${result.rules} rules, ${result.enforced} enforced by a check that fails on its fixture; failing: ${failing.length ? failing.join(", ") : "none"}; ${unmapped} unmapped check(s); ${result.findings.length} finding(s)`);
    }
    process.exitCode = result.findings.length ? 1 : 0;
  } catch (error) {
    console.error(`check:rules could not run: ${error.message}`);
    process.exitCode = 2;
  }
}
