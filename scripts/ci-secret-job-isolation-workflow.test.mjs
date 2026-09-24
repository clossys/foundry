import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// ci-secret-job-isolation-workflow -- pins the one rule every ci.yml job that
// can see a repository secret must keep: it runs only base-ref, install-free
// code. A job that installs dependencies, builds, restores a cache, or runs a
// script from this pull request's own checkout holds no secret; a job that
// holds a secret does none of those things, and checks this pull request's
// tree out only as data it reads.
//
// Text-level on purpose, like the other workflow-shape suites here: this
// suite runs in the dependency-free check:gates job, so it cannot import a
// YAML parser, and the rules below are about which commands appear in a
// job at all, which raw text answers directly.

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workflowPath = join(resolve(scriptDir, ".."), ".github", "workflows", "ci.yml");

export const TRUSTED_REF = "${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha || github.sha }}";
const TRUSTED_DIR = ".trusted-scripts";

/** Split a workflow's `jobs:` section into { id: text } by two-space keys. */
export function workflowJobs(workflowText) {
  const jobsStart = workflowText.search(/^jobs:[ \t]*$/m);
  assert.notEqual(jobsStart, -1, "workflow has no jobs: section");
  const body = workflowText.slice(jobsStart);
  const jobs = {};
  const headers = [...body.matchAll(/^ {2}([A-Za-z0-9_-]+):[ \t]*$/gm)];
  headers.forEach((match, index) => {
    const end = index + 1 < headers.length ? headers[index + 1].index : body.length;
    jobs[match[1]] = body.slice(match.index, end);
  });
  return jobs;
}

