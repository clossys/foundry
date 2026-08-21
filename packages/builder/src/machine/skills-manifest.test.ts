import { describe, expect, it } from "vitest";
import { applyInstallation } from "../apply.js";
import { createMemoryFileSystem } from "../memory-fs.test-helper.js";
import { createRuntimeContext, planInstallation } from "../runtime.js";
import { verifyInstallation } from "../verify.js";
import { buildSkillsManifest } from "./skills-manifest.js";

const composedSkillsRoot = "/home/op/.agents/skills";
const home = "/home/op";
const sourceRoot = "/code/account-a/skills";
const backupRoot = "/home/op/.config-backups/run";

describe("buildSkillsManifest", () => {
  it("builds one links entry per skill, sorted, each destined inside the composed directory", () => {
    const manifest = buildSkillsManifest(["zeta", "alpha"], { composedSkillsRoot });
    expect(manifest.links).toEqual([
      { source: "alpha", destination: `${composedSkillsRoot}/alpha` },
      { source: "zeta", destination: `${composedSkillsRoot}/zeta` },
    ]);
    expect(manifest.copies).toEqual([]);
    expect(manifest.managedBlocks).toEqual([]);
  });

  it("declares composedSkillsRoot itself as a private directory — the migration-hazard guard (#240)", () => {
    const manifest = buildSkillsManifest(["alpha"], { composedSkillsRoot });
    expect(manifest.privateDirectories).toEqual([{ path: composedSkillsRoot, create: true }]);
  });

  it("builds a manifest loadManifest itself considers valid, for an empty skill list too", () => {
    // loadManifest is called internally; a thrown error here would mean this
    // module drifted from the manifest engine's own validation rules.
    expect(() => buildSkillsManifest([], { composedSkillsRoot })).not.toThrow();
    expect(buildSkillsManifest([], { composedSkillsRoot }).links).toEqual([]);
    // The private-directory guard applies even with nothing to link yet.
    expect(buildSkillsManifest([], { composedSkillsRoot }).privateDirectories).toEqual([
      { path: composedSkillsRoot, create: true },
    ]);
  });

  it("refuses a skill name containing a path separator, rather than trust a hostile readdir result", () => {
    expect(() => buildSkillsManifest(["../escape"], { composedSkillsRoot })).toThrow(/unsafe skill name/);
    expect(() => buildSkillsManifest(["a/b"], { composedSkillsRoot })).toThrow(/unsafe skill name/);
  });
});

describe("the single-directory-symlink to per-skill-links transition (#240)", () => {
  function setup(skillNames: readonly string[]) {
    const manifest = buildSkillsManifest(skillNames, { composedSkillsRoot });
    const runtime = createRuntimeContext(manifest, { home, sourceRoot, workspaceRoot: home });
    return planInstallation(manifest, runtime);
  }

  it("reproduces #240: a stale directory symlink at composedSkillsRoot, being replaced by per-skill links", () => {
    const fs = createMemoryFileSystem();
    fs.set(`${sourceRoot}/greet`, "skill contents");
    fs.setDirectory(`${sourceRoot}/greet`);
    // The pre-migration shape: composedSkillsRoot is a single directory
    // symlink into the repository being retired, and that repository is
    // now gone — a dangling link, exactly #240's own reproduction.
    fs.setSymlink(composedSkillsRoot, "/code/deleted-account-checkout/skills");

    const plan = setup(["greet"]);

    // Detected and reported with a clear, named error -- never a crash on an
    // unrelated low-level ENOENT surfacing from deep inside `replace()`, and
    // never silently overwritten.
    expect(() => applyInstallation(plan, fs, { backupRoot })).toThrow(
      /must not be a symlink or a non-directory/,
    );

    // Untouched: the stale symlink is exactly what it was before the attempt.
    expect(fs.lstat(composedSkillsRoot)?.isSymbolicLink).toBe(true);
    expect(fs.readlink(composedSkillsRoot)).toBe("/code/deleted-account-checkout/skills");
    // Nothing was backed up either -- the refusal fires before any backup or
    // removal is attempted.
    expect(fs.lstat(`${backupRoot}${composedSkillsRoot}`)).toBeUndefined();
  });

  it("also refuses a directory symlink still pointing at a directory that exists — not only the dangling case", () => {
    const fs = createMemoryFileSystem();
    fs.setDirectory(`${sourceRoot}/greet`);
    const stillExistingTarget = "/code/not-yet-deleted-account-checkout/skills";
    fs.setDirectory(stillExistingTarget);
    fs.setSymlink(composedSkillsRoot, stillExistingTarget);

    const plan = setup(["greet"]);

    expect(() => applyInstallation(plan, fs, { backupRoot })).toThrow(
      /must not be a symlink or a non-directory/,
    );
    // Never silently written into the old target through the stale link.
    expect(fs.lstat(`${stillExistingTarget}/greet`)).toBeUndefined();
  });

  it("verify (never applies) reports the same situation as a clean finding, never a throw", () => {
    const fs = createMemoryFileSystem();
    fs.setSymlink(composedSkillsRoot, "/code/deleted-account-checkout/skills");

    const plan = setup(["greet"]);
    const findings = verifyInstallation(plan, fs);
    expect(findings.some((f) => f.rule === "install/private-directory-not-a-directory")).toBe(true);
  });

  it("the new shape applies cleanly once the stale symlink has been removed", () => {
    const fs = createMemoryFileSystem();
    fs.set(`${sourceRoot}/greet`, "skill contents");
    fs.setDirectory(`${sourceRoot}/greet`);
    // No pre-existing composedSkillsRoot at all -- the common case on a
    // machine that never had the old installer, or where the stale symlink
    // has already been cleared by an operator following this refusal.

    const plan = setup(["greet"]);
    const result = applyInstallation(plan, fs, { backupRoot });
    expect(result.changed.length).toBeGreaterThan(0);

    const rootStat = fs.lstat(composedSkillsRoot);
    expect(rootStat?.isDirectory).toBe(true);
    expect(rootStat?.isSymbolicLink).toBe(false);
    expect(rootStat?.mode).toBe(0o700);

    expect(verifyInstallation(plan, fs)).toEqual([]);
  });
});
