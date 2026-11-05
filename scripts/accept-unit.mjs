#!/usr/bin/env node
/**
 * Unit acceptance by check: a unit is accepted when its check fails on the base and passes on the head.
 *
 *   node scripts/accept-unit.mjs <base> <head> <check-script>
 *
 * <check-script> is an npm script name found in exactly one package.json of the head tree, or
 * `<package dir>#<script>` (the root is "."). Each revision is extracted with `git archive` into a
 * fresh temporary directory beside the other, the current checkout's node_modules folders are linked
 * in, and the script runs there with `npm run`. The base is always measured with the head's check:
 * the head's script definition and the check code files it reaches (the check:orphan-checks graph)
 * are overlaid onto the base, as the pre-push ratchet does, so a head that weakens its own check
 * cannot read as "fails on the base, passes on the head". The verdict says how many files were carried.
 *
 * The extracted trees hold no gitignored output (dist/) of their own, so before the check runs each
 * tree builds what the check loads (`buildDist`): the first-party workspaces a reached code file
 * imports by name or whose dist/ it names, plus their first-party dependencies, each built in its own
 * tree from its own sources with its own `build` script up to its last `tsc` step (later steps rewrite
 * tracked files or are checks of their own). Builds are cached by the commit's tree sha, so an unchanged
 * base is built once. A build may not rewrite a tracked file. A side whose build fails measured nothing
 * and the verdict is FAIL. A side whose output still shows a module-resolution error (`loadError`)
 * after that build did not measure anything either: a base that cannot load the check is not a failing
 * base, and the verdict is FAIL either way. A base that exits with anything but 1 (2 is a usage or
 * read error by this repository's convention, 127 a missing command, 128+ a signal) did not report a
 * finding, so it is not a failing base either.
 *
 * Each tree is a git work tree of its commit (objects borrowed from the checkout), so a check that asks
 * git about the tree (`git ls-files`) sees that commit. Policy data the check reads is part of the
 * check: an exemptions, exceptions, allowlist, waivers, baseline or known-* JSON file that a reached
 * code file names is carried from the head as well (`policyFiles`), and a head that adds entries to one,
 * or that loosens scripts/rules/registry.json (a rule removed, no longer enforced, a check or fixture
 * run dropped, an exemption added), is FAIL as `loosened` (`loosening`). The registry itself is never
 * carried: it is what check:rules measures.
 *
 * Prints one line: PASS or FAIL, both exit codes, and where the trees and logs are kept (they are
 * left in place for inspection). Exits 0 on PASS, 1 on FAIL, 2 on a usage or setup error.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { constants, tmpdir } from "node:os";
import { delimiter, dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOrder, listWorkspaces } from "./build-workspaces.mjs";
import { commandList, reachable, workspaces } from "./check-orphan-checks.mjs";

const CODE = /\.(?:mjs|cjs|js|jsx|ts|tsx|mts|cts)$/;
const run = (command, args, options = {}) => spawnSync(command, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...options });

export function gitTop(cwd) {
  const top = run("git", ["rev-parse", "--show-toplevel"], { cwd });
  if (top.status !== 0) throw new Error(`not inside a git checkout: ${cwd}`);
  return top.stdout.trim();
}

export function commit(repo, rev) {
  const out = run("git", ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], { cwd: repo });
  if (out.status !== 0) throw new Error(`unknown revision: ${rev}`);
  return out.stdout.trim();
}

/** Variables that point git at one repository; a process inside an extracted tree must find the tree's own. */
const GIT_LOCATION = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_COMMON_DIR", "GIT_NAMESPACE", "GIT_PREFIX"];
/** The environment a check or build runs with inside an extracted tree. */
export function treeEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const name of GIT_LOCATION) delete env[name];
  return env;
}

/**
 * Export `sha` into `into` with `git archive`, then make the tree a git repository of its own at that
 * commit: its objects borrowed from the checkout (an alternates file, nothing copied), its index read
 * from the commit and HEAD detached at it. Checks that ask git what is tracked (`git ls-files`) then
 * read the extracted revision, not the checkout, and not a missing repository.
 */
