#!/usr/bin/env node
/**
 * CONTAM-U3 D5 codemod: the recipe command lines in the five agent packages stop citing their own package by its
 * repository path. A craft.md runs in the consumer root, which has no packages/ folder, so a line such as
 * `node packages/designer/recipes/stage-check.mjs brief <slot> brief.json` resolves nothing there. Each one is
 * rewritten to the clossys verb that finds the recipe's tool by recipe id (packages/producer/src/cli/recipe.ts):
 *
 *   node packages/<agent>/recipes/stage-check.mjs <stage> ...    -> clossys recipe check <recipe-id> <stage> ...
 *   node packages/${agent}/recipes/stage-check.mjs ...           -> clossys recipe check <recipe-id> ...   (in the
 *                                                                   agent's shared stage-check.mjs or stage-core.mjs)
 *   node packages/<agent>/recipes/<id>/<generator> ...           -> clossys recipe generate <id> ...
 *   node --test packages/<agent>/recipes/recipes.test.mjs        -> node --test <path relative to the citing file>
 *
 * The recipe id is the recipe folder that holds the citing file; in the stage check's own header, which serves
 * every recipe of the agent, it is the placeholder <recipe-id>. A generator line is rewritten only when that
 * recipe's recipe.json declares that generator. The test runner line has no recipe verb (it is a development
 * command, not a recipe tool), so its path is spelled relative to the citing file.
 *
 * Every rewrite is checked before anything is written: the cited file must exist, the recipe folder must hold a
 * recipe.json, and the generator must be the one it declares. Any failure names the path and the run writes
 * nothing (exit 1). An own-package `packages/<agent>/` path that no rule covers is also a failure, so nothing is
 * left behind silently. A templated command line (`node packages/${...}/...`) can name any package, so it is
 * rewritten only where it is the agent's own shared stage check (recipes/stage-check.mjs or recipes/stage-core.mjs,
 * with this package's stage check present); anywhere else it is a failure naming the file. Another package's path is not a self-path and is left as it is. `--skill packages/<agent>/...` arguments are skill ids, not paths (CONTAM-U3 D5), and
 * are never touched.
 *
 *   node scripts/codemod-contam-u3.mjs          rewrite in place, print each rewrite
 *   node scripts/codemod-contam-u3.mjs --check  write nothing; exit 1 when a rewrite is still pending
 *
 * A second run changes nothing.
 */
import { agentList } from "./lib/agent-lists.mjs";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGES = agentList("nav");
const TREES = ["recipes", "actions"];
const TEXT = /\.(md|mjs|js|ts|json|txt)$/;

const STAGE_CHECK = /\bnode packages\/([a-z][a-z0-9-]*)\/recipes\/stage-check\.mjs(?=\s)/g;
const GENERATOR = /\bnode packages\/([a-z][a-z0-9-]*)\/recipes\/([^/\s`'"]+)\/([^/\s`'"]+\.mjs)(?=\s)/g;
const TEMPLATE_STAGE_CHECK = /\bnode packages\/\$\{[A-Za-z_$][\w$.]*\}\/recipes\/stage-check\.mjs(?=\s)/g;
const SHARED_STAGE_FILES = ["recipes/stage-check.mjs", "recipes/stage-core.mjs"];
const TEST_RUN = /\bnode --test packages\/([a-z][a-z0-9-]*)\/recipes\/recipes\.test\.mjs\b/g;
const SKILL_ARG = /--skill(?:=|[ \t]+)$/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (TEXT.test(name)) out.push(path);
  }
  return out;
}

/** The recipe folder (`recipes/<id>/`) a package-relative file sits in, or undefined. */
function recipeIdOf(rel) {
  return /^recipes\/([^/]+)\//.exec(rel)?.[1];
}

/**
 * Rewrites one file's text. Returns { text, rewrites, failures }; a failure names the cited path and why.
 * `repo` is the repository root, `pkg` the owning package, `rel` the file's path inside the package.
 */
