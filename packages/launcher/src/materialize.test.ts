import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LATER_AT, assessmentFor, decide, decision, editLedger, reseal, withDecisions } from "./admission-fixture.js";
import type { Loose } from "./admission-fixture.js";
import type { ReadinessRunner } from "./admission.js";
import { buildAdmittedFixture, buildMaterializedFixture, readCloneLedger, writeSnapshot } from "./apply-step-fixture.js";
import { BUNDLE_STORE_REL, CHANGE_SET_STORE_REL, storeChangeSet } from "./apply-store.js";
import { AGENTS_GUIDE_PATH, AGENTS_GUIDE_TEXT } from "./agents-guide.js";
import { LEDGER_PATH, contentDigest, skillPath } from "./change-set-contract.js";
import { buildGuideFixture } from "./plan-bundle-setup-fixture.js";
import { renderInstalledLedger } from "./ledger-contract.js";
import { materializeRepository, verifyRepository } from "./materialize.js";

// Each case builds a hub and a clone with real git; a slow machine needs more than the default.
vi.setConfig({ testTimeout: 30_000 });

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
    expect(fixture.binding).toEqual({ kind: "approved", subjectDigest: fixture.bundle.bundleDigest });
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
      heldChangeSets: [],
    });
    expect(outcome).toEqual({ exitCode: 2, verdict: "indeterminate", reason: "change-set-invalid" });
    expect(applyBranchExists(fixture.clone, fixture.set.branch)).toBe(false);
  });
});

describe("materializeRepository: the Launcher guide", () => {
  const inputOf = (fixture: ReturnType<typeof buildGuideFixture>) => ({ clone: fixture.clone, hub: fixture.hub, set: fixture.set, texts: fixture.texts, heldChangeSets: [] as [], now: () => new Date("2026-10-01T00:00:00Z") });

  it("writes clossys/AGENTS.md from the constant text, and verify accepts it", async () => {
    const fixture = buildGuideFixture(roots);
    const input = inputOf(fixture);
    expect(await materializeRepository(input)).toEqual({ exitCode: 0, verdict: "materialized" });
    expect(readFileSync(join(fixture.clone, AGENTS_GUIDE_PATH), "utf8")).toBe(AGENTS_GUIDE_TEXT);
    expect(await verifyRepository(input)).toEqual({ exitCode: 0, verdict: "materialized" });
  });

  it("verify checks the guide: a head with one changed byte is diverged (agents-guide-mismatch)", async () => {
    const fixture = buildGuideFixture(roots);
    const input = inputOf(fixture);
    expect((await materializeRepository(input)).exitCode).toBe(0);
    const changed = AGENTS_GUIDE_TEXT.replace("Do not", "Do NOT");
    expect(changed).not.toBe(AGENTS_GUIDE_TEXT);
    writeFileSync(join(fixture.clone, AGENTS_GUIDE_PATH), changed);
    expect(await verifyRepository(input)).toEqual({ exitCode: 1, verdict: "violated", reason: "agents-guide-mismatch" });
    expect(await materializeRepository(input)).toEqual({ exitCode: 1, verdict: "violated", reason: "diverged", detail: "agents-guide-mismatch" });
    expect(readFileSync(join(fixture.clone, AGENTS_GUIDE_PATH), "utf8")).toBe(changed);
  });

  it("verify also holds the file to the constant text, not only to the set's digest", async () => {
    const other = `${AGENTS_GUIDE_TEXT}An extra line.\n`;
    const fixture = buildGuideFixture(roots, other);
    const input = inputOf(fixture);
    expect((await materializeRepository(input)).exitCode).toBe(0);
    expect(readFileSync(join(fixture.clone, AGENTS_GUIDE_PATH), "utf8")).toBe(other);
    expect(await verifyRepository(input)).toEqual({ exitCode: 1, verdict: "violated", reason: "agents-guide-mismatch" });
  });

  it("a deleted guide is the same mismatch", async () => {
    const fixture = buildGuideFixture(roots);
    const input = inputOf(fixture);
    expect((await materializeRepository(input)).exitCode).toBe(0);
    rmSync(join(fixture.clone, AGENTS_GUIDE_PATH));
    expect(await verifyRepository(input)).toEqual({ exitCode: 1, verdict: "violated", reason: "agents-guide-mismatch" });
  });
});

// ---------------------------------------------------------------------------
// #1178: a change set is written only when the hub's committed approval binds
// it, and the ledger records exactly the binding admission computed.

const NOW = () => new Date("2026-10-01T00:00:00Z");
const awaiting = (detail: string) => ({ exitCode: 2, verdict: "indeterminate", reason: "awaiting-approval", detail });
const wholeFile = (set: Loose, path: string): Loose => (set.files as Loose[]).find((file) => file.path === path)!;

