import { describe, expect, it } from "vitest";
import { applyInstallation } from "../apply.js";
import { createMemoryFileSystem } from "../memory-fs.test-helper.js";
import { createRuntimeContext, planInstallation } from "../runtime.js";
import { verifyInstallation } from "../verify.js";
import { buildSkillsManifest, detectSkillNameCollisions } from "./skills-manifest.js";

const composedSkillsRoot = "/home/op/.agents/skills";
const home = "/home/op";
const sourceRoot = "/code/account-a/skills";
const backupRoot = "/home/op/.config-backups/run";

describe("buildSkillsManifest", () => {
  it("builds exactly one links entry — the whole source tree, as a directory — destined inside the composed directory", () => {
    const manifest = buildSkillsManifest({ composedSkillsRoot, linkName: "account-a" });
    expect(manifest.links).toEqual([{ source: ".", destination: `${composedSkillsRoot}/account-a` }]);
    expect(manifest.copies).toEqual([]);
    expect(manifest.managedBlocks).toEqual([]);
  });

  it("declares composedSkillsRoot itself as a private directory — the migration-hazard guard (#240)", () => {
    const manifest = buildSkillsManifest({ composedSkillsRoot, linkName: "account-a" });
    expect(manifest.privateDirectories).toEqual([{ path: composedSkillsRoot, create: true }]);
  });

  it("refuses a link name containing a path separator, rather than trust a hostile account identifier", () => {
    expect(() => buildSkillsManifest({ composedSkillsRoot, linkName: "../escape" })).toThrow(/unsafe link name/);
    expect(() => buildSkillsManifest({ composedSkillsRoot, linkName: "a/b" })).toThrow(/unsafe link name/);
  });

  it("refuses an empty link name", () => {
    expect(() => buildSkillsManifest({ composedSkillsRoot, linkName: "" })).toThrow(/unsafe link name/);
  });
});

describe("detectSkillNameCollisions", () => {
  it("reports nothing when every source's skills are unique", () => {
    const collisions = detectSkillNameCollisions(
      [
        { name: "alpha-account", skillNames: ["greet"] },
        { name: "beta-account", skillNames: ["farewell"] },
      ],
      { composedSkillsRoot },
    );
    expect(collisions).toEqual([]);
  });

  it("reports a skill name claimed by two sources, naming both, at the notional flat address", () => {
    const collisions = detectSkillNameCollisions(
      [
        { name: "alpha-account", skillNames: ["shared-skill"] },
        { name: "beta-account", skillNames: ["shared-skill"] },
      ],
      { composedSkillsRoot },
    );
    expect(collisions).toEqual([
      { destinationPath: `${composedSkillsRoot}/shared-skill`, sources: ["alpha-account", "beta-account"] },
    ]);
  });

  it("reports every colliding skill name, sorted by its notional destination, when more than one collides", () => {
    const collisions = detectSkillNameCollisions(
      [
        { name: "alpha-account", skillNames: ["zeta-skill", "alpha-skill"] },
        { name: "beta-account", skillNames: ["zeta-skill", "alpha-skill"] },
      ],
      { composedSkillsRoot },
    );
    expect(collisions.map((c) => c.destinationPath)).toEqual([
      `${composedSkillsRoot}/alpha-skill`,
      `${composedSkillsRoot}/zeta-skill`,
    ]);
  });

  it("names all three sources when a skill name is claimed by more than two", () => {
    const collisions = detectSkillNameCollisions(
      [
        { name: "alpha-account", skillNames: ["shared-skill"] },
        { name: "beta-account", skillNames: ["shared-skill"] },
        { name: "third-party", skillNames: ["shared-skill"] },
      ],
      { composedSkillsRoot },
    );
    expect(collisions).toHaveLength(1);
    expect(collisions[0]?.sources).toEqual(["alpha-account", "beta-account", "third-party"]);
  });

  it("is not tripped up by a source with no skills at all", () => {
    const collisions = detectSkillNameCollisions(
      [
        { name: "alpha-account", skillNames: [] },
        { name: "beta-account", skillNames: ["greet"] },
      ],
      { composedSkillsRoot },
    );
    expect(collisions).toEqual([]);
  });

  it("returns nothing for an empty source list", () => {
    expect(detectSkillNameCollisions([], { composedSkillsRoot })).toEqual([]);
  });
});

describe("the single-directory-symlink to directory-link transition (#240)", () => {
  function setup(linkName: string) {
    const manifest = buildSkillsManifest({ composedSkillsRoot, linkName });
    const runtime = createRuntimeContext(manifest, { home, sourceRoot, workspaceRoot: home });
    return planInstallation(manifest, runtime);
  }

  it("reproduces #240: a stale directory symlink at composedSkillsRoot, being replaced by per-source directory links", () => {
    const fs = createMemoryFileSystem();
    fs.set(`${sourceRoot}/greet`, "skill contents");
    fs.setDirectory(`${sourceRoot}/greet`);
    // The pre-migration shape: composedSkillsRoot is a single directory
    // symlink into the repository being retired, and that repository is
    // now gone — a dangling link, exactly #240's own reproduction.
    fs.setSymlink(composedSkillsRoot, "/code/deleted-account-checkout/skills");

    const plan = setup("account-a");

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

    const plan = setup("account-a");

    expect(() => applyInstallation(plan, fs, { backupRoot })).toThrow(
      /must not be a symlink or a non-directory/,
    );
    // Never silently written into the old target through the stale link.
    expect(fs.lstat(`${stillExistingTarget}/account-a`)).toBeUndefined();
  });

  it("verify (never applies) reports the same situation as a clean finding, never a throw", () => {
    const fs = createMemoryFileSystem();
    fs.setSymlink(composedSkillsRoot, "/code/deleted-account-checkout/skills");

    const plan = setup("account-a");
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

    const plan = setup("account-a");
    const result = applyInstallation(plan, fs, { backupRoot });
    expect(result.changed.length).toBeGreaterThan(0);

    const rootStat = fs.lstat(composedSkillsRoot);
    expect(rootStat?.isDirectory).toBe(true);
    expect(rootStat?.isSymbolicLink).toBe(false);
    expect(rootStat?.mode).toBe(0o700);

    // The whole account-a source tree is now one directory symlink, never a
    // per-skill link -- its individual skill ("greet") is only reachable by
    // resolving through that directory link, not as its own destination.
    const linkStat = fs.lstat(`${composedSkillsRoot}/account-a`);
    expect(linkStat?.isSymbolicLink).toBe(true);
    expect(fs.lstat(`${composedSkillsRoot}/greet`)).toBeUndefined();

    expect(verifyInstallation(plan, fs)).toEqual([]);
  });
});
