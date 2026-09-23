import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { discoverGateTestFiles, GATE_TEST_EXCLUSIONS } from "./lib/gate-test-set.mjs";

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

// "Candidate qualification records" moved out of the `build` job and into
// its own `candidate-qualification` job (CI throughput: it was 946s of a
// 2571s `build and test` run, serial with two other independent steps --
// see that job's own header comment in ci.yml), then sharded a second time
// (#1257) into `candidate-qualification-shard` (an 8-way matrix doing the
// real per-record work) behind `candidate-qualification` (a thin fan-in,
// same #1240 shape as `safety`/`build` use). This function checks all
// three: `candidate-qualification-shard` for the step itself and its own
// full-history checkout, `candidate-qualification` for the fan-in's own
// needs/always() shape, `build` for "Later publication records" (which
// stayed, and needs the SAME full-history checkout for the same "retained
// immutable history join" reason) and for the required-context name.
export function candidateQualificationCiFailures(workflowText) {
  const build = workflowJob(workflowText, "build");
  const shardJob = workflowJob(workflowText, "candidate-qualification-shard");
  const fanInJob = workflowJob(workflowText, "candidate-qualification");
  const fullHistoryCheckout = /- uses: actions\/checkout@[^\n]+\n[ \t]+with:\n(?:[ \t]+#[^\n]+\n)*[ \t]+fetch-depth: 0\b/;
  const failures = [];
  if (!/^  build:\n\s+name: build and test$/m.test(build)) failures.push("required-build-context");
  if (!fullHistoryCheckout.test(build)) failures.push("build-full-history-checkout");
  if (!fullHistoryCheckout.test(shardJob)) failures.push("candidate-full-history-checkout");
  if (
    !/^\s+- name: Candidate qualification records \(this shard's own slice\)\n\s+if: steps\.touch\.outputs\.touches != 'false'\n\s+run: node scripts\/check-candidate-qualification\.mjs --shard-index \$\{\{ matrix\.shard \}\} --shard-count \$\{\{ env\.CANDIDATE_QUALIFICATION_SHARDS \}\}$/m.test(
      shardJob,
    )
  )
    failures.push("candidate-invocation");
  if (!/^\s+- name: Later publication records\n\s+run: npm run check:later-publications$/m.test(build)) failures.push("later-publication-invocation");
  // The fan-in must depend on the shard matrix and be always()-gated, the
  // same reason every other #1240-shaped fan-in in this file needs it: a
  // skipped needs.candidate-qualification.result in build's own check must
  // read as "not success", never silently vanish.
  if (!/^ {4}needs: \[push-tree, candidate-qualification-shard\]$/m.test(fanInJob)) failures.push("candidate-fanin-needs");
  if (!/^ {4}if: always\(\) &&/m.test(fanInJob)) failures.push("candidate-fanin-always");
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

  // Mutations below operate on the full workflow text -- "Candidate
  // qualification records", "Later publication records", and the fan-in's
  // own needs/if: each live in a DIFFERENT job, so a mutation scoped to
  // just one job's extracted text can no longer stand in for the whole
  // file the way it used to.
  const withoutInvocation = workflow.replace(
    "      - name: Candidate qualification records (this shard's own slice)\n        if: steps.touch.outputs.touches != 'false'\n        run: node scripts/check-candidate-qualification.mjs --shard-index ${{ matrix.shard }} --shard-count ${{ env.CANDIDATE_QUALIFICATION_SHARDS }}\n",
    "",
  );
  assert.deepEqual(candidateQualificationCiFailures(withoutInvocation), ["candidate-invocation"]);

  const withoutLaterPublication = workflow.replace(
    "      - name: Later publication records\n        run: npm run check:later-publications\n",
    "",
  );
  assert.deepEqual(candidateQualificationCiFailures(withoutLaterPublication), ["later-publication-invocation"]);

  // Each job's own checkout is a separate full-history requirement now:
  // `candidate-qualification-shard` needs it for the step this test is
  // named after, `build` needs it independently for "Later publication
  // records".
  const shardJob = workflowJob(workflow, "candidate-qualification-shard");
  const shardShallow = workflow.replace(shardJob, shardJob.replace("          fetch-depth: 0\n", "          fetch-depth: 1\n"));
  assert.deepEqual(candidateQualificationCiFailures(shardShallow), ["candidate-full-history-checkout"]);

  const buildJob = workflowJob(workflow, "build");
  const buildShallow = workflow.replace(buildJob, buildJob.replace("          fetch-depth: 0\n", "          fetch-depth: 1\n"));
  assert.deepEqual(candidateQualificationCiFailures(buildShallow), ["build-full-history-checkout"]);

  // The fan-in's own needs:/if: always() -- a skipped or failed matrix must
  // never silently read as success to `build`'s own downstream check.
  const fanInJob = workflowJob(workflow, "candidate-qualification");
  const withoutFanInNeeds = workflow.replace(fanInJob, fanInJob.replace("needs: [push-tree, candidate-qualification-shard]", "needs: [push-tree]"));
  assert.deepEqual(candidateQualificationCiFailures(withoutFanInNeeds), ["candidate-fanin-needs"]);

  const withoutFanInAlways = workflow.replace(
    fanInJob,
    fanInJob.replace(
      "if: always() && (github.event_name != 'push' || needs.push-tree.outputs.duplicate != 'true')",
      "if: github.event_name != 'push' || needs.push-tree.outputs.duplicate != 'true'",
    ),
  );
  assert.deepEqual(candidateQualificationCiFailures(withoutFanInAlways), ["candidate-fanin-always"]);
});