/** The job's lines with whole-line comments removed (YAML and shell alike). */
function codeLines(jobText) {
  return jobText.split("\n").filter((line) => !/^\s*#/.test(line));
}

export function secretHoldingJobs(workflowText) {
  return Object.entries(workflowJobs(workflowText))
    .filter(([, text]) => codeLines(text).some((line) => /\$\{\{\s*secrets\./.test(line)))
    .map(([id]) => id);
}

const FORBIDDEN = [
  [/(^|[^A-Za-z0-9_.-])(npm|npx|pnpm|yarn|corepack)(\s|$)/, "runs a package manager (install, build, test, pack, or any lifecycle script)"],
  [/uses:\s*actions\/cache[@/]/, "restores a cache (actions/cache)"],
  [/^\s+cache(-dependency-path)?:/, "restores a cache (setup-node cache:)"],
  [/uses:\s*\.{1,2}\//, "runs a local action from this pull request's own checkout"],
  [/(^|[\s;&|(])(bash|sh|zsh|source|make|python3?|deno|bun|tsx|ts-node)\s+[^-\s]/, "executes a file through an interpreter other than node"],
  [/(^|[\s;&|(])\.{1,2}\/[^\s]/, "executes a path from the checkout directly"],
];

/**
 * Every rule violation in the workflow, as human-readable strings. Empty
 * means every secret-holding job is isolated.
 */
export function secretJobIsolationFailures(workflowText) {
  const failures = [];
  const jobs = workflowJobs(workflowText);
  for (const id of secretHoldingJobs(workflowText)) {
    const lines = codeLines(jobs[id]);
    for (const line of lines) {
      for (const [pattern, why] of FORBIDDEN) {
        if (pattern.test(line)) failures.push(`${id}: ${why}: ${line.trim()}`);
      }
      for (const match of line.matchAll(/(?:^|[\s;&|(])node\s+(\S+)/g)) {
        const target = match[1].replace(/^"/, "");
        if (!target.startsWith(`$GITHUB_WORKSPACE/${TRUSTED_DIR}/`)) {
          failures.push(`${id}: runs node on something other than a ${TRUSTED_DIR}/ (base-ref) script: ${line.trim()}`);
        }
      }
      if (/check-artifact-safety\.mjs/.test(line) && !/--tarball\s/.test(line)) {
        failures.push(`${id}: check-artifact-safety.mjs without --tarball packs inside this checkout (npm reads its config): ${line.trim()}`);
      }
      const uses = line.match(/uses:\s*([^\s#]+)/);
      if (uses && !/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(uses[1])) {
        failures.push(`${id}: action is not pinned to a full commit SHA: ${line.trim()}`);
      }
    }
    const text = lines.join("\n");
    const trustedCheckout = new RegExp(
      `ref: ${TRUSTED_REF.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n\\s+path: ${TRUSTED_DIR.replace(".", "\\.")}\\n`,
    );
    if (!trustedCheckout.test(text)) {
      failures.push(`${id}: no base-ref checkout into ${TRUSTED_DIR}/ (ref: ${TRUSTED_REF})`);
    }
  }
  return failures;
}

test("every ci.yml job that holds a secret runs only base-ref, install-free code", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  const holders = secretHoldingJobs(workflow);
  // Guards against a vacuous pass: if secret detection ever stopped matching,
  // the rule would hold over zero jobs.
  for (const id of ["safety-identity", "artifact"]) {
    assert.ok(holders.includes(id), `expected ${id} to be detected as holding the denylist secret`);
  }
  assert.deepEqual(secretJobIsolationFailures(workflow), []);
});

test("the tarball scan keeps its required context and fails closed when packing did not succeed", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  const jobs = workflowJobs(workflow);
  const scan = jobs["artifact"];
  const pack = jobs["artifact-pack"];
  assert.ok(scan && pack, "ci.yml must define both artifact-pack and artifact");
  assert.match(scan, /^ {4}name: artifact safety \(tarball\)$/m, "the scan job must keep the exact required context name");
  for (const [id, job, required] of [
    ["artifact-pack", pack, ["push-tree", "classify"]],
    ["artifact", scan, ["push-tree", "artifact-pack", "classify"]],
  ]) {
    const needs = jobNeeds(job);
    for (const dependency of required) assert.ok(needs.includes(dependency), `${id} must need ${dependency}`);
  }
  assert.match(jobIf(scan), /^always\(\) && /, "without always(), a failed pack job would skip (and so pass) the required context");
  assert.match(scan, /result="\$\{\{ needs\.artifact-pack\.result \}\}"/);
  assert.match(scan, /if \[ "\$result" != "success" \]; then[\s\S]*?exit 1/);
  assert.match(scan, /actions\/download-artifact@[0-9a-f]{40}[\s\S]*?name: artifact-safety-tarballs/);

  assert.ok(!secretHoldingJobs(workflow).includes("artifact-pack"), "the job that installs and builds must hold no secret");
  assert.match(pack, /npm ci --ignore-scripts/);
  assert.match(pack, /npm pack --ignore-scripts --pack-destination/);
  assert.match(pack, /name: artifact-safety-tarballs[\s\S]*?retention-days: \d+/);
});

function jobNeeds(jobText) {
  const line = jobText.match(/^ {4}needs: \[(.+)\]$/m);
  return line ? line[1].split(",").map((entry) => entry.trim()) : [];
}

function jobIf(jobText) {
  const line = jobText.match(/^ {4}if: (.+)$/m);
  assert.ok(line, "job must declare a job-level if:");
  return line[1];
}

// Evaluates the subset of GitHub Actions expression syntax these job-level
// if: lines use -- always(), `<context path> ==|!= '<literal>'`, &&, ||, and
// parentheses -- and throws on anything else, so a new shape fails loudly
// instead of being evaluated wrongly.
function evaluateIf(expression, context) {
  const tokens = expression.match(/always\(\)|&&|\|\||\(|\)|[A-Za-z0-9_.-]+ (?:==|!=) '[^']*'|\S+/g);
  let index = 0;
  const primary = () => {
    const token = tokens[index++];
    if (token === "(") {
      const value = or();
      assert.equal(tokens[index++], ")", `unbalanced parentheses in: ${expression}`);
      return value;
    }
    if (token === "always()") return true;
    const comparison = /^([A-Za-z0-9_.-]+) (==|!=) '([^']*)'$/.exec(token ?? "");
    assert.ok(comparison, `unrecognised term ${token} in: ${expression}`);
    const [, path, operator, literal] = comparison;
    assert.ok(path in context, `no context value for ${path}`);
    return operator === "==" ? context[path] === literal : context[path] !== literal;
  };
  const and = () => {
    let value = primary();
    while (tokens[index] === "&&") { index += 1; value = primary() && value; }
    return value;
  };
  const or = () => {
    let value = and();
    while (tokens[index] === "||") { index += 1; value = and() || value; }
    return value;
  };
  const value = or();
  assert.equal(index, tokens.length, `trailing text in: ${expression}`);
  return value;
}

test("both tarball jobs run or skip together, and skip only on a proven prose-tier change", () => {
  const jobs = workflowJobs(readFileSync(workflowPath, "utf8"));
  const packIf = jobIf(jobs["artifact-pack"]);
  const scanIf = jobIf(jobs["artifact"]);
  let proseSkips = 0;
  for (const event of ["pull_request", "merge_group", "push"]) {
    for (const duplicate of ["", "false", "true"]) {
      for (const result of ["success", "failure", "cancelled", "skipped"]) {
        for (const tier of ["", "full", "packed-prose", "prose"]) {
          const context = {
            "github.event_name": event,
            "needs.push-tree.outputs.duplicate": duplicate,
            "needs.classify.result": result,
            "needs.classify.outputs.tier": tier,
          };
          const label = JSON.stringify(context);
          const packRuns = evaluateIf(packIf, context);
          const scanRuns = evaluateIf(scanIf, context);
          // Equal conditions: the scan's fail-closed pack-result step can
          // only ever see a pack job that was meant to run.
          assert.equal(scanRuns, packRuns, `artifact and artifact-pack disagree for ${label}`);
          const duplicatePush = event === "push" && duplicate === "true";
          const provenProse = result === "success" && tier === "prose";
          assert.equal(scanRuns, !duplicatePush && !provenProse, `unexpected run/skip for ${label}`);
          if (!duplicatePush && provenProse) proseSkips += 1;
        }
      }
    }
  }
  assert.ok(proseSkips > 0, "the prose-tier skip case must actually be exercised");
});

test("check-foreign-references runs under publish safety, in a job that holds no secret", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  const jobs = workflowJobs(workflow);
  const runners = Object.entries(jobs)
    .filter(([, text]) => codeLines(text).some((line) => /node scripts\/check-foreign-references\.mjs/.test(line)))
    .map(([id]) => id);
  assert.deepEqual(runners, ["safety-gates"]);
  assert.match(jobs["safety"], /needs: \[[^\]]*\bsafety-gates\b/);
});

// Detection cases, so the rule above is known to fail on the shapes it exists
// to refuse rather than only known to pass on today's ci.yml.
function fixture(steps, { secret = true } = {}) {
  return [
    "name: fixture",
    "jobs:",
    "  scan:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0",
    "      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0",
    "        with:",
    `          ref: ${TRUSTED_REF}`,
    "          path: .trusted-scripts",
    ...(secret ? ["      - env:", "          DENYLIST_B64: ${{ secrets.PUBLIC_SAFETY_DENYLIST_B64 }}", "        run: echo materialise"] : []),
    ...steps,
    "",
  ].join("\n");
}

test("the isolation rule accepts a base-ref-only scan job", () => {
  const clean = fixture([
    '      - run: node "$GITHUB_WORKSPACE/.trusted-scripts/scripts/check-artifact-safety.mjs" packages/a --tarball "$RUNNER_TEMP/packed/a.tgz"',
  ]);
  assert.deepEqual(secretJobIsolationFailures(clean), []);
});

test("the isolation rule refuses every untrusted-execution shape in a secret-holding job", () => {
  const cases = {
    "npm ci": ["      - run: npm ci"],
    "npm run build": ["      - run: npm run build"],
    "setup-node cache": ["      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0", "        with:", "          cache: npm"],
    "actions/cache": ["      - uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0"],
    "PR-controlled script": ["      - run: node scripts/check-foreign-references.mjs"],
    "local action": ["      - uses: ./.github/actions/setup"],
    "shell script from checkout": ["      - run: bash scripts/setup.sh"],
    "direct executable": ["      - run: ./scripts/run"],
    "unpinned action": ["      - uses: actions/checkout@v4"],
    "in-checkout pack": ['      - run: node "$GITHUB_WORKSPACE/.trusted-scripts/scripts/check-artifact-safety.mjs" packages/a --require-denylist'],
  };
  for (const [label, steps] of Object.entries(cases)) {
    assert.notDeepEqual(secretJobIsolationFailures(fixture(steps)), [], `${label} must be refused`);
  }
  const noTrustedCheckout = fixture(['      - run: node "$GITHUB_WORKSPACE/.trusted-scripts/scripts/x.mjs"']).replace(
    `          ref: ${TRUSTED_REF}\n`,
    "",
  );
  assert.notDeepEqual(secretJobIsolationFailures(noTrustedCheckout), [], "a missing base-ref checkout must be refused");
});

test("the isolation rule leaves a job that holds no secret alone", () => {
  assert.deepEqual(secretJobIsolationFailures(fixture(["      - run: npm ci", "      - run: npm run build"], { secret: false })), []);
});