type Site = { clone: string; hub: string; set: Parameters<typeof materializeRepository>[0]["set"]; texts: Record<string, string> };

/** Runs materialize, requires exactly `expected`, and requires that nothing in the clone or the hub moved. */
async function refuses(site: Site, expected: object, extra: Partial<Parameters<typeof materializeRepository>[0]> = {}): Promise<void> {
  const before = writeSnapshot(site.clone, site.hub);
  const outcome = await materializeRepository({ clone: site.clone, hub: site.hub, set: site.set, texts: site.texts, heldChangeSets: [], now: NOW, ...extra });
  expect(outcome).toEqual(expected);
  expect(writeSnapshot(site.clone, site.hub)).toBe(before);
  expect(applyBranchExists(site.clone, site.set.branch)).toBe(false);
}

describe("materializeRepository admission (#1178)", () => {
  it("5a: a stored set with no plan committed at the hub HEAD is refused as awaiting-approval, writing nothing", async () => {
    // The hub's worktree holds an approving plan that was never committed (see also 5e).
    const site = buildMaterializedFixture(roots, { hub: { planMode: "absent" } });
    await refuses(site, awaiting("plan-unreadable"));
    expect(existsSync(join(site.hub, CHANGE_SET_STORE_REL))).toBe(false);
    const unapproved = buildMaterializedFixture(roots, { hub: ({ plan }) => ({ plans: [withDecisions(plan, [])] }) });
    await refuses(unapproved, awaiting("plan-not-approved"));
    expect(existsSync(join(unapproved.hub, CHANGE_SET_STORE_REL))).toBe(false);
  });

  it("5b: membership: the ledger written in the clone records the approved bundle's digest, not the plan's", async () => {
    const site = buildMaterializedFixture(roots);
    expect(await materializeRepository({ clone: site.clone, hub: site.hub, set: site.set, texts: site.texts, heldChangeSets: [], now: NOW })).toEqual({ exitCode: 0, verdict: "materialized" });
    const ledger = readCloneLedger(site.clone)!;
    expect(ledger.history[0].binding).toEqual({ kind: "approved", subjectDigest: site.bundle.bundleDigest });
    expect(ledger.history[0].binding.subjectDigest).not.toBe(site.set.planDigest);
    expect(await verifyRepository({ clone: site.clone, hub: site.hub, set: site.set, now: NOW })).toEqual({ exitCode: 0, verdict: "materialized" });
  });

  it("5d: a later non-approving decision committed in the hub refuses", async () => {
    const site = buildMaterializedFixture(roots, { hub: ({ plan }) => ({ plans: [plan, decide(plan, "rejected", LATER_AT)] }) });
    await refuses(site, awaiting("plan-not-approved"));
  });

  it("5d: an approving and a non-approving decision tied at the latest instant refuse", async () => {
    const site = buildMaterializedFixture(roots, {
      hub: ({ plan, bundle }) => ({ plans: [withDecisions(plan, [decision(LATER_AT, "approved", bundle.bundleDigest), decision(LATER_AT, "rejected")])] }),
    });
    await refuses(site, awaiting("plan-not-approved"));
  });

  it("5d: an edited stored bundle refuses", async () => {
    const site = buildMaterializedFixture(roots);
    const path = join(site.hub, BUNDLE_STORE_REL, `${site.bundle.bundleDigest.slice(7)}.json`);
    const edited = JSON.parse(readFileSync(path, "utf8")) as Loose;
    edited.repositories[0].changeSet = `sha256:${"0".repeat(64)}`;
    writeFileSync(path, `${JSON.stringify(edited, null, 2)}\n`);
    await refuses(site, awaiting("bundle-unreadable"));
  });

  it("5d: a set whose producer changed is no member of the approved bundle", async () => {
    const site = buildMaterializedFixture(roots);
    const changed = structuredClone(site.set) as unknown as Loose;
    changed.producer.version = "9.9.9";
    const bundle = changed.bundle;
    reseal(changed);
    changed.bundle = bundle;
    await refuses({ ...site, set: changed as Site["set"] }, awaiting("not-member"));
  });

  it("5d: an expired authorization, judged at the injected instant by the hub's readiness executable, refuses as violated", async () => {
    const site = buildMaterializedFixture(roots, { hub: ({ plan }) => ({ assessment: assessmentFor(plan, { expiresAt: "2026-09-25T00:00:00Z" }) }) });
    await refuses(site, { exitCode: 1, verdict: "violated", reason: "authorization-not-current", detail: "readiness-violated" });
    // The same hub, judged before the expiry, materializes.
    const current = await materializeRepository({ clone: site.clone, hub: site.hub, set: site.set, texts: site.texts, heldChangeSets: [], now: () => new Date("2026-09-24T18:00:00Z") });
    expect(current).toEqual({ exitCode: 0, verdict: "materialized" });
  });

  it("5d: a readiness runner that fails, or that cannot say, is indeterminate", async () => {
    const site = buildMaterializedFixture(roots);
    const answers: [ReadinessRunner, string][] = [
      [() => ({ status: 2 }), "readiness-indeterminate"],
      [() => ({ status: null }), "readiness-failed"],
      [() => ({ status: 3 }), "readiness-failed"],
      [
        () => {
          throw new Error("the runner is gone");
        },
        "readiness-failed",
      ],
    ];
    for (const [runReadiness, detail] of answers) {
      await refuses(site, { exitCode: 2, verdict: "indeterminate", reason: "authorization-unverified", detail }, { runReadiness });
    }
  });

  it("5e: an uncommitted approval in the hub worktree does not authorize", async () => {
    const site = buildMaterializedFixture(roots, { hub: ({ plan }) => ({ plans: [withDecisions(plan, [])], worktreePlan: plan }) });
    const worktree = JSON.parse(readFileSync(join(site.hub, "clossys/advisor/plan.json"), "utf8")) as Loose;
    expect(worktree.decisions).toHaveLength(1);
    await refuses(site, awaiting("plan-not-approved"));
  });

  it("5e: an uncommitted revocation in the hub worktree does not block", async () => {
    const site = buildMaterializedFixture(roots, { hub: ({ plan }) => ({ worktreePlan: decide(plan, "rejected", LATER_AT) }) });
    const worktree = JSON.parse(readFileSync(join(site.hub, "clossys/advisor/plan.json"), "utf8")) as Loose;
    expect(worktree.decisions).toHaveLength(2);
    expect(await materializeRepository({ clone: site.clone, hub: site.hub, set: site.set, texts: site.texts, heldChangeSets: [], now: NOW })).toEqual({ exitCode: 0, verdict: "materialized" });
    expect(readCloneLedger(site.clone)!.history[0].binding).toEqual({ kind: "approved", subjectDigest: site.bundle.bundleDigest });
  });

  it("5i: a hub without the readiness executable is indeterminate, and never falls back to npx", async () => {
    const site = buildMaterializedFixture(roots, { hub: { readiness: false } });
    const bin = mkdtempSync(join(tmpdir(), "launcher-fake-npx-"));
    roots.push(bin);
    const marker = join(bin, "npx-was-run");
    writeFileSync(join(bin, "npx"), `#!/bin/sh\necho ran > '${marker}'\nexit 0\n`, { mode: 0o755 });
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path ?? ""}`;
    try {
      await refuses(site, { exitCode: 2, verdict: "indeterminate", reason: "authorization-unverified", detail: "readiness-bin-missing" });
    } finally {
      process.env.PATH = path;
    }
    expect(existsSync(marker)).toBe(false);
  });

  it("5i: the default readiness runner runs the hub's own executable, with the committed bytes and the injected instant", async () => {
    const site = buildMaterializedFixture(roots);
    expect(await materializeRepository({ clone: site.clone, hub: site.hub, set: site.set, texts: site.texts, heldChangeSets: [], now: NOW })).toEqual({ exitCode: 0, verdict: "materialized" });
  });
});

describe("materializeRepository: the one-approval rule (D26) end to end", () => {
  it("5f: an apply set over a squash-merged setup (no ancestor of the setup branch) is admitted, and the ledger records it as admitted", async () => {
    const site = buildAdmittedFixture(roots);
    expect(site.sideTip).not.toBeNull();
    expect(() => git(site.clone, "merge-base", "--is-ancestor", site.sideTip!, site.baseCommit)).toThrow();
    const outcome = await materializeRepository({ clone: site.clone, hub: site.hub, set: site.set, texts: site.texts, heldChangeSets: [site.setup], spawn: site.spawn, now: NOW });
    expect(outcome).toEqual({ exitCode: 0, verdict: "materialized" });
    const ledger = readCloneLedger(site.clone)!;
    expect(ledger.history.map((entry: Loose) => entry.phase)).toEqual(["setup", "apply"]);
    expect(ledger.history[0].binding).toEqual({ kind: "approved", subjectDigest: site.world.approvedBundle.bundleDigest });
    expect(ledger.history[1].binding).toEqual({ kind: "admitted", subjectDigest: site.world.approvedBundle.bundleDigest, setupChangeSet: site.setup.changeSetDigest });
    expect(readFileSync(join(site.clone, LEDGER_PATH))).toEqual(
      Buffer.from(
        renderInstalledLedger(site.world.ledger, site.set, { kind: "admitted", subjectDigest: site.world.approvedBundle.bundleDigest, setupChangeSet: site.setup.changeSetDigest }, site.world.plan.packages!.filter((act) => act.repository === site.set.repository.id)),
        "utf8",
      ),
    );
    expect(existsSync(join(site.hub, CHANGE_SET_STORE_REL, `${site.set.changeSetDigest.slice(7)}.json`))).toBe(true);
    // Verify re-runs the admission on the materialized branch: it reads the base commit, never the worktree.
    expect(await verifyRepository({ clone: site.clone, hub: site.hub, set: site.set, heldChangeSets: [site.setup], now: NOW })).toEqual({ exitCode: 0, verdict: "materialized" });
  });

  const rows: [string, Parameters<typeof buildAdmittedFixture>[1], object][] = [
    ["condition 1: a different plan digest", { world: { editApply: (a) => void (a.planDigest = `sha256:${"e".repeat(64)}`) } }, awaiting("plan-digest-mismatch")],
    [
      "condition 1: the approving decision is no longer the latest",
      { hub: (w) => ({ plans: [w.plan, decide(w.plan, "rejected", LATER_AT)] }) },
      awaiting("plan-not-approved"),
    ],
    [
      "condition 2: the package acts differ",
      { world: { editApply: (a) => void a.items.splice(a.items.findIndex((entry: Loose) => entry.act === "pin-starter"), 1) } },
      awaiting("package-acts-differ"),
    ],
    [
      "condition 2: something is deferred",
      { world: { editApply: (a) => void (a.deferred = [{ planItem: "example-owner/site:@example/writer", reason: "after-setup" }]) } },
      { exitCode: 2, verdict: "indeterminate", reason: "change-set-invalid" },
    ],
    ["condition 2: a different producer", { world: { editApply: (a) => void (a.producer.version = "0.5.0") } }, awaiting("producer-differs")],
    [
      "condition 2: a whole-file entry that is not a no-op",
      { world: { editApply: (a) => void (wholeFile(a, "clossys/brief.json").before = contentDigest("older\n")) } },
      awaiting("file-not-noop"),
    ],
    [
      "condition 3: the base ledger is bound to another subject",
      { tree: (tree) => tree.set(LEDGER_PATH, { mode: "100644", bytes: editLedger(tree.get(LEDGER_PATH)!.bytes, (ledger) => void (ledger.history[0].binding.subjectDigest = `sha256:${"6".repeat(64)}`)) }) },
      awaiting("setup-subject-mismatch"),
    ],
    [
      "condition 3: the base holds no ledger, so the setup is not merged",
      { tree: (tree) => void tree.delete(LEDGER_PATH) },
      { exitCode: 1, verdict: "violated", reason: "ledger-mismatch" },
    ],
  ];

  it.each(rows)("5c: %s refuses, writing nothing", async (_name, options, expected) => {
    const site = buildAdmittedFixture(roots, options);
    await refuses(site, expected, { heldChangeSets: [site.setup], spawn: site.spawn });
  });

  it("6: a staffing-only apply set has no package act, needs no authorization, and materializes on membership alone", async () => {
    // The hub approved a second bundle, which holds the apply set; it carries no assessment and no readiness executable.
    const site = buildAdmittedFixture(roots, {
      world: {
        editApply: (a) => {
          a.items = (a.items as Loose[]).filter((item) => item.act !== "pin-starter" && item.act !== "install");
          a.keys = [];
          a.files = (a.files as Loose[]).filter((file) => file.derived !== true || file.path === LEDGER_PATH);
        },
      },
      hub: (w) => ({ plans: [w.plan, decide(w.plan, "approved", LATER_AT, w.applyBundle.bundleDigest)], assessment: null, readiness: false }),
    });
    expect(site.set.items.some((item) => item.act === "install" || item.act === "pin-starter")).toBe(false);
    expect(existsSync(join(site.hub, "clossys/advisor/assessment-input.json"))).toBe(false);
    expect(existsSync(join(site.hub, "node_modules"))).toBe(false);
    const outcome = await materializeRepository({ clone: site.clone, hub: site.hub, set: site.set, texts: site.texts, heldChangeSets: [site.setup], now: NOW });
    expect(outcome).toEqual({ exitCode: 0, verdict: "materialized" });
    const ledger = readCloneLedger(site.clone)!;
    expect(ledger.history[0].binding).toEqual({ kind: "approved", subjectDigest: site.world.approvedBundle.bundleDigest });
    expect(ledger.history[1].binding).toEqual({ kind: "approved", subjectDigest: site.world.applyBundle.bundleDigest });
  });

  it("5j: the default branch moving after admission is still superseded, and writes nothing", async () => {
    const site = buildAdmittedFixture(roots);
    advanceDefaultBranch(site.clone, "main");
    await refuses(site, { exitCode: 1, verdict: "violated", reason: "superseded" }, { heldChangeSets: [site.setup], spawn: site.spawn });
  });
});
