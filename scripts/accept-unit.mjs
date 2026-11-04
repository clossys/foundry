#!/usr/bin/env node
/**
 * Unit acceptance by check: a unit is accepted when its check fails on the base and passes on the head.
 *
 *   node scripts/accept-unit.mjs <base> <head> <check-script>
 *
 * <check-script> is an npm script name found in exactly one package.json of the head tree, or
 * `<package dir>#<script>` (the root is "."). Each revision is extracted with `git archive` into a
 * fresh temporary directory beside the other, the current checkout's node_modules folders are linked
 * in, and the script runs there with `npm run`. When the base has no such script, the head's script
 * definition and the check code files it reaches (the check:orphan-checks graph) are overlaid onto
 * the base, so the base is measured by the head's check; the verdict says so.
 *
 * Prints one line: PASS or FAIL, both exit codes, and where the trees and logs are kept (they are
 * left in place for inspection). Exits 0 on PASS, 1 on FAIL, 2 on a usage or setup error.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { reachable } from "./check-orphan-checks.mjs";

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

export function extract(repo, sha, into) {
  mkdirSync(into, { recursive: true });
  const out = run("sh", ["-c", 'git -C "$1" archive --format=tar "$2" | tar -x -C "$3"', "sh", repo, sha, into]);
  if (out.status !== 0) throw new Error(`git archive ${sha} failed: ${out.stderr.trim()}`);
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

/** Link the checkout's installed node_modules into an extracted tree (never copied, never installed). */
export function linkModules(checkout, tree) {
  for (const dir of packageDirs(checkout)) {
    const from = join(checkout, dir, "node_modules"), to = join(tree, dir, "node_modules");
    if (existsSync(from) && existsSync(join(tree, dir)) && !existsSync(to)) symlinkSync(from, to, "dir");
  }
}

/**
 * Give the base the head's checks: every check code file the entries reach (the check:orphan-checks
 * graph), any `extra` repository paths, and the head's definition of every npm script the entries run.
 * Code only: data the checks read (fixtures, records, the tree under test) stays the base's own.
 */
export async function overlayChecks(headTree, baseTree, entries, { extra = [] } = {}) {
  const { reached, scripts } = await reachable(headTree, { entries });
  const files = [...new Set([...[...reached].filter(file => CODE.test(file)), ...extra])].sort();
  for (const file of files) {
    mkdirSync(dirname(join(baseTree, file)), { recursive: true });
    copyFileSync(join(headTree, file), join(baseTree, file));
  }
  for (const key of scripts.keys ? scripts.keys() : scripts) {
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
  const out = run("npm", ["run", "--silent", script], { cwd: join(tree, dir), env: { ...process.env, FORCE_COLOR: "0" } });
  writeFileSync(log, `$ npm run ${script}  (cwd ${dir})\n${out.stdout ?? ""}${out.stderr ?? ""}${out.error ? `\n${out.error.message}\n` : ""}`);
  return out.status ?? 1;
}

export async function acceptUnit({ base, head, check, cwd = process.cwd() }) {
  const repo = gitTop(cwd);
  const baseSha = commit(repo, base), headSha = commit(repo, head);
  const work = mkdtempSync(join(tmpdir(), "accept-unit-"));
  const baseTree = join(work, "base"), headTree = join(work, "head");
  extract(repo, baseSha, baseTree);
  extract(repo, headSha, headTree);
  const target = resolveCheck(headTree, check);
  const overlaid = typeof scriptsOf(baseTree, target.dir)[target.script] === "string" ? undefined : await overlayChecks(headTree, baseTree, [target]);
  linkModules(repo, baseTree);
  linkModules(repo, headTree);
  const baseExit = runCheck(baseTree, target, join(work, "base.log"));
  const headExit = runCheck(headTree, target, join(work, "head.log"));
  const pass = baseExit !== 0 && headExit === 0;
  const name = target.dir === "." ? target.script : `${target.dir}#${target.script}`;
  const carried = overlaid ? `; base measured with the head check (${overlaid.length} file(s) overlaid)` : "";
  const line = `${pass ? "PASS" : "FAIL"} ${name}: base ${baseSha.slice(0, 9)} exit ${baseExit} (want non-zero), head ${headSha.slice(0, 9)} exit ${headExit} (want 0)${carried}; trees and logs in ${work}`;
  return { pass, baseExit, headExit, overlaid, work, line };
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
