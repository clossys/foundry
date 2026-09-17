#!/usr/bin/env node
// rehearse-publish-lifecycle — actually execute the npm lifecycle scripts a
// publish would fire, in the environment the publish job runs in.
//
//   node scripts/rehearse-publish-lifecycle.mjs <packageDir>
//
// Exit 0 = every rehearsable hook ran and succeeded. Exit 1 = a hook failed,
// or the manifest declares a hook that CANNOT be rehearsed. Exit 2 = the
// manifest could not be read (indeterminate, never a pass).
//
// WHY THIS EXISTS (issue #351)
// ----------------------------
// publish.yml's qualify job runs `npm publish . --dry-run`, and that step
// reads as a rehearsal. It is not one, and cannot be made into one:
//
//   * `--dry-run` does not execute lifecycle scripts, and
//   * the step passes `--ignore-scripts` anyway -- CORRECTLY, because the
//     real upload (scripts/publish-qualified-directory.mjs) passes it too.
//     Dropping `--ignore-scripts` from the dry run would make it LESS
//     faithful to the real publish, not more. Issue #351's option 1 is
//     therefore the wrong fix here; this file is its option 2.
//
// So nothing in the gate chain has ever executed these scripts, while
// `prepublishOnly` is a real, shipped gate: set-prepublish-hook.mjs keeps
// every package's `prepublishOnly` wired to check-name-collision.mjs
// precisely so a hand-run `npm publish` from a package directory -- which
// npm DOES fire the hook for -- cannot bypass the collision check (#273).
// A change that breaks that hook passes every check here and fails on a
// maintainer's own machine, at the one moment the check exists to protect.
// That is the untested ground.
//
// WHAT THIS PROVES, AND WHAT IT STILL DOES NOT
// --------------------------------------------
// PROVES: the declared hook COMMANDS succeed, in the job's own environment,
// with no credential and without touching the registry -- the hooks here read
// the registry anonymously and compile, nothing more.
//
// DOES NOT PROVE: that npm would fire them. npm decides that from the publish
// target's spec type, not from this script; that dispatch is asserted
// separately by publish-qualified-directory.test.mjs and
// set-prepublish-hook.mjs --check. Running a hook by name is the closest a
// credential-free, registry-immutable rehearsal can get.
//
// CANNOT REHEARSE AT ALL: `publish` and `postpublish`. npm fires those only
// AFTER a successful upload, so exercising them for real would mean mutating
// the registry -- the one thing a rehearsal must never do. This script
// therefore FAILS when a manifest declares one, rather than passing over it
// quietly. None are declared today; the failure is the record that
// introducing one is a decision, not a detail.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// npm's publish-time order is: prepublishOnly, prepack, prepare, postpack,
// then the upload, then publish and postpublish. Everything before the upload
// can be run for real here. `prepack`, `prepare` and `postpack` are included
// even though both sanctioned publish paths pack and upload with
// `--ignore-scripts`: a broken one still breaks a hand-run `npm publish`,
// which is the invocation these hooks exist to protect.
const REHEARSABLE = ["prepublishOnly", "prepack", "prepare", "postpack"];
// npm fires these only after the registry has already accepted the upload.
const UNREHEARSABLE = ["publish", "postpublish"];

const packageDir = process.argv[2];
if (!packageDir || packageDir.startsWith("--")) {
  console.error("usage: rehearse-publish-lifecycle.mjs <packageDir>");
  process.exit(2);
}

const absolute = resolve(packageDir);
const manifestPath = join(absolute, "package.json");
if (!existsSync(manifestPath)) {
  console.error(`INDETERMINATE — no package.json at ${packageDir}`);
  process.exit(2);
}

let manifest;
try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); }
catch (error) {
  console.error(`INDETERMINATE — ${packageDir}/package.json is not valid JSON: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exit(2);
}

const scripts = manifest.scripts ?? {};
const declaredUnrehearsable = UNREHEARSABLE.filter((name) => typeof scripts[name] === "string");
if (declaredUnrehearsable.length > 0) {
  console.error(
    `HOOK CANNOT BE REHEARSED — ${manifest.name ?? packageDir} declares ${declaredUnrehearsable.join(", ")}. ` +
      "npm fires these only after a successful upload, so no credential-free, registry-immutable rehearsal can execute them: " +
      "they would first run on the real publish, which is production. Remove the hook, or decide deliberately to accept an unrehearsed publish-time script.",
  );
  process.exit(1);
}

const declared = REHEARSABLE.filter((name) => typeof scripts[name] === "string");
if (declared.length === 0) {
  console.log(`REHEARSED — ${manifest.name ?? packageDir} declares no publish lifecycle script to rehearse.`);
  process.exit(0);
}

for (const name of declared) {
  console.log(`rehearsing ${name}: ${scripts[name]}`);
  const result = spawnSync("npm", ["run", name], { cwd: absolute, stdio: "inherit" });
  if (result.error || result.signal || result.status !== 0) {
    console.error(
      `HOOK FAILED — ${manifest.name ?? packageDir}'s \`${name}\` exited ${result.status ?? result.signal ?? "with an error"} in the publish job's own environment. ` +
        "A publish that fires this hook would fail the same way, and would do so for the first time in production.",
    );
    process.exit(1);
  }
}

console.log(`REHEARSED — ${manifest.name ?? packageDir}: ${declared.join(", ")} each exited 0.`);
process.exit(0);