export function rewriteText(repo, pkg, rel, text) {
  const rewrites = [];
  const failures = [];
  const pkgRoot = join(repo, "packages", pkg);
  const lines = text.split("\n");
  const out = lines.map((line, index) => {
    const at = `packages/${pkg}/${rel}:${index + 1}`;
    let next = line.replace(STAGE_CHECK, (whole, agent) => {
      const cited = `packages/${agent}/recipes/stage-check.mjs`;
      if (agent !== pkg) return whole; // another package's path: not this package's self-path, left as it is
      if (!existsSync(join(repo, cited))) { failures.push(`${at}: ${cited} does not exist`); return whole; }
      let id;
      if (rel === "recipes/stage-check.mjs") id = "<recipe-id>";
      else {
        id = recipeIdOf(rel);
        if (!id) { failures.push(`${at}: ${cited} is cited outside a recipe folder, so there is no recipe id to run it by`); return whole; }
        if (!existsSync(join(pkgRoot, "recipes", id, "recipe.json"))) { failures.push(`${at}: packages/${pkg}/recipes/${id}/recipe.json does not exist`); return whole; }
      }
      const to = `clossys recipe check ${id}`;
      rewrites.push(`${at}: node ${cited} -> ${to}`);
      return to;
    });
    next = next.replace(GENERATOR, (whole, agent, id, script) => {
      const cited = `packages/${agent}/recipes/${id}/${script}`;
      if (agent !== pkg) return whole; // another package's path: not this package's self-path, left as it is
      if (!existsSync(join(repo, cited))) { failures.push(`${at}: ${cited} does not exist`); return whole; }
      const doc = join(pkgRoot, "recipes", id, "recipe.json");
      if (!existsSync(doc)) { failures.push(`${at}: packages/${pkg}/recipes/${id}/recipe.json does not exist`); return whole; }
      let generator;
      try { generator = JSON.parse(readFileSync(doc, "utf8")).generator; } catch (error) { failures.push(`${at}: packages/${pkg}/recipes/${id}/recipe.json does not parse: ${error.message}`); return whole; }
      if (generator !== script) { failures.push(`${at}: ${cited} is not the generator packages/${pkg}/recipes/${id}/recipe.json declares (${generator ?? "none"})`); return whole; }
      const to = `clossys recipe generate ${id}`;
      rewrites.push(`${at}: node ${cited} -> ${to}`);
      return to;
    });
    next = next.replace(TEMPLATE_STAGE_CHECK, whole => {
      const cited = whole.slice("node ".length);
      if (!SHARED_STAGE_FILES.includes(rel)) { failures.push(`${at}: ${cited} is a templated command line outside the agent's shared stage check, so there is no recipe tool to name`); return whole; }
      if (!existsSync(join(pkgRoot, "recipes", "stage-check.mjs"))) { failures.push(`${at}: ${cited} stands for packages/${pkg}/recipes/stage-check.mjs, which does not exist`); return whole; }
      const to = "clossys recipe check <recipe-id>";
      rewrites.push(`${at}: node ${cited} -> ${to}`);
      return to;
    });
    next = next.replace(TEST_RUN, (whole, agent) => {
      const cited = `packages/${agent}/recipes/recipes.test.mjs`;
      if (agent !== pkg) return whole; // another package's path: not this package's self-path, left as it is
      if (!existsSync(join(repo, cited))) { failures.push(`${at}: ${cited} does not exist`); return whole; }
      const spelled = posix.relative(posix.dirname(rel), "recipes/recipes.test.mjs") || "recipes.test.mjs";
      if (!existsSync(join(pkgRoot, posix.dirname(rel), spelled))) { failures.push(`${at}: ${spelled} does not resolve from ${posix.dirname(rel)}`); return whole; }
      const to = `node --test ${spelled}`;
      rewrites.push(`${at}: node --test ${cited} -> ${to}`);
      return to;
    });
    // Nothing of this package's own repository path may be left as a command line; --skill ids are ids.
    for (const m of next.matchAll(new RegExp(`\\bnode (?:--test )?packages/${pkg}/\\S*`, "g"))) {
      if (SKILL_ARG.test(next.slice(0, m.index))) continue;
      failures.push(`${at}: ${m[0].slice(m[0].indexOf("packages/"))} is an own-package command line no rule rewrites`);
    }
    // A templated package path names no package until it runs, so no templated command line may be left either.
    for (const m of next.matchAll(/\bnode (?:--test )?packages\/\$\{[^}]*\}\S*/g)) {
      failures.push(`${at}: ${m[0].slice(m[0].indexOf("packages/"))} is a templated command line no rule rewrites`);
    }
    return next;
  });
  return { text: out.join("\n"), rewrites, failures };
}

export function run(repo, { check = false } = {}) {
  const changes = [];
  const rewrites = [];
  const failures = [];
  for (const pkg of PACKAGES) {
    for (const tree of TREES) {
      const base = join(repo, "packages", pkg, tree);
      if (!existsSync(base)) continue;
      for (const file of walk(base)) {
        const rel = relative(join(repo, "packages", pkg), file).split("\\").join("/");
        const before = readFileSync(file, "utf8");
        const result = rewriteText(repo, pkg, rel, before);
        failures.push(...result.failures);
        rewrites.push(...result.rewrites);
        if (result.text !== before) changes.push([file, result.text]);
      }
    }
  }
  if (failures.length) return { code: 1, text: `codemod-contam-u3: ${failures.length} path(s) do not resolve; nothing written\n${failures.join("\n")}\n` };
  if (check) return { code: changes.length ? 1 : 0, text: changes.length ? `codemod-contam-u3 --check: ${rewrites.length} rewrite(s) pending in ${changes.length} file(s)\n${rewrites.join("\n")}\n` : "codemod-contam-u3 --check: nothing to rewrite\n" };
  for (const [file, text] of changes) writeFileSync(file, text);
  return { code: 0, text: `codemod-contam-u3: ${rewrites.length} rewrite(s) in ${changes.length} file(s)\n${rewrites.join("\n")}${rewrites.length ? "\n" : ""}` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const unknown = args.filter(arg => arg !== "--check");
  if (unknown.length) { process.stderr.write(`codemod-contam-u3: unknown argument ${unknown[0]}\nUsage: node scripts/codemod-contam-u3.mjs [--check]\n`); process.exit(2); }
  const result = run(resolve(dirname(fileURLToPath(import.meta.url)), ".."), { check: args.includes("--check") });
  (result.code === 0 ? process.stdout : process.stderr).write(result.text);
  process.exitCode = result.code;
}
