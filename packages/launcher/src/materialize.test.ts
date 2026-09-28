import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildMaterializedFixture } from "./apply-step-fixture.js";
import { CHANGE_SET_STORE_REL, storeChangeSet } from "./apply-store.js";
import { skillPath } from "./change-set-contract.js";
import { renderInstalledLedger } from "./ledger-contract.js";
import { materializeRepository } from "./materialize.js";

const gitEnv = {
  ...process.env,
  PATH: process.env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Example Author",
  GIT_AUTHOR_EMAIL: "author@example.com",
  GIT_COMMITTER_NAME: "Example Author",
  GIT_COMMITTER_EMAIL: "author@example.com",
};

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    env: gitEnv,
    stdio: "ignore",
  });
}

function syncDefaultBranch(clone: string, defaultBranch: string): void {
  git(clone, "fetch", "--no-tags", "origin", `+refs/heads/${defaultBranch}:refs/remotes/origin/${defaultBranch}`);
  git(clone, "checkout", defaultBranch);
  git(clone, "reset", "--hard", `refs/remotes/origin/${defaultBranch}`);
}

function advanceDefaultBranch(clone: string, defaultBranch: string, extra?: () => void): void {
  git(clone, "checkout", defaultBranch);
  extra?.();
  writeFileSync(join(clone, "branch-advance.txt"), "advanced\n");
  git(clone, "add", "branch-advance.txt");
  git(clone, "commit", "-m", "advance default branch");
  git(clone, "push", "origin", `refs/heads/${defaultBranch}`);
  syncDefaultBranch(clone, defaultBranch);
}

