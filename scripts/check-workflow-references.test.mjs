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
  if (!/^ {4}needs: \[push-tree, candidate-qualification-shard, classify\]$/m.test(fanInJob)) failures.push("candidate-fanin-needs");
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
  const withoutFanInNeeds = workflow.replace(fanInJob, fanInJob.replace("needs: [push-tree, candidate-qualification-shard, classify]", "needs: [push-tree]"));
  assert.deepEqual(candidateQualificationCiFailures(withoutFanInNeeds), ["candidate-fanin-needs"]);

  const withoutFanInAlways = workflow.replace(
    fanInJob,
    fanInJob.replace(
      "if: always() && (github.event_name != 'push' || needs.push-tree.outputs.duplicate != 'true') && (needs.classify.result != 'success' || needs.classify.outputs.tier != 'prose')",
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

// issue #1324 item 2: the three independent `workspace-build-cache` steps
// (readme-examples-typecheck, packed-consumer-readiness, build) each key
// their cache on the files a `run: npm run build` invocation can read --
// but two packages' `build` scripts run a pre-tsc generation step BEFORE
// compiling (packages/launcher/scripts/pack-skills.mjs,
// packages/advisor/scripts/pack-capability-catalogue.mjs) that reads
// inputs outside `packages/*/src/**`: pack-skills.mjs copies every OTHER
// package's `skill/SKILL.md` and the shared `docs/contracts/conversation-
// contract.md`; pack-capability-catalogue.mjs reads `docs/contracts/
// kit-presets.json`. None of those paths, nor the per-package `scripts/`
// directories the generation steps themselves live in, nor the root
// `package.json`, were part of the cache key -- so a change to any of them
// left the key unchanged, and a cache HIT served a `dist/` (and sibling
// generated `skill-catalogue/`/`contracts/`) that no longer reflected the
// real tree.
//
// A second, distinct gap in that same family: pack-capability-catalogue.mjs
// also imports `scripts/lib/capability-catalogue.mjs` at the repository
// root -- code, not a doc or a per-package script, so it falls outside
// every one of the paths above too. A change to only that shared library
// left the key unchanged and let a cached advisor `dist/` go stale in
// exactly the same way. `scripts/lib/**` covers it (and any future
// package `build` script that imports a root-level helper from there).
test("every workspace-build-cache step's key covers every input npm run build can read (issue #1324 item 2)", () => {
  const workflow = readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8");
  const requiredHashedPaths = [
    "package.json",
    "package-lock.json",
    "packages/*/src/**",
    "packages/*/package.json",
    "packages/*/tsconfig*.json",
    "packages/*/scripts/**",
    "scripts/lib/**",
    "docs/contracts/**",
  ];
  const jobsWithTheCache = ["readme-examples-typecheck", "packed-consumer-readiness", "build"];
  const keyLines = [];
  for (const jobName of jobsWithTheCache) {
    const job = workflowJob(workflow, jobName);
    const cacheStepIndex = job.indexOf("- name: Restore workspace build cache");
    assert.ok(cacheStepIndex !== -1, `${jobName} must have its own "Restore workspace build cache" step`);
    const cacheStep = job.slice(cacheStepIndex, job.indexOf("\n      - ", cacheStepIndex + 1));
    const keyLine = cacheStep.match(/^\s*key: workspace-build-.*$/m);
    assert.ok(keyLine, `${jobName}'s workspace-build-cache step must declare a key:`);
    for (const requiredPath of requiredHashedPaths) {
      assert.ok(
        keyLine[0].includes(`'${requiredPath}'`),
        `${jobName}'s workspace-build-cache key is missing '${requiredPath}' -- a change there would not invalidate a stale cache hit`,
      );
    }
    keyLines.push(keyLine[0]);
  }
  // All three jobs must key on EXACTLY the same file list -- a hit in one
  // job while another would have missed on the identical tree is its own
  // silent inconsistency.
  assert.ok(keyLines.every((line) => line === keyLines[0]), `every job's workspace-build-cache key must be byte-identical: ${JSON.stringify(keyLines)}`);
});

// Issue #1420: the fail-closed fast path for prose-only changes. The
// classifier itself (scripts/classify-change-tier.test.mjs) proves that any
// changed path outside the prose/packed-prose sets -- including an empty
// diff, an unresolvable base, or the deleted half of a rename -- makes
// classifyChangeTier() return 'full', never a narrower tier. That proof
// alone is not enough: review round 1 found that if the `classify` JOB
// itself fails, is cancelled, or is skipped -- a lost runner, a checkout
// failure, the 5-minute timeout, a module-load error -- every job gating on
// `needs.classify.outputs.tier == 'full'` reads an EMPTY string, which is
// not 'full', and GitHub's own implicit "skip unless every needed job
// succeeded" default skips the job outright before its `if:` is even
// evaluated. A skipped required context reports as passing, so a classify
// failure would have silently waved through 11 of the 16 required checks.
// THIS test proves the fix: every gated job must (a) carry `always()`, so
// GitHub's implicit gate cannot pre-empt its own `if:`, and (b) check
// `needs.classify.result != 'success'` ahead of the tier comparison, so it
// runs on anything other than a PROVEN narrow tier -- failure, cancellation,
// skip, or an empty/garbled output all fail OPEN (run everything), never
// silently skip. Every job the charter names as a keep-running prose gate
// must, symmetrically, never reference `classify` at all.
test("issue #1420: every heavy job depends on the classifier and fails OPEN (runs) unless classify proved a narrower tier", () => {
  const workflow = readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8");

  assert.match(workflow, /^  classify:\n    name: classify change tier$/m, "the classify job must exist under exactly this id");
  const classifyJob = workflowJob(workflow, "classify");
  assert.match(classifyJob, /outputs:\n\s+tier: \$\{\{ steps\.classify\.outputs\.tier \}\}/, "classify must output tier");
  assert.match(classifyJob, /run: node scripts\/classify-change-tier\.mjs/, "classify must actually invoke the classifier script");

  // "Full-only": cannot possibly be affected by prose OR by a packed
  // packages/*/README.md or skill/SKILL.md change (pure governance, drift,
  // and policy gates over non-package, non-prose paths). These jobs run
  // whenever classify did NOT prove a narrower ('prose' or 'packed-prose')
  // tier -- on any failure/cancellation/skip, AND on a genuine 'full'
  // classification. The skip condition is a POSITIVE enumeration of the two
  // narrow tiers (`tier != 'prose' && tier != 'packed-prose'`), deliberately
  // NOT a negative check against 'full' alone (`tier != 'full'`) -- an
  // empty or garbled tier output (classify succeeded but never wrote one)
  // is also != 'full', so a negative-only check would have skipped these
  // jobs on exactly the "ran but produced nothing" failure mode this fix
  // exists to close. See classify-change-tier.test.mjs's own header
  // comment on the same distinction.
  const fullOnlyJobs = [
    "dependency-audit",
    "credential-lifecycle",
    "scope",
    "registry",
    "prepublish-hook",
    "root-entry",
    "package-evidence",
    "controller-gates",
    "workspace-links",
    "qualification-record-required",
    "contrast",
    "designer-contrast",
  ];
  for (const jobName of fullOnlyJobs) {
    const job = workflowJob(workflow, jobName);
    const needsLine = job.match(/^ {4}needs: \[(.+)\]$/m);
    assert.ok(needsLine, `${jobName} must declare needs:`);
    assert.ok(
      needsLine[1].split(",").map((entry) => entry.trim()).includes("classify"),
      `${jobName} must need classify -- its if: cannot read a tier it never depended on`,
    );
    const jobIf = job.match(/^ {4}if: (.+)$/m);
    assert.ok(jobIf, `${jobName} must declare if:`);
    assert.match(jobIf[1], /^always\(\) &&/, `${jobName} must carry always(), or GitHub's implicit needs-gate skips it the moment classify fails (and a skipped required check passes)`);
    assert.match(
      jobIf[1],
      /needs\.classify\.result != 'success' \|\| \(needs\.classify\.outputs\.tier != 'prose' && needs\.classify\.outputs\.tier != 'packed-prose'\)/,
      `${jobName} must skip ONLY when classify proved a narrow tier -- a failed/cancelled/skipped classify, or one that ran but wrote no tier at all, must run it`,
    );
  }

  // "Packed-file gates": also relevant to the narrower 'packed-prose' tier
  // (a packages/*/README.md or packages/*/skill/SKILL.md change) -- README
  // code-examples typecheck and artifact safety read packed files directly;
  // role-loop-archetypes runs check-package-skills.mjs, check-conversation-
  // contract.mjs, check-package-conformance.mjs, and check-install-docs.mjs,
  // all of which read a package's own README.md or skill/SKILL.md; build
  // and test's own `npm test` exercises packages/launcher/src/{skills,
  // core}.test.ts against the packed skill-catalogue npm run build
  // generates from every package's SKILL.md (review round 1, reviewer B).
  // candidate-qualification (its shard matrix and its fan-in) and packed
  // consumer readiness are included here too, NOT because they read
  // README/SKILL.md content themselves, but because `build`'s own fan-in
  // step (`needs.candidate-qualification.result`, `needs.packed-consumer-
  // readiness.result`) would otherwise see them skipped whenever `build`
  // itself runs, and a skipped needed job's result is 'skipped', not
  // 'success' -- exactly the failure this same fan-in step exists to
  // detect. All seven gate on `tier != 'prose'` (never `== 'full'`): they
  // run for BOTH 'full' and 'packed-prose', and skip only for pure 'prose'.
  const packedFileGates = ["readme-examples-typecheck", "artifact", "role-loop-archetypes", "build", "candidate-qualification-shard", "candidate-qualification", "packed-consumer-readiness"];
  for (const jobName of packedFileGates) {
    const job = workflowJob(workflow, jobName);
    const needsLine = job.match(/^ {4}needs: \[(.+)\]$/m);
    assert.ok(needsLine, `${jobName} must declare needs:`);
    assert.ok(
      needsLine[1].split(",").map((entry) => entry.trim()).includes("classify"),
      `${jobName} must need classify`,
    );
    const jobIf = job.match(/^ {4}if: (.+)$/m);
    assert.ok(jobIf, `${jobName} must declare if:`);
    assert.match(jobIf[1], /^always\(\) &&/, `${jobName} must carry always(), or GitHub's implicit needs-gate skips it the moment classify fails`);
    assert.match(
      jobIf[1],
      /needs\.classify\.result != 'success' \|\| needs\.classify\.outputs\.tier != 'prose'/,
      `${jobName} must keep running for 'packed-prose' and on any classify failure, skipping only a PROVEN pure 'prose'`,
    );
    assert.doesNotMatch(jobIf[1], /tier == 'full'/, `${jobName} must not narrow to full-only -- that would also skip it for 'packed-prose'`);
  }

  // Every full-only or packed-file-gate job above must depend on classify
  // ONLY through `needs.classify` (never a bare success() implied by
  // omitting always()) -- covered by the always()-prefix assertions above.
  // This second pass proves the fan-in jobs among them (credential-
  // lifecycle, candidate-qualification, build) keep BOTH their original
  // fan-in reason for always() (their own split jobs failing) and the new
  // classify-failure reason -- one always() token serves both, which is
  // exactly why it must be the first conjunct, unconditionally.
  for (const jobName of ["credential-lifecycle", "candidate-qualification", "build"]) {
    const job = workflowJob(workflow, jobName);
    const jobIf = job.match(/^ {4}if: (.+)$/m);
    assert.match(jobIf[1], /^always\(\) && \(github\.event_name/, `${jobName}'s always() must still gate the push-tree duplicate check too, unchanged from before this fix`);
  }

  // The nine keep-running prose gates (public-safety's three split jobs
  // plus its fan-in, secret-scan, prose quality, release readiness, and
  // release PR shape, plus push-tree) must run on every tier -- a
  // prose-only change is exactly the change these gates exist to judge, so
  // none of them may reference the classifier's tier output at all.
  const alwaysRunJobs = [
    "push-tree",
    "safety-identity",
    "safety-gates",
    "safety-gitleaks",
    "safety",
    "secret-scan-judgment",
    "prose",
    "release-readiness",
    "release-pr-shape",
  ];
  for (const jobName of alwaysRunJobs) {
    const job = workflowJob(workflow, jobName);
    // Checked on the job's own `needs:`/`if:` LINES only, never the whole
    // job body -- several of these jobs' surrounding comments legitimately
    // mention `needs.classify` in prose (e.g. explaining why a NEIGHBOURING
    // job needs it), which must not be mistaken for this job depending on
    // it. push-tree has neither line at all (it is the very first job, no
    // needs), which is itself a form of "never depends on classify".
    const needsLine = job.match(/^ {4}needs: \[(.+)\]$/m);
    const jobIf = job.match(/^ {4}if: (.+)$/m);
    if (needsLine) {
      assert.doesNotMatch(needsLine[0], /classify/, `${jobName}'s needs: must not include classify -- it is one of issue #1420's explicit keep-running prose gates`);
    }
    if (jobIf) {
      assert.doesNotMatch(jobIf[0], /needs\.classify/, `${jobName}'s if: must not reference the classifier -- it is one of issue #1420's explicit keep-running prose gates`);
    }
  }
});

// The classify-failure path itself, end to end, over EVERY gated job's `if:`
// expression: simulates GitHub Actions' own evaluation (a JS mirror of the
// subset of expression syntax these lines use -- `always()`, `!=`/`==`
// string comparison, `&&`/`||`, and parenthesised grouping) against a
// `needs` context where `classify` failed, was cancelled, or was skipped
// outright, and against one where it succeeded with an empty/garbled tier
// output. Proves the property the test above can only assert textually: the
// actual boolean this expression evaluates to is `true` (run) in every one
// of these cases, for every gated job in the workflow, not just the ones
// this file happens to name.
test("issue #1420: a failed, cancelled, or skipped classify job runs every gated job (simulated GitHub Actions evaluation)", () => {
  const workflow = readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8");

  // A tiny evaluator for exactly the expression shapes ci.yml's `if:` lines
  // use: `always()`, `github.event_name <op> '<literal>'`,
  // `needs.<job>.outputs.duplicate <op> '<literal>'`, `needs.classify.result
  // <op> '<literal>'`, `needs.classify.outputs.tier <op> '<literal>'`,
  // combined with `&&`/`||` and parentheses. Not a general GHA expression
  // parser -- it refuses (throws) on anything it does not recognise, so a
  // future edit that introduces a shape this evaluator cannot handle fails
  // this test loudly rather than silently evaluating the wrong thing.
  function evalGhaIf(expr, ctx) {
    let i = 0;
    function skipWs() {
      while (expr[i] === " ") i++;
    }
    function parsePrimary() {
      skipWs();
      if (expr[i] === "(") {
        i++;
        const value = parseOr();
        skipWs();
        assert.equal(expr[i], ")", `unbalanced parens in: ${expr}`);
        i++;
        return value;
      }
      if (expr.startsWith("always()", i)) {
        i += "always()".length;
        return true;
      }
      const compareMatch = /^([A-Za-z0-9_.\-]+) (!=|==) '([^']*)'/.exec(expr.slice(i));
      assert.ok(compareMatch, `unrecognised expression term at ${i} in: ${expr}`);
      const [, path, op, literal] = compareMatch;
      i += compareMatch[0].length;
      const actual = ctx[path];
      assert.notEqual(actual, undefined, `context has no value for ${path} (expression: ${expr})`);
      return op === "!=" ? actual !== literal : actual === literal;
    }
    function parseAnd() {
      let value = parsePrimary();
      skipWs();
      while (expr.startsWith("&&", i)) {
        i += 2;
        value = parsePrimary() && value; // evaluate both sides regardless of short-circuit, same as GHA
        skipWs();
      }
      return value;
    }
    function parseOr() {
      let value = parseAnd();
      skipWs();
      while (expr.startsWith("||", i)) {
        i += 2;
        value = parseAnd() || value;
        skipWs();
      }
      return value;
    }
    const result = parseOr();
    skipWs();
    assert.equal(i, expr.length, `trailing unparsed text in: ${expr}`);
    return result;
  }

  // Sanity: the evaluator itself agrees with the ORIGINAL, pre-fix
  // (broken) polarity on the classify-failure case, so a regression in the
  // fix does not also silently break the evaluator into always reporting
  // "safe".
  assert.equal(evalGhaIf("needs.classify.outputs.tier == 'full'", { "needs.classify.outputs.tier": "" }), false, "sanity: the broken pre-fix polarity really did evaluate to skip on a failed classify");

  const gatedJobs = [
    "dependency-audit",
    "credential-lifecycle",
    "scope",
    "registry",
    "prepublish-hook",
    "root-entry",
    "package-evidence",
    "controller-gates",
    "workspace-links",
    "qualification-record-required",
    "contrast",
    "designer-contrast",
    "readme-examples-typecheck",
    "artifact",
    "role-loop-archetypes",
    "build",
    "candidate-qualification-shard",
    "candidate-qualification",
    "packed-consumer-readiness",
  ];

  // Three ways `needs.classify.result` reads when classify did not prove an
  // answer: GitHub sets it to the job's own conclusion for 'failure' and
  // 'cancelled', and to 'skipped' if classify itself was skipped (e.g. a
  // future edit gates classify on some condition). An empty tier paired
  // with each covers "classify ran to a `success` conclusion but its own
  // output step never wrote anything" too.
  const classifyDidNotProve = [
    { result: "failure", tier: "" },
    { result: "cancelled", tier: "" },
    { result: "skipped", tier: "" },
    { result: "success", tier: "" }, // ran, but the output write itself failed/was skipped
  ];

  for (const jobName of gatedJobs) {
    const job = workflowJob(workflow, jobName);
    const jobIf = job.match(/^ {4}if: (.+)$/m);
    assert.ok(jobIf, `${jobName} must declare if:`);
    for (const { result, tier } of classifyDidNotProve) {
      const ctx = {
        "github.event_name": "pull_request",
        "needs.push-tree.outputs.duplicate": "",
        "github.event_name == 'pull_request'": true, // for qualification-record-required's event check, handled below
        "needs.classify.result": result,
        "needs.classify.outputs.tier": tier,
      };
      // qualification-record-required's if: uses an OR of two event checks
      // instead of push-tree's duplicate check; evalGhaIf only understands
      // single comparisons, so translate that one term into the same
      // context-key shape the evaluator expects.
      let expr = jobIf[1];
      expr = expr.replace(/github\.event_name == 'pull_request' \|\| github\.event_name == 'merge_group'/, "github.event_name != 'push'");
      const runs = evalGhaIf(expr, ctx);
      assert.equal(runs, true, `${jobName} must RUN when classify.result='${result}' and tier='${tier}' (unproven) -- got ${runs}`);
    }
  }
});