export function extract(repo, sha, into) {
  mkdirSync(into, { recursive: true });
  const out = run("sh", ["-c", 'git -C "$1" archive --format=tar "$2" | tar -x -C "$3"', "sh", repo, sha, into]);
  if (out.status !== 0) throw new Error(`git archive ${sha} failed: ${out.stderr.trim()}`);
  const objects = run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: repo });
  if (objects.status !== 0) throw new Error(`git rev-parse --git-common-dir failed: ${objects.stderr.trim()}`);
  const env = treeEnv();
  for (const args of [["init", "-q", "--template="], ["read-tree", sha], ["update-index", "-q", "--refresh"]]) {
    if (args[0] === "read-tree") {
      writeFileSync(join(into, ".git", "objects", "info", "alternates"), `${join(objects.stdout.trim(), "objects")}\n`);
      writeFileSync(join(into, ".git", "HEAD"), `${sha}\n`);
    }
    const step = run("git", args, { cwd: into, env });
    if (step.status !== 0 && args[0] !== "update-index") throw new Error(`git ${args[0]} in the extracted ${sha.slice(0, 9)} failed: ${step.stderr.trim()}`);
  }
}

/** Package directories (relative, "." for the root) that hold a package.json in a tree. */
function packageDirs(tree) {
  const dirs = existsSync(join(tree, "package.json")) ? ["."] : [];
  const packages = join(tree, "packages");
  if (existsSync(packages)) for (const name of readdirSync(packages).sort()) if (existsSync(join(packages, name, "package.json"))) dirs.push(`packages/${name}`);
  return dirs;
}

const scriptsOf = (tree, dir) => {
  const file = join(tree, dir, "package.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).scripts ?? {} : {};
};

/** Resolve `<dir>#<script>` or a bare script name against the head tree. */
export function resolveCheck(tree, ref) {
  const at = ref.lastIndexOf("#");
  if (at > 0) {
    const dir = ref.slice(0, at), script = ref.slice(at + 1);
    if (typeof scriptsOf(tree, dir)[script] !== "string") throw new Error(`${dir} has no script ${script} at head`);
    return { dir, script };
  }
  const owners = packageDirs(tree).filter(dir => typeof scriptsOf(tree, dir)[ref] === "string");
  if (owners.length !== 1) throw new Error(owners.length ? `${ref} is defined in ${owners.join(", ")}; name one as <dir>#${ref}` : `no package.json at head defines ${ref}`);
  return { dir: owners[0], script: ref };
}

/** Module-resolution failures: the check never ran, so its exit code is not a verdict. */
export const LOAD_ERROR = /\b(?:ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|ERR_PACKAGE_PATH_NOT_EXPORTED)\b|\bCannot find (?:module|package)\b/;
/** The first output line that shows the check could not load a module, or undefined. */
export function loadError(output) {
  return String(output ?? "").split("\n").find(line => LOAD_ERROR.test(line))?.trim();
}

/**
 * Give an extracted tree the checkout's installed node_modules (never installed). Each node_modules
 * folder is a copy-on-write clone of the checkout's (`cp -cR` on macOS, `cp -R --reflink=always`
 * elsewhere), so the tree resolves every package inside itself exactly as a real install does: tsc can
 * name a dependency's types in emitted declarations, and a workspace link such as
 * `@scope/pkg -> ../../packages/pkg` resolves to the tree's own workspace and its own dist/, never to
 * the checkout's. Where no clone is possible the folder is mirrored as links instead: an installed
 * package links to the checkout's copy and a link that stays inside the checkout is recreated as the
 * same relative link. A tree workspace the checkout has not installed is linked by name as well.
 */
export function linkModules(checkout, tree) {
  if (!existsSync(join(checkout, "package.json"))) return;
  for (const dir of workspaces(checkout).keys()) {
    const from = join(checkout, dir, "node_modules"), to = join(tree, dir, "node_modules");
    if (!existsSync(from) || !existsSync(join(tree, dir)) || existsSync(to)) continue;
    const clone = process.platform === "darwin" ? ["-cR", from, to] : ["-R", "--reflink=always", from, to];
    if (run("cp", clone).status !== 0) {
      if (existsSync(to)) rmSync(to, { recursive: true, force: true });
      mirrorModules(realpathSync(checkout), from, to);
    }
  }
  const root = join(tree, "node_modules");
  if (!existsSync(root) || !existsSync(join(tree, "package.json"))) return;
  for (const [dir, manifest] of workspaces(tree)) {
    const at = typeof manifest.name === "string" && dir !== "." ? join(root, ...manifest.name.split("/")) : undefined;
    if (!at || existsSync(at)) continue;
    mkdirSync(dirname(at), { recursive: true });
    symlinkSync(relative(dirname(at), join(tree, dir)), at, "dir");
  }
}

function mirrorModules(checkout, from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name), target = join(to, entry.name);
    if (entry.isSymbolicLink()) {
      const link = readlinkSync(source), points = resolve(dirname(source), link);
      const inside = !link.startsWith("/") && !relative(checkout, existsSync(points) ? realpathSync(points) : points).startsWith("..");
      symlinkSync(inside ? link : points, target);
    } else if (entry.isDirectory() && (entry.name.startsWith("@") || entry.name === ".bin")) mirrorModules(checkout, source, target);
    else symlinkSync(source, target, entry.isDirectory() ? "dir" : "file");
  }
}