// #1276 review addendum: the shard COUNT is a single tunable
// (CANDIDATE_QUALIFICATION_SHARDS, a workflow-level env var -- currently 4,
// down from an original 8, sized against the Free-plan 20-concurrent-job
// cap under today's fleet-wide load), never a hard-coded matrix array. This
// test proves the derivation chain end to end -- the env var exists with
// today's actual value, push-tree's own step derives the matrix's index
// list from it, the matrix job reads that derived output (not a literal),
// and the invocation step's --shard-count reads the SAME env var, so the
// three can never silently drift apart -- plus the fan-in's own explicit
// check, the same shape #1240 established for `build`/`safety`: fail
// closed on anything other than a clean success.
test("candidate-qualification-shard's matrix count is the single CANDIDATE_QUALIFICATION_SHARDS tunable, and its fan-in fails closed", () => {
  const workflow = readFileSync(join(workflowsDir, "ci.yml"), "utf8");

  assert.match(workflow, /^env:\n(?:[ \t]+#[^\n]*\n)*[ \t]+CANDIDATE_QUALIFICATION_SHARDS: 4$/m, "expected a workflow-level CANDIDATE_QUALIFICATION_SHARDS: 4");

  const pushTree = workflowJob(workflow, "push-tree");
  assert.match(pushTree, /shard-matrix: \$\{\{ steps\.shard-matrix\.outputs\.matrix \}\}/, "push-tree must output the derived shard-matrix");
  assert.match(
    pushTree,
    /id: shard-matrix\n\s+run: \|\n\s+node -e "console\.log\('matrix=' \+ JSON\.stringify\(\[\.\.\.Array\(Number\(process\.env\.CANDIDATE_QUALIFICATION_SHARDS\)\)\.keys\(\)\]\)\)" >> "\$GITHUB_OUTPUT"/,
    "push-tree's shard-matrix step must derive the index list from CANDIDATE_QUALIFICATION_SHARDS, not a literal",
  );

  const shardJob = workflowJob(workflow, "candidate-qualification-shard");
  assert.match(
    shardJob,
    /^ {4}strategy:\n {6}fail-fast: false\n {6}matrix:\n {8}shard: \$\{\{ fromJSON\(needs\.push-tree\.outputs\.shard-matrix\) \}\}$/m,
    "the matrix must read push-tree's derived output, not a hard-coded array",
  );
  assert.match(
    shardJob,
    /run: node scripts\/check-candidate-qualification\.mjs --shard-index \$\{\{ matrix\.shard \}\} --shard-count \$\{\{ env\.CANDIDATE_QUALIFICATION_SHARDS \}\}/,
    "the invocation's --shard-count must read the same tunable the matrix was derived from, never a separate literal",
  );

  const fanInJob = workflowJob(workflow, "candidate-qualification");
  const stepStart = fanInJob.indexOf("- name: All candidate-qualification shards must succeed");
  assert.notEqual(stepStart, -1, "the fan-in must have an explicit check step");
  const stepBody = fanInJob.slice(stepStart);
  assert.match(stepBody, /if: always\(\)/);
  assert.match(stepBody, /needs\.candidate-qualification-shard\.result/);
  assert.match(stepBody, /!= "success"/);
  assert.match(stepBody, /exit 1/);
});

// #<CI throughput issue>: `build and test` used to run "Candidate
// qualification records", "README code examples typecheck against shipped
// declarations" and "Packed consumer readiness" as three serial steps of
// its own -- 2185s of a 2571s run, none of the three depending on either of
// the others. Splitting them into their own parallel jobs only cuts wall
// time honestly if the required context named `build and test` still fails
// whenever any of them does. GitHub's own default undermines that: a job
// that `needs` other jobs is skipped -- not failed -- the moment one of
// them fails, and a SKIPPED required context reports as passing. This test
// proves the fan-in closes that gap structurally: `always()` so the job
// cannot be silently skipped, every split job named in `needs`, and a step
// that treats anything other than a clean 'success' as this job's own
// failure.
test("the build-and-test fan-in genuinely fails when any split job does not succeed", () => {
  const workflow = readFileSync(join(workflowsDir, "ci.yml"), "utf8");
  const build = workflowJob(workflow, "build");
  const splitJobs = ["candidate-qualification", "readme-examples-typecheck", "packed-consumer-readiness"];

  const jobIf = build.match(/^ {4}if: (.+)$/m);
  assert.ok(jobIf, "build and test must declare a job-level if:");
  assert.match(
    jobIf[1],
    /^always\(\) &&/,
    "build and test's if: must be gated by always(), or GitHub's implicit needs-must-succeed default skips it (and a skipped required check passes) the moment a split job fails",
  );

  const needsLine = build.match(/^ {4}needs: \[(.+)\]$/m);
  assert.ok(needsLine, "build and test must declare needs:");
  const needs = needsLine[1].split(",").map((entry) => entry.trim());
  for (const job of splitJobs) {
    assert.ok(needs.includes(job), `build and test must need ${job}, or this job cannot see its result at all`);
  }

  const stepStart = build.indexOf("- name: Split build-and-test jobs must all succeed");
  assert.notEqual(stepStart, -1, "build and test must have an explicit fan-in check step");
  const stepBody = build.slice(stepStart).split(/\n {6}- (?:name|uses):/)[0];

  assert.match(
    stepBody,
    /if: always\(\)/,
    "the fan-in check step must itself run unconditionally, or it can be skipped by an earlier failure in this same job",
  );
  for (const job of splitJobs) {
    assert.match(
      stepBody,
      new RegExp(`needs\\.${job}\\.result`),
      `the fan-in check must inspect needs.${job}.result`,
    );
  }
  assert.match(
    stepBody,
    /!= "success"/,
    "the fan-in check must fail closed on anything other than a clean success (failure, skipped, and cancelled all count)",
  );
  assert.match(stepBody, /exit "?\$status"?/, "the fan-in check must actually exit non-zero when a split job did not succeed");
});

// #1257: `publish safety` measured ~18-19 minutes as ten serial steps in one
// job -- three independent facts about the same checkout (identity/denylist,
// the gate regression suite, and a full-history secret scan) that do not
// depend on each other's RESULT. Split into `safety-identity`,
// `safety-gates`, and `safety-gitleaks`, behind a fan-in that keeps the
// required context's exact name (`safety` job, name "publish safety") --
// the identical #1240 shape the `build`/`build and test` test above already
// proves, checked here against the second job that now uses it.
test("the publish-safety fan-in genuinely fails when any split job does not succeed", () => {
  const workflow = readFileSync(join(workflowsDir, "ci.yml"), "utf8");
  const safety = workflowJob(workflow, "safety");
  const splitJobs = ["safety-identity", "safety-gates", "safety-gitleaks"];

  assert.match(safety, /^ {4}name: publish safety$/m, "the fan-in job must keep the exact required context name");

  const jobIf = safety.match(/^ {4}if: (.+)$/m);
  assert.ok(jobIf, "safety must declare a job-level if:");
  assert.match(
    jobIf[1],
    /^always\(\) &&/,
    "safety's if: must be gated by always(), or GitHub's implicit needs-must-succeed default skips it (and a skipped required check passes) the moment a split job fails",
  );

  const needsLine = safety.match(/^ {4}needs: \[(.+)\]$/m);
  assert.ok(needsLine, "safety must declare needs:");
  const needs = needsLine[1].split(",").map((entry) => entry.trim());
  for (const job of splitJobs) {
    assert.ok(needs.includes(job), `safety must need ${job}, or this job cannot see its result at all`);
  }

  const stepStart = safety.indexOf("- name: Split publish-safety jobs must all succeed");
  assert.notEqual(stepStart, -1, "safety must have an explicit fan-in check step");
  const stepBody = safety.slice(stepStart).split(/\n {6}- (?:name|uses):/)[0];

  assert.match(stepBody, /if: always\(\)/, "the fan-in check step must itself run unconditionally, or it can be skipped by an earlier failure in this same job");
  for (const job of splitJobs) {
    assert.match(stepBody, new RegExp(`needs\\.${job}\\.result`), `the fan-in check must inspect needs.${job}.result`);
  }
  assert.match(stepBody, /!= "success"/, "the fan-in check must fail closed on anything other than a clean success (failure, skipped, and cancelled all count)");
  assert.match(stepBody, /exit "?\$status"?/, "the fan-in check must actually exit non-zero when a split job did not succeed");

  // secret-scan-judgment needs the gitleaks OUTPUTS (gitleaks-exit-code,
  // gitleaks-version), which only safety-gitleaks produces now -- depending
  // on the `safety` fan-in instead would read an undefined output, since a
  // fan-in job declares no outputs of its own.
  const judgment = workflowJob(workflow, "secret-scan-judgment");
  assert.match(judgment, /needs: \[push-tree, safety-gitleaks\]/, "secret-scan-judgment must depend on safety-gitleaks directly, not the safety fan-in");
  assert.match(judgment, /needs\.safety-gitleaks\.outputs\.gitleaks-version/);
  assert.match(judgment, /needs\.safety-gitleaks\.outputs\.gitleaks-exit-code/);
});

test("tree-identical main pushes skip duplicate CI without dropping the required build context on pull_request", () => {
  const workflow = readFileSync(join(workflowsDir, "ci.yml"), "utf8");
  assert.match(workflow, /^  push-tree:\n    name: push-tree identity$/m);
  assert.match(workflow, /node scripts\/push-tree-identical\.mjs/);
  const build = workflowJob(workflow, "build");
  // `needs: [push-tree]` widened to also include the three split jobs (see
  // the fan-in test below) -- push-tree must still be the FIRST dependency
  // so the duplicate-push skip check below stays meaningful.
  assert.match(build, /needs: \[push-tree, /);
  assert.doesNotMatch(build, /needs: \[safety, scope\]/);
  assert.match(build, /github\.event_name != 'push'/);
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
  // scripts/gate-run-history.test.mjs already are -- or, since issue #907,
  // is named with that reason in scripts/lib/gate-test-set.mjs's
  // GATE_TEST_EXCLUSIONS. `check:gates` no longer names its suites in
  // package.json at all (a hand-listed path array was this repository's
  // single most common merge-train conflict -- see issue #1187), so this
  // test asks the SAME discovery function scripts/run-gate-suites.mjs
  // actually runs, not the package.json string.
  const suites = discoverGateTestFiles();
  assert.ok(suites.length > 0, "expected check:gates to discover at least one suite — fixture drift?");

  const offenders = [];
  for (const suite of suites) {
    const source = readFileSync(join(repoRoot, suite), "utf8");
    // Import statements only, anchored at the start of a line with a word
    // boundary after `import` (so `importMustStay.foo = "bar"` -- a plain
    // identifier assignment, not an import -- never matches), and confined
    // to a single line (excluding the source's own newlines from the
    // pre-quote run) so a later, unrelated quoted string many lines below a
    // real import statement is never mistaken for that import's specifier.
    for (const [, specifier] of source.matchAll(/^\s*import\b[^"'\n]*["']([^"']+)["']/gm)) {
      if (!specifier.startsWith("node:") && !specifier.startsWith("./") && !specifier.startsWith("../")) {
        offenders.push(`${suite} -> ${specifier}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `check:gates suite(s) importing something the dependency-free \`safety\` job cannot resolve: ${offenders.join(", ")}. ` +
      "Move the suite to ci.yml's `build and test` job as its own step, next to scripts/observation-bundle.test.mjs, and add it to scripts/lib/gate-test-set.mjs's GATE_TEST_EXCLUSIONS with that reason.",
  );
});

test("real candidate framework acceptance runs only after install and build in required paths", () => {
  const manifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  assert.ok(
    GATE_TEST_EXCLUSIONS["scripts/lib/candidate-runner-acceptance.test.mjs"],
    "scripts/lib/candidate-runner-acceptance.test.mjs must stay in scripts/lib/gate-test-set.mjs's GATE_TEST_EXCLUSIONS -- it needs a real build",
  );
  assert.ok(!discoverGateTestFiles().includes("scripts/lib/candidate-runner-acceptance.test.mjs"));
  assert.match(manifest.scripts["check:candidate-runner-acceptance"], /candidate-runner-acceptance\.test\.mjs/);
  assert.ok(manifest.scripts.check.indexOf("npm run build") < manifest.scripts.check.indexOf("npm run check:candidate-runner-acceptance"));

  const workflow = readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8");
  const build = workflowJob(workflow, "build");
  const install = build.indexOf("- run: npm ci");
  // #1257: this step gained a name and an `if:` (skipped on an exact
  // source+lockfile cache hit -- see the workspace build cache step
  // immediately above it), so it is no longer the bare "- run: npm run
  // build" this test used to look for. The step's OWN `run:` line is still
  // exactly that command, just no longer the line starting the step.
  const compile = build.indexOf("- name: Build\n        if: steps.workspace-build-cache.outputs.cache-hit != 'true'\n        run: npm run build");
  const runtime = build.indexOf("- name: Assert qualified-directory release runtime");
  const acceptance = build.indexOf("run: npm run check:candidate-runner-acceptance");
  assert.ok(install !== -1, "expected an npm ci step");
  assert.ok(compile !== -1, "expected the cache-aware Build step, unchanged in shape");
  assert.ok(install < compile && compile < runtime && runtime < acceptance);
});
