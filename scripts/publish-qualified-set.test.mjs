import assert from "node:assert/strict";
import test from "node:test";

import { publishEligibleSet, publishOnePackage } from "./publish-qualified-set.mjs";

function passingDeps(overrides = {}) {
  return {
    runPreflight: () => ({ ok: true, output: "PASS" }),
    packCandidate: () => ({ path: "/tmp/app.tgz", cleanup: () => {} }),
    runQualification: () => "/tmp/transcript.json",
    validate: () => [],
    publish: async () => ({ name: "@example/app", version: "1.0.0" }),
    ...overrides,
  };
}

// -------------------------------------------------------------------- publishOnePackage

test("publishOnePackage: a preflight failure stops before packing, qualifying, or publishing", async () => {
  let touched = false;
  const outcome = await publishOnePackage({
    packageKey: "app",
    recordPath: "governance/release-qualifications/clossys-app-1.0.0.json",
    ...passingDeps({
      runPreflight: () => ({ ok: false, output: "FAIL name collision" }),
      packCandidate: () => { touched = true; return { path: "/tmp/x.tgz", cleanup: () => {} }; },
    }),
  });
  assert.equal(outcome.status, "preflight-failed");
  assert.match(outcome.detail, /FAIL name collision/);
  assert.equal(touched, false);
});

test("publishOnePackage: a packing failure stops before qualifying or publishing", async () => {
  let touched = false;
  const outcome = await publishOnePackage({
    packageKey: "app",
    recordPath: "governance/release-qualifications/clossys-app-1.0.0.json",
    ...passingDeps({
      packCandidate: () => { throw new Error("npm pack failed"); },
      runQualification: () => { touched = true; return "/tmp/transcript.json"; },
    }),
  });
  assert.equal(outcome.status, "pack-failed");
  assert.match(outcome.detail, /npm pack failed/);
  assert.equal(touched, false);
});

test("publishOnePackage: a fresh-qualification failure stops before prepublish validation or publishing, and still cleans up", async () => {
  let cleaned = false;
  let published = false;
  const outcome = await publishOnePackage({
    packageKey: "app",
    recordPath: "governance/release-qualifications/clossys-app-1.0.0.json",
    ...passingDeps({
      packCandidate: () => ({ path: "/tmp/app.tgz", cleanup: () => { cleaned = true; } }),
      runQualification: () => { throw new Error("registry unreachable"); },
      publish: async () => { published = true; return {}; },
    }),
  });
  assert.equal(outcome.status, "qualification-failed");
  assert.match(outcome.detail, /registry unreachable/);
  assert.equal(published, false);
  assert.equal(cleaned, true);
});

test("publishOnePackage: prepublish validation findings stop the publish and are reported verbatim", async () => {
  let published = false;
  const outcome = await publishOnePackage({
    packageKey: "app",
    recordPath: "governance/release-qualifications/clossys-app-1.0.0.json",
    ...passingDeps({
      validate: () => [{ rule: "tarball", message: "exact tarball differs from record." }],
      publish: async () => { published = true; return {}; },
    }),
  });
  assert.equal(outcome.status, "prepublish-validation-failed");
  assert.match(outcome.detail, /\[tarball\] exact tarball differs from record\./);
  assert.equal(published, false);
});

test("publishOnePackage: a thrown prepublish validation error is reported, not left to crash the batch", async () => {
  const outcome = await publishOnePackage({
    packageKey: "app",
    recordPath: "governance/release-qualifications/clossys-app-1.0.0.json",
    ...passingDeps({
      validate: () => { throw new Error("invalid qualification policy"); },
    }),
  });
  assert.equal(outcome.status, "prepublish-validation-failed");
  assert.match(outcome.detail, /invalid qualification policy/);
});

test("publishOnePackage: a publish failure is reported, and the packed candidate is always cleaned up", async () => {
  let cleaned = false;
  const outcome = await publishOnePackage({
    packageKey: "app",
    recordPath: "governance/release-qualifications/clossys-app-1.0.0.json",
    ...passingDeps({
      packCandidate: () => ({ path: "/tmp/x.tgz", cleanup: () => { cleaned = true; } }),
      publish: async () => { throw new Error("owner-present npm publish failed"); },
    }),
  });
  assert.equal(outcome.status, "publish-failed");
  assert.match(outcome.detail, /owner-present npm publish failed/);
  assert.equal(cleaned, true);
});

test("publishOnePackage: success hands the preflighted package's exact candidate, fresh transcript, and record path through the whole chain", async () => {
  const seen = [];
  const outcome = await publishOnePackage({
    packageKey: "app",
    recordPath: "governance/release-qualifications/clossys-app-1.0.0.json",
    root: "/repo",
    runPreflight: (packageDirectory) => { seen.push(["preflight", packageDirectory]); return { ok: true, output: "PASS" }; },
    packCandidate: (packageKey) => { seen.push(["pack", packageKey]); return { path: "/tmp/app.tgz", cleanup: () => seen.push(["cleanup"]) }; },
    runQualification: (packageKey, candidatePath) => { seen.push(["qualify", packageKey, candidatePath]); return "/tmp/transcript.json"; },
    validate: (options) => { seen.push(["validate", options]); return []; },
    publish: async (options) => { seen.push(["publish", options]); return { name: "@example/app", version: "1.0.0" }; },
  });
  assert.equal(outcome.status, "published");
  assert.deepEqual(outcome.detail, { name: "@example/app", version: "1.0.0" });
  assert.deepEqual(seen[0], ["preflight", "/repo/packages/app"]);
  assert.deepEqual(seen[1], ["pack", "app"]);
  assert.deepEqual(seen[2], ["qualify", "app", "/tmp/app.tgz"]);
  assert.equal(seen[3][0], "validate");
  assert.deepEqual(seen[3][1], { root: "/repo", args: { package: "app", tarball: "/tmp/app.tgz", transcript: "/tmp/transcript.json", mode: "prepublish" } });
  assert.equal(seen[4][0], "publish");
  assert.equal(seen[4][1].packageKey, "app");
  assert.equal(seen[4][1].candidatePath, "/tmp/app.tgz");
  assert.equal(seen[4][1].recordPath, "governance/release-qualifications/clossys-app-1.0.0.json");
  assert.equal(seen[4][1].mode, "owner-present");
  assert.deepEqual(seen[5], ["cleanup"]);
});

