#!/usr/bin/env node
/**
 * Unit acceptance by check: a unit is accepted when its check fails on the base and passes on the head.
 *
 *   node scripts/accept-unit.mjs [--keep] <base> <head> <check-script>
 *   node scripts/accept-unit.mjs --clean-stale [--adopt-legacy]
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
 * Prints one line: PASS or FAIL and both exit codes; on FAIL the last lines of each log follow. The
 * work folder (both trees, their node_modules clones and built dist/, the logs) is removed when the
 * run ends, pass, fail or error, unless --keep is given; the line says which. Every run starts with
 * that marker-mode clean. `--clean-stale` removes the folders that killed runs left behind
 * (`cleanStale`): only marked accept-unit folders older than two hours whose process is gone and that
 * nothing holds open; `--adopt-legacy` also removes unmarked accept-unit folders from before the
 * marker, only by exact name, layout, age and an lsof that shows no holder (`legacyKind`). Exits 0 on PASS, 1 on FAIL, 2 on a
 * usage or setup error.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, statfsSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { constants, hostname, tmpdir } from "node:os";
import { basename, delimiter, dirname, join, posix, relative, resolve, sep } from "node:path";
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
/**
 * The environment a check or build runs with inside an extracted tree. Given the tree, and when the tree
 * sits in a marked work folder, the temp directory is that folder's own `tmp/` (TMPDIR, TMP, TEMP): what a
 * check or build leaves in its temp directory (check:rules makes one per fixture run) goes with the folder.
 */
export function treeEnv(extra = {}, tree) {
  const env = { ...process.env, ...extra };
  for (const name of GIT_LOCATION) delete env[name];
  const work = tree && dirname(tree);
  if (work && workMarker(work)) {
    const tmp = join(work, "tmp");
    mkdirSync(tmp, { recursive: true });
    env.TMPDIR = env.TMP = env.TEMP = tmp;
  }
  return env;
}

/**
 * Work folders. Each run extracts its trees (each with a node_modules clone and its built dist/) into
 * one folder `<tmpdir>/<tool>-XXXXXX` that carries a marker file naming the tool, the process and the
 * host. The run removes that folder when it ends, pass or fail, unless the caller asks to keep it. The
 * trees are standalone repositories (`git init`, objects borrowed through an alternates file), not
 * `git worktree add` trees, so nothing is registered in the checkout and removal is `fs.rm` of the
 * folder: a symlink inside it is unlinked, never followed, and the borrowed objects are untouched.
 * A run that was killed leaves its folder behind; `cleanStale` removes those.
 */
export const WORK_MARKER = ".foundry-check-tree.json";
export const WORK_KIND = "foundry-check-tree";
export const WORK_TOOLS = ["accept-unit", "pre-push-ratchet"];
export const STALE_AFTER_MS = 2 * 60 * 60 * 1000;
const active = new Set();

export function makeWork(tool, { root = tmpdir() } = {}) {
  if (!WORK_TOOLS.includes(tool)) throw new Error(`unknown work tool: ${tool}`);
  // The real path: the slot model refuses a tree reached through a symlinked temp root (/var -> /private/var).
  const work = realpathSync(mkdtempSync(join(root, `${tool}-`)));
  writeFileSync(join(work, WORK_MARKER), JSON.stringify({ kind: WORK_KIND, tool, pid: process.pid, host: hostname(), started: new Date().toISOString() }) + "\n");
  active.add(work);
  return work;
}

/** The marker of a work folder, or undefined when the folder is not one this code made for `tool`. */
export function workMarker(work, tools = WORK_TOOLS) {
  const name = basename(work);
  const tool = tools.find(candidate => name.startsWith(`${candidate}-`));
  if (!tool) return undefined;
  try {
    const marker = JSON.parse(readFileSync(join(work, WORK_MARKER), "utf8"));
    if (marker?.kind !== WORK_KIND || marker.tool !== tool || !Number.isInteger(marker.pid) || Number.isNaN(Date.parse(marker.started))) return undefined;
    return marker;
  } catch { return undefined; }
}

