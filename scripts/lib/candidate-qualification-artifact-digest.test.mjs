// Negative-control tests for the artifact-scoped (schema 3) qualification
// digest — issue #879.
//
// `currentQualificationJoins(root, candidate, ref, { schemaVersion: 3 })`
// hashes only the manifest fields that ship (`ARTIFACT_MANIFEST_FIELDS`) and
// only the file set `npm pack` itself would produce, instead of the whole
// `package.json` and the whole package directory (schema 2, legacy). A
// narrower digest is exactly how a gate stops catching things, so every test
// below that is supposed to still invalidate (RED) is as important as the
// ones proving the fix actually narrows anything (GREEN) — see the issue's
// own "negative controls" section.
//
// The fixture below is a real, throwaway git repository with its own
// minimal release-qualification policy and adapter (never this repository's
// real ones, so package.json fields can be freely mutated) and a real,
// on-disk package directory `npm pack --dry-run` can actually pack — the
// issue is explicit that the packed file set must come from npm's own
// computation, never a hand-rolled matcher.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentQualificationJoins } from "./candidate-qualification.mjs";

const CANDIDATE = { name: "@fixture/widget", version: "1.0.0" };
const PACKAGE_DIR = "packages/widget";

function git(root, args) {
  execFileSync("git", args, { cwd: root, stdio: "ignore" });
}

function baseManifest(overrides = {}) {
  return {
    name: CANDIDATE.name,
    version: CANDIDATE.version,
    main: "index.js",
    files: ["index.js"],
    dependencies: { "left-pad": "^1.0.0" },
    peerDependencies: { react: "^18.0.0" },
    peerDependenciesMeta: { react: { optional: true } },
    devDependencies: { vitest: "^1.0.0", "@types/node": "^20.0.0" },
    bin: { widget: "./bin/widget.js" },
    engines: { node: ">=18" },
    exports: { ".": "./index.js" },
    license: "MIT",
    ...overrides,
  };
}

