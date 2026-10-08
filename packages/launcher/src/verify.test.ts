import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LATER_AT, assessmentFor, commitHubPlan, decide } from "./admission-fixture.js";
import { buildMaterializedFixture } from "./apply-step-fixture.js";
import type { MaterializedFixtureOptions } from "./apply-step-fixture.js";
import { discoveryLinkPath, skillPath } from "./change-set-contract.js";
import { materializeRepository, verifyRepository } from "./materialize.js";

const SITE_ID = "example-owner/site";
const GIT = ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null"] as const;
const gitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Example Author",
  GIT_AUTHOR_EMAIL: "author@example.com",
  GIT_COMMITTER_NAME: "Example Author",
  GIT_COMMITTER_EMAIL: "author@example.com",
};
const roots: string[] = [];

function gitIn(cwd: string, ...args: string[]): string {
  return execFileSync("git", [...GIT, ...args], { cwd, encoding: "utf8" }).trim();
}

function bareOriginForClone(clone: string): string {
  return join(dirname(clone), "origin.git");
}

function advanceOriginBranch(origin: string, branch: string): string {
  const bare = realpathSync(origin);
  const workspace = mkdtempSync(join(tmpdir(), "launcher-origin-advance-"));
  roots.push(workspace);
  execFileSync("git", [...GIT, "clone", "--branch", branch, bare, workspace], { cwd: tmpdir(), env: gitEnv, stdio: "ignore" });
  writeFileSync(join(workspace, `advance-${branch}.txt`), `${branch}\n`);
  execFileSync("git", [...GIT, "add", `.`], { cwd: workspace, env: gitEnv, stdio: "ignore" });
  execFileSync("git", [...GIT, "commit", "-m", `advance ${branch}`], { cwd: workspace, env: gitEnv, stdio: "ignore" });
  execFileSync("git", [...GIT, "push", "origin", branch], { cwd: workspace, env: gitEnv, stdio: "ignore" });
  return gitIn(origin, "rev-parse", `refs/heads/${branch}`);
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function materialized(options: MaterializedFixtureOptions = {}, now?: () => Date) {
  const fixture = buildMaterializedFixture(roots, options);
  const outcome = await materializeRepository({
    clone: fixture.clone,
    hub: fixture.hub,
    set: fixture.set,
    texts: fixture.texts,
    heldChangeSets: [],
    now,
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
    expect((await verifyRepository({ clone: fixture.clone, hub: fixture.hub, set: fixture.set })).exitCode).toBe(1);

    fixture = await materialized();
    const link = discoveryLinkPath(".claude/skills", "writer");
    unlinkSync(join(fixture.clone, link));
    symlinkSync("elsewhere", join(fixture.clone, link));
    expect((await verifyRepository({ clone: fixture.clone, hub: fixture.hub, set: fixture.set })).exitCode).toBe(1);

    fixture = await materialized();
    chmodSync(join(fixture.clone, skillPath("writer")), 0o755);
    expect((await verifyRepository({ clone: fixture.clone, hub: fixture.hub, set: fixture.set })).exitCode).toBe(1);

    fixture = await materialized();
    const ledger = join(fixture.clone, "clossys/.state/installed.json");
    const bytes = readFileSync(ledger);
    bytes[0] ^= 0xff;
    writeFileSync(ledger, bytes);
    expect((await verifyRepository({ clone: fixture.clone, hub: fixture.hub, set: fixture.set })).exitCode).toBe(1);

    fixture = await materialized();
    writeFileSync(join(fixture.clone, "README.md"), "# changed\n");
    const undeclared = await verifyRepository({ clone: fixture.clone, hub: fixture.hub, set: fixture.set });
    expect(undeclared).toMatchObject({ exitCode: 1, reason: "undeclared-path" });

    fixture = await materialized();
    writeFileSync(join(fixture.clone, "leftover.txt"), "x\n");
    expect((await verifyRepository({ clone: fixture.clone, hub: fixture.hub, set: fixture.set })).reason).toBe("dirty");

    fixture = await materialized();
    mkdirSync(join(fixture.clone, ".agents/skills/clossys-leftover"), { recursive: true });
    writeFileSync(join(fixture.clone, ".agents/skills/clossys-leftover/NOTE"), "x\n");
    const leftover = await verifyRepository({ clone: fixture.clone, hub: fixture.hub, set: fixture.set });
    expect(leftover).toMatchObject({ exitCode: 1, reason: "dirty" });
    expect(leftover.detail).toContain("left by an earlier run");
    expect(existsSync(join(fixture.clone, ".agents/skills/clossys-leftover/NOTE"))).toBe(true);
  },
    120_000,
  );

  it("reports a missing clone as indeterminate", async () => {
    const fixture = buildMaterializedFixture(roots);
    const outcome = await verifyRepository({ clone: join(fixture.clone, "missing"), hub: fixture.hub, set: fixture.set });
    expect(outcome).toEqual({ exitCode: 2, verdict: "indeterminate", reason: "missing-clone" });
    const { verifyMain } = await import("./apply-plan-cli.js");
    expect(await verifyMain(["--repo", SITE_ID], { cwd: fixture.hub, clone: join(fixture.clone, "missing"), set: fixture.set })).toBe(2);
  });

  it("matches verifyMain exit codes for a violated tree", async () => {
    const fixture = await materialized();
    writeFileSync(join(fixture.clone, skillPath("strategist")), "tampered\n");
    const { verifyMain } = await import("./apply-plan-cli.js");
    const code = await verifyMain(["--repo", SITE_ID], { cwd: fixture.hub, clone: fixture.clone, set: fixture.set });
    expect(code).toBe(1);
  });

  it("reports diverged when the clone matches the set but HEAD is not the apply branch", async () => {
    const fixture = await materialized();
    execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "checkout", "main"], { cwd: fixture.clone, stdio: "ignore" });
    expect(await verifyRepository({ clone: fixture.clone, hub: fixture.hub, set: fixture.set })).toEqual({
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
    expect(await verifyRepository({ clone: fixture.clone, hub: fixture.hub, set: fixture.set })).toEqual({
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
    expect(await verifyRepository({ clone: fixture.clone, hub: fixture.hub, set: fixture.set })).toEqual({
      exitCode: 2,
      verdict: "indeterminate",
      reason: "symlink-ancestor",
    });
  }, 120_000);

  it("returns remote-tip-unreadable when the index is unreadable before status runs", async () => {
    const fixture = await materialized();
    const stray = join(fixture.clone, "stray-untracked.txt");
    writeFileSync(stray, "keep\n");
    const index = join(fixture.clone, ".git/index");
    const mode = readFileSync(index); // touch to ensure exists
    chmodSync(index, 0o000);
    try {
      expect(await verifyRepository({ clone: fixture.clone, hub: fixture.hub, set: fixture.set })).toEqual({
        exitCode: 2,
        verdict: "indeterminate",
        reason: "remote-tip-unreadable",
      });
    } finally {
      chmodSync(index, 0o644);
    }
    expect(existsSync(stray)).toBe(true);
    expect(mode.length).toBeGreaterThan(0);
  }, 120_000);

  it("returns remote-tip-unreadable when the index is unreadable instead of reporting materialized", async () => {
    const fixture = await materialized();
    const index = join(fixture.clone, ".git/index");
    chmodSync(index, 0o000);
    try {
      expect(await verifyRepository({ clone: fixture.clone, hub: fixture.hub, set: fixture.set })).toEqual({
        exitCode: 2,
        verdict: "indeterminate",
        reason: "remote-tip-unreadable",
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
      expect(await verifyRepository({ clone: fixture.clone, hub: fixture.hub, set })).toEqual({
        exitCode: 2,
        verdict: "indeterminate",
        reason: "change-set-invalid",
      });
      expect(execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "rev-parse", "other"], { cwd: fixture.clone, encoding: "utf8" }).trim()).toBe(otherBefore);
    }
    const mainSet = structuredClone(fixture.set);
    mainSet.repository = { ...mainSet.repository, defaultBranch: "main" };
    expect((await verifyRepository({ clone: fixture.clone, hub: fixture.hub, set: mainSet })).reason).not.toBe("change-set-invalid");
  });

  it("fetches the default branch into refs/remotes/origin only when origin.fetch maps heads onto heads", async () => {
    const fixture = buildMaterializedFixture(roots);
    const origin = bareOriginForClone(fixture.clone);
    execFileSync("git", [...GIT, "config", "remote.origin.fetch", "+refs/heads/*:refs/heads/*"], {
      cwd: fixture.clone,
      stdio: "ignore",
    });
    execFileSync("git", [...GIT, "branch", "other", "HEAD"], { cwd: fixture.clone, stdio: "ignore" });
    execFileSync("git", [...GIT, "push", "origin", "other"], { cwd: fixture.clone, stdio: "ignore" });
    const otherBefore = gitIn(fixture.clone, "rev-parse", "refs/heads/other");
    const mainBefore = gitIn(fixture.clone, "rev-parse", "refs/heads/main");
    const mainTip = advanceOriginBranch(origin, "main");
    advanceOriginBranch(origin, "other");
    await verifyRepository({ clone: fixture.clone, hub: fixture.hub, set: fixture.set });
    expect(gitIn(fixture.clone, "rev-parse", "refs/heads/other")).toBe(otherBefore);
    expect(gitIn(fixture.clone, "rev-parse", "refs/heads/main")).toBe(mainBefore);
    expect(gitIn(fixture.clone, "rev-parse", "refs/remotes/origin/main")).toBe(mainTip);

    execFileSync("git", [...GIT, "checkout", "other"], { cwd: fixture.clone, stdio: "ignore" });
    await verifyRepository({ clone: fixture.clone, hub: fixture.hub, set: fixture.set });
    expect(gitIn(fixture.clone, "rev-parse", "refs/heads/main")).toBe(mainBefore);
    expect(gitIn(fixture.clone, "rev-parse", "refs/remotes/origin/main")).toBe(mainTip);
  }, 120_000);

  it("returns remote-tip-unreadable when fetch fails even if stale local and tracking refs still match", async () => {
    const fixture = buildMaterializedFixture(roots);
    const origin = bareOriginForClone(fixture.clone);
    const stale = gitIn(fixture.clone, "rev-parse", "refs/heads/main");
    execFileSync("git", [...GIT, "update-ref", "-d", "refs/heads/main"], { cwd: origin, stdio: "ignore" });
    expect(gitIn(fixture.clone, "rev-parse", "refs/heads/main")).toBe(stale);
    expect(gitIn(fixture.clone, "rev-parse", "refs/remotes/origin/main")).toBe(stale);
    const unreadable = { exitCode: 2, verdict: "indeterminate", reason: "remote-tip-unreadable" } as const;
    expect(await verifyRepository({ clone: fixture.clone, hub: fixture.hub, set: fixture.set })).toEqual(unreadable);
    expect(
      await materializeRepository({
        clone: fixture.clone,
        hub: fixture.hub,
        set: fixture.set,
        texts: fixture.texts,
            heldChangeSets: [],
      }),
    ).toEqual(unreadable);
  }, 120_000);
});

describe("verifyRepository re-checks the approval and the authorization (#1178)", () => {
  const NOW = () => new Date("2026-10-01T00:00:00Z");

  it("5g: passes right after a successful materialize, and fails once a later committed decision withdraws the approval", async () => {
    const fixture = await materialized({}, NOW);
    const { verifyMain } = await import("./apply-plan-cli.js");
    expect(await verifyRepository({ clone: fixture.clone, hub: fixture.hub, set: fixture.set, now: NOW })).toEqual({ exitCode: 0, verdict: "materialized" });
    expect(await verifyMain(["--repo", SITE_ID], { cwd: fixture.hub, clone: fixture.clone, set: fixture.set, now: NOW })).toBe(0);

    commitHubPlan(fixture.hub, decide(fixture.plan, "rejected", LATER_AT));
    const withdrawn = { exitCode: 2, verdict: "indeterminate", reason: "awaiting-approval", detail: "plan-not-approved" };
    expect(await verifyRepository({ clone: fixture.clone, hub: fixture.hub, set: fixture.set, now: NOW })).toEqual(withdrawn);
    expect(await verifyMain(["--repo", SITE_ID], { cwd: fixture.hub, clone: fixture.clone, set: fixture.set, now: NOW })).toBe(2);
  }, 10_000);

  it("5g: fails after the execution authorization expires, judged at the injected instant", async () => {
    const fixture = await materialized({ hub: ({ plan }) => ({ assessment: assessmentFor(plan, { expiresAt: "2026-10-15T00:00:00Z" }) }) }, NOW);
    expect(await verifyRepository({ clone: fixture.clone, hub: fixture.hub, set: fixture.set, now: NOW })).toEqual({ exitCode: 0, verdict: "materialized" });
    const later = () => new Date("2026-11-01T00:00:00Z");
    expect(await verifyRepository({ clone: fixture.clone, hub: fixture.hub, set: fixture.set, now: later })).toEqual({
      exitCode: 1,
      verdict: "violated",
      reason: "authorization-not-current",
      detail: "readiness-violated",
    });
    const { verifyMain } = await import("./apply-plan-cli.js");
    expect(await verifyMain(["--repo", SITE_ID], { cwd: fixture.hub, clone: fixture.clone, set: fixture.set, now: later })).toBe(1);
  }, 10_000);

  it("verify uses the injected readiness runner, and refuses when it cannot say", async () => {
    const fixture = await materialized({}, NOW);
    const seen: string[] = [];
    const runReadiness = (request: { asOf: string }) => {
      seen.push(request.asOf);
      return { status: 2 };
    };
    expect(await verifyRepository({ clone: fixture.clone, hub: fixture.hub, set: fixture.set, now: NOW, runReadiness })).toEqual({
      exitCode: 2,
      verdict: "indeterminate",
      reason: "authorization-unverified",
      detail: "readiness-indeterminate",
    });
    expect(seen).toEqual(["2026-10-01T00:00:00.000Z"]);
  });

  it("a verify that finds no approving plan reports awaiting-approval before it looks at the tree", async () => {
    const fixture = buildMaterializedFixture(roots, { hub: { planMode: "absent" } });
    expect(await verifyRepository({ clone: fixture.clone, hub: fixture.hub, set: fixture.set, now: NOW })).toEqual({
      exitCode: 2,
      verdict: "indeterminate",
      reason: "awaiting-approval",
      detail: "plan-unreadable",
    });
  });
});

