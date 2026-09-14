import { strict as assert } from "node:assert";
import { test } from "node:test";
import { extractJobBlock, toCanonicalUtcTimestamp, workflowGrantsOnlyContentsRead } from "./collect-credential-evidence.mjs";

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
