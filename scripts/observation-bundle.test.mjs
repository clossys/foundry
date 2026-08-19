// scripts/observation-bundle.test.mjs -- hermetic with respect to
// EVALUATION: every scenario injects `gateResult` directly, so
// `buildRepositoryProfileGateResult`'s own discovery I/O (declaration read,
// `git ls-tree`, controller's `runRepositoryProfileCheck`) never runs and
// this checkout's own governance/repository-profile.json is never touched.
//
// This file DOES still exercise the real `writeObservationBundle`/
// `parseObservationBundle` (packages/builder, in-workspace, built dist) --
// deliberately: the point is proving THIS script's writer output really
// round-trips through the shared library's own shape validator, not a
// mocked stand-in for it. That means `packages/builder` must be built
// first (`npm run build --workspace=packages/builder`) for this file to
// run -- the same precondition scripts/check-neutrality.mjs already
// documents for its own dist-consuming gate. This is why this test is
// wired as its own explicit `node --test` step in ci.yml's `build` job,
// placed AFTER `npm run build`, rather than into `check:gates` (which
// verifiably runs BEFORE `build` in the `npm run check` aggregate --
// adding a dist-dependent test there would break `npm run check` on a
// fresh clone before it ever reaches the build step that produces the
// dist/ this test needs).
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildObservationBundle } from "./observation-bundle.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const builderDistEntry = join(repoRoot, "packages/builder/dist/index.js");

if (!existsSync(builderDistEntry)) {
  throw new Error(
    `${builderDistEntry} is missing -- run "npm run build --workspace=packages/builder" before running this test file.`,
  );
}
const { parseObservationBundle } = await import(pathToFileURL(builderDistEntry).href);

const PRODUCED_AT = "2026-08-19T00:00:00.000Z";

test("buildObservationBundle: an injected satisfied gate result round-trips through the real writer and parser", async () => {
  const serialized = await buildObservationBundle({
    repositoryId: "foundry",
    ref: "abc1234",
    producedAt: PRODUCED_AT,
    gateResult: { verdict: "satisfied", evaluated: 21 },
  });
  const parsed = JSON.parse(serialized);
  const outcome = parseObservationBundle(parsed);
  assert.equal(outcome.ok, true);
  assert.deepEqual(parsed.repository, { id: "foundry", ref: "abc1234" });
  assert.equal(parsed.producedAt, PRODUCED_AT);
  assert.deepEqual(parsed.gates, [{ gateId: "repository-profile", result: { verdict: "satisfied", evaluated: 21 } }]);
});

test("buildObservationBundle: an injected violated gate result round-trips, carrying its own findings", async () => {
  const violated = {
    verdict: "violated",
    findings: [{ rule: "root-entry-missing", severity: "high", message: '"README.md" is required but missing.' }],
  };
  const serialized = await buildObservationBundle({ producedAt: PRODUCED_AT, gateResult: violated });
  const parsed = JSON.parse(serialized);
  assert.equal(parseObservationBundle(parsed).ok, true);
  assert.deepEqual(parsed.gates[0].result, violated);
});

test("buildObservationBundle: an injected indeterminate gate result round-trips, carrying its own reason and detail", async () => {
  const indeterminate = { verdict: "indeterminate", reason: "declaration-schema-invalid", detail: "requirements[0] is malformed" };
  const serialized = await buildObservationBundle({ producedAt: PRODUCED_AT, gateResult: indeterminate });
  const parsed = JSON.parse(serialized);
  assert.equal(parseObservationBundle(parsed).ok, true);
  assert.deepEqual(parsed.gates[0].result, indeterminate);
});

test("buildObservationBundle: requires an explicit producedAt, never reads a clock", async () => {
  await assert.rejects(
    buildObservationBundle({ gateResult: { verdict: "satisfied", evaluated: 1 } }),
    /producedAt is required/,
  );
});

test("buildObservationBundle: rejects an empty producedAt", async () => {
  await assert.rejects(
    buildObservationBundle({ producedAt: "   ", gateResult: { verdict: "satisfied", evaluated: 1 } }),
    /producedAt is required/,
  );
});

test("buildObservationBundle: omits repository.ref when no ref is supplied", async () => {
  const serialized = await buildObservationBundle({ producedAt: PRODUCED_AT, gateResult: { verdict: "satisfied", evaluated: 1 } });
  const parsed = JSON.parse(serialized);
  assert.deepEqual(parsed.repository, { id: "foundry" });
});

test("buildObservationBundle: the real writer rejects a malformed injected gate result rather than silently serializing it", async () => {
  // writeObservationBundle validates the assembled bundle before returning
  // (packages/builder/src/observation-bundle.ts) and throws on an invalid
  // shape -- a violated result with no findings is exactly the shape its
  // own gateViolated() constructor also refuses to build.
  await assert.rejects(buildObservationBundle({ producedAt: PRODUCED_AT, gateResult: { verdict: "violated", findings: [] } }));
});