// issue #1322 item 3: preflight resolves `denylist` explicitly (CLI
// `--denylist` or `PUBLIC_SAFETY_DENYLIST`) and runs FULL against it, but
// the actual publish call used to default `env` to the raw ambient
// `process.env` -- so an explicit `--denylist <path>` and a DIFFERENT
// ambient `PUBLIC_SAFETY_DENYLIST` env var would validate two different
// files, with neither step erroring. The publish call's env must carry the
// exact same resolved denylist preflight was told to use.
test("publishOnePackage: the publish call's env.PUBLIC_SAFETY_DENYLIST is the resolved denylist, not a stray ambient env var (issue #1322 item 3)", async () => {
  const seenPreflight = [];
  let publishEnv;
  const outcome = await publishOnePackage({
    packageKey: "app",
    recordPath: "governance/release-qualifications/clossys-app-1.0.0.json",
    root: "/repo",
    denylist: "/explicit/denylist.json",
    env: { PUBLIC_SAFETY_DENYLIST: "/ambient/stray-denylist.json", PATH: "/usr/bin" },
    ...passingDeps({
      runPreflight: (packageDirectory, options) => { seenPreflight.push(options); return { ok: true, output: "PASS" }; },
      publish: async (options) => { publishEnv = options.env; return { name: "@example/app", version: "1.0.0" }; },
    }),
  });
  assert.equal(outcome.status, "published");
  // Preflight was told the explicit denylist, as before.
  assert.equal(seenPreflight[0].denylist, "/explicit/denylist.json");
  // The publish call's env must resolve to the SAME denylist, not the
  // ambient env's own (different) value -- and every other ambient env
  // entry must still pass through unchanged.
  assert.equal(publishEnv.PUBLIC_SAFETY_DENYLIST, "/explicit/denylist.json");
  assert.equal(publishEnv.PATH, "/usr/bin");
});

test("publishOnePackage: with no denylist resolved, the publish call's env is passed through exactly as given", async () => {
  let publishEnv;
  const outcome = await publishOnePackage({
    packageKey: "app",
    recordPath: "governance/release-qualifications/clossys-app-1.0.0.json",
    root: "/repo",
    env: { PUBLIC_SAFETY_DENYLIST: "/ambient/denylist.json", PATH: "/usr/bin" },
    ...passingDeps({
      publish: async (options) => { publishEnv = options.env; return { name: "@example/app", version: "1.0.0" }; },
    }),
  });
  assert.equal(outcome.status, "published");
  assert.equal(publishEnv.PUBLIC_SAFETY_DENYLIST, "/ambient/denylist.json");
  assert.equal(publishEnv.PATH, "/usr/bin");
});

// -------------------------------------------------------------------- publishEligibleSet

test("publishEligibleSet: a failure in one package does not stop the batch, and every outcome is reported", async () => {
  const attempted = [];
  const outcomes = await publishEligibleSet({
    eligible: [{ package: "base" }, { package: "dependent" }, { package: "third" }],
    recordPaths: { base: "r/base.json", dependent: "r/dependent.json", third: "r/third.json" },
    publishOne: async ({ packageKey }) => {
      attempted.push(packageKey);
      if (packageKey === "dependent") return { packageKey, status: "publish-failed", detail: "boom" };
      return { packageKey, status: "published", detail: {} };
    },
  });
  assert.deepEqual(attempted, ["base", "dependent", "third"]);
  assert.deepEqual(
    outcomes.map((o) => o.status),
    ["published", "publish-failed", "published"],
  );
});

test("publishEligibleSet: attempts run sequentially, in the given (dependency) order", async () => {
  const started = [];
  const finished = [];
  await publishEligibleSet({
    eligible: [{ package: "first" }, { package: "second" }],
    recordPaths: {},
    publishOne: async ({ packageKey }) => {
      started.push(packageKey);
      await new Promise((r) => setTimeout(r, packageKey === "first" ? 10 : 0));
      finished.push(packageKey);
      return { packageKey, status: "published", detail: {} };
    },
  });
  // If these ran concurrently, "second" (no delay) would finish before "first"
  // (10ms delay) despite starting after it — sequential execution keeps them
  // in lockstep instead, matching publish.yml's own max-parallel: 1.
  assert.deepEqual(finished, ["first", "second"]);
  assert.deepEqual(started, ["first", "second"]);
});

test("publishEligibleSet: each package's own record path is looked up and forwarded, never shared", async () => {
  const seenRecordPaths = [];
  await publishEligibleSet({
    eligible: [{ package: "a" }, { package: "b" }],
    recordPaths: { a: "r/a.json", b: "r/b.json" },
    publishOne: async ({ packageKey, recordPath }) => {
      seenRecordPaths.push([packageKey, recordPath]);
      return { packageKey, status: "published", detail: {} };
    },
  });
  assert.deepEqual(seenRecordPaths, [["a", "r/a.json"], ["b", "r/b.json"]]);
});
