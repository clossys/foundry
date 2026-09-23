import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { defaultCleanRebuildPackage, defaultPackCandidate, publishEligibleSet, publishOnePackage } from "./publish-qualified-set.mjs";

function passingDeps(overrides = {}) {
  return {
    runPreflight: () => ({ ok: true, output: "PASS" }),
    cleanRebuildPackage: () => {},
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
    cleanRebuildPackage: (packageKey, options) => { seen.push(["clean-rebuild", packageKey, options]); },
    packCandidate: (packageKey, options) => { seen.push(["pack", packageKey, options]); return { path: "/tmp/app.tgz", cleanup: () => seen.push(["cleanup"]) }; },
    runQualification: (packageKey, candidatePath) => { seen.push(["qualify", packageKey, candidatePath]); return "/tmp/transcript.json"; },
    validate: (options) => { seen.push(["validate", options]); return []; },
    publish: async (options) => { seen.push(["publish", options]); return { name: "@example/app", version: "1.0.0" }; },
  });
  assert.equal(outcome.status, "published");
  assert.deepEqual(outcome.detail, { name: "@example/app", version: "1.0.0" });
  assert.deepEqual(seen[0], ["preflight", "/repo/packages/app"]);
  assert.deepEqual(seen[1], ["clean-rebuild", "app", { root: "/repo" }]);
  assert.deepEqual(seen[2], ["pack", "app", { root: "/repo" }]);
  assert.deepEqual(seen[3], ["qualify", "app", "/tmp/app.tgz"]);
  assert.equal(seen[4][0], "validate");
  assert.deepEqual(seen[4][1], { root: "/repo", args: { package: "app", tarball: "/tmp/app.tgz", transcript: "/tmp/transcript.json", mode: "prepublish" } });
  assert.equal(seen[5][0], "publish");
  assert.equal(seen[5][1].packageKey, "app");
  assert.equal(seen[5][1].candidatePath, "/tmp/app.tgz");
  assert.equal(seen[5][1].recordPath, "governance/release-qualifications/clossys-app-1.0.0.json");
  assert.equal(seen[5][1].mode, "owner-present");
  assert.deepEqual(seen[6], ["cleanup"]);
});