/** Import-like specifiers a JS/TS source names, bare ones included. */
const SPECIFIERS = [
  /\b(?:import|export)\b[^'"`;]*?\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire(?:\.resolve)?\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\.meta\.resolve\s*\(\s*["']([^"']+)["']\s*\)/g,
];
const LITERAL = /["'`]([^"'`\n]*)["'`]/g;
const DIST = /(?:^|\/)dist\//;
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

function namedWorkspaces(tree) {
  const spaces = workspaces(tree);
  const byName = new Map([...spaces].filter(([dir, manifest]) => dir !== "." && typeof manifest.name === "string").map(([dir, manifest]) => [manifest.name, dir]));
  return { spaces, byName };
}

/**
 * The first-party workspaces (by package name) whose build output the reached files load: a reached
 * code file imports the workspace by name, or names a `dist/` path inside it (relative to the file, or
 * a bare `dist/...` inside the file's own workspace).
 */
export function distSeeds(tree, reached) {
  const { byName } = namedWorkspaces(tree);
  const nameOf = new Map([...byName].map(([name, dir]) => [dir, name]));
  const dirs = [...nameOf.keys()].sort((a, b) => b.length - a.length);
  const owner = rel => dirs.find(dir => rel === dir || rel.startsWith(`${dir}/`));
  const seeds = new Set();
  for (const rel of reached) {
    if (!CODE.test(rel) || !existsSync(join(tree, rel))) continue;
    const text = readFileSync(join(tree, rel), "utf8");
    for (const pattern of SPECIFIERS) for (const [, specifier] of text.matchAll(pattern)) {
      const name = specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
      if (byName.has(name)) seeds.add(name);
    }
    for (const [, literal] of text.matchAll(LITERAL)) {
      if (!DIST.test(literal)) continue;
      const at = /^\.\.?\//.test(literal) ? owner(posix.normalize(posix.join(posix.dirname(rel), literal))) : owner(rel);
      if (at) seeds.add(nameOf.get(at));
    }
  }
  return [...seeds].sort();
}

/** The workspace dirs of a tree to build for `seeds`: those present, with their first-party dependencies, in build order. */
export function distOrder(tree, seeds) {
  if (!seeds.length || !existsSync(join(tree, "package.json"))) return [];
  const { spaces, byName } = namedWorkspaces(tree);
  const need = new Set(seeds.filter(name => byName.has(name)).map(name => byName.get(name)));
  for (const queue = [...need]; queue.length;) {
    const manifest = spaces.get(queue.shift());
    for (const field of DEPENDENCY_FIELDS) for (const name of Object.keys(manifest[field] ?? {})) {
      const dir = byName.get(name);
      if (dir && !need.has(dir)) { need.add(dir); queue.push(dir); }
    }
  }
  return buildOrder(listWorkspaces(tree)).filter(space => need.has(space.dir) && typeof space.manifest.scripts?.build === "string").map(space => space.dir);
}

/** `a && b && c` split at its top-level `&&`, or undefined when the script uses any other operator. */
function andSteps(script) {
  if (commandList(script).some(command => command.op !== null && command.op !== "&&")) return undefined;
  const steps = [];
  let quote = null, start = 0;
  for (let i = 0; i < script.length; i++) {
    const c = script[i];
    if (quote) { if (c === "\\" && quote === '"') i++; else if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"') quote = c;
    else if (c === "\\") i++;
    else if (c === "&" && script[i + 1] === "&") { steps.push(script.slice(start, i).trim()); start = i + 2; i++; }
  }
  steps.push(script.slice(start).trim());
  return steps.every(step => commandList(step).length === 1) ? steps : undefined;
}

/**
 * The part of a workspace `build` script that produces its dist/: every step up to and including its
 * last `tsc` step. Steps after it (generators that rewrite tracked files, checks of their own) are not
 * part of the output a check loads. A script with no `tsc` step, or one that is not a plain `&&` list,
 * runs whole.
 */
export function distCommand(script) {
  const steps = andSteps(script);
  if (!steps) return script;
  const program = step => {
    const words = commandList(step)[0].words.filter(word => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
    return posix.basename((words[0] === "npx" ? words.find((word, i) => i > 0 && !word.startsWith("-")) : words[0]) ?? "");
  };
  const last = steps.map(program).lastIndexOf("tsc");
  return last < 0 ? script : steps.slice(0, last + 1).join(" && ");
}

/** Files (tree-relative) under a tree directory, node_modules folders excluded. */
function filesUnder(tree, dir) {
  const out = [];
  const walk = rel => {
    for (const entry of readdirSync(join(tree, rel), { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const next = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else out.push(next);
    }
  };
  if (existsSync(join(tree, dir))) walk(dir);
  return out;
}

/** Tracked files of `sha` whose content in the extracted tree is no longer the committed blob. */
export function trackedChanges(repo, sha, tree) {
  const listing = run("git", ["ls-tree", "-r", "-z", sha], { cwd: repo });
  if (listing.status !== 0) return [`git ls-tree ${sha} failed: ${listing.stderr.trim()}`];
  const blobs = listing.stdout.split("\0").filter(Boolean).map(line => {
    const tab = line.indexOf("\t"), [mode, type, blob] = line.slice(0, tab).split(" ");
    return { mode, type, blob, path: line.slice(tab + 1) };
  }).filter(entry => entry.type === "blob" && entry.mode !== "120000" && !entry.path.includes("\n"));
  const missing = blobs.filter(entry => !existsSync(join(tree, entry.path)));
  const present = blobs.filter(entry => existsSync(join(tree, entry.path)));
  const hashed = run("git", ["hash-object", "--no-filters", "--stdin-paths"], { cwd: repo, input: present.map(entry => join(tree, entry.path)).join("\n") + "\n" });
  if (hashed.status !== 0) return [`git hash-object failed: ${hashed.stderr.trim()}`];
  const ids = hashed.stdout.trim().split("\n");
  return [...missing.map(entry => entry.path), ...present.filter((entry, i) => ids[i] !== entry.blob).map(entry => entry.path)].sort();
}

/** The default build cache: one folder per commit tree sha and installed lockfile. */
export const DIST_CACHE = join(tmpdir(), "foundry-dist-cache");
const DIST_CACHE_KEEP = 8;

function pruneCache(cache, keep) {
  if (!existsSync(cache)) return;
  const entries = readdirSync(cache).filter(name => !name.includes(".tmp-")).map(name => ({ name, at: statSync(join(cache, name)).mtimeMs })).sort((a, b) => b.at - a.at);
  for (const { name } of entries.slice(keep)) rmSync(join(cache, name), { recursive: true, force: true });
}

const tail = (out, n = 20) => `${out.stdout ?? ""}\n${out.stderr ?? ""}${out.error ? `\n${out.error.message}` : ""}`.split("\n").map(line => line.trimEnd()).filter(Boolean).slice(-n);

/**
 * Build `dirs` (from distOrder) inside an extracted tree, in order, each with distCommand of its own
 * `build` script, its own sources and the linked node_modules. The files a build adds are cached under
 * `<cache>/<tree sha>-<installed lockfile hash>/<dir>`, so the same tree is built once and restored after
 * that. A build that fails, or that rewrites a tracked file, is returned as `failure` and stops the rest.
 */
export function buildDist(repo, sha, tree, dirs, { cache = DIST_CACHE, log } = {}) {
  const result = { built: [], cached: [] };
  if (!dirs.length) return result;
  const treeSha = run("git", ["rev-parse", "--verify", `${sha}^{tree}`], { cwd: repo }).stdout.trim();
  const lock = join(repo, "node_modules", ".package-lock.json");
  const installed = createHash("sha256").update(existsSync(lock) ? readFileSync(lock) : "none").digest("hex").slice(0, 12);
  const home = join(cache, `${treeSha}-${installed}`);
  mkdirSync(home, { recursive: true });
  const now = new Date();
  utimesSync(home, now, now);
  pruneCache(cache, DIST_CACHE_KEEP);
  const lines = [];
  for (const dir of dirs) {
    const saved = join(home, dir.replaceAll("/", "__"));
    if (existsSync(saved)) {
      cpSync(saved, join(tree, dir), { recursive: true });
      result.cached.push(dir);
      lines.push(`# ${dir}: restored from ${saved}`);
      continue;
    }
    const command = distCommand(JSON.parse(readFileSync(join(tree, dir, "package.json"), "utf8")).scripts.build);
    const before = new Set(filesUnder(tree, dir));
    const PATH = [join(tree, dir, "node_modules", ".bin"), join(tree, "node_modules", ".bin"), process.env.PATH].filter(Boolean).join(delimiter);
    const out = run("/bin/sh", ["-c", command], { cwd: join(tree, dir), env: treeEnv({ FORCE_COLOR: "0", NO_COLOR: "1", PATH }) });
    lines.push(`# ${dir}: ${command} (exit ${out.status ?? 1})`, ...tail(out, 200));
    if (out.status !== 0) {
      if (log) writeFileSync(log, lines.join("\n") + "\n");
      return { ...result, failure: { dir, command, exit: out.status ?? 1, lines: tail(out) } };
    }
    const changed = trackedChanges(repo, sha, tree);
    if (changed.length) {
      if (log) writeFileSync(log, lines.join("\n") + "\n");
      return { ...result, failure: { dir, command, exit: 1, lines: changed.slice(0, 20).map(file => `the build rewrote tracked file ${file}`) } };
    }
    const scratch = `${saved}.tmp-${process.pid}-${Date.now()}`;
    mkdirSync(scratch, { recursive: true });
    for (const file of filesUnder(tree, dir).filter(file => !before.has(file))) {
      const to = join(scratch, file.slice(dir.length + 1));
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(join(tree, file), to);
    }
    try { renameSync(scratch, saved); } catch { rmSync(scratch, { recursive: true, force: true }); }
    result.built.push(dir);
  }
  if (log) writeFileSync(log, lines.join("\n") + "\n");
  return result;
}

