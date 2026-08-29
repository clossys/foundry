import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// check-workflow-references — a future `check:*` script added only to the
// local `npm run check` aggregate, and to no workflow, is exactly issue
// #414: this repository measured six job-shaped packages shipping eleven
// bin entry points with two ever invoked by a workflow, and separately
// found `check:neutrality` and `check:root-entry` sitting in `npm run
// check` with no workflow reference at all -- the structural half of
// publish safety, unenforced in CI, on a public repository, for a gate that
// existed and simply never ran. This test makes the SAME class of gap fail
// loudly the next time a `check:*` script is added without a workflow to
// run it, rather than being found again by hand.
//
// DETECTION IS DELIBERATELY SHALLOW: a `check:*` script's own npm name (the
// `npm run check:x` form some workflow steps use), OR any `scripts/*.mjs`
// file it invokes, OR any `packages/*/dist/*.js` compiled entry point it
// invokes (this repository's gates are invoked by dist path, not bin name —
// see AGENTS.md-adjacent memory on that trap, and `check:package-governance`
// / `check:repository-profile` below for the pattern) is searched for as a
// plain substring across every workflow file's raw text. This is a coarse
// net on purpose: it does not parse YAML `run:` blocks or shell, so it
// cannot verify a script is invoked CORRECTLY (right arguments, right job,
// right condition) — it can only catch total absence, the specific failure
// mode #414 found. A script referenced only in a comment would also pass;
// that false-negative is an accepted, documented trade for staying a few
// lines instead of a shell parser.

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const workflowsDir = join(repoRoot, ".github", "workflows");

const MJS_PATTERN = /scripts\/[A-Za-z0-9._-]+\.mjs\b/g;
const DIST_JS_PATTERN = /packages\/[A-Za-z0-9._/-]+\.js\b/g;

function fileTokensFor(scriptValue) {
  const tokens = new Set();
  for (const match of scriptValue.matchAll(MJS_PATTERN)) tokens.add(match[0]);
  for (const match of scriptValue.matchAll(DIST_JS_PATTERN)) tokens.add(match[0]);
  return [...tokens];
}

function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Is this script INVOKED by a workflow, as opposed to merely mentioned?
 *
 * `npm run check:x` runs the whole compound, so one invocation vouches for
 * every command inside it. A bare substring match does not: `check:gates`
 * appears in this repository's workflows only inside two COMMENTS explaining
 * why something else is kept out of it, and that was enough to satisfy the
 * previous rule. The negative lookahead stops `check:safety` from being
 * satisfied by `npm run check:safety:strict`.
 */
export function isInvokedByWorkflow(scriptName, workflowText) {
  return new RegExp(`npm run (--silent )?${escapeForRegExp(scriptName)}(?![A-Za-z0-9:_-])`).test(workflowText);
}

/**
 * Decide whether a `check:*` script actually reaches CI.
 *
 * Two ways, and the disjunction is load-bearing in both directions:
 *
 *   invoked   -- a workflow runs `npm run <name>`, which runs everything in it.
 *   allFiles  -- EVERY file the script invokes is referenced somewhere. Not
 *                any file. `check:gates` is `node scripts/test-gates.mjs &&
 *                node --test <ten suites>`; only the first is in a workflow,
 *                and under the previous `.some` rule that one token vouched
 *                for the other ten. Nine of those ten ran in no workflow at
 *                all, and #468 shipped green and turned main red as a direct
 *                result.
 *
 * Requiring `allFiles` alone would be wrong the other way: five scripts here
 * are invoked as `npm run check:x` in a workflow while their inner paths
 * never appear as text, and they are correctly wired. Demanding the paths
 * too would fail all five.
 */
export function reachesCI(scriptName, scriptValue, workflowText) {
  if (isInvokedByWorkflow(scriptName, workflowText)) return true;
  const files = fileTokensFor(scriptValue);
  return files.length > 0 && files.every((token) => workflowText.includes(token));
}

function workflowJob(workflowText, name) {
  const start = workflowText.indexOf(`  ${name}:\n`);
  assert.notEqual(start, -1, `workflow is missing ${name} job`);
  const rest = workflowText.slice(start + 1);
  const next = rest.search(/^  [a-z][a-z0-9-]*:\n/m);
  return workflowText.slice(start, next === -1 ? workflowText.length : start + 1 + next);
}