test("publishOnePackage: a clean-rebuild failure stops before packing, qualifying, or publishing", async () => {
  let touched = false;
  const outcome = await publishOnePackage({
    packageKey: "app",
    recordPath: "governance/release-qualifications/clossys-app-1.0.0.json",
    ...passingDeps({
      cleanRebuildPackage: () => { throw new Error("clean dist/ rebuild failed for packages/app: tsc exited 2"); },
      packCandidate: () => { touched = true; return { path: "/tmp/x.tgz", cleanup: () => {} }; },
    }),
  });
  assert.equal(outcome.status, "clean-rebuild-failed");
  assert.match(outcome.detail, /tsc exited 2/);
  assert.equal(touched, false);
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

// -------------------------------------------------------------------- defaultCleanRebuildPackage (issue #1286)

function withTempRoot(run) {
  const root = mkdtempSync(join(tmpdir(), "clean-rebuild-"));
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("defaultCleanRebuildPackage: deletes the existing dist/ before the rebuild command runs, and the mode a stale dist/ left behind does not survive", () => {
  withTempRoot((root) => {
    const packageDir = join(root, "packages", "widget");
    mkdirSync(join(packageDir, "dist"), { recursive: true });
    const staleBin = join(packageDir, "dist", "cli.js");
    // Simulates what `npm ci` does to a workspace's declared `bin` target
    // when it links it against a `dist/` that already existed (issue #1286).
    writeFileSync(staleBin, "#!/usr/bin/env node\nconsole.log('stale');\n");
    chmodSync(staleBin, 0o755);

    let distExistedWhenRebuildRan;
    let seenArgs;
    const run = (file, args, options) => {
      distExistedWhenRebuildRan = existsSync(join(packageDir, "dist"));
      seenArgs = { file, args, cwd: options?.cwd };
      // Simulates a fresh `tsc` emit into the now-deleted dist/: new content,
      // default (umask-derived) file mode — never an inherited chmod.
      mkdirSync(join(packageDir, "dist"), { recursive: true });
      writeFileSync(join(packageDir, "dist", "cli.js"), "#!/usr/bin/env node\nconsole.log('fresh');\n");
      return "";
    };

    defaultCleanRebuildPackage("widget", { root, run });

    assert.equal(distExistedWhenRebuildRan, false, "dist/ must already be gone by the time the rebuild command runs");
    assert.deepEqual(seenArgs, { file: "npm", args: ["run", "build", "--workspace", "packages/widget", "--if-present"], cwd: root });
    const mode = statSync(staleBin).mode & 0o777;
    assert.equal(mode, 0o644, "a clean rebuild must never carry a stale dist/'s executable mode forward");
  });
});

test("defaultCleanRebuildPackage: a failing rebuild command is reported with the package name and the underlying output", () => {
  withTempRoot((root) => {
    mkdirSync(join(root, "packages", "widget"), { recursive: true });
    const run = () => {
      const error = new Error("Command failed");
      error.stdout = "";
      error.stderr = "error TS2307: Cannot find module\n";
      throw error;
    };
    assert.throws(
      () => defaultCleanRebuildPackage("widget", { root, run }),
      /clean dist\/ rebuild failed for packages\/widget: .*TS2307/s,
    );
  });
});

test("defaultCleanRebuildPackage + defaultPackCandidate: a real npm pack of the rebuilt tree carries no stale executable mode — proves the packed bytes match a fresh-checkout build (issue #1286)", () => {
  withTempRoot((root) => {
    const packageDir = join(root, "packages", "widget");
    mkdirSync(join(packageDir, "dist"), { recursive: true });
    writeFileSync(
      join(packageDir, "package.json"),
      `${JSON.stringify({ name: "@example/widget", version: "1.0.0", bin: { widget: "dist/cli.js" }, files: ["dist"] }, null, 2)}\n`,
    );
    const stagedBin = join(packageDir, "dist", "cli.js");
    // A dist/ that survived from an earlier build, with the executable mode
    // `npm ci` would have set on it when it linked this bin target — the
    // exact stale-mode starting condition issue #1286 describes.
    writeFileSync(stagedBin, "#!/usr/bin/env node\nconsole.log('stale');\n");
    chmodSync(stagedBin, 0o755);

    defaultCleanRebuildPackage("widget", {
      root,
      run: () => {
        // Simulates the package's own `tsc` build re-emitting dist/ from a
        // clean, dist-less starting point — default file mode only.
        mkdirSync(join(packageDir, "dist"), { recursive: true });
        writeFileSync(join(packageDir, "dist", "cli.js"), "#!/usr/bin/env node\nconsole.log('fresh');\n");
        return "";
      },
    });

    const candidate = defaultPackCandidate("widget", { root, stagingParent: root });
    try {
      const listing = spawnSync("tar", ["-tvzf", candidate.path], { encoding: "utf8" });
      assert.equal(listing.status, 0, listing.stderr);
      const binLine = listing.stdout.split("\n").find((line) => line.includes("dist/cli.js"));
      assert.ok(binLine, `expected the packed tarball to contain dist/cli.js: ${listing.stdout}`);
      // A CI checkout would emit dist/cli.js at -rw-r--r--, never -rwxr-xr-x;
      // this is the exact byte (well, mode) issue #1286 reports as differing.
      assert.match(binLine, /^-rw-r--r--/, `packed dist/cli.js must not carry a stale executable mode: ${binLine}`);
    } finally {
      candidate.cleanup();
    }
  });
});

test("negative control: packing a stale dist/ WITHOUT the clean rebuild really does carry the stale mode forward — this is the defect issue #1286 reports", () => {
  withTempRoot((root) => {
    const packageDir = join(root, "packages", "widget");
    mkdirSync(join(packageDir, "dist"), { recursive: true });
    writeFileSync(
      join(packageDir, "package.json"),
      `${JSON.stringify({ name: "@example/widget", version: "1.0.0", bin: { widget: "dist/cli.js" }, files: ["dist"] }, null, 2)}\n`,
    );
    const stagedBin = join(packageDir, "dist", "cli.js");
    writeFileSync(stagedBin, "#!/usr/bin/env node\nconsole.log('stale');\n");
    chmodSync(stagedBin, 0o755);

    // No defaultCleanRebuildPackage call here — pack the stale tree directly,
    // exactly what publish-qualified-set.mjs did before this fix.
    const candidate = defaultPackCandidate("widget", { root, stagingParent: root });
    try {
      const listing = spawnSync("tar", ["-tvzf", candidate.path], { encoding: "utf8" });
      assert.equal(listing.status, 0, listing.stderr);
      const binLine = listing.stdout.split("\n").find((line) => line.includes("dist/cli.js"));
      assert.ok(binLine, `expected the packed tarball to contain dist/cli.js: ${listing.stdout}`);
      assert.match(binLine, /^-rwxr-xr-x/, `expected the unfixed pack step to still carry the stale executable mode: ${binLine}`);
    } finally {
      candidate.cleanup();
    }
  });
});
