#!/usr/bin/env node
// test-gates — regression tests for the publish-safety gates themselves.
//
//   node scripts/test-gates.mjs [--verbose]
//
// Exit 0 = every gate behaves as specified. Exit 1 = a gate regressed.
//
// WHY THIS EXISTS
// ---------------
// The gates are the only thing standing between an unreviewed working tree and an
// irreversible public disclosure, and until now they had no tests at all. A
// gate with no tests is a gate that rots silently: every rule here is one
// refactor away from matching nothing and still exiting 0, which looks
// identical to "clean" from CI.
//
// Each case below is a NEGATIVE test — it plants something that must be caught
// and asserts the gate catches it. A gate that passes its own positive case
// proves very little; a gate that fails to catch planted contamination is the
// only failure mode that matters.
//
// Fixtures are built in a temp directory and torn down. Nothing here writes to
// the repository, and no fixture contains a real credential — the secret-shaped
// strings are structurally valid but issued by no one.
//
// Cases marked KNOWN-GAP document behaviour that is currently wrong. They assert
// the CURRENT behaviour so the suite stays green, and they name what should
// change. Deleting a KNOWN-GAP case without fixing the underlying rule is how a
// known hole becomes an unknown one.

import { mkdtempSync, rmSync, mkdirSync, writeFileSync, cpSync, existsSync, chmodSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");
const verbose = process.argv.includes("--verbose");

// Fixture packages are named under a scope that appears in no denylist term, so
// a fixture's own name can never be the thing a case trips over. The collision
// gate is the one exception — it must use the real scope, because it is
// specifically checking names under the real registry owner.
const FIXTURE_SCOPE = "@gate-fixture";

// This suite runs against a SYNTHETIC denylist, never the real one.
//
// Two reasons, and the second is the load-bearing one:
//   1. Hermetic. The tests assert the gate's MECHANISM — that an identity term
//      matches, that neutralize confines to its paths — which needs some terms,
//      not the real terms. Real terms would make these tests fail whenever the
//      denylist is edited for unrelated reasons.
//   2. This file lives in a public repository and is scanned by the very gate
//      it tests. Hardcoding real denylist terms as fixtures would commit, in
//      plaintext, exactly the strings the denylist exists to keep out — the
//      same reason the real denylist is not in this repo. (Caught the honest
//      way: an earlier draft of this file did precisely that and the gate
//      rejected it.)
//
// Properties of the REAL denylist are checked separately by
// check-denylist-quality.mjs, which reads it without ever echoing a term.
const SYNTH_DENYLIST = {
  version: "synthetic-test",
  terms: [
    { pattern: "acme-corp", why: "synthetic sibling product", severity: "high" },
    { pattern: "zeta\\.example", why: "synthetic product domain", severity: "high" },
    { pattern: "quux(-|\\.| )corp", why: "synthetic separated name", severity: "medium" },
  ],
  neutralize: [
    { pattern: "@gate-fixture/acme-corp-allowed", paths: ["allowed.md"] },
  ],
};

const SAFETY = join(scriptDir, "check-public-safety.mjs");
const ARTIFACT = join(scriptDir, "check-artifact-safety.mjs");
const COLLISION = join(scriptDir, "check-name-collision.mjs");
const CONTAM = join(scriptDir, "check-contamination-classes.mjs");
const QUALITY = join(scriptDir, "check-denylist-quality.mjs");

let passed = 0;
const failures = [];

function run(cmd, args, opts = {}) {
  try {
    const stdout = execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
    return { code: 0, out: stdout };
  } catch (error) {
    return { code: error.status ?? 1, out: (error.stdout ?? "") + (error.stderr ?? "") };
  }
}

function check(name, condition, detail) {
  if (condition) {
    passed++;
    if (verbose) console.log(`  ok   ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  FAIL ${name}\n         ${detail}`);
  }
}

function gitInit(dir) {
  run("git", ["-C", dir, "init", "-q"]);
  run("git", ["-C", dir, "add", "-A"]);
  run("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "fixture"]);
}

const work = mkdtempSync(join(tmpdir(), "gate-tests-"));
const synthPath = join(work, "synth-denylist.json");
writeFileSync(synthPath, JSON.stringify(SYNTH_DENYLIST, null, 2));
// Every gate invocation in this suite uses the synthetic list.
const DL = ["--denylist", synthPath];

try {
  // ---------------------------------------------------------------- secrets
  console.log("\n# credential-shaped strings");
  {
    const dir = join(work, "secrets");
    mkdirSync(dir, { recursive: true });
    // Structurally valid, issued by nobody — and assembled from fragments at
    // run time so that no complete credential-shaped string is ever a literal in
    // this file. Written out whole, each of these would (correctly) trip the
    // gate on the gate's own test suite.
    const planted = [
      ["anthropic", "sk-" + "ant-" + "A".repeat(24)],
      ["openai", "sk" + "-" + "B".repeat(28)],
      ["github-pat", "ghp" + "_" + "C".repeat(28)],
      ["aws", "AKI" + "A" + "D".repeat(16)],
      ["stripe-live", "sk_" + "live_" + "E".repeat(16)],
      ["slack", "xox" + "b-" + "1".repeat(16)],
      ["db-url", "postgre" + "s://u:p@h:5432/d"],
      ["private-key", "-----BEGIN " + "RSA PRIVATE KEY" + "-----"],
    ];
    for (const [label, value] of planted) {
      writeFileSync(join(dir, `${label}.js`), `const x = ${JSON.stringify(value)};\n`);
    }
    gitInit(dir);
    const r = run("node", [SAFETY, dir, ...DL, "--require-denylist", "--json"]);
    let report;
    try { report = JSON.parse(r.out); } catch { report = { failures: [] }; }
    for (const [label] of planted) {
      const hit = (report.failures ?? []).some((f) => f.kind === "SECRET" && f.rel === `${label}.js`);
      check(`catches ${label}`, hit, `no SECRET finding for ${label}.js`);
    }
    const leaked = (report.failures ?? []).some((f) => f.kind === "SECRET" && f.text && f.text !== "<redacted>");
    check("never echoes a matched secret", !leaked, "a SECRET finding carried the raw matching line");
  }

  // -------------------------------------------------------- forbidden files
  console.log("\n# forbidden files");
  {
    const dir = join(work, "forbidden");
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, ".claude", "settings.json"), "{}\n");
    writeFileSync(join(dir, "CLAUDE.md"), "# internal\n");
    writeFileSync(join(dir, ".env"), "TOKEN=x\n");
    writeFileSync(join(dir, ".npmrc"), "//r/:_authToken=x\n");
    writeFileSync(join(dir, "CONSUMPTION.json"), "{}\n");
    gitInit(dir);
    // .gitignore is absent so nothing is skipped as ignored.
    const r = run("node", [SAFETY, dir, ...DL, "--require-denylist", "--json"]);
    let report;
    try { report = JSON.parse(r.out); } catch { report = { failures: [] }; }
    for (const f of [".claude/settings.json", "CLAUDE.md", ".env", ".npmrc", "CONSUMPTION.json"]) {
      const hit = (report.failures ?? []).some((x) => x.kind === "forbidden-file" && x.rel === f);
      check(`refuses ${f}`, hit, `no forbidden-file finding for ${f}`);
    }
  }

  // ------------------------------------------------------------ fail-closed
  console.log("\n# fail-closed behaviour");
  {
    const dir = join(work, "failclosed");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "a.md"), "clean\n");
    gitInit(dir);

    const missing = run("node", [SAFETY, dir, "--require-denylist", "--denylist", "/nonexistent/dl.json"]);
    check("--require-denylist exits 2 when the denylist is missing", missing.code === 2, `exit was ${missing.code}`);

    const partial = run("node", [SAFETY, dir, "--denylist", "/nonexistent/dl.json"]);
    check("PARTIAL mode exits 0 but never claims a bare PASS", partial.code === 0 && /PASS \(partial\)/.test(partial.out), "expected an explicitly-partial PASS");
    check("PARTIAL mode prints a visible banner", /PARTIAL SCAN/.test(partial.out), "no PARTIAL SCAN banner");
    check("PARTIAL mode says a pass is not a clearance", /does NOT clear/i.test(partial.out), "banner did not disclaim clearance");
  }

  // ------------------------------- check-contamination-classes: fail-closed
  console.log("\n# check-contamination-classes: fail-closed walker");
  {
    const dir = join(work, "contam-failclosed");
    const clean = join(dir, "clean");
    const blocked = join(dir, "blocked");
    mkdirSync(clean, { recursive: true });
    mkdirSync(blocked, { recursive: true });
    writeFileSync(join(clean, "note.md"), "nothing to see here\n");
    writeFileSync(join(blocked, "note.md"), "nothing to see here\n");

    // Sanity anchor: a genuinely clean, fully-readable tree still passes,
    // so the two checks below actually pin the unreadable-directory case
    // and not some unrelated breakage.
    const okRun = run("node", [CONTAM, clean]);
    check("passes a clean, fully-readable directory", okRun.code === 0, `exit was ${okRun.code}: ${okRun.out.slice(0, 200)}`);

    // Make one subdirectory unreadable to reproduce the walk error the gate
    // must fail closed on (a permission error, a broken symlink loop, or any
    // other readdir failure are all the same shape: readdirSync throws).
    chmodSync(blocked, 0o000);
    let reallyBlocked = true;
    try {
      readdirSync(blocked);
      reallyBlocked = false; // e.g. running as root, which ignores the mode bits
    } catch {
      // expected — confirms the fixture actually reproduces an unreadable dir
    }

    try {
      if (reallyBlocked) {
        const r = run("node", [CONTAM, dir]);
        check("aborts (does not exit 0/1) when a directory cannot be read", r.code === 2, `exit was ${r.code}`);
        check("never reports a bare PASS over an unreadable directory", !/PASS/.test(r.out), "gate printed PASS while a directory could not be read");
        check("names the unreadable directory in its error output", r.out.includes(blocked), "no mention of the unreadable path in the error output");
      } else {
        console.log("  skip (running with privileges that bypass directory permissions — cannot reproduce EACCES)");
      }
    } finally {
      // Restore permissions before the outer temp-dir cleanup, which needs to
      // read and delete this directory too.
      chmodSync(blocked, 0o755);
    }
  }

  // --------------------------------------------------- the dist/ blind spot
  console.log("\n# the dist/ blind spot (tree mode vs artifact mode)");
  {
    const dir = join(work, "distblind");
    mkdirSync(join(dir, "packages", "probe"), { recursive: true });
    const pkgDir = join(dir, "packages", "probe");
    cpSync(join(repoRoot, "package-scope.json"), join(dir, "package-scope.json"));
    const scope = JSON.parse(execFileSync("cat", [join(repoRoot, "package-scope.json")], { encoding: "utf8" }));
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify(
        {
          // A neutral, non-denylisted scope on purpose: naming the fixture under
          // the real scope would trip the identity rule (correctly — only the two
          // sanctioned package names are neutralized) and mask what this case tests.
          name: `${FIXTURE_SCOPE}/gate-test-probe`,
          version: "1.0.0",
          private: false,
          license: "MIT",
          type: "module",
          main: "./dist/index.js",
          files: ["dist", "src", "README.md", "LICENSE"],
          publishConfig: { registry: scope.registry },
        },
        null,
        2,
      ) + "\n",
    );
    writeFileSync(join(pkgDir, "README.md"), "# probe\n");
    writeFileSync(join(pkgDir, "LICENSE"), "MIT\n");
    mkdirSync(join(pkgDir, "src"), { recursive: true });
    writeFileSync(join(pkgDir, "src", "index.ts"), "export const x = 1;\n");
    mkdirSync(join(pkgDir, "dist"), { recursive: true });
    // Contamination ONLY in build output — never in src, never in a tracked
    // file. The term is synthetic (see SYNTH_DENYLIST), so this file contains
    // no real denylisted string.
    writeFileSync(join(pkgDir, "dist", "index.js"), `export const x = 1;\n// see the acme-corp design system\n`);
    writeFileSync(join(dir, ".gitignore"), "node_modules/\ndist/\n");
    gitInit(dir);

    const tree = run("node", [SAFETY, dir, ...DL, "--require-denylist", "--allow-changelogs"]);
    check(
      "tree mode is BLIND to gitignored dist/ (documents why artifact mode exists)",
      tree.code === 0,
      `tree mode exited ${tree.code}; if this now fails, tree mode gained dist visibility — good, update this test`,
    );

    const artifact = run("node", [ARTIFACT, pkgDir, ...DL, "--require-denylist"]);
    check(
      "artifact mode CATCHES contamination that only exists in dist/",
      artifact.code === 1 && /identity/.test(artifact.out),
      `artifact mode exited ${artifact.code} without an identity finding — the blind spot is open again`,
    );
  }

  // ------------------------------------------------- artifact structure
  console.log("\n# artifact structural rules");
  {
    const dir = join(work, "structure");
    const pkgDir = join(dir, "packages", "probe");
    mkdirSync(join(pkgDir, "src"), { recursive: true });
    cpSync(join(repoRoot, "package-scope.json"), join(dir, "package-scope.json"));
    const scope = JSON.parse(execFileSync("cat", [join(repoRoot, "package-scope.json")], { encoding: "utf8" }));
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify(
        {
          name: `${FIXTURE_SCOPE}/gate-test-structure`,
          version: "1.0.0",
          private: false,
          license: "MIT",
          type: "module",
          // Deliberately wrong: ships tests, omits LICENSE, negates only .ts
          files: ["src", "README.md"],
          publishConfig: { registry: scope.registry },
        },
        null,
        2,
      ) + "\n",
    );
    writeFileSync(join(pkgDir, "README.md"), "# probe\n");
    writeFileSync(join(pkgDir, "src", "index.ts"), "export const x = 1;\n");
    writeFileSync(join(pkgDir, "src", "index.test.tsx"), "test('x', () => {});\n");
    gitInit(dir);

    const r = run("node", [ARTIFACT, pkgDir, ...DL, "--require-denylist"]);
    check("artifact mode flags a shipped test file", /test file shipped/.test(r.out), "no test-file finding");
    check("artifact mode flags a missing LICENSE", /LICENSE is absent/.test(r.out), "no missing-LICENSE finding");
    check("artifact mode fails overall on structural defects", r.code === 1, `exit was ${r.code}`);
  }

  // -------------------------------------------------------- collision gate
  console.log("\n# name-collision gate");
  {
    const dir = join(work, "collision");
    mkdirSync(dir, { recursive: true });

    // Exercised entirely through --packages-json (see check-name-collision.mjs)
    // so these cases need no gh credential. Owner, repo, and package names are
    // all synthetic under FIXTURE_SCOPE — this pins the gate's decision LOGIC,
    // not any real registry state.
    //
    // "This repo" identity is injected via GITHUB_REPOSITORY, the same
    // env var the gate trusts in real CI, rather than via a real git remote —
    // that's what makes these cases hermetic. This also means every case here
    // exercises the trust boundary directly: the gate is handed "this repo"
    // from outside the fixture package entirely, so a fixture package.json is
    // free to claim whatever repository.url it likes without affecting the
    // verdict — which is precisely the property under test.
    const thisRepo = "gate-fixture-owner/gate-fixture-repo";
    const asThisRepo = (opts = {}) => ({ ...opts, env: { ...process.env, GITHUB_REPOSITORY: thisRepo } });

    // A name known to exist under this owner from a DIFFERENT repo —
    // reproduced with synthetic names, the exact shape of the collision this
    // gate exists to catch.
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify(
        {
          name: `${FIXTURE_SCOPE}/collided-name`,
          version: "1.0.0",
          private: false,
          repository: { type: "git", url: `git+https://github.com/${thisRepo}.git` },
        },
        null,
        2,
      ) + "\n",
    );
    const collidePackages = join(dir, "packages-collision.json");
    writeFileSync(
      collidePackages,
      JSON.stringify([
        { name: "collided-name", visibility: "public", repository: { full_name: "gate-fixture-owner/some-other-repo" } },
      ]),
    );
    const collide = run("node", [COLLISION, dir, "--packages-json", collidePackages], asThisRepo());
    check("detects a cross-repo name collision", collide.code === 1 && /COLLISION/.test(collide.out), `exit ${collide.code}`);

    // The candidate's OWN package.json repository.url is spoofed to claim the
    // identity of the repo that actually owns the pre-existing colliding
    // package. Trusting that field (the pre-fix behaviour) would make this
    // look like a same-repo version bump. "This repo" must come from
    // GITHUB_REPOSITORY / git remote instead, so the spoof has no effect and
    // the gate still reports a real collision. Regression for GH issue #7.
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify(
        {
          name: `${FIXTURE_SCOPE}/spoofed-name`,
          version: "1.0.0",
          private: false,
          repository: { type: "git", url: "git+https://github.com/gate-fixture-owner/some-other-repo.git" },
        },
        null,
        2,
      ) + "\n",
    );
    const spoofedPackages = join(dir, "packages-spoofed.json");
    writeFileSync(
      spoofedPackages,
      JSON.stringify([
        { name: "spoofed-name", visibility: "public", repository: { full_name: "gate-fixture-owner/some-other-repo" } },
      ]),
    );
    const spoofed = run("node", [COLLISION, dir, "--packages-json", spoofedPackages], asThisRepo());
    check(
      "a spoofed repository.url claiming the colliding package's real owner is still flagged as a collision",
      spoofed.code === 1 && /COLLISION/.test(spoofed.out),
      `exit ${spoofed.code}: ${spoofed.out.slice(0, 300)}`,
    );

    // Same bare name, but the existing package belongs to THIS repo -> a
    // version bump, not a collision.
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify(
        {
          name: `${FIXTURE_SCOPE}/bumped-name`,
          version: "1.0.0",
          private: false,
          repository: { type: "git", url: `git+https://github.com/${thisRepo}.git` },
        },
        null,
        2,
      ) + "\n",
    );
    const bumpPackages = join(dir, "packages-bump.json");
    writeFileSync(
      bumpPackages,
      JSON.stringify([{ name: "bumped-name", visibility: "public", repository: { full_name: thisRepo } }]),
    );
    const bump = run("node", [COLLISION, dir, "--packages-json", bumpPackages], asThisRepo());
    check("treats a same-repo match as a version bump", bump.code === 0, `exit ${bump.code}: ${bump.out.slice(0, 200)}`);

    // Unused name -> safe.
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify(
        {
          name: `${FIXTURE_SCOPE}/unused-name`,
          version: "1.0.0",
          private: false,
          repository: { type: "git", url: `git+https://github.com/${thisRepo}.git` },
        },
        null,
        2,
      ) + "\n",
    );
    const unusedPackages = join(dir, "packages-unused.json");
    writeFileSync(
      unusedPackages,
      JSON.stringify([
        { name: "some-other-package", visibility: "public", repository: { full_name: "gate-fixture-owner/some-other-repo" } },
      ]),
    );
    const safe = run("node", [COLLISION, dir, "--packages-json", unusedPackages], asThisRepo());
    check("passes a name unused under the owner", safe.code === 0, `exit ${safe.code}: ${safe.out.slice(0, 200)}`);

    // The owner's packages could not be listed (fixture: a bare JSON `null`,
    // the same shape the live `gh` path produces on failure) -> must not
    // report a pass.
    const nullPackages = join(dir, "packages-null.json");
    writeFileSync(nullPackages, "null");
    const unreachable = run("node", [COLLISION, dir, "--packages-json", nullPackages], asThisRepo());
    check("fails closed when the owner's packages cannot be listed", unreachable.code === 2, `exit ${unreachable.code}`);

    // Neither GITHUB_REPOSITORY nor a git remote is available -> must not
    // report a pass. `dir` here is a bare directory with no enclosing git
    // repo, so `git remote get-url origin` fails and there is nothing left
    // to fall back to.
    const noRepoEnv = { ...process.env };
    delete noRepoEnv.GITHUB_REPOSITORY;
    const noRepo = run("node", [COLLISION, dir, "--packages-json", unusedPackages], { env: noRepoEnv });
    check(
      "fails closed when this repository's own identity cannot be determined",
      noRepo.code === 2 && /cannot determine this repository/.test(noRepo.out),
      `exit ${noRepo.code}: ${noRepo.out.slice(0, 300)}`,
    );
  }

  // -------------------------------------------------- neutralize confinement
  console.log("\n# neutralize + paths confinement");
  {
    const dir = join(work, "neutralize");
    mkdirSync(dir, { recursive: true });
    // The neutralize entry is confined to allowed.md. The same string in any
    // other file must still fail, and a neutralized line must still be scanned
    // for whatever else is on it.
    writeFileSync(join(dir, "allowed.md"), "install @gate-fixture/acme-corp-allowed here\n");
    writeFileSync(join(dir, "elsewhere.md"), "install @gate-fixture/acme-corp-allowed here\n");
    writeFileSync(join(dir, "ridealong.md"), "@gate-fixture/acme-corp-allowed and also zeta.example\n");
    gitInit(dir);
    const r = run("node", [SAFETY, dir, ...DL, "--require-denylist", "--json"]);
    let report;
    try { report = JSON.parse(r.out); } catch { report = { failures: [] }; }
    const hitIn = (f) => (report.failures ?? []).some((x) => x.rel === f);
    check("neutralize applies inside its declared path", !hitIn("allowed.md"), "the allowed path was still flagged");
    check("neutralize does NOT leak to other paths", hitIn("elsewhere.md"), "the same string passed outside its declared path");
    check(
      "a neutralized line is still scanned for everything else on it",
      hitIn("ridealong.md"),
      "a second term riding along on a neutralized line was missed — neutralize is skipping whole lines",
    );
  }

  // ------------------------------------- separator-optional matching (shape)
  console.log("\n# identity pattern shape");
  {
    const dir = join(work, "shape");
    mkdirSync(dir, { recursive: true });
    // Documents a real gap class: a pattern that requires a separator between
    // name parts catches the separated forms and misses the bare compound —
    // which is how an identity appears as a handle, an npm scope, or a URL
    // slug. Asserted here with synthetic terms; check-denylist-quality.mjs
    // asserts the real denylist has no such pattern.
    writeFileSync(join(dir, "sep.md"), "name: quux-corp\n");
    writeFileSync(join(dir, "compound.md"), "handle: quuxcorp\n");
    gitInit(dir);
    const r = run("node", [SAFETY, dir, ...DL, "--require-denylist", "--json"]);
    let report;
    try { report = JSON.parse(r.out); } catch { report = { failures: [] }; }
    check("separator-required pattern catches the separated form", (report.failures ?? []).some((f) => f.rel === "sep.md"), "separated form missed");
    check(
      "separator-required pattern MISSES the compound form (why check-denylist-quality exists)",
      !(report.failures ?? []).some((f) => f.rel === "compound.md"),
      "compound form was caught — the synthetic fixture no longer models the gap; update it",
    );
  }

  // ------------------------------- denylist quality: neutralize breadth (issue #8)
  console.log("\n# denylist quality — neutralize breadth keys off `paths`, not pattern length");
  {
    // Synthetic denylist for check-denylist-quality.mjs, never the real one.
    // Three neutralize entries, all global (unconfined) except the last:
    //   #0 - unconfined, SHORT pattern -> must still be flagged (pre-existing case).
    //   #1 - unconfined, LONG-but-still-context-free pattern -> this is the exact
    //        gap from issue #8: a length-based heuristic let a long global entry
    //        pass with zero warning. Fixed, this must be flagged too.
    //   #2 - paths-confined, equally long pattern -> confinement bounds the blast
    //        radius, so this one must NOT be flagged for breadth.
    const qDir = join(work, "quality");
    mkdirSync(qDir, { recursive: true });
    const qualityDenylist = {
      version: "synthetic-quality-test",
      terms: [{ pattern: "widget-co", why: "synthetic sibling product", severity: "medium" }],
      neutralize: [
        { pattern: "acme-corp", why: "synthetic short unconfined entry" },
        { pattern: "acme-corp-widget-manufacturing-division", why: "synthetic long unconfined entry" },
        {
          pattern: "acme-corp-widget-manufacturing-division-confined",
          why: "synthetic long confined entry",
          paths: ["allowed.md"],
        },
      ],
    };
    const qualityPath = join(qDir, "quality-denylist.json");
    writeFileSync(qualityPath, JSON.stringify(qualityDenylist, null, 2));

    const r = run("node", [QUALITY, "--denylist", qualityPath, "--json"]);
    let report;
    try {
      report = JSON.parse(r.out);
    } catch {
      report = { findings: [] };
    }
    const breadthIndices = (report.findings ?? [])
      .filter((f) => f.rule === "neutralize-breadth")
      .map((f) => f.index)
      .sort();

    check(
      "flags a SHORT unconfined neutralize entry",
      breadthIndices.includes(0),
      `expected index 0 in neutralize-breadth findings, got ${JSON.stringify(breadthIndices)}`,
    );
    check(
      "flags a LONG-but-still-context-free unconfined neutralize entry (issue #8 regression)",
      breadthIndices.includes(1),
      `expected index 1 in neutralize-breadth findings — a long global pattern must not evade the heuristic, got ${JSON.stringify(breadthIndices)}`,
    );
    check(
      "does NOT flag a paths-confined entry for breadth, regardless of pattern length",
      !breadthIndices.includes(2),
      `paths-confined entry (index 2) was flagged for breadth — confinement should bound the blast radius`,
    );
    check("check-denylist-quality exits 1 when quality findings exist", r.code === 1, `exit was ${r.code}`);
  }

  // ====================================================================
  // GH issue #3: test-gates.mjs never exercised check-commit-messages.mjs
  // or check-readme-parity.mjs at all, so a regression in either shipped
  // silently. Kept as one block at the end so a concurrent edit anywhere
  // above only needs a trivial merge.
  // ====================================================================

  const READMEPARITY = join(scriptDir, "check-readme-parity.mjs");
  const COMMITMSG = join(scriptDir, "check-commit-messages.mjs");

  function gitCommit(dir, message) {
    run("git", ["-C", dir, "add", "-A"]);
    run("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", message]);
    return run("git", ["-C", dir, "rev-parse", "HEAD"]).out.trim();
  }

  // -------------------------------------------------- check-commit-messages
  console.log("\n# check-commit-messages: identity terms in commit message text");
  {
    const dir = join(work, "commit-messages");
    mkdirSync(dir, { recursive: true });
    run("git", ["-C", dir, "init", "-q"]);
    writeFileSync(join(dir, "seed.txt"), "seed\n");
    const hash0 = gitCommit(dir, "initial commit\n\nNothing interesting here.");

    writeFileSync(join(dir, "a.txt"), "a\n");
    const leaky = gitCommit(dir, "Refactor the widget\n\nAccidentally mentions acme-corp in the body.");

    // A GitHub squash-merge-shaped Co-authored-by trailer carrying the term
    // only inside the machine-generated attribution line — must NOT trip
    // the gate (see check-commit-messages.mjs's own reasoning for the one
    // narrow exemption it makes).
    writeFileSync(join(dir, "b.txt"), "b\n");
    const trailerOnly = gitCommit(
      dir,
      "Fix the sprocket\n\nCo-authored-by: acme-corp-bot <12345+acme-corp-bot@users.noreply.github.com>",
    );

    // The same identity term, hand-written, in a Co-authored-by-shaped line
    // that is NOT the exact GitHub noreply form — must still be caught. A
    // human typing an identity into a commit message is not exempt.
    writeFileSync(join(dir, "c.txt"), "c\n");
    const handWritten = gitCommit(
      dir,
      "Polish the gizmo\n\nCo-authored-by: A Contributor <person@acme-corp-real.example>",
    );

    writeFileSync(join(dir, "d.txt"), "d\n");
    const clean = gitCommit(dir, "Docs tweak, nothing sensitive here.");

    // Each case below scans a range holding exactly ONE commit (that
    // commit's own parent..itself), rather than one shared range covering
    // all four. `git log --format=` inserts its own newline terminator
    // after every entry but the last, which lands on the FRONT of the next
    // entry's hash once split on our embedded NUL byte -- so only the
    // newest commit in a multi-commit range gets a clean, uncorrupted short
    // hash out of check-commit-messages.mjs today (a real, separately
    // filed defect; a per-commit range is the hermetic way to assert
    // detection correctness without also pinning that known-broken label
    // formatting).
    const leakyRun = run("node", [COMMITMSG, `${hash0}..${leaky}`, ...DL, "--require-denylist"], { cwd: dir });
    check("flags a commit whose message body carries a denylisted term", leakyRun.code === 1, `exit was ${leakyRun.code}: ${leakyRun.out.slice(0, 200)}`);
    check(
      `names the offending commit (${leaky.slice(0, 12)}) in the finding`,
      leakyRun.out.includes(leaky.slice(0, 12)),
      `no finding for the leaky commit: ${leakyRun.out.slice(0, 200)}`,
    );

    const trailerRun = run("node", [COMMITMSG, `${leaky}..${trailerOnly}`, ...DL, "--require-denylist"], { cwd: dir });
    check(
      "does NOT flag a commit whose only occurrence is inside a GitHub Co-authored-by trailer",
      trailerRun.code === 0,
      `the trailer-exempt commit was flagged — the exemption regressed. exit ${trailerRun.code}: ${trailerRun.out.slice(0, 200)}`,
    );

    const handWrittenRun = run("node", [COMMITMSG, `${trailerOnly}..${handWritten}`, ...DL, "--require-denylist"], { cwd: dir });
    check(
      "flags a hand-written Co-authored-by line with a real domain",
      handWrittenRun.code === 1 && handWrittenRun.out.includes(handWritten.slice(0, 12)),
      `a non-GitHub-shaped Co-authored-by line escaped the scan — the exemption is too broad. exit ${handWrittenRun.code}: ${handWrittenRun.out.slice(0, 200)}`,
    );

    const cleanRun = run("node", [COMMITMSG, `${handWritten}..${clean}`, ...DL, "--require-denylist"], { cwd: dir });
    check("does not flag a clean commit", cleanRun.code === 0, `exit was ${cleanRun.code}: ${cleanRun.out.slice(0, 200)}`);

    // Sanity: a single combined range spanning all four commits still
    // scans all of them (proves multi-commit ranges are walked in full,
    // not just the single-commit ranges exercised above) and still nets
    // exactly the two real findings (leaky + handWritten) — total finding
    // COUNT is unaffected by the label-formatting defect noted above, only
    // the printed hash text is.
    const range = `${hash0}..${clean}`;
    const r = run("node", [COMMITMSG, range, ...DL, "--require-denylist"], { cwd: dir });
    check("fails when the combined range contains any offending commit", r.code === 1, `exit was ${r.code}`);
    check(
      "reports scanning all 4 commits in range",
      /scanned 4 item/.test(r.out),
      `expected "scanned 4 item(s)", got: ${r.out.slice(0, 200)}`,
    );
    const findingCount = (r.out.match(/\[high\] commit/g) ?? []).length;
    check("finds exactly the 2 real identity findings across the combined range", findingCount === 2, `expected 2 findings, got ${findingCount}: ${r.out.slice(0, 300)}`);

    const titleClean = run("node", [COMMITMSG, "--title", "A perfectly ordinary PR title", ...DL, "--require-denylist"], { cwd: dir });
    check("a clean --title alone passes", titleClean.code === 0, `exit was ${titleClean.code}`);

    const titleLeaky = run("node", [COMMITMSG, "--title", "Mentions acme-corp in the title", ...DL, "--require-denylist"], { cwd: dir });
    check("a leaky --title alone fails", titleLeaky.code === 1, `exit was ${titleLeaky.code}`);

    const noDenylistEnv = { ...process.env };
    delete noDenylistEnv.PUBLIC_SAFETY_DENYLIST;
    const partial = run("node", [COMMITMSG, range], { cwd: dir, env: noDenylistEnv });
    check(
      "PARTIAL mode (no denylist) exits 0 without scanning for identity",
      partial.code === 0 && /PARTIAL/.test(partial.out),
      `exit ${partial.code}: ${partial.out.slice(0, 200)}`,
    );

    const requirePartial = run("node", [COMMITMSG, range, "--require-denylist", "--denylist", "/nonexistent/dl.json"], { cwd: dir });
    check("--require-denylist exits 2 when the denylist cannot be loaded", requirePartial.code === 2, `exit was ${requirePartial.code}`);

    const badRange = run("node", [COMMITMSG, "not-a-real-rev..also-not-real", ...DL, "--require-denylist"], { cwd: dir });
    check("a bad git rev-range fails closed (exit 2), not a silent 0-commit pass", badRange.code === 2, `exit was ${badRange.code}`);
  }

  // ------------------------- check-contamination-classes CLASS 4 (issue #27)
  // GH issue #27's own suggested-direction text asks for exactly this case:
  // "a fixture naming a retired package in a CHANGELOG should pass, while a
  // genuinely foreign scoped name should still fail." Deliberately exercised
  // against THIS repo's real history rather than a synthetic one:
  // check-contamination-classes.mjs reads its "ever published" name set from
  // git history rooted at wherever the SCRIPT FILE itself lives (see its own
  // loadHistoricalPackageNames), which is always the real checkout here, not
  // a fixture directory -- so faking that history would mean faking the
  // whole repo. @vespeneventures/icons was really published and really
  // retired (#23, #26), so it's the one real, permanent fact this fix can be
  // pinned against, the same way the "distblind"/"structure" cases above
  // already lean on this repo's real package-scope.json rather than a
  // synthetic stand-in.
  console.log("\n# check-contamination-classes CLASS 4: retired-but-real vs. genuinely foreign scoped names");
  {
    const dir = join(work, "contam-class4-retired");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@vespeneventures/probe", version: "1.0.0" }, null, 2) + "\n");
    writeFileSync(
      join(dir, "CHANGELOG.md"),
      "## 0.1.0\n- Removed `@vespeneventures/icons`; its glyphs now ship at `@vespeneventures/ui/icons`.\n",
    );
    writeFileSync(join(dir, "foreign.md"), "See `@vespeneventures/totally-made-up-thing-nobody-shipped` for details.\n");
    writeFileSync(join(dir, "install-retired.md"), "```\nnpm install @vespeneventures/icons\n```\n");

    const r = run("node", [CONTAM, dir, "--class", "4", "--json"]);
    let report;
    try {
      report = JSON.parse(r.out);
    } catch {
      report = { findings: [] };
    }
    const hit = (f) => (report.findings ?? []).some((x) => x.file === f);
    check(
      "a CHANGELOG naming a real, retired package in prose is NOT flagged",
      !hit("CHANGELOG.md"),
      `CHANGELOG.md was flagged: ${JSON.stringify(report.findings)}`,
    );
    check(
      "a genuinely foreign scoped name is still flagged (proves the fix didn't just stop checking)",
      hit("foreign.md"),
      `foreign.md was not flagged: ${JSON.stringify(report.findings)}`,
    );
    check(
      "an npm-install instruction for that SAME retired package is still flagged -- retired is not installable",
      hit("install-retired.md"),
      `install-retired.md was not flagged: ${JSON.stringify(report.findings)}`,
    );
    check("exits 1 overall (the foreign + install-instruction findings still fail the gate)", r.code === 1, `exit was ${r.code}`);
  }

  // ---------------------------------------------------- check-readme-parity
  console.log("\n# check-readme-parity: README vs. real exports");
  {
    const dir = join(work, "readme-parity");

    function writePackage(name, indexTs, readmeMd) {
      const pkgDir = join(dir, name);
      mkdirSync(join(pkgDir, "src"), { recursive: true });
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({ name: `${FIXTURE_SCOPE}/${name}`, version: "1.0.0", private: false }, null, 2) + "\n",
      );
      writeFileSync(join(pkgDir, "src", "index.ts"), indexTs);
      writeFileSync(join(pkgDir, "README.md"), readmeMd);
      return pkgDir;
    }

    function parseJson(out) {
      try {
        return JSON.parse(out);
      } catch {
        return { findings: [] };
      }
    }

    // Happy path: every export documented, table entries real, examples use
    // the real package name.
    const clean = writePackage(
      "clean",
      `export const Foo = 1;\nexport type Bar = string;\n`,
      [
        "# clean",
        "",
        "```ts",
        `import { Foo } from "${FIXTURE_SCOPE}/clean";`,
        "```",
        "",
        "## API",
        "",
        "| Export | Type |",
        "| --- | --- |",
        "| `Foo` | number |",
        "",
        "Also exports the `Bar` type.",
        "",
      ].join("\n"),
    );
    const okRun = run("node", [READMEPARITY, clean, "--json"]);
    check("passes a README that fully documents real exports", okRun.code === 0, `exit ${okRun.code}: ${okRun.out.slice(0, 300)}`);

    // CHECK A: a real VALUE export that appears nowhere in the README.
    const undocumented = writePackage(
      "undocumented",
      `export const Foo = 1;\nexport const Baz = 2;\n`,
      ["# undocumented", "", "Only mentions `Foo`.", ""].join("\n"),
    );
    const undocRun = run("node", [READMEPARITY, undocumented, "--json"]);
    const undocReport = parseJson(undocRun.out);
    check(
      "CHECK A flags a value export missing from README entirely",
      undocRun.code === 1 && (undocReport.findings ?? []).some((f) => f.check === "A" && f.severity === "high" && /Baz/.test(f.message)),
      `exit ${undocRun.code}: ${undocRun.out.slice(0, 300)}`,
    );

    // Sanity for CHECK A's severity split: an undocumented TYPE-only export
    // is still recorded as a finding (proves the scan actually inspected
    // real exports, rather than passing on zero coverage) but is "low"
    // severity and must NOT fail the gate on its own.
    const typeOnly = writePackage(
      "type-only",
      // The parser only recognises the barrel re-export shape used
      // throughout this repo's real packages (`export type { X }`), not a
      // direct `export type X = ...` alias declaration — matching
      // src/index.ts in every real package here.
      `type Ghost = string;\nexport const Foo = 1;\nexport type { Ghost };\n`,
      ["# type-only", "", "Mentions `Foo` only.", ""].join("\n"),
    );
    const typeOnlyRun = run("node", [READMEPARITY, typeOnly, "--json"]);
    const typeOnlyReport = parseJson(typeOnlyRun.out);
    check(
      "an undocumented TYPE export is recorded as a low-severity finding",
      (typeOnlyReport.findings ?? []).some((f) => f.check === "A" && f.severity === "low" && /Ghost/.test(f.message)),
      `findings: ${JSON.stringify(typeOnlyReport.findings)}`,
    );
    check("a lone low-severity finding does not fail the gate", typeOnlyRun.code === 0, `exit was ${typeOnlyRun.code}`);

    // CHECK B: a copy-pasteable import/install line naming the WRONG
    // package under the same scope.
    const wrongName = writePackage(
      "wrong-name",
      `export const Foo = 1;\n`,
      [
        "# wrong-name",
        "",
        "```ts",
        `import { Foo } from "${FIXTURE_SCOPE}/not-this-package";`,
        "```",
        "",
        "Mentions `Foo`.",
        "",
      ].join("\n"),
    );
    const wrongNameRun = run("node", [READMEPARITY, wrongName, "--json"]);
    const wrongNameReport = parseJson(wrongNameRun.out);
    check(
      "CHECK B flags an import example naming the wrong package under this scope",
      wrongNameRun.code === 1 && (wrongNameReport.findings ?? []).some((f) => f.check === "B" && /not-this-package/.test(f.message)),
      `exit ${wrongNameRun.code}: ${wrongNameRun.out.slice(0, 300)}`,
    );

    // CHECK C: the API table documents an export that does not exist.
    const phantom = writePackage(
      "phantom",
      `export const Foo = 1;\n`,
      [
        "# phantom",
        "",
        "Mentions `Foo`.",
        "",
        "## API",
        "",
        "| Export | Type |",
        "| --- | --- |",
        "| `Foo` | number |",
        "| `Ghost` | number |",
        "",
      ].join("\n"),
    );
    const phantomRun = run("node", [READMEPARITY, phantom, "--json"]);
    const phantomReport = parseJson(phantomRun.out);
    check(
      "CHECK C flags an API table row for an export that doesn't exist",
      phantomRun.code === 1 && (phantomReport.findings ?? []).some((f) => f.check === "C" && /Ghost/.test(f.message)),
      `exit ${phantomRun.code}: ${phantomRun.out.slice(0, 300)}`,
    );

    // Fail-closed: a package directory missing a required file must abort
    // (exit 2), never report a silent pass.
    const missing = join(dir, "missing-readme");
    mkdirSync(join(missing, "src"), { recursive: true });
    writeFileSync(join(missing, "package.json"), JSON.stringify({ name: `${FIXTURE_SCOPE}/missing-readme` }) + "\n");
    writeFileSync(join(missing, "src", "index.ts"), "export const Foo = 1;\n");
    const missingRun = run("node", [READMEPARITY, missing]);
    check("aborts (exit 2) when README.md is absent", missingRun.code === 2, `exit was ${missingRun.code}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(`\n${failures.length ? "FAIL" : "PASS"} — ${passed} assertion(s) passed, ${failures.length} failed.`);
process.exit(failures.length ? 1 : 0);