/** One line naming a side's build failure. */
export const buildFailure = (side, failure) => `the ${side} build of ${failure.dir} failed (exit ${failure.exit}: ${failure.command})${failure.lines.length ? `: ${failure.lines.at(-1)}` : ""}`;

/**
 * Policy data a check reads: tracked JSON files named like a debt register (exemptions, exceptions,
 * allowlist, waivers, baseline, known-*) outside fixtures, plus the rule registry. Only those the
 * check reaches count: a reached file, or one whose repository path, `<dir>/<name>` or distinctive name
 * appears in a reached code file of `codeTree` (the head). Listed from `tree`'s own index.
 */
export const POLICY_DATA = /(?:^|\/)(?:(?:[\w.-]+[.-])?(?:exemptions|exceptions|allowlist|waivers)|baseline|known-[\w.-]+)\.json$/;
export const REGISTRY_FILE = "scripts/rules/registry.json";
const NOT_POLICY = /(?:^|\/)(?:fixtures|__fixtures__|test-fixtures|references|node_modules)\//;
const DISTINCTIVE = /(?:[.-](?:exemptions|exceptions|allowlist|waivers)|^known-[\w.-]+)\.json$/;

export function policyFiles(tree, codeTree, reached) {
  const listed = run("git", ["ls-files", "-z"], { cwd: tree, env: treeEnv() });
  if (listed.status !== 0) return [];
  const texts = [...reached].filter(file => CODE.test(file) && existsSync(join(codeTree, file))).map(file => readFileSync(join(codeTree, file), "utf8"));
  const named = file => {
    const parts = file.split("/"), name = parts.at(-1);
    const needles = [file, parts.slice(-2).join("/"), ...(DISTINCTIVE.test(name) ? [name] : [])];
    return texts.some(text => needles.some(needle => text.includes(needle)));
  };
  return listed.stdout.split("\0").filter(Boolean)
    .filter(file => (file === REGISTRY_FILE || POLICY_DATA.test(file)) && !NOT_POLICY.test(file))
    .filter(file => reached.has(file) || named(file)).sort();
}

