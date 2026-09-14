import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  extractJobBlock,
  jobEffectivelyGrantsOnlyContentsRead,
  jobGrantsOnlyContentsRead,
  jobHasOwnPermissionsBlock,
  toCanonicalUtcTimestamp,
  workflowGrantsOnlyContentsRead,
} from "./collect-credential-evidence.mjs";

test("toCanonicalUtcTimestamp pads a fractionless GitHub API timestamp to three digits", () => {
  assert.equal(toCanonicalUtcTimestamp("2026-09-14T07:53:00Z"), "2026-09-14T07:53:00.000Z");
});

test("toCanonicalUtcTimestamp truncates an over-long fraction rather than rejecting it", () => {
  assert.equal(toCanonicalUtcTimestamp("2026-09-14T07:53:00.123456Z"), "2026-09-14T07:53:00.123Z");
});

test("toCanonicalUtcTimestamp reports undefined for null, undefined, or an unparseable string", () => {
  assert.equal(toCanonicalUtcTimestamp(null), undefined);
  assert.equal(toCanonicalUtcTimestamp(undefined), undefined);
  assert.equal(toCanonicalUtcTimestamp("not a timestamp"), undefined);
});

const REAL_CI_YAML = `name: CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  dependency-audit:
    name: dependency audit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@sha
      - run: npm ci --ignore-scripts
      - run: npm run check:dependency-audit

  safety:
    name: publish safety
    runs-on: ubuntu-latest
    steps:
      - name: Materialise denylist
        env:
          DENYLIST_B64: \${{ secrets.PUBLIC_SAFETY_DENYLIST_B64 }}
        run: echo hi

  credential-lifecycle:
    name: credential lifecycle (dependency-audit token)
    needs: dependency-audit
    permissions:
      contents: read
      actions: read
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
`;

test("workflowGrantsOnlyContentsRead is true for this repository's real ci.yml top-level block", () => {
  assert.equal(workflowGrantsOnlyContentsRead(REAL_CI_YAML), true);
});

test("workflowGrantsOnlyContentsRead is false when more than contents:read is declared", () => {
  const wider = REAL_CI_YAML.replace("permissions:\n  contents: read", "permissions:\n  contents: read\n  packages: write");
  assert.equal(workflowGrantsOnlyContentsRead(wider), false);
});

test("workflowGrantsOnlyContentsRead is false when there is no top-level permissions block at all", () => {
  assert.equal(workflowGrantsOnlyContentsRead("name: CI\n\njobs:\n  x:\n    runs-on: ubuntu-latest\n"), false);
});

test("extractJobBlock isolates exactly the named job, stopping at the next job key", () => {
  const block = extractJobBlock(REAL_CI_YAML, "dependency-audit");
  assert.match(block, /name: dependency audit/);
  assert.doesNotMatch(block, /name: publish safety/);
});

test("extractJobBlock finds a job with no secrets. reference in its own block", () => {
  const block = extractJobBlock(REAL_CI_YAML, "dependency-audit");
  assert.equal(block.includes("secrets."), false);
});

test("extractJobBlock finds a job that DOES reference a secret, honestly", () => {
  const block = extractJobBlock(REAL_CI_YAML, "safety");
  assert.equal(block.includes("secrets."), true);
});

test("extractJobBlock returns undefined for a job id that does not exist", () => {
  assert.equal(extractJobBlock(REAL_CI_YAML, "does-not-exist"), undefined);
});

// ---- Job-level `permissions:` overrides -----------------------------------
// GitHub Actions REPLACES the workflow-level permission set entirely for a
// job that declares its own — never merges the two. A caller that checks
// only the workflow-level block would silently keep asserting the
// workflow's scope even after a job-level override widened it.

test("jobHasOwnPermissionsBlock is false for a job with no override", () => {
  const block = extractJobBlock(REAL_CI_YAML, "dependency-audit");
  assert.equal(jobHasOwnPermissionsBlock(block), false);
});

test("jobHasOwnPermissionsBlock is true for a job that declares its own permissions", () => {
  const block = extractJobBlock(REAL_CI_YAML, "credential-lifecycle");
  assert.equal(jobHasOwnPermissionsBlock(block), true);
});

test("jobGrantsOnlyContentsRead is false when the job's own block declares more than contents:read", () => {
  const block = extractJobBlock(REAL_CI_YAML, "credential-lifecycle");
  assert.equal(jobGrantsOnlyContentsRead(block), false); // also declares actions: read
});

test("jobEffectivelyGrantsOnlyContentsRead uses the job's own override, not the workflow-level block, when one exists", () => {
  const block = extractJobBlock(REAL_CI_YAML, "credential-lifecycle");
  // The workflow-level block alone IS contents:read only, but this job's
  // own override adds actions:read — the effective scope must reflect that
  // override, not the (looser-looking, in the other direction) top-level
  // block.
  assert.equal(workflowGrantsOnlyContentsRead(REAL_CI_YAML), true);
  assert.equal(jobEffectivelyGrantsOnlyContentsRead(REAL_CI_YAML, block), false);
});

test("jobEffectivelyGrantsOnlyContentsRead falls back to the workflow-level block for a job with no override of its own", () => {
  const block = extractJobBlock(REAL_CI_YAML, "dependency-audit");
  assert.equal(jobEffectivelyGrantsOnlyContentsRead(REAL_CI_YAML, block), true);
});

test("jobEffectivelyGrantsOnlyContentsRead would catch a future job-level override this script never verified", () => {
  // Simulates exactly the scenario the reviewer raised: someone later adds
  // a wider job-level permissions block to "dependency-audit" itself.
  const widened = REAL_CI_YAML.replace(
    "  dependency-audit:\n    name: dependency audit\n    runs-on: ubuntu-latest\n",
    "  dependency-audit:\n    name: dependency audit\n    permissions:\n      contents: read\n      packages: write\n    runs-on: ubuntu-latest\n",
  );
  const block = extractJobBlock(widened, "dependency-audit");
  assert.equal(jobHasOwnPermissionsBlock(block), true);
  assert.equal(jobEffectivelyGrantsOnlyContentsRead(widened, block), false);
});