function writeManifest(root, manifest) {
  writeFileSync(join(root, PACKAGE_DIR, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

// A fresh fixture root, git-initialized, with the minimal policy/adapter a
// real `currentQualificationJoins()` call needs, and a real packable
// directory: `index.js` (shipped via `files`), `bin/widget.js` (shipped
// because npm always includes a referenced `bin` target), and
// `test/index.test.js` (shipped by neither `files` nor any always-included
// rule — the file this suite's "excluded" control mutates).
function fixture(t, manifest = baseManifest()) {
  const root = mkdtempSync(join(tmpdir(), "foundry-artifact-digest-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, ["init"]);
  git(root, ["config", "gc.auto", "0"]);
  git(root, ["config", "maintenance.auto", "false"]);
  git(root, ["config", "user.email", "test@example.invalid"]);
  git(root, ["config", "user.name", "Artifact Digest Test"]);
  writeFileSync(join(root, "package.json"), "{}\n");
  writeFileSync(join(root, "package-lock.json"), "{}\n");

  const policy = {
    packages: {
      [CANDIDATE.name]: {
        packageKey: "widget",
        recordStem: "fixture-widget",
        packageDir: PACKAGE_DIR,
        adapterPath: "governance/release-qualification-adapters/widget/current-direct.json",
        fixturePath: "governance/release-qualification-fixtures/widget/current-direct",
        archetypes: {
          "current-direct": { status: "required" },
          "prior-minor": { status: "unsupported", reason: "fixture" },
          "oldest-supported": { status: "unsupported", reason: "fixture" },
          "control-plane": { status: "unsupported", reason: "fixture" },
        },
        dimensions: {
          position: { status: "unsupported", reason: "fixture" },
          completion: { status: "unsupported", reason: "fixture" },
          rollback: { status: "required" },
          duplicate: { status: "unsupported", reason: "fixture" },
          cadence: { status: "unsupported", reason: "fixture" },
          closeWindow: { status: "unsupported", reason: "fixture" },
        },
      },
    },
  };
  mkdirSync(join(root, "governance/release-qualification-adapters/widget"), { recursive: true });
  writeFileSync(join(root, "governance/release-qualification-policy.json"), JSON.stringify(policy, null, 2));
  writeFileSync(join(root, "governance/release-qualification-adapters/widget/current-direct.json"), JSON.stringify({ fixtures: [] }));

  mkdirSync(join(root, PACKAGE_DIR, "bin"), { recursive: true });
  mkdirSync(join(root, PACKAGE_DIR, "test"), { recursive: true });
  writeManifest(root, manifest);
  writeFileSync(join(root, PACKAGE_DIR, "index.js"), "module.exports = {};\n");
  writeFileSync(join(root, PACKAGE_DIR, "bin/widget.js"), "#!/usr/bin/env node\nconsole.log(\"widget\");\n");
  writeFileSync(join(root, PACKAGE_DIR, "test/index.test.js"), "// not shipped\n");

  git(root, ["add", "-A"]);
  git(root, ["commit", "-m", "fixture"]);
  return root;
}

const joinsV3 = (root) => currentQualificationJoins(root, CANDIDATE, "WORKTREE", { schemaVersion: 3 });
const joinsV2 = (root) => currentQualificationJoins(root, CANDIDATE, "WORKTREE", { schemaVersion: 2 });

test("sanity: schema 3 and schema 2 disagree on a base fixture only in which fields they hash from (both are real, distinct digests)", (t) => {
  const root = fixture(t);
  const v3 = joinsV3(root), v2 = joinsV2(root);
  assert.match(v3.packageManifestSha256, /^[a-f0-9]{64}$/);
  assert.match(v3.packageTreeSha1, /^[a-f0-9]{40}$/);
  assert.notEqual(v3.packageManifestSha256, v2.packageManifestSha256);
  assert.notEqual(v3.packageTreeSha1, v2.packageTreeSha1);
});

test("schema 3 at a historical git ref matches schema 3 at WORKTREE when nothing changed (parity between the two materialization paths)", (t) => {
  const root = fixture(t);
  const atHead = currentQualificationJoins(root, CANDIDATE, "HEAD", { schemaVersion: 3 });
  const atWorktree = joinsV3(root);
  assert.equal(atHead.packageManifestSha256, atWorktree.packageManifestSha256);
  assert.equal(atHead.packageTreeSha1, atWorktree.packageTreeSha1);
});

// --- (a) a change to a file that DOES ship still invalidates (RED) --------
test("negative control (a): a change to a shipped file still invalidates the tree digest (RED)", (t) => {
  const root = fixture(t);
  const before = joinsV3(root);
  writeFileSync(join(root, PACKAGE_DIR, "index.js"), "module.exports = { changed: true };\n");
  const after = joinsV3(root);
  assert.notEqual(after.packageTreeSha1, before.packageTreeSha1, "a shipped file changed — the tree digest must move");
  assert.equal(after.packageManifestSha256, before.packageManifestSha256, "package.json itself was not touched");
});

// --- (b) a change to `dependencies` still invalidates (RED) ---------------
test("negative control (b): a change to dependencies still invalidates the manifest digest (RED)", (t) => {
  const root = fixture(t);
  const before = joinsV3(root);
  writeManifest(root, baseManifest({ dependencies: { "left-pad": "^2.0.0" } }));
  const after = joinsV3(root);
  assert.notEqual(after.packageManifestSha256, before.packageManifestSha256);
});

// --- (c) a change to `peerDependencies` still invalidates (RED) -----------
test("negative control (c): a change to peerDependencies still invalidates the manifest digest (RED)", (t) => {
  const root = fixture(t);
  const before = joinsV3(root);
  writeManifest(root, baseManifest({ peerDependencies: { react: "^19.0.0" } }));
  const after = joinsV3(root);
  assert.notEqual(after.packageManifestSha256, before.packageManifestSha256);
});

// --- (d) a change to `exports` still invalidates (RED) ---------------------
test("negative control (d): a change to exports still invalidates the manifest digest (RED)", (t) => {
  const root = fixture(t);
  const before = joinsV3(root);
  writeManifest(root, baseManifest({ exports: { ".": "./index.js", "./extra": "./index.js" } }));
  const after = joinsV3(root);
  assert.notEqual(after.packageManifestSha256, before.packageManifestSha256);
});

// --- (e) a change to `files` still invalidates (RED) — matters most: it ---
// changes what ships without changing any file's bytes.
test("negative control (e): a change to files still invalidates both digests, with no file content changed (RED) — the one that matters most", (t) => {
  const root = fixture(t);
  const before = joinsV3(root);
  // Nothing on disk changes — only the manifest's `files` allowlist grows to
  // ship a file (`test/index.test.js`) that previously was not packed.
  writeManifest(root, baseManifest({ files: ["index.js", "test/index.test.js"] }));
  const after = joinsV3(root);
  assert.notEqual(after.packageManifestSha256, before.packageManifestSha256, "the files field itself is part of the artifact manifest digest");
  assert.notEqual(after.packageTreeSha1, before.packageTreeSha1, "the packed file SET changed even though no file's bytes did");
});

// --- (f) a change to `bin` or `engines` still invalidates (RED) -----------
test("negative control (f1): a change to bin still invalidates the manifest digest (RED)", (t) => {
  const root = fixture(t);
  const before = joinsV3(root);
  writeManifest(root, baseManifest({ bin: { widget: "./bin/widget.js", "widget-alt": "./bin/widget.js" } }));
  const after = joinsV3(root);
  assert.notEqual(after.packageManifestSha256, before.packageManifestSha256);
});
test("negative control (f2): a change to engines still invalidates the manifest digest (RED)", (t) => {
  const root = fixture(t);
  const before = joinsV3(root);
  writeManifest(root, baseManifest({ engines: { node: ">=20" } }));
  const after = joinsV3(root);
  assert.notEqual(after.packageManifestSha256, before.packageManifestSha256);
  assert.equal(after.packageTreeSha1, before.packageTreeSha1, "engines does not select which files are packed");
});

// --- (g) a devDependency-only change does NOT invalidate (GREEN) ----------
// the fix's whole purpose — contrasted directly against schema 2 (legacy),
// which still (correctly, for a schema-2 record) treats it as invalidating.
test("negative control (g): a devDependency-only change does not invalidate under schema 3 (GREEN), but still does under legacy schema 2 — the fix's whole purpose", (t) => {
  const root = fixture(t);
  const beforeV3 = joinsV3(root), beforeV2 = joinsV2(root);
  writeManifest(root, baseManifest({ devDependencies: { vitest: "^2.0.0", "@types/node": "^22.0.0", react: "^19.0.0" } }));
  const afterV3 = joinsV3(root), afterV2 = joinsV2(root);
  assert.equal(afterV3.packageManifestSha256, beforeV3.packageManifestSha256, "GREEN: devDependencies is not part of the artifact");
  assert.equal(afterV3.packageTreeSha1, beforeV3.packageTreeSha1, "GREEN: the tree digest is unaffected too");
  assert.notEqual(afterV2.packageManifestSha256, beforeV2.packageManifestSha256, "legacy schema 2 still hashes the whole package.json, devDependencies included — this is issue #879 itself");
});

// --- (h) a change to a test file excluded by `files` does NOT invalidate --
// (GREEN)
test("negative control (h): a change to a test file excluded by files does not invalidate (GREEN)", (t) => {
  const root = fixture(t);
  const before = joinsV3(root);
  writeFileSync(join(root, PACKAGE_DIR, "test/index.test.js"), "// changed fixture content, never shipped\n");
  const after = joinsV3(root);
  assert.equal(after.packageTreeSha1, before.packageTreeSha1, "GREEN: the excluded test file is not part of the packed artifact");
  assert.equal(after.packageManifestSha256, before.packageManifestSha256);
});

// Confirms the schema-3 packed tree digest genuinely reflects npm's OWN
// always-included rule for `bin`, not a hand-rolled files matcher: the bin
// target ships even though it is absent from `files`, and removing it moves
// the tree digest.
test("the packed tree digest follows npm's own always-included bin rule, not just the files array", (t) => {
  const root = fixture(t);
  const before = joinsV3(root);
  writeFileSync(join(root, PACKAGE_DIR, "bin/widget.js"), "#!/usr/bin/env node\nconsole.log(\"changed\");\n");
  const after = joinsV3(root);
  assert.notEqual(after.packageTreeSha1, before.packageTreeSha1, "bin/widget.js is packed by npm's own always-included rule despite being absent from files");
});

// --- (i) built dist/ output vs a git-only (buildless) ref — the boundary --
// this design deliberately draws, per a real measurement mid-review: a real
// publish dispatch of @clossys/writer@0.3.7 showed the record's (legacy,
// schema-2) packageTreeSha1 matching `git rev-parse HEAD:packages/writer`
// exactly, while the record's candidate.tarball.sha256 did NOT match a
// freshly packed tarball from that same tree — because `dist` ships FIRST in
// writer's `files` array and `dist/` is gitignored, so no git-tree-based
// digest, however it is computed, can see it. That gap pre-dates this PR
// (schema 2 already had it despite its own header comment claiming
// otherwise); this control proves this PR neither introduces it nor silently
// leaves it unstated.
//
// A WORKTREE-ref schema-3 digest DOES catch dist drift — it reads the real,
// currently-materialized directory, dist included, whenever a build has
// actually put one there. A git-archived (any other ref) schema-3 digest
// CANNOT: `git archive` only ever reproduces git-TRACKED content, and dist/
// was never committed, at this commit or any other. This is a real
// boundary, not an oversight: the RECORDED digest at generation time must
// use the identical (git-archived, buildless) method later re-verification
// uses, or the two could never agree — and re-verification runs against
// arbitrary historical commits where rebuilding dist is not cheap. The
// authoritative, dist-inclusive binding remains `candidate.tarball.sha256`
// — a hash of the real, fully-built tarball, independently reverified by
// `validate-candidate-publish.mjs` immediately before upload — which this
// PR does not touch, and which is exactly what caught the real writer
// mismatch above.
test("negative control (i): a WORKTREE schema-3 digest catches built dist/ drift; a git-archived one structurally cannot (dist/ is gitignored, never committed) — the boundary a real publish dispatch measured", (t) => {
  const root = fixture(t, baseManifest({ files: ["index.js", "dist"] }));
  writeFileSync(join(root, ".gitignore"), "dist/\n");
  mkdirSync(join(root, PACKAGE_DIR, "dist"), { recursive: true });
  writeFileSync(join(root, PACKAGE_DIR, "dist/bundle.js"), "// built output, v1\n");
  // dist/ is real, on disk, but deliberately never committed — exactly like
  // packages/writer/dist in the real repository.
  const beforeWorktree = joinsV3(root);
  const beforeHead = currentQualificationJoins(root, CANDIDATE, "HEAD", { schemaVersion: 3 });

  writeFileSync(join(root, PACKAGE_DIR, "dist/bundle.js"), "// built output, v2 — rebuilt from an unchanged source\n");

  const afterWorktree = joinsV3(root);
  const afterHead = currentQualificationJoins(root, CANDIDATE, "HEAD", { schemaVersion: 3 });

  assert.notEqual(afterWorktree.packageTreeSha1, beforeWorktree.packageTreeSha1, "a live, currently-materialized dist/ IS captured by the WORKTREE-ref digest");
  assert.equal(afterHead.packageTreeSha1, beforeHead.packageTreeSha1, "a git-archived ref cannot see gitignored dist/ content — by construction, not by accident");
});

// --- (j) the silent partial pack — a declared, unbuilt directory MUST fail
// loudly rather than silently return a digest over an incomplete artifact.
// A real publish dispatch measured `check-qualification-record-present.mjs`
// reporting PRESENT while `dist/` had drifted with no git-visible cause
// (negative control (i)); a second, INDEPENDENT review measured that
// `packedArtifactPaths()` itself would not even throw if a `files`-declared
// directory contributed zero packed files (as it always would for an
// unbuilt `dist/`) — meaning a WORKTREE schema-3 digest computed before a
// build silently describes a SHORTER, real-looking artifact instead of
// failing. This control is WORKTREE-only, deliberately: see
// `assertDeclaredFilesEntriesArePacked`'s own header comment in
// candidate-qualification.mjs for why a historical (git-archived) ref
// cannot be held to the same standard without making every historical
// computation for any package that ships `dist` fail unconditionally.
test("negative control (j): an unbuilt files-declared directory fails LOUDLY on a WORKTREE digest, not silently — the silent-partial-pack this repository refuses everywhere else it can detect one", (t) => {
  const root = fixture(t, baseManifest({ files: ["index.js", "dist"] }));
  writeFileSync(join(root, ".gitignore"), "dist/\n");
  // `dist` is declared in `files` but was never built — exactly the state
  // packages/writer/dist was in when CI's `discover` job (which does not
  // build first) ran check-qualification-record-present.mjs.
  assert.throws(
    () => joinsV3(root),
    /"dist" is declared in package\.json "files" but npm pack --dry-run packed zero files under it/,
    "a declared-but-absent directory must fail loudly, not silently produce a partial digest",
  );

  // The identical fixture's git-archived (historical) computation is NOT
  // held to this standard — `dist` was never committed either way, so this
  // is not a build-state problem there, it is a structural property of what
  // `git archive` can ever see (negative control (i)).
  assert.doesNotThrow(() => currentQualificationJoins(root, CANDIDATE, "HEAD", { schemaVersion: 3 }));

  // Building it — materializing real content under the declared directory —
  // clears the failure; the WORKTREE digest then succeeds normally.
  mkdirSync(join(root, PACKAGE_DIR, "dist"), { recursive: true });
  writeFileSync(join(root, PACKAGE_DIR, "dist/bundle.js"), "// built output\n");
  assert.doesNotThrow(() => joinsV3(root));
});

// A `files`-declared directory that exists but is genuinely EMPTY of any
// packable content must fail exactly the same way as one that is entirely
// absent — npm never packs an empty directory either way, so there is no
// observable difference between "never built" and "built into nothing" from
// the packed file list alone, and both are the same silent-partial-pack risk.
test("negative control (j2): a files-declared directory that exists but is empty fails the same way as one that is absent", (t) => {
  const root = fixture(t, baseManifest({ files: ["index.js", "dist"] }));
  writeFileSync(join(root, ".gitignore"), "dist/\n");
  mkdirSync(join(root, PACKAGE_DIR, "dist"), { recursive: true }); // exists, but empty — npm packs nothing from it
  assert.throws(() => joinsV3(root), /"dist" is declared in package\.json "files" but npm pack --dry-run packed zero files under it/);
});