/** Prose keys: editing a reason or a note loosens nothing. */
const PROSE = new Set(["$schema", "$comment", "about", "note", "notes", "reason", "description", "comment", "why"]);
const strip = value => Array.isArray(value) ? value.map(strip)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().filter(key => !PROSE.has(key)).map(key => [key, strip(value[key])]))
  : value;
/** A JSON document as entries: `path value` per object leaf, `path[] element` per array element. */
function policyEntries(value, path = "") {
  if (Array.isArray(value)) return value.map(item => `${path}[] ${JSON.stringify(strip(item))}`);
  if (value && typeof value === "object") return Object.keys(value).sort().filter(key => !PROSE.has(key)).flatMap(key => policyEntries(value[key], path ? `${path}.${key}` : key));
  return [`${path} ${JSON.stringify(value)}`];
}
/** Items of `after` beyond their count in `before` (multiset difference). */
function extra(after, before) {
  const left = new Map();
  for (const item of before) left.set(item, (left.get(item) ?? 0) + 1);
  return after.filter(item => { const n = left.get(item) ?? 0; if (n > 0) { left.set(item, n - 1); return false; } return true; });
}
const readPolicy = (tree, file) => {
  if (!existsSync(join(tree, file))) return undefined;
  try { return JSON.parse(readFileSync(join(tree, file), "utf8")); } catch (error) { return error; }
};