/** Remove a work folder this code made; anything without the tool's name prefix and marker is refused. */
export function removeWork(work) {
  if (!workMarker(work)) throw new Error(`refusing to remove ${work}: not a marked work folder`);
  rmSync(work, { recursive: true, force: true, maxRetries: 3 });
  active.delete(work);
}

/** Remove every folder this process made and still holds (a signal ended the run). */
export function removeActiveWork() {
  for (const work of [...active]) { try { removeWork(work); } catch { active.delete(work); } }
}

/** Allocated bytes under `path`, symlinks counted as themselves and never followed. */
export function diskUsage(path) {
  let total = 0;
  const walk = at => {
    let st;
    try { st = lstatSync(at); } catch { return; }
    total += st.blocks !== undefined ? st.blocks * 512 : st.size;
    if (!st.isDirectory()) return;
    let names = [];
    try { names = readdirSync(at); } catch { return; }
    for (const name of names) walk(join(at, name));
  };
  walk(path);
  return total;
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
}

/** Top-level folder names under `root` that some process has open (a cwd, an open file), by lsof. */
function heldUnder(root) {
  const out = run("lsof", ["-n", "-P", "-w", "-F", "n"]);
  if (out.error || !out.stdout) throw new Error(`lsof could not list open files${out.error ? `: ${out.error.message}` : ""}; nothing removed`);
  const held = new Set();
  const prefixes = [...new Set([root, realpathSync(root)])].map(at => at.endsWith(sep) ? at : at + sep);
  for (const line of out.stdout.split("\n")) {
    if (!line.startsWith("n")) continue;
    const path = line.slice(1);
    const prefix = prefixes.find(candidate => path.startsWith(candidate));
    if (prefix) held.add(path.slice(prefix.length).split(sep)[0]);
  }
  return held;
}

/**
 * Folders this repository's tools and their tests made before work folders carried a marker
 * ("legacy"). Each is named by `mkdtemp` (six letters or digits after the prefix) and has the layout
 * the code that made it gives it:
 *   - run: a work folder of acceptUnit or ratchet (`<tool>-XXXXXX`): `base/` and `head/`, each an
 *     extracted tree (a package.json; a `.git/` only as `extract` makes it, borrowing objects through
 *     `objects/info/alternates`), beside the run's own logs and nothing else;
 *   - fixture: a test repository (`<tool>-test-XXXXXX`, history(), workspace(), repository()): a git
 *     repository whose package.json is named "fixture", with only the files those fixtures write;
 *   - remote: the hook test's bare remote (`pre-push-ratchet-remote-XXXXXX`): a bare git repository;
 *   - cache: a test's dist cache (`<tool>-cache-XXXXXX`): only `<tree sha>-<lock hash>` folders;
 *   - registry: the loosening test's tree (`accept-unit-registry-XXXXXX`): only scripts/rules/registry.json.
 */
const SUFFIX = "[A-Za-z0-9]{6}";
const RUN_ENTRIES = {
  "accept-unit": ["base", "head", "base-build.log", "head-build.log", "base.log", "head.log"],
  "pre-push-ratchet": ["base", "head", "base-build.log", "head-build.log"],
};
export const LEGACY = {
  "accept-unit": [["run", new RegExp(`^accept-unit-${SUFFIX}$`)], ["fixture", new RegExp(`^accept-unit-test-${SUFFIX}$`)], ["cache", new RegExp(`^accept-unit-cache-${SUFFIX}$`)], ["registry", new RegExp(`^accept-unit-registry-${SUFFIX}$`)]],
  "pre-push-ratchet": [["run", new RegExp(`^pre-push-ratchet-${SUFFIX}$`)], ["fixture", new RegExp(`^pre-push-ratchet-test-${SUFFIX}$`)], ["remote", new RegExp(`^pre-push-ratchet-remote-${SUFFIX}$`)], ["cache", new RegExp(`^pre-push-ratchet-cache-${SUFFIX}$`)]],
};