function applyBranchExists(clone: string, branch: string): boolean {
  return (
    spawnSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "show-ref", "--verify", `refs/heads/${branch}`], {
      cwd: clone,
      stdio: "ignore",
    }).status === 0
  );
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("materializeRepository", () => {
  it("writes the change set into a clean clone and stores it in the hub", async () => {
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

    for (const file of fixture.set.files) {
      if ("derived" in file || file.after === null) continue;
      const path = join(fixture.clone, file.path);
      if (file.mode === "120000") {
        expect(readlinkSync(path)).toBe(fixture.texts[file.path]);
      } else {
        expect(readFileSync(path)).toEqual(Buffer.from(fixture.texts[file.path]!, "utf8"));
      }
    }

    const ledgerExpected = renderInstalledLedger(null, fixture.set, fixture.binding, fixture.planPackages);
    expect(readFileSync(join(fixture.clone, "clossys/.state/installed.json"))).toEqual(Buffer.from(ledgerExpected, "utf8"));

    const digest = fixture.set.changeSetDigest.slice("sha256:".length);
    expect(existsSync(join(fixture.hub, CHANGE_SET_STORE_REL, `${digest}.json`))).toBe(true);
  });

  it("does not rewrite when the branch already exists, and reports diverged after a tamper", async () => {
    const fixture = buildMaterializedFixture(roots);
    const input = {
      clone: fixture.clone,
      hub: fixture.hub,
      set: fixture.set,
      texts: fixture.texts,
      binding: fixture.binding,
      heldChangeSets: [],
    };
    expect((await materializeRepository(input)).exitCode).toBe(0);
    expect(await materializeRepository(input)).toEqual({ exitCode: 0, verdict: "materialized" });

    const skill = skillPath("strategist");
    writeFileSync(join(fixture.clone, skill), "tampered\n");
    const diverged = await materializeRepository(input);
    expect(diverged.exitCode).toBe(1);
    expect(diverged.reason).toBe("diverged");
    expect(readFileSync(join(fixture.clone, skill), "utf8")).toBe("tampered\n");
  });

  it("writes whole files from texts on the stored change set without a separate texts map", async () => {
    const fixture = buildMaterializedFixture(roots);
    const stored = {
      ...fixture.set,
      texts: Object.entries(fixture.texts)
        .map(([path, text]) => ({ path, text }))
        .sort((left, right) => left.path.localeCompare(right.path)),
    };
    storeChangeSet(fixture.hub, stored);
    const outcome = await materializeRepository({
      clone: fixture.clone,
      hub: fixture.hub,
      set: stored,
      texts: {},
      binding: fixture.binding,
      heldChangeSets: [],
    });
    expect(outcome).toEqual({ exitCode: 0, verdict: "materialized" });
    const briefPath = stored.files.find((file) => file.path === "clossys/brief.json");
    if (briefPath !== undefined && "derived" in briefPath) throw new Error("unexpected derived brief");
    const briefFile = stored.files.find((file) => file.path === "clossys/brief.json" && !("derived" in file));
    if (briefFile !== undefined && briefFile.after !== null) {
      expect(readFileSync(join(fixture.clone, "clossys/brief.json"), "utf8")).toBe(
        stored.texts!.find((row) => row.path === "clossys/brief.json")!.text,
      );
    }
  });

  it("does not create the apply branch or write when git status fails", async () => {
    const fixture = buildMaterializedFixture(roots);
    writeFileSync(join(fixture.clone, "dirty.txt"), "x\n");
    const index = join(fixture.clone, ".git/index");
    chmodSync(index, 0o000);
    const branch = fixture.set.branch;
    let outcome;
    try {
      outcome = await materializeRepository({
        clone: fixture.clone,
        hub: fixture.hub,
        set: fixture.set,
        texts: fixture.texts,
        binding: fixture.binding,
        heldChangeSets: [],
      });
    } finally {
      chmodSync(index, 0o644);
    }
    expect(outcome).toEqual({ exitCode: 2, verdict: "indeterminate", reason: "remote-tip-unreadable" });
    expect(applyBranchExists(fixture.clone, branch)).toBe(false);
    expect(existsSync(join(fixture.hub, CHANGE_SET_STORE_REL))).toBe(false);
  });

  it("materializes when the default-branch tip still equals baseCommit", async () => {
    const fixture = buildMaterializedFixture(roots);
    const tip = execFileSync(
      "git",
      ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "rev-parse", `refs/heads/${fixture.set.repository.defaultBranch}`],
      { cwd: fixture.clone, encoding: "utf8" },
    ).trim();
    expect(fixture.set.repository.baseCommit).toBe(tip);
    const outcome = await materializeRepository({
      clone: fixture.clone,
      hub: fixture.hub,
      set: fixture.set,
      texts: fixture.texts,
      binding: fixture.binding,
      heldChangeSets: [],
    });
    expect(outcome).toEqual({ exitCode: 0, verdict: "materialized" });
    expect(applyBranchExists(fixture.clone, fixture.set.branch)).toBe(true);
  });

  it("returns superseded when the default branch moved but every before still matches the new tip", async () => {
    const fixture = buildMaterializedFixture(roots);
    advanceDefaultBranch(fixture.clone, fixture.set.repository.defaultBranch);
    const outcome = await materializeRepository({
      clone: fixture.clone,
      hub: fixture.hub,
      set: fixture.set,
      texts: fixture.texts,
      binding: fixture.binding,
      heldChangeSets: [],
    });
    expect(outcome).toEqual({ exitCode: 1, verdict: "violated", reason: "superseded" });
    expect(applyBranchExists(fixture.clone, fixture.set.branch)).toBe(false);
  });

  it("returns base-conflict when the default branch moved and a before differs at the new tip", async () => {
    const fixture = buildMaterializedFixture(roots);
    const wholePath = fixture.set.files.find((file) => !("derived" in file) && file.mode === "100644")!.path;
    advanceDefaultBranch(fixture.clone, fixture.set.repository.defaultBranch, () => {
      const path = join(fixture.clone, wholePath);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "unexpected at new tip\n");
      git(fixture.clone, "add", wholePath);
    });
    const outcome = await materializeRepository({
      clone: fixture.clone,
      hub: fixture.hub,
      set: fixture.set,
      texts: fixture.texts,
      binding: fixture.binding,
      heldChangeSets: [],
    });
    expect(outcome).toEqual({ exitCode: 2, verdict: "indeterminate", reason: "base-conflict" });
    expect(applyBranchExists(fixture.clone, fixture.set.branch)).toBe(false);
  });

  it("stores the change set on a successful rerun when the hub holds nothing yet", async () => {
    const fixture = buildMaterializedFixture(roots);
    const input = {
      clone: fixture.clone,
      hub: fixture.hub,
      set: fixture.set,
      texts: fixture.texts,
      binding: fixture.binding,
      heldChangeSets: [] as const,
    };
    expect((await materializeRepository(input)).exitCode).toBe(0);
    rmSync(join(fixture.hub, CHANGE_SET_STORE_REL), { recursive: true, force: true });
    const rerun = await materializeRepository(input);
    expect(rerun).toEqual({ exitCode: 0, verdict: "materialized" });
    const digest = fixture.set.changeSetDigest.slice("sha256:".length);
    expect(existsSync(join(fixture.hub, CHANGE_SET_STORE_REL, `${digest}.json`))).toBe(true);
  });

  it("returns change-set-not-stored when a successful rerun cannot write the hub store", async () => {
    const fixture = buildMaterializedFixture(roots);
    const input = {
      clone: fixture.clone,
      hub: fixture.hub,
      set: fixture.set,
      texts: fixture.texts,
      binding: fixture.binding,
      heldChangeSets: [] as const,
    };
    expect((await materializeRepository(input)).exitCode).toBe(0);
    const storeDir = join(fixture.hub, CHANGE_SET_STORE_REL);
    chmodSync(storeDir, 0o000);
    try {
      const rerun = await materializeRepository(input);
      expect(rerun).toEqual({ exitCode: 2, verdict: "indeterminate", reason: "change-set-not-stored" });
    } finally {
      chmodSync(storeDir, 0o755);
    }
  });

  it("returns change-set-invalid before creating a branch when ledger bytes cannot be computed", async () => {
    const fixture = buildMaterializedFixture(roots);
    const invalid = { ...fixture.set, changeSetDigest: "sha256:" + "0".repeat(64) };
    const outcome = await materializeRepository({
      clone: fixture.clone,
      hub: fixture.hub,
      set: invalid,
      texts: fixture.texts,
      binding: fixture.binding,
      heldChangeSets: [],
    });
    expect(outcome).toEqual({ exitCode: 2, verdict: "indeterminate", reason: "change-set-invalid" });
    expect(applyBranchExists(fixture.clone, fixture.set.branch)).toBe(false);
  });
});