function registryLoosening(base, head) {
  const rows = doc => new Map((Array.isArray(doc?.rules) ? doc.rules : []).filter(row => row && typeof row.id === "string").map(row => [row.id, row]));
  const runs = row => { const n = new Map(); for (const runOf of row.fixture_runs ?? []) n.set(runOf?.check, (n.get(runOf?.check) ?? 0) + 1); return n; };
  const before = rows(base), after = rows(head), out = [];
  for (const [id, row] of before) {
    const now = after.get(id);
    if (!now) { out.push(`${REGISTRY_FILE}: removes rule ${id}`); continue; }
    if (row.status === "enforced" && now.status !== "enforced") out.push(`${REGISTRY_FILE}: ${id} goes from enforced to ${now.status}`);
    for (const check of row.checks ?? []) if (!(now.checks ?? []).includes(check)) out.push(`${REGISTRY_FILE}: ${id} drops check ${check}`);
    const had = runs(row), has = runs(now);
    for (const [check, n] of had) if ((has.get(check) ?? 0) < n) out.push(`${REGISTRY_FILE}: ${id} drops a fixture run of ${check}`);
  }
  const exempt = doc => (Array.isArray(doc?.exemptions) ? doc.exemptions : []).map(item => JSON.stringify(strip(item)));
  for (const item of extra(exempt(head), exempt(base))) out.push(`${REGISTRY_FILE}: adds exemption ${item}`);
  return out;
}

/**
 * How the head loosens the policy data `files`: entries a debt register gains over the base (a file new
 * on the head gains all of its entries), or a loosened rule registry. A head copy that is not JSON is
 * reported too. A file absent on the head loosens nothing; an unreadable base copy compares as empty.
 */
export function loosening(baseTree, headTree, files) {
  const out = [];
  for (const file of files) {
    const head = readPolicy(headTree, file), base = readPolicy(baseTree, file);
    if (head === undefined) continue;
    if (head instanceof Error) { out.push(`${file}: the head's copy is not valid JSON (${head.message})`); continue; }
    const before = base instanceof Error ? undefined : base;
    if (file === REGISTRY_FILE) { if (before !== undefined) out.push(...registryLoosening(before, head)); continue; }
    out.push(...extra(policyEntries(head), before === undefined ? [] : policyEntries(before)).map(entry => `${file}: adds ${entry}`));
  }
  return out;
}

/**
 * What giving the base the head's checks carries (overlayPlan, measured on the pristine head before any
 * build output exists): every check code file the entries reach (the check:orphan-checks graph), the
 * policy data those files read (policyFiles, the rule registry excepted), any `extra` repository paths,
 * and every npm script the entries run. `reached` is the whole reached set, `policy` every policy file.
 */
