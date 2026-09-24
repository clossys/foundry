import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { evaluateLockfileShape } from "./release-pr-lockfile-shape.mjs";

// Hermetic real-git-repo fixtures, matching check-release-pr-shape.test.mjs's
// and release-pr-footprint.test.mjs's own shape.

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function gitCommit(dir, message) {
  git(["add", "-A"], dir);
  git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", message], dir);
  return git(["rev-parse", "HEAD"], dir).trim();
}

function writeManifest(root, name, manifest) {
  const pkgDir = join(root, "packages", name);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
  return pkgDir;
}

function writeLockfile(root, packagesMap) {
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ name: "foundry", lockfileVersion: 3, requires: true, packages: packagesMap }, null, 2) + "\n");
}

function withRepo(build) {
  const root = mkdtempSync(join(tmpdir(), "lockfile-shape-test-"));
  try {
    git(["init", "-q"], root);
    build(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("no package-lock.json at all: passes trivially", () => {
  withRepo((root) => {
    writeManifest(root, "alpha", { name: "@x/alpha", version: "1.0.0" });
    const base = gitCommit(root, "initial");
    const r = evaluateLockfileShape({ gitRoot: root, mergeBase: base, bumps: [] });
    assert.equal(r.status, "pass");
    assert.match(r.detail, /no package-lock\.json/);
  });
});

test("package-lock.json unchanged since merge-base: passes", () => {
  withRepo((root) => {
    writeManifest(root, "alpha", { name: "@x/alpha", version: "1.0.0" });
    writeLockfile(root, { "": { name: "foundry" }, "packages/alpha": { name: "@x/alpha", version: "1.0.0" } });
    const base = gitCommit(root, "initial");
    const r = evaluateLockfileShape({ gitRoot: root, mergeBase: base, bumps: [] });
    assert.equal(r.status, "pass");
    assert.match(r.detail, /unchanged/);
  });
});

test("package-lock.json changed but no package in this diff bumped a version: refused", () => {
  withRepo((root) => {
    writeManifest(root, "alpha", { name: "@x/alpha", version: "1.0.0" });
    writeLockfile(root, { "": { name: "foundry" }, "packages/alpha": { name: "@x/alpha", version: "1.0.0" } });
    const base = gitCommit(root, "initial");

    writeLockfile(root, { "": { name: "foundry" }, "packages/alpha": { name: "@x/alpha", version: "1.0.0", resolved: "tampered" } });

    const r = evaluateLockfileShape({ gitRoot: root, mergeBase: base, bumps: [] });
    assert.equal(r.status, "not-release-shaped");
    assert.match(r.detail, /no package in this diff bumped/);
  });
});

test("a lockfile change limited to the bumped package's own version field passes", () => {
  withRepo((root) => {
    const manifest = { name: "@x/alpha", version: "1.0.0", license: "MIT" };
    writeManifest(root, "alpha", manifest);
    writeLockfile(root, { "": { name: "foundry" }, "packages/alpha": { name: "@x/alpha", version: "1.0.0", license: "MIT" } });
    const base = gitCommit(root, "initial");

    const headManifest = { ...manifest, version: "1.0.1" };
    writeManifest(root, "alpha", headManifest);
    writeLockfile(root, { "": { name: "foundry" }, "packages/alpha": { name: "@x/alpha", version: "1.0.1", license: "MIT" } });

    const r = evaluateLockfileShape({
      gitRoot: root,
      mergeBase: base,
      bumps: [{ dir: "alpha", name: "@x/alpha", version: "1.0.1", manifest: headManifest }],
    });
    assert.equal(r.status, "pass", r.detail);
  });
});

test("a lockfile change that ALSO tampers with an unrelated third-party entry is refused, even alongside a legitimate bump", () => {
  withRepo((root) => {
    const manifest = { name: "@x/alpha", version: "1.0.0" };
    writeManifest(root, "alpha", manifest);
    writeLockfile(root, {
      "": { name: "foundry" },
      "packages/alpha": { name: "@x/alpha", version: "1.0.0" },
      "node_modules/left-pad": { version: "1.3.0", resolved: "https://registry.example/left-pad-1.3.0.tgz" },
    });
    const base = gitCommit(root, "initial");

    const headManifest = { ...manifest, version: "1.0.1" };
    writeManifest(root, "alpha", headManifest);
    writeLockfile(root, {
      "": { name: "foundry" },
      "packages/alpha": { name: "@x/alpha", version: "1.0.1" },
      // Tampered: a third-party dependency's resolved URL changed, unrelated to any bump.
      "node_modules/left-pad": { version: "1.3.0", resolved: "https://evil.example/left-pad-1.3.0.tgz" },
    });

    const r = evaluateLockfileShape({
      gitRoot: root,
      mergeBase: base,
      bumps: [{ dir: "alpha", name: "@x/alpha", version: "1.0.1", manifest: headManifest }],
    });
    assert.equal(r.status, "not-release-shaped");
    assert.match(r.detail, /not limited to the bumped package/);
  });
});

test("a lockfile change on a package NOT in the given bumps (e.g. a stale npm regenerating unrelated metadata) is refused", () => {
  withRepo((root) => {
    const alphaManifest = { name: "@x/alpha", version: "1.0.0" };
    const betaManifest = { name: "@x/beta", version: "2.0.0" };
    writeManifest(root, "alpha", alphaManifest);
    writeManifest(root, "beta", betaManifest);
    writeLockfile(root, {
      "": { name: "foundry" },
      "packages/alpha": { name: "@x/alpha", version: "1.0.0" },
      "packages/beta": { name: "@x/beta", version: "2.0.0" },
    });
    const base = gitCommit(root, "initial");

    const headAlpha = { ...alphaManifest, version: "1.0.1" };
    writeManifest(root, "alpha", headAlpha);
    writeLockfile(root, {
      "": { name: "foundry" },
      "packages/alpha": { name: "@x/alpha", version: "1.0.1" },
      // beta's version field itself is untouched, but a different npm rewrote
      // its "peer" flag -- exactly the #1439 defect-3 incident shape.
      "packages/beta": { name: "@x/beta", version: "2.0.0", peer: true },
    });

    const r = evaluateLockfileShape({
      gitRoot: root,
      mergeBase: base,
      bumps: [{ dir: "alpha", name: "@x/alpha", version: "1.0.1", manifest: headAlpha }],
    });
    assert.equal(r.status, "not-release-shaped");
  });
});

test("a devDependencies-only sibling rewrite (no version bump of its own) is accepted alongside a real bump", () => {
  withRepo((root) => {
    const alphaManifest = { name: "@x/alpha", version: "1.0.0" };
    const betaManifest = { name: "@x/beta", version: "2.0.0", devDependencies: { "@x/alpha": "^1.0.0" } };
    writeManifest(root, "alpha", alphaManifest);
    writeManifest(root, "beta", betaManifest);
    writeLockfile(root, {
      "": { name: "foundry" },
      "packages/alpha": { name: "@x/alpha", version: "1.0.0" },
      "packages/beta": { name: "@x/beta", version: "2.0.0", devDependencies: { "@x/alpha": "^1.0.0" } },
    });
    const base = gitCommit(root, "initial");

    const headAlpha = { ...alphaManifest, version: "1.1.0" };
    const headBeta = { ...betaManifest, devDependencies: { "@x/alpha": "^1.1.0" } };
    writeManifest(root, "alpha", headAlpha);
    writeManifest(root, "beta", headBeta);
    writeLockfile(root, {
      "": { name: "foundry" },
      "packages/alpha": { name: "@x/alpha", version: "1.1.0" },
      "packages/beta": { name: "@x/beta", version: "2.0.0", devDependencies: { "@x/alpha": "^1.1.0" } },
    });

    const r = evaluateLockfileShape({
      gitRoot: root,
      mergeBase: base,
      bumps: [{ dir: "alpha", name: "@x/alpha", version: "1.1.0", manifest: headAlpha }],
    });
    assert.equal(r.status, "pass", r.detail);
  });
});
