import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildMaterializedFixture } from "./apply-step-fixture.js";
import { discoveryLinkPath, skillPath } from "./change-set-contract.js";
import { materializeRepository, verifyRepository } from "./materialize.js";

const SITE_ID = "example-owner/site";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function materialized() {
  const fixture = buildMaterializedFixture(roots);
  const outcome = await materializeRepository({
    clone: fixture.clone,
    hub: fixture.hub,
    set: fixture.set,
    texts: fixture.texts,
    binding: fixture.binding,
    heldChangeSets: [],
  });
  expect(outcome).toEqual({ exitCode: 0, verdict: "materialized" });
  return fixture;
}

describe("verifyRepository", () => {
  it(
    "reports violations for tampered files, links, modes, ledger, undeclared paths, and dirty trees",
    async () => {
    let fixture = await materialized();
    const skill = skillPath("strategist");
    writeFileSync(join(fixture.clone, skill), "tampered\n");
    expect((await verifyRepository({ clone: fixture.clone, set: fixture.set, binding: fixture.binding })).exitCode).toBe(1);

    fixture = await materialized();
    const link = discoveryLinkPath(".claude/skills", "writer");
    unlinkSync(join(fixture.clone, link));
    symlinkSync("elsewhere", join(fixture.clone, link));
    expect((await verifyRepository({ clone: fixture.clone, set: fixture.set, binding: fixture.binding })).exitCode).toBe(1);

    fixture = await materialized();
    chmodSync(join(fixture.clone, skillPath("writer")), 0o755);
    expect((await verifyRepository({ clone: fixture.clone, set: fixture.set, binding: fixture.binding })).exitCode).toBe(1);

    fixture = await materialized();
    const ledger = join(fixture.clone, "clossys/.state/installed.json");
    const bytes = readFileSync(ledger);
    bytes[0] ^= 0xff;
    writeFileSync(ledger, bytes);
    expect((await verifyRepository({ clone: fixture.clone, set: fixture.set, binding: fixture.binding })).exitCode).toBe(1);

    fixture = await materialized();
    writeFileSync(join(fixture.clone, "README.md"), "# changed\n");
    const undeclared = await verifyRepository({ clone: fixture.clone, set: fixture.set, binding: fixture.binding });
    expect(undeclared).toMatchObject({ exitCode: 1, reason: "undeclared-path" });

    fixture = await materialized();
    writeFileSync(join(fixture.clone, "leftover.txt"), "x\n");
    expect((await verifyRepository({ clone: fixture.clone, set: fixture.set, binding: fixture.binding })).reason).toBe("dirty");

    fixture = await materialized();
    mkdirSync(join(fixture.clone, ".agents/skills/clossys-leftover"), { recursive: true });
    writeFileSync(join(fixture.clone, ".agents/skills/clossys-leftover/NOTE"), "x\n");
    const leftover = await verifyRepository({ clone: fixture.clone, set: fixture.set, binding: fixture.binding });
    expect(leftover).toMatchObject({ exitCode: 1, reason: "dirty" });
    expect(leftover.detail).toContain("left by an earlier run");
    expect(existsSync(join(fixture.clone, ".agents/skills/clossys-leftover/NOTE"))).toBe(true);
  },
    120_000,
  );

  it("reports a missing clone as indeterminate", async () => {
    const fixture = buildMaterializedFixture(roots);
    const outcome = await verifyRepository({ clone: join(fixture.clone, "missing"), set: fixture.set, binding: fixture.binding });
    expect(outcome).toEqual({ exitCode: 2, verdict: "indeterminate", reason: "missing-clone" });
    const { verifyMain } = await import("./apply-plan-cli.js");
    expect(await verifyMain(["--repo", SITE_ID], { cwd: fixture.hub, clone: join(fixture.clone, "missing"), set: fixture.set, binding: fixture.binding })).toBe(2);
  });

  it("matches verifyMain exit codes for a violated tree", async () => {
    const fixture = await materialized();
    writeFileSync(join(fixture.clone, skillPath("strategist")), "tampered\n");
    const { verifyMain } = await import("./apply-plan-cli.js");
    const code = await verifyMain(["--repo", SITE_ID], { cwd: fixture.hub, clone: fixture.clone, set: fixture.set, binding: fixture.binding });
    expect(code).toBe(1);
  });

  it("reports diverged when the clone matches the set but HEAD is not the apply branch", async () => {
    const fixture = await materialized();
    execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "checkout", "main"], { cwd: fixture.clone, stdio: "ignore" });
    expect(await verifyRepository({ clone: fixture.clone, set: fixture.set, binding: fixture.binding })).toEqual({
      exitCode: 1,
      verdict: "violated",
      reason: "diverged",
    });
  });

  it("returns symlink-ancestor when clossys is a symlink whose target holds the set bytes", async () => {
    const fixture = await materialized();
    const realRoot = join(fixture.clone, "clossys-real");
    mkdirSync(join(realRoot, ".state"), { recursive: true });
    const ledger = readFileSync(join(fixture.clone, "clossys/.state/installed.json"));
    writeFileSync(join(realRoot, ".state/installed.json"), ledger);
    rmSync(join(fixture.clone, "clossys"), { recursive: true, force: true });
    symlinkSync(realRoot, join(fixture.clone, "clossys"));
    expect(await verifyRepository({ clone: fixture.clone, set: fixture.set, binding: fixture.binding })).toEqual({
      exitCode: 2,
      verdict: "indeterminate",
      reason: "symlink-ancestor",
    });
  });

  it("returns symlink-ancestor when a symlink ancestor lies outside clossys, .github, and .starter", async () => {
    const fixture = await materialized();
    const realAgents = join(fixture.clone, "agents-real");
    mkdirSync(join(realAgents, "skills/clossys-strategist"), { recursive: true });
    writeFileSync(join(realAgents, "skills/clossys-strategist/SKILL.md"), readFileSync(join(fixture.clone, skillPath("strategist")), "utf8"));
    rmSync(join(fixture.clone, ".agents"), { recursive: true, force: true });
    symlinkSync(realAgents, join(fixture.clone, ".agents"));
    expect(await verifyRepository({ clone: fixture.clone, set: fixture.set, binding: fixture.binding })).toEqual({
      exitCode: 2,
      verdict: "indeterminate",
      reason: "symlink-ancestor",
    });
  }, 120_000);

  it("returns status-unreadable when git status fails and leaves an untracked file in place", async () => {
    const fixture = await materialized();
    const stray = join(fixture.clone, "stray-untracked.txt");
    writeFileSync(stray, "keep\n");
    const index = join(fixture.clone, ".git/index");
    const mode = readFileSync(index); // touch to ensure exists
    chmodSync(index, 0o000);
    try {
      expect(await verifyRepository({ clone: fixture.clone, set: fixture.set, binding: fixture.binding })).toEqual({
        exitCode: 2,
        verdict: "indeterminate",
        reason: "status-unreadable",
      });
    } finally {
      chmodSync(index, 0o644);
    }
    expect(existsSync(stray)).toBe(true);
    expect(mode.length).toBeGreaterThan(0);
  }, 120_000);

  it("returns status-unreadable when git diff fails instead of reporting materialized", async () => {
    const fixture = await materialized();
    const index = join(fixture.clone, ".git/index");
    chmodSync(index, 0o000);
    try {
      expect(await verifyRepository({ clone: fixture.clone, set: fixture.set, binding: fixture.binding })).toEqual({
        exitCode: 2,
        verdict: "indeterminate",
        reason: "status-unreadable",
      });
    } finally {
      chmodSync(index, 0o644);
    }
  }, 120_000);

  it("rejects a default branch refspec before fetch and leaves a local other branch unchanged", async () => {
    const fixture = buildMaterializedFixture(roots);
    execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "branch", "other", "HEAD~0"], { cwd: fixture.clone, stdio: "ignore" });
    const otherBefore = execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "rev-parse", "other"], { cwd: fixture.clone, encoding: "utf8" }).trim();
    for (const defaultBranch of ["+refs/heads/main:refs/heads/other", "main:refs/heads/other", "refs/heads/*"] as const) {
      const set = structuredClone(fixture.set);
      set.repository = { ...set.repository, defaultBranch };
      expect(await verifyRepository({ clone: fixture.clone, set, binding: fixture.binding })).toEqual({
        exitCode: 2,
        verdict: "indeterminate",
        reason: "change-set-invalid",
      });
      expect(execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "rev-parse", "other"], { cwd: fixture.clone, encoding: "utf8" }).trim()).toBe(otherBefore);
    }
    const mainSet = structuredClone(fixture.set);
    mainSet.repository = { ...mainSet.repository, defaultBranch: "main" };
    expect((await verifyRepository({ clone: fixture.clone, set: mainSet, binding: fixture.binding })).reason).not.toBe("change-set-invalid");
  });

  it("fetches the default branch into refs/remotes/origin only when origin.fetch maps heads onto heads", async () => {
    const fixture = buildMaterializedFixture(roots);
    execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "config", "remote.origin.fetch", "+refs/heads/*:refs/heads/*"], {
      cwd: fixture.clone,
      stdio: "ignore",
    });
    execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "branch", "other", "HEAD"], { cwd: fixture.clone, stdio: "ignore" });
    const otherBefore = execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "rev-parse", "refs/heads/other"], {
      cwd: fixture.clone,
      encoding: "utf8",
    }).trim();
    const mainBefore = execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "rev-parse", "refs/heads/main"], {
      cwd: fixture.clone,
      encoding: "utf8",
    }).trim();
    await verifyRepository({ clone: fixture.clone, set: fixture.set, binding: fixture.binding });
    expect(
      execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "rev-parse", "refs/heads/other"], {
        cwd: fixture.clone,
        encoding: "utf8",
      }).trim(),
    ).toBe(otherBefore);

    execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "checkout", "other"], { cwd: fixture.clone, stdio: "ignore" });
    await verifyRepository({ clone: fixture.clone, set: fixture.set, binding: fixture.binding });
    expect(
      execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "rev-parse", "refs/heads/main"], {
        cwd: fixture.clone,
        encoding: "utf8",
      }).trim(),
    ).toBe(mainBefore);
  }, 120_000);
});