export async function overlayPlan(headTree, entries, { extra: more = [] } = {}) {
  const { reached, scripts } = await reachable(headTree, { entries });
  const policy = policyFiles(headTree, headTree, reached);
  const files = [...new Set([...[...reached].filter(file => CODE.test(file)), ...policy.filter(file => file !== REGISTRY_FILE), ...more])].sort();
  return { reached, policy, files, removed: [], scripts: [...(scripts.keys ? scripts.keys() : scripts)] };
}

/**
 * Give the base the head's checks: copy the plan's files and the head's definition of every planned npm
 * script, and drop the policy files the head no longer has (`removed`). Data the checks measure
 * (fixtures, records, the rule registry, the tree under test) stays the base's own.
 */
export async function overlayChecks(headTree, baseTree, entries, options = {}) {
  return applyOverlay(headTree, baseTree, await overlayPlan(headTree, entries, options));
}

export function applyOverlay(headTree, baseTree, { files, removed = [], scripts }) {
  for (const file of files) {
    mkdirSync(dirname(join(baseTree, file)), { recursive: true });
    copyFileSync(join(headTree, file), join(baseTree, file));
    // Keep the head file's (commit-time) mtime: a carried source must not read as newer than the base's
    // own build output, which a freshness check (dist older than src) would report as unbuilt.
    const { atime, mtime } = statSync(join(headTree, file));
    utimesSync(join(baseTree, file), atime, mtime);
  }
  for (const file of removed) if (existsSync(join(baseTree, file))) unlinkSync(join(baseTree, file));
  for (const key of scripts) {
    const at = key.lastIndexOf("#"), dir = key.slice(0, at), script = key.slice(at + 1);
    const definition = scriptsOf(headTree, dir)[script], manifest = join(baseTree, dir, "package.json");
    if (typeof definition !== "string") continue;
    if (!existsSync(manifest)) throw new Error(`base has no ${dir}/package.json to carry ${script}`);
    const doc = JSON.parse(readFileSync(manifest, "utf8"));
    if (doc.scripts?.[script] === definition) continue;
    doc.scripts = { ...doc.scripts, [script]: definition };
    writeFileSync(manifest, JSON.stringify(doc, null, 2) + "\n");
  }
  return files;
}

function runCheck(tree, { dir, script }, log) {
  const out = run("npm", ["run", "--silent", script], { cwd: join(tree, dir), env: treeEnv({ FORCE_COLOR: "0" }) });
  const text = `${out.stdout ?? ""}${out.stderr ?? ""}${out.error ? `\n${out.error.message}\n` : ""}`;
  writeFileSync(log, `$ npm run ${script}  (cwd ${dir})\n${text}`);
  // A signal is reported as a shell does (128 + its number), never as an ordinary finding.
  const exit = out.status ?? (out.signal ? 128 + (constants.signals[out.signal] ?? 0) : 1);
  return { exit, load: exit === 0 ? undefined : loadError(text) };
}

/** Exit 1 is a finding; 0 is clean; anything else (usage or read error, missing command, signal) is no verdict. */
export const FINDING_EXIT = 1;

/**
 * Ready two extracted trees for measurement: plan the overlay on the pristine head, link node_modules,
 * build in each tree what the entries load (the same first-party workspaces, from the head's reached
 * check code, each tree from its own sources), then give the base the head's checks. Builds run one
 * tree after the other; the second is restored from the cache when both trees are the same. `loosened`
 * is how the head loosens the policy data the entries read, compared on the pristine trees.
 */