export function candidateQualificationCiFailures(workflowText) {
  const build = workflowJob(workflowText, "build");
  const failures = [];
  if (!/^  build:\n\s+name: build and test$/m.test(build)) failures.push("required-build-context");
  if (!/- uses: actions\/checkout@[^\n]+\n[ \t]+with:\n(?:[ \t]+#[^\n]+\n)*[ \t]+fetch-depth: 0\b/.test(build)) failures.push("full-history-checkout");
  if (!/^\s+- name: Candidate qualification records\n\s+run: npm run check:candidate-qualification$/m.test(build)) failures.push("candidate-invocation");
  return failures;
}

test("every check:* script in the root manifest is referenced by at least one workflow", () => {
  const rootManifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const checkScripts = Object.entries(rootManifest.scripts ?? {}).filter(([name]) => name.startsWith("check:"));
  assert.ok(checkScripts.length > 0, "expected at least one check:* script in the root manifest — fixture drift?");

  const workflowFiles = readdirSync(workflowsDir).filter((entry) => entry.endsWith(".yml") || entry.endsWith(".yaml"));
  assert.ok(workflowFiles.length > 0, "expected at least one workflow file under .github/workflows");
  const workflowText = workflowFiles.map((file) => readFileSync(join(workflowsDir, file), "utf8")).join("\n");

  const unreferenced = checkScripts.filter(([name, value]) => !reachesCI(name, value, workflowText)).map(([name]) => name);

  assert.deepEqual(
    unreferenced,
    [],
    `check:* script(s) in package.json with no workflow reference (npm run name, scripts/*.mjs, or packages/*/dist/*.js all absent from every .github/workflows/*.yml): ${unreferenced.join(", ")}. ` +
      "A script that is only ever in the local `npm run check` aggregate and never a workflow is a gate that never runs in CI (#414) — wire it into a workflow, or if it genuinely cannot run there, keep it out of `check:*` and document why. " +
      "A COMPOUND script needs every file it runs referenced, or one `npm run <name>` invocation that runs all of them: one wired command does not vouch for its siblings (#472).",
  );
});

test("the required build context fails closed on candidate qualification records with full history", () => {
  const workflow = readFileSync(join(workflowsDir, "ci.yml"), "utf8");
  assert.deepEqual(candidateQualificationCiFailures(workflow), []);
  const build = workflowJob(workflow, "build");

  const withoutInvocation = build.replace(
    "      - name: Candidate qualification records\n        run: npm run check:candidate-qualification\n",
    "",
  );
  assert.deepEqual(candidateQualificationCiFailures(withoutInvocation), ["candidate-invocation"]);

  const shallow = build.replace("          fetch-depth: 0\n", "          fetch-depth: 1\n");
  assert.deepEqual(candidateQualificationCiFailures(shallow), ["full-history-checkout"]);
});

test("every suite in check:gates imports only node builtins and local scripts", () => {
  // `check:gates` runs in ci.yml's dependency-free `safety` job -- no `npm ci`,
  // no build. A suite that imports a workspace package therefore passes
  // locally and fails in CI with a module-not-found, which is exactly what
  // happened: the ten suites were verified dependency-free by hand, and an
  // eleventh importing @clossys/observer was then added to the list,
  // silently invalidating the verification that had just been done.
  //
  // A suite that genuinely needs a build belongs in the `build and test` job
  // as its own step, the way scripts/observation-bundle.test.mjs and
  // scripts/gate-run-history.test.mjs already are.
  const manifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const suites = manifest.scripts["check:gates"].match(/scripts\/[A-Za-z0-9._-]+\.test\.mjs/g) ?? [];
  assert.ok(suites.length > 0, "expected check:gates to name at least one suite — fixture drift?");

  const offenders = [];
  for (const suite of suites) {
    const source = readFileSync(join(repoRoot, suite), "utf8");
    // Import statements only, anchored at the start of a line, so a module
    // specifier appearing inside test FIXTURE data does not count as an
    // import of it.
    for (const [, specifier] of source.matchAll(/^\s*import[^"']*["']([^"']+)["']/gm)) {
      if (!specifier.startsWith("node:") && !specifier.startsWith("./") && !specifier.startsWith("../")) {
        offenders.push(`${suite} -> ${specifier}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `check:gates suite(s) importing something the dependency-free \`safety\` job cannot resolve: ${offenders.join(", ")}. ` +
      "Move the suite to ci.yml's `build and test` job as its own step, next to scripts/observation-bundle.test.mjs.",
  );
});