const kindOf = (at, want) => { try { const st = lstatSync(at); return want === "dir" ? st.isDirectory() : st.isFile(); } catch { return false; } };
const only = (dir, allowed) => { try { return readdirSync(dir).every(name => allowed.includes(name)); } catch { return false; } };

function extractedTree(tree) {
  if (!kindOf(tree, "dir") || !kindOf(join(tree, "package.json"), "file")) return false;
  if (!existsSync(join(tree, ".git"))) return true;
  return kindOf(join(tree, ".git"), "dir") && kindOf(join(tree, ".git", "objects", "info", "alternates"), "file");
}

const SHAPES = {
  run: (dir, tool) => only(dir, RUN_ENTRIES[tool]) && extractedTree(join(dir, "base")) && extractedTree(join(dir, "head"))
    && RUN_ENTRIES[tool].filter(name => name.endsWith(".log")).every(name => !existsSync(join(dir, name)) || kindOf(join(dir, name), "file")),
  fixture: dir => {
    if (!only(dir, [".git", ".gitignore", "node_modules", "package.json", "packages", "scripts"])) return false;
    if (!kindOf(join(dir, ".git"), "dir") || !kindOf(join(dir, ".git", "HEAD"), "file") || existsSync(join(dir, ".git", "objects", "info", "alternates"))) return false;
    try { return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name === "fixture"; } catch { return false; }
  },
  remote: dir => {
    if (!only(dir, ["HEAD", "config", "description", "hooks", "info", "objects", "refs", "packed-refs"])) return false;
    if (!kindOf(join(dir, "HEAD"), "file") || !kindOf(join(dir, "objects"), "dir") || !kindOf(join(dir, "refs"), "dir")) return false;
    try { return /^\s*bare\s*=\s*true\s*$/m.test(readFileSync(join(dir, "config"), "utf8")); } catch { return false; }
  },
  cache: dir => { try { return readdirSync(dir).every(name => /^[0-9a-f]{40}-[0-9a-f]{12}$/.test(name) && kindOf(join(dir, name), "dir")); } catch { return false; } },
  registry: dir => only(dir, ["scripts"]) && only(join(dir, "scripts"), ["rules"]) && only(join(dir, "scripts", "rules"), ["registry.json"]) && kindOf(join(dir, "scripts", "rules", "registry.json"), "file"),
};

/** The legacy kind of `dir` for `tools`, or undefined: its name fully matches a pattern and its layout is that kind's. */
export function legacyKind(dir, tools = WORK_TOOLS) {
  const name = basename(dir);
  for (const tool of tools) {
    for (const [kind, pattern] of LEGACY[tool] ?? []) {
      if (pattern.test(name)) return { tool, kind, shape: kindOf(dir, "dir") && SHAPES[kind](dir, tool) };
    }
  }
  return undefined;
}

/** The newest mtime of a folder and its direct entries: a folder still being written is young. */
function newestMtime(dir) {
  let newest = lstatSync(dir).mtimeMs;
  for (const name of readdirSync(dir)) { try { newest = Math.max(newest, lstatSync(join(dir, name)).mtimeMs); } catch {} }
  return newest;
}

/** `lsof +D dir`: "held" when a process has a file or cwd under it, "free" when none, "failed" otherwise. */
export function lsofDir(dir, { lsof = "lsof" } = {}) {
  const out = run(lsof, ["-w", "-n", "-P", "+D", dir]);
  if (out.error) return "failed";
  // macOS lsof exits 1 with +D even when it lists a holder: any listed process is a holder.
  if (out.stdout.trim()) return "held";
  if (out.status === 1 && !out.stdout.trim() && !out.stderr.trim()) return "free";
  return "failed";
}