export async function prepareTrees({ repo, baseSha, headSha, baseTree, headTree, entries, work, cache }) {
  const plan = await overlayPlan(headTree, entries);
  // Policy data is compared before any build or overlay touches either tree.
  const loosened = loosening(baseTree, headTree, plan.policy);
  plan.removed = policyFiles(baseTree, headTree, plan.reached).filter(file => file !== REGISTRY_FILE && !plan.policy.includes(file));
  linkModules(repo, baseTree);
  linkModules(repo, headTree);
  const seeds = distSeeds(headTree, plan.reached);
  const builds = {};
  const treeOf = sha => run("git", ["rev-parse", "--verify", `${sha}^{tree}`], { cwd: repo }).stdout.trim();
  for (const [side, sha, tree] of [["base", baseSha, baseTree], ["head", headSha, headTree]]) {
    const dirs = distOrder(tree, seeds);
    // The same tree builds the same way: a base build that failed is the head's failure too, not rerun.
    if (side === "head" && builds.base.failure && treeOf(baseSha) === treeOf(headSha)) { builds.head = { dirs, built: [], cached: [], failure: builds.base.failure }; continue; }
    builds[side] = { dirs, ...buildDist(repo, sha, tree, dirs, { cache, log: work ? join(work, `${side}-build.log`) : undefined }) };
  }
  const overlaid = applyOverlay(headTree, baseTree, plan);
  return { overlaid, removed: plan.removed, seeds, builds, loosened };
}

export async function acceptUnit({ base, head, check, cwd = process.cwd(), cache }) {
  const repo = gitTop(cwd);
  const baseSha = commit(repo, base), headSha = commit(repo, head);
  const work = realpathSync(mkdtempSync(join(tmpdir(), "accept-unit-")));
  const baseTree = join(work, "base"), headTree = join(work, "head");
  extract(repo, baseSha, baseTree);
  extract(repo, headSha, headTree);
  const target = resolveCheck(headTree, check);
  const name = target.dir === "." ? target.script : `${target.dir}#${target.script}`;
  // Always the head's check on both sides: a base's own (stricter) check would let a weakened head pass.
  const { overlaid, builds, loosened } = await prepareTrees({ repo, baseSha, headSha, baseTree, headTree, entries: [target], work, cache });
  const carried = `; base measured with the head check (${overlaid.length} file(s) overlaid)`;
  if (loosened.length) {
    const line = `FAIL ${name}: loosened, the head relaxes policy data the check reads (${loosened.slice(0, 5).join("; ")}${loosened.length > 5 ? `; ${loosened.length - 5} more` : ""})${carried}; trees and logs in ${work}`;
    return { pass: false, baseExit: undefined, headExit: undefined, overlaid, builds, loosened, work, line, load: {} };
  }
  const broken = ["base", "head"].filter(side => builds[side].failure);
  if (broken.length) {
    const why = broken.map(side => `; ${buildFailure(side, builds[side].failure)}`).join("");
    const line = `FAIL ${name}: not measured, base ${baseSha.slice(0, 9)} and head ${headSha.slice(0, 9)} must both build what the check loads${why}${carried}; trees and logs in ${work}`;
    return { pass: false, baseExit: undefined, headExit: undefined, overlaid, builds, loosened, work, line, load: {} };
  }
  const baseRun = runCheck(baseTree, target, join(work, "base.log"));
  const headRun = runCheck(headTree, target, join(work, "head.log"));
  const baseExit = baseRun.exit, headExit = headRun.exit;
  const pass = baseExit === FINDING_EXIT && !baseRun.load && headExit === 0;
  const unloaded = [["base", baseRun], ["head", headRun]].filter(([, side]) => side.load).map(([side, { load }]) => `; the ${side} could not load the check (${load})`).join("");
  const noVerdict = baseExit !== 0 && baseExit !== FINDING_EXIT ? `; the base exit ${baseExit} is a usage, read or run error, not a finding` : "";
  const line = `${pass ? "PASS" : "FAIL"} ${name}: base ${baseSha.slice(0, 9)} exit ${baseExit} (want ${FINDING_EXIT}), head ${headSha.slice(0, 9)} exit ${headExit} (want 0)${carried}${unloaded}${noVerdict}; trees and logs in ${work}`;
  return { pass, baseExit, headExit, overlaid, builds, loosened, work, line, load: { base: baseRun.load, head: headRun.load } };
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 3 || args.some(arg => arg.startsWith("-"))) {
    console.error("usage: node scripts/accept-unit.mjs <base> <head> <check-script | dir#script>");
    process.exit(2);
  }
  try {
    const [base, head, check] = args;
    const result = await acceptUnit({ base, head, check });
    console.log(result.line);
    process.exit(result.pass ? 0 : 1);
  } catch (error) {
    console.error(`accept-unit: ${error.message}`);
    process.exit(2);
  }
}