/** Remove a legacy folder after rechecking it is a direct child of `root`, a real folder, and legacy-shaped. */
export function removeLegacy(dir, { root = tmpdir(), tools = WORK_TOOLS } = {}) {
  const kind = legacyKind(dir, tools);
  if (!kind?.shape) throw new Error(`refusing to remove ${dir}: not a legacy folder of ${tools.join(", ")}`);
  if (!kindOf(dir, "dir") || realpathSync(dirname(dir)) !== realpathSync(root)) throw new Error(`refusing to remove ${dir}: not a folder directly under ${root}`);
  rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
}

/**
 * Remove the work folders a killed run left behind: only folders directly under `root` whose name
 * starts with one of `tools` followed by "-" and that carry that tool's marker, started more than
 * `maxAgeMs` ago, made on this host by a process that is gone, and that no live process holds open.
 * With `adoptLegacy`, an unmarked folder is removed too, but only when its name fully matches one of
 * that tool's LEGACY patterns, its layout is that pattern's (`legacyKind`), its newest mtime is older
 * than `maxAgeMs`, no process holds it in the system-wide open-file list and `lsof +D` on it reports
 * no holder; an lsof that fails removes nothing. Every other folder is left alone. Returns what was
 * removed and kept (with why), the bytes those folders held and the volume's free space before and after.
 */
export function cleanStale({ root = tmpdir(), tools = WORK_TOOLS, maxAgeMs = STALE_AFTER_MS, now = Date.now(), held, adoptLegacy = false, lsof = "lsof" } = {}) {
  const free = () => { const fs = statfsSync(root); return fs.bavail * fs.bsize; };
  const freeBefore = free();
  const holders = held ?? heldUnder(root);
  const removed = [], kept = [];
  let bytes = 0;
  for (const name of readdirSync(root).sort()) {
    if (name === "foundry-dist-cache" || !tools.some(tool => name.startsWith(`${tool}-`))) continue;
    const work = join(root, name);
    try { if (!lstatSync(work).isDirectory()) continue; } catch { continue; }
    const marker = workMarker(work, tools);
    let why, legacy;
    if (marker) {
      why = now - Date.parse(marker.started) < maxAgeMs ? "young"
        : marker.host !== hostname() ? "other-host"
        : active.has(work) || alive(marker.pid) ? "live-process"
        : holders.has(name) ? "held-open"
        : undefined;
    } else if (!adoptLegacy) {
      why = "unmarked";
    } else {
      legacy = legacyKind(work, tools);
      why = !legacy ? "legacy-name"
        : !legacy.shape ? "legacy-shape"
        : now - newestMtime(work) < maxAgeMs ? "legacy-young"
        : holders.has(name) ? "held-open"
        : undefined;
      if (!why) {
        const state = lsofDir(work, { lsof });
        why = state === "held" ? "held-open" : state === "failed" ? "lsof-failed" : undefined;
      }
    }
    if (why) { kept.push({ name, why }); continue; }
    const size = diskUsage(work);
    if (marker) removeWork(work); else removeLegacy(work, { root, tools });
    bytes += size;
    removed.push({ name, bytes: size, kind: legacy ? `legacy-${legacy.kind}` : "marked" });
  }
  return { root, removed, kept, bytes, freeBefore, freeAfter: free(), adoptLegacy };
}

/** One line for a cleanStale result. */
export function staleReport(result) {
  const gib = n => `${(n / 2 ** 30).toFixed(2)} GiB`;
  const count = (list, key) => Object.entries(list.reduce((all, entry) => ({ ...all, [entry[key]]: (all[entry[key]] ?? 0) + 1 }), {})).sort().map(([k, n]) => `${n} ${k}`).join(", ");
  const unmarked = result.kept.filter(entry => entry.why === "unmarked").length;
  const keptWhy = result.adoptLegacy ? count(result.kept, "why") || "none" : `${unmarked} unmarked, never touched`;
  const removedKinds = result.removed.length ? ` [${count(result.removed, "kind")}]` : "";
  return `clean-stale${result.adoptLegacy ? " --adopt-legacy" : ""} ${result.root}: removed ${result.removed.length} folder(s)${removedKinds}, ${gib(result.bytes)} allocated; kept ${result.kept.length} (${keptWhy}); free ${gib(result.freeBefore)} -> ${gib(result.freeAfter)}`;
}

/** The marker-mode clean every run starts with; it never blocks the run, it warns instead. */
export function startupClean(tool) {
  try {
    const result = cleanStale({ tools: [tool] });
    if (result.removed.length) console.error(staleReport(result));
    return result;
  } catch (error) {
    console.error(`${tool}: could not clean stale work folders (${error.message}); continuing`);
    return undefined;
  }
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
/** The cache keeps at most this many tree entries and this many allocated bytes, newest first. */
export const DIST_CACHE_KEEP = 8;
export const DIST_CACHE_MAX_BYTES = 1024 * 1024 * 1024;

/**
 * Prune the cache to `keep` entries and `maxBytes`, dropping the least recently used first. `current`
 * (the entry this run is using) is always kept and counts toward both caps. A scratch folder
 * (`.tmp-<pid>-<ms>`) is an unfinished store: left alone while its process lives, removed once that
 * process is gone and it is older than STALE_AFTER_MS.
 */
export function pruneCache(cache, { keep = DIST_CACHE_KEEP, maxBytes = DIST_CACHE_MAX_BYTES, current, now = Date.now() } = {}) {
  if (!existsSync(cache)) return { removed: [], bytes: 0 };
  const removed = [];
  const drop = name => { rmSync(join(cache, name), { recursive: true, force: true, maxRetries: 3 }); removed.push(name); };
  const entries = [];
  for (const name of readdirSync(cache)) {
    let at;
    try { at = statSync(join(cache, name)).mtimeMs; } catch { continue; }
    const scratch = /\.tmp-(\d+)-(\d+)$/.exec(name);
    if (scratch) { if (!alive(Number(scratch[1])) && now - Number(scratch[2]) > STALE_AFTER_MS) drop(name); continue; }
    if (name.includes(".tmp-")) continue;
    entries.push({ name, at, bytes: diskUsage(join(cache, name)) });
  }
  entries.sort((a, b) => (b.name === current) - (a.name === current) || b.at - a.at);
  let count = 0, bytes = 0;
  for (const entry of entries) {
    if (entry.name !== current && (count + 1 > keep || bytes + entry.bytes > maxBytes)) { drop(entry.name); continue; }
    count += 1;
    bytes += entry.bytes;
  }
  return { removed, bytes };
}

const tail = (out, n = 20) => `${out.stdout ?? ""}\n${out.stderr ?? ""}${out.error ? `\n${out.error.message}` : ""}`.split("\n").map(line => line.trimEnd()).filter(Boolean).slice(-n);

/**
 * Build `dirs` (from distOrder) inside an extracted tree, in order, each with distCommand of its own
 * `build` script, its own sources and the linked node_modules. The files a build adds are cached under
 * `<cache>/<tree sha>-<installed lockfile hash>/<dir>`, so the same tree is built once and restored after
 * that. A build that fails, or that rewrites a tracked file, is returned as `failure` and stops the rest.
 */
export function buildDist(repo, sha, tree, dirs, { cache = DIST_CACHE, log, cacheKeep = DIST_CACHE_KEEP, cacheMaxBytes = DIST_CACHE_MAX_BYTES } = {}) {
  const result = { built: [], cached: [] };
  if (!dirs.length) return result;
  const treeSha = run("git", ["rev-parse", "--verify", `${sha}^{tree}`], { cwd: repo }).stdout.trim();
  const lock = join(repo, "node_modules", ".package-lock.json");
  const installed = createHash("sha256").update(existsSync(lock) ? readFileSync(lock) : "none").digest("hex").slice(0, 12);
  const home = join(cache, `${treeSha}-${installed}`);
  mkdirSync(home, { recursive: true });
  const now = new Date();
  utimesSync(home, now, now);
  const prune = () => pruneCache(cache, { keep: cacheKeep, maxBytes: cacheMaxBytes, current: basename(home) });
  prune();
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
    const out = run("/bin/sh", ["-c", command], { cwd: join(tree, dir), env: treeEnv({ FORCE_COLOR: "0", NO_COLOR: "1", PATH }, tree) });
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
  // What this run stored counts too: the cache is held to its caps after the store, not only before.
  if (result.built.length) prune();
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
  const out = run("npm", ["run", "--silent", script], { cwd: join(tree, dir), env: treeEnv({ FORCE_COLOR: "0" }, tree) });
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
 *
 * A planned npm script lives in a package.json; when the base has no such package.json the script
 * cannot be carried and applyOverlay refuses (an error, the run fails closed). The pre-push ratchet
 * measures a package absent at base absolutely on the head and never runs it on the base, so it passes
 * `absentPackages: true`: those scripts are then left uncarried and listed in `uncarried`
 * (`<dir>#<script>`), decided on the pristine base before any build or overlay. Every other caller
 * keeps the refusal.
 */
export async function prepareTrees({ repo, baseSha, headSha, baseTree, headTree, entries, work, cache, absentPackages = false }) {
  const plan = await overlayPlan(headTree, entries);
  // Policy data is compared before any build or overlay touches either tree.
  const loosened = loosening(baseTree, headTree, plan.policy);
  plan.removed = policyFiles(baseTree, headTree, plan.reached).filter(file => file !== REGISTRY_FILE && !plan.policy.includes(file));
  const uncarried = absentPackages ? plan.scripts.filter(key => !existsSync(join(baseTree, key.slice(0, key.lastIndexOf("#")), "package.json"))).sort() : [];
  plan.scripts = plan.scripts.filter(key => !uncarried.includes(key));
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
  return { overlaid, removed: plan.removed, seeds, builds, loosened, uncarried };
}

const LOGS = ["base-build.log", "head-build.log", "base.log", "head.log"];

/** The last `n` lines of each log a run wrote, read before its folder is removed. */
function logTails(work, n = 20) {
  return Object.fromEntries(LOGS.filter(name => existsSync(join(work, name))).map(name => [name, readFileSync(join(work, name), "utf8").split("\n").map(line => line.trimEnd()).filter(Boolean).slice(-n)]));
}

/**
 * Measure `check` on `base` and `head`. The work folder (both trees, their node_modules clones and
 * built dist/, and the logs) is removed when the run ends, pass, fail or error, unless `keep`; the
 * result then carries the last lines of each log (`logs`) and `kept: false`.
 */
export async function acceptUnit({ base, head, check, cwd = process.cwd(), cache, keep = false, root }) {
  const repo = gitTop(cwd);
  const baseSha = commit(repo, base), headSha = commit(repo, head);
  const work = makeWork("accept-unit", { root });
  const where = keep ? `; trees and logs kept in ${work}` : "; trees removed (--keep keeps them)";
  let result;
  try {
    result = await measureUnit({ repo, baseSha, headSha, check, work, cache });
  } catch (error) {
    if (keep) error.work = work;
    throw error;
  } finally {
    if (!keep) {
      if (result) result.logs = logTails(work);
      removeWork(work);
    }
  }
  return { ...result, work, kept: keep, line: result.line + where };
}

async function measureUnit({ repo, baseSha, headSha, check, work, cache }) {
  const baseTree = join(work, "base"), headTree = join(work, "head");
  extract(repo, baseSha, baseTree);
  extract(repo, headSha, headTree);
  const target = resolveCheck(headTree, check);
  const name = target.dir === "." ? target.script : `${target.dir}#${target.script}`;
  // Always the head's check on both sides: a base's own (stricter) check would let a weakened head pass.
  const { overlaid, builds, loosened } = await prepareTrees({ repo, baseSha, headSha, baseTree, headTree, entries: [target], work, cache });
  const carried = `; base measured with the head check (${overlaid.length} file(s) overlaid)`;
  if (loosened.length) {
    const line = `FAIL ${name}: loosened, the head relaxes policy data the check reads (${loosened.slice(0, 5).join("; ")}${loosened.length > 5 ? `; ${loosened.length - 5} more` : ""})${carried}`;
    return { pass: false, baseExit: undefined, headExit: undefined, overlaid, builds, loosened, line, load: {} };
  }
  const broken = ["base", "head"].filter(side => builds[side].failure);
  if (broken.length) {
    const why = broken.map(side => `; ${buildFailure(side, builds[side].failure)}`).join("");
    const line = `FAIL ${name}: not measured, base ${baseSha.slice(0, 9)} and head ${headSha.slice(0, 9)} must both build what the check loads${why}${carried}`;
    return { pass: false, baseExit: undefined, headExit: undefined, overlaid, builds, loosened, line, load: {} };
  }
  const baseRun = runCheck(baseTree, target, join(work, "base.log"));
  const headRun = runCheck(headTree, target, join(work, "head.log"));
  const baseExit = baseRun.exit, headExit = headRun.exit;
  const pass = baseExit === FINDING_EXIT && !baseRun.load && headExit === 0;
  const unloaded = [["base", baseRun], ["head", headRun]].filter(([, side]) => side.load).map(([side, { load }]) => `; the ${side} could not load the check (${load})`).join("");
  const noVerdict = baseExit !== 0 && baseExit !== FINDING_EXIT ? `; the base exit ${baseExit} is a usage, read or run error, not a finding` : "";
  const line = `${pass ? "PASS" : "FAIL"} ${name}: base ${baseSha.slice(0, 9)} exit ${baseExit} (want ${FINDING_EXIT}), head ${headSha.slice(0, 9)} exit ${headExit} (want 0)${carried}${unloaded}${noVerdict}`;
  return { pass, baseExit, headExit, overlaid, builds, loosened, line, load: { base: baseRun.load, head: headRun.load } };
}

/** On SIGINT, SIGTERM or SIGHUP remove this process's work folders (unless kept), then exit 128 + n. */
export function removeWorkOnSignal({ keep = false } = {}) {
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      if (!keep) removeActiveWork();
      process.exit(128 + (constants.signals[signal] ?? 0));
    });
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const usage = "usage: node scripts/accept-unit.mjs [--keep] <base> <head> <check-script | dir#script>\n       node scripts/accept-unit.mjs --clean-stale [--adopt-legacy]";
  const args = process.argv.slice(2);
  if (args[0] === "--clean-stale" && (args.length === 1 || (args.length === 2 && args[1] === "--adopt-legacy"))) {
    try {
      console.log(staleReport(cleanStale({ tools: ["accept-unit"], adoptLegacy: args[1] === "--adopt-legacy" })));
      process.exit(0);
    } catch (error) {
      console.error(`accept-unit --clean-stale: ${error.message}`);
      process.exit(2);
    }
  }
  const keep = args.includes("--keep");
  const positional = args.filter(arg => arg !== "--keep");
  if (positional.length !== 3 || positional.some(arg => arg.startsWith("-")) || args.filter(arg => arg === "--keep").length > 1) {
    console.error(usage);
    process.exit(2);
  }
  removeWorkOnSignal({ keep });
  startupClean("accept-unit");
  try {
    const [base, head, check] = positional;
    const result = await acceptUnit({ base, head, check, keep });
    console.log(result.line);
    if (!result.pass && result.logs) {
      for (const [name, lines] of Object.entries(result.logs)) if (lines.length) console.log(`--- ${name} (last ${lines.length} line(s))\n${lines.join("\n")}`);
    }
    process.exit(result.pass ? 0 : 1);
  } catch (error) {
    console.error(`accept-unit: ${error.message}${error.work ? ` (trees and logs kept in ${error.work})` : ""}`);
    process.exit(2);
  }
}
