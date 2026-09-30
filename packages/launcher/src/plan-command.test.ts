// `launcher-apply-plan plan` against real git: a hub, and one sibling clone
// (with a bare origin) for each staffed repository. Every test drives git
// against temporary repositories, so each carries its own timeout.

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { READINESS_BIN, approvedPlan, assessmentFor, clone as cloneValue, writeReadinessStub } from "./admission-fixture.js";
import type { Loose } from "./admission-fixture.js";
import { BUNDLE_STORE_REL, CHANGE_SET_STORE_REL, listStoredChangeSets, readStoredApplyBundle } from "./apply-store.js";
import type { PinnedPackage } from "./change-set-contract.js";
import { materializeRepository } from "./materialize.js";
import { defaultOriginId } from "./observe-repository.js";
import { PLAN_USAGE, planMain } from "./plan-command.js";
import type { PlanCommandOptions } from "./plan-command.js";
import { HUB_BRIEF, SKILLS, STARTER_INTEGRITY, STARTER_NAME, STARTER_VERSION, WRITER_INTEGRITY, setupPlan } from "./plan-bundle-setup-fixture.js";
import type { AdvisorPlan } from "./plan-contract.js";
import { planDigest } from "./plan-digest.js";
import type { LockfileSpawn, LockfileSpawnRequest } from "./lockfile-regen.js";
import { PACKAGE_SCOPE } from "./generated/package-scope.generated.js";
import { PROVENANCE_CHECK_BIN } from "./provenance-gate.js";

// A switch that makes the real sheet refuse, so a test can show a refused sheet stores nothing.
const sheetSwitch = vi.hoisted(() => ({ refuse: false }));
vi.mock("./approval-sheet.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./approval-sheet.js")>();
  return {
    ...original,
    renderApprovalSheet: (input: Parameters<typeof original.renderApprovalSheet>[0]) => {
      if (sheetSwitch.refuse) throw new original.ApprovalSheetError("value-unsafe");
      return original.renderApprovalSheet(input);
    },
  };
});

const TEST_TIMEOUT_MS = 120_000;
const NOW = () => new Date("2026-09-25T00:00:00Z");
const READY = () => ({ status: 0 });
const SITE = "example-owner/site";
const DOCS = "example-owner/docs";
const ENGINE: PinnedPackage = { name: "@clossys/advisor", version: "0.8.0", integrity: STARTER_INTEGRITY };
const INTEGRATOR: PinnedPackage = { name: "@clossys/integrator", version: "0.6.0", integrity: WRITER_INTEGRITY };
const DEP_INTEGRITY = `sha512-${Buffer.alloc(64, 3).toString("base64")}`;

const gitEnv: NodeJS.ProcessEnv = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_AUTHOR_NAME: "Example Author",
  GIT_AUTHOR_EMAIL: "author@example.com",
  GIT_COMMITTER_NAME: "Example Author",
  GIT_COMMITTER_EMAIL: "author@example.com",
  GIT_AUTHOR_DATE: "2026-09-20T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-09-20T00:00:00Z",
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd, env: gitEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

const roots: string[] = [];
afterEach(() => {
  sheetSwitch.refuse = false;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

function write(dir: string, path: string, text: string): void {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
}

// ---------------------------------------------------------------------------
// the world: a hub and one clone for each staffed repository

const npmLock = (withStarter: boolean): string => {
  const tarball = (name: string, file: string, version: string) => `https://registry.npmjs.org/${name}/-/${file}-${version}.tgz`;
  const packages: Record<string, unknown> = {
    "": { name: "site", version: "1.0.0", devDependencies: { "example-dep": "1.0.0", ...(withStarter ? { [STARTER_NAME]: STARTER_VERSION } : {}) } },
    "node_modules/example-dep": { version: "1.0.0", resolved: tarball("example-dep", "example-dep", "1.0.0"), integrity: DEP_INTEGRITY, dev: true },
  };
  if (withStarter) {
    packages[`node_modules/${STARTER_NAME}`] = { version: STARTER_VERSION, resolved: tarball(STARTER_NAME, "starter", STARTER_VERSION), integrity: STARTER_INTEGRITY, dev: true };
  }
  return json({ name: "site", version: "1.0.0", lockfileVersion: 3, requires: true, packages });
};

const hubLock = (): string => {
  const tarball = (name: string, file: string, version: string) => `https://registry.npmjs.org/${name}/-/${file}-${version}.tgz`;
  return json({
    name: "hub",
    version: "1.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": { name: "hub", version: "1.0.0", devDependencies: { [ENGINE.name]: ENGINE.version, [INTEGRATOR.name]: INTEGRATOR.version } },
      [`node_modules/${ENGINE.name}`]: { version: ENGINE.version, resolved: tarball(ENGINE.name, "advisor", ENGINE.version), integrity: ENGINE.integrity, dev: true },
      [`node_modules/${INTEGRATOR.name}`]: { version: INTEGRATOR.version, resolved: tarball(INTEGRATOR.name, "integrator", INTEGRATOR.version), integrity: INTEGRATOR.integrity, dev: true },
    },
  });
};

const hubManifest = (ranges: Partial<Record<"advisor" | "integrator", string>> = {}): string =>
  json({ name: "hub", private: true, devDependencies: { [ENGINE.name]: ranges.advisor ?? ENGINE.version, [INTEGRATOR.name]: ranges.integrator ?? INTEGRATOR.version } });

/** The setup plan over two repositories, each pinning Starter and installing nothing else; a pin changes a lockfile, which the planner cannot yet prove (V6). */
function pinnedPlan(): AdvisorPlan {
  const plan = cloneValue(setupPlan()) as unknown as Loose;
  plan.staffing = [
    { repository: SITE, roles: ["strategist", "writer"] },
    { repository: DOCS, roles: ["strategist"] },
  ];
  plan.packages = [
    ...plan.packages.filter((entry: Loose) => entry.act !== "install"),
    { planItem: `${DOCS}:${STARTER_NAME}`, repository: DOCS, act: "pin-starter", name: STARTER_NAME, version: STARTER_VERSION, integrity: STARTER_INTEGRITY, placement: "devDependencies" },
  ];
  return plan as AdvisorPlan;
}

interface World {
  readonly root: string;
  readonly hub: string;
  readonly plan: AdvisorPlan;
  readonly options: PlanCommandOptions;
  readonly out: string[];
  readonly err: string[];
  /** Every request the two stub spawns received, in order. */
  readonly spawned: { readonly lockfile: LockfileSpawnRequest[]; readonly provenance: LockfileSpawnRequest[] };
}

const cloneOf = (world: World, id: string): string => join(world.root, id.slice(id.indexOf("/") + 1));

function originIdFor(root: string): (url: string) => string | null {
  const prefix = `${join(root, "origin")}${sep}`;
  return (url) => {
    if (!url.startsWith(prefix) || !url.endsWith(".git")) return defaultOriginId(url);
    const parts = url.slice(prefix.length, -".git".length).split("/");
    return parts.length === 2 && parts.every((part) => part.length > 0) ? parts.join("/") : null;
  };
}

function makeClone(root: string, id: string): void {
  const name = id.slice(id.indexOf("/") + 1);
  const origin = join(root, "origin", `${id}.git`);
  const path = join(root, name);
  mkdirSync(dirname(origin), { recursive: true });
  mkdirSync(path);
  git(root, "init", "--bare", "-b", "main", origin);
  git(path, "init", "-b", "main");
  git(path, "remote", "add", "origin", origin);
  write(path, "README.md", "# Example\n");
  write(path, "package.json", json({ name: "site", private: true, packageManager: "npm@10.9.0", devDependencies: { "example-dep": "1.0.0" } }));
  write(path, "package-lock.json", npmLock(false));
  git(path, "add", "-A");
  git(path, "commit", "-m", "initial");
  git(path, "push", "-u", "origin", "main");
}

/** The package manager the dry tree runs: answers the version probe, then writes the lockfile npm would for the pinned Starter. */
const lockfileStub =
  (calls: LockfileSpawnRequest[]): LockfileSpawn =>
  async (request) => {
    calls.push(request);
    if (request.args.includes("--version")) return { status: 0, stdout: "10.9.0\n", stderr: "" };
    writeFileSync(join(request.cwd, "package-lock.json"), npmLock(true));
    return { status: 0, stdout: "", stderr: "" };
  };

/** The hub's provenance check: reports the pinned Starter as verified, whatever tree it is given. */
const provenanceStub =
  (calls: LockfileSpawnRequest[]): LockfileSpawn =>
  async (request) => {
    calls.push(request);
    const report = { state: "verified", registryBaseUrl: PACKAGE_SCOPE.registry, packages: [{ name: STARTER_NAME, installedVersion: STARTER_VERSION, latestVersion: STARTER_VERSION, currencyDistance: "current", state: "verified", reasons: [] }] };
    return { status: 0, stdout: json(report), stderr: "" };
  };

/** Integrator installed in the hub the way npm lays it out: a stub file, and a relative link for the bin. */
function writeIntegratorStub(hub: string): void {
  const stub = join(hub, "node_modules", "@clossys", "integrator", "dist", "provenance-check-cli.js");
  const bin = join(hub, "node_modules", ".bin", PROVENANCE_CHECK_BIN);
  mkdirSync(dirname(stub), { recursive: true });
  mkdirSync(dirname(bin), { recursive: true });
  writeFileSync(stub, "#!/usr/bin/env node\n", { mode: 0o755 });
  symlinkSync("../@clossys/integrator/dist/provenance-check-cli.js", bin);
}

interface WorldOptions {
  readonly plan?: AdvisorPlan;
  readonly brief?: unknown;
  /** The committed assessment: a document, or null for none. Default: a current authorization for the plan. */
  readonly assessment?: Loose | string | null;
  readonly manifest?: string;
  readonly skills?: readonly { role: string; content: string }[];
  readonly inventory?: readonly string[];
  readonly planText?: string;
  readonly briefText?: string;
}

function makeWorld(options: WorldOptions = {}): World {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "plan-command-")));
  roots.push(root);
  const plan = options.plan ?? pinnedPlan();
  for (const id of [SITE, DOCS]) makeClone(root, id);
  const hub = join(root, "hub");
  mkdirSync(hub);
  git(hub, "init", "-b", "main");
  write(hub, "package.json", options.manifest ?? hubManifest());
  write(hub, "package-lock.json", hubLock());
  write(hub, "clossys/advisor/plan.json", options.planText ?? json(plan));
  write(hub, "clossys/advisor/brief.json", options.briefText ?? json(options.brief ?? HUB_BRIEF));
  write(hub, "clossys/.state/inventory.json", json({ schemaVersion: 1, repositories: (options.inventory ?? [SITE, DOCS]).map((id) => ({ id })) }));
  for (const skill of options.skills ?? SKILLS) write(hub, `.agents/skills/clossys-${skill.role}/SKILL.md`, skill.content);
  const assessment = options.assessment === undefined ? assessmentFor(plan, {}, [SITE, DOCS]) : options.assessment;
  if (assessment !== null) write(hub, "clossys/advisor/assessment-input.json", typeof assessment === "string" ? assessment : json(assessment));
  git(hub, "add", "-A");
  git(hub, "commit", "-m", "hub");
  writeReadinessStub(hub);
  writeIntegratorStub(hub);
  const out: string[] = [];
  const err: string[] = [];
  const spawned = { lockfile: [] as LockfileSpawnRequest[], provenance: [] as LockfileSpawnRequest[] };
  return {
    root,
    hub,
    plan,
    out,
    err,
    spawned,
    options: {
      cwd: hub,
      now: NOW,
      producerVersion: "0.4.0",
      spawn: { lockfileSpawn: lockfileStub(spawned.lockfile), provenanceSpawn: provenanceStub(spawned.provenance) },
      ports: { nodeId: (id) => `R_${id.slice(id.indexOf("/") + 1)}`, visibility: () => "private", originId: originIdFor(root) },
      stdout: (text) => void out.push(text),
      stderr: (line) => void err.push(line),
    },
  };
}

const run = (world: World, argv: readonly string[] = []) => planMain(argv, world.options);

/** Every file below `directory`, with its bytes, leaving out `.git` and anything under `skip`. */
function snapshot(directory: string, skip: readonly string[] = [], base = directory): Record<string, string> {
  const files: Record<string, string> = {};
  for (const name of readdirSync(directory).sort()) {
    const full = join(directory, name);
    const rel = full.slice(base.length + 1);
    if (name === ".git" || skip.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`))) continue;
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) files[rel] = `link:${readlinkSync(full)}`;
    else if (stat.isDirectory()) Object.assign(files, snapshot(full, skip, base));
    else files[rel] = readFileSync(full).toString("base64");
  }
  return files;
}

const APPLY_STATE = "clossys/.state/apply";
const stateSnapshot = (world: World) => ({
  hub: snapshot(world.hub, [APPLY_STATE, READINESS_BIN.split("/")[0]!]),
  site: snapshot(cloneOf(world, SITE)),
  docs: snapshot(cloneOf(world, DOCS)),
});
const storedFiles = (world: World): string[] => {
  const list = (rel: string) => (existsSync(join(world.hub, rel)) ? readdirSync(join(world.hub, rel)).sort() : []);
  return [...list(CHANGE_SET_STORE_REL).map((name) => `change-sets/${name}`), ...list(BUNDLE_STORE_REL).map((name) => `bundles/${name}`)];
};

// Golden sheets, captured from a real-git run and reviewed by hand: ids and digests only.
const FIRST_SHEET = `Clossys apply plan: approval sheet
Mode: report
Plan digest: sha256:af6d64909cbc93dd8009df226a7a25173810a705d2081045fe446d8268a43bfd
Plan committed: yes
Bundle digest: sha256:21214292be57dd50009ba1faf8d4707e4a86ddbf5cb301b17cd844a2c20ecb71
Authorization: plan sha256:af6d64909cbc93dd8009df226a7a25173810a705d2081045fe446d8268a43bfd expires 2999-01-01T00:00:00Z
Approve subjectDigest: sha256:21214292be57dd50009ba1faf8d4707e4a86ddbf5cb301b17cd844a2c20ecb71

| Repository | Kind | Item | Change | Digest |
| --- | --- | --- | --- | --- |
| example-owner/site | write-record | brief | 1 path | c9bee88d5ec5 |
| example-owner/site | add-caller-workflow | caller-workflow | 3 paths | c9bee88d5ec5 |
| example-owner/site | add-ci-template | ci-template | 1 path | c9bee88d5ec5 |
| example-owner/site | pin-starter | example-owner/site:@clossys/starter | @clossys/starter@0.2.0 | c9bee88d5ec5 |
| example-owner/site | write-ledger | ledger | 1 path | c9bee88d5ec5 |
| example-owner/site | add-path-scope-job | path-scope-job | 1 path | c9bee88d5ec5 |
| example-owner/site | compose-skills | skills | 10 paths | c9bee88d5ec5 |
| example-owner/site | write-starter-request | starter-request | 1 path | c9bee88d5ec5 |
| example-owner/docs | write-record | brief | 1 path | 383f32af7ac6 |
| example-owner/docs | add-caller-workflow | caller-workflow | 3 paths | 383f32af7ac6 |
| example-owner/docs | add-ci-template | ci-template | 1 path | 383f32af7ac6 |
| example-owner/docs | pin-starter | example-owner/docs:@clossys/starter | @clossys/starter@0.2.0 | 383f32af7ac6 |
| example-owner/docs | write-ledger | ledger | 1 path | 383f32af7ac6 |
| example-owner/docs | add-path-scope-job | path-scope-job | 1 path | 383f32af7ac6 |
| example-owner/docs | compose-skills | skills | 7 paths | 383f32af7ac6 |
| example-owner/docs | write-starter-request | starter-request | 1 path | 383f32af7ac6 |
`;

const APPLY_SHEET = `Clossys apply plan: approval sheet
Mode: report
Plan digest: sha256:af6d64909cbc93dd8009df226a7a25173810a705d2081045fe446d8268a43bfd
Plan committed: yes
Bundle digest: sha256:3b1f0f81f4cabdd5880350eb1478904b2fcb4f39fb9a674b4ba618eb7de8d952
Authorization: plan sha256:af6d64909cbc93dd8009df226a7a25173810a705d2081045fe446d8268a43bfd expires 2999-01-01T00:00:00Z
Approve subjectDigest: sha256:3b1f0f81f4cabdd5880350eb1478904b2fcb4f39fb9a674b4ba618eb7de8d952

| Repository | Kind | Item | Change | Digest |
| --- | --- | --- | --- | --- |
| example-owner/site | write-record | brief | 1 path | c3909522108a |
| example-owner/site | add-caller-workflow | caller-workflow | 3 paths | c3909522108a |
| example-owner/site | add-ci-template | ci-template | 1 path | c3909522108a |
| example-owner/site | pin-starter | example-owner/site:@clossys/starter | @clossys/starter@0.2.0 | c3909522108a |
| example-owner/site | write-ledger | ledger | 1 path | c3909522108a |
| example-owner/site | add-path-scope-job | path-scope-job | 1 path | c3909522108a |
| example-owner/site | compose-skills | skills | 10 paths | c3909522108a |
| example-owner/site | write-starter-request | starter-request | 1 path | c3909522108a |
| example-owner/docs | write-record | brief | 1 path | b7571a08ee07 |
| example-owner/docs | add-caller-workflow | caller-workflow | 3 paths | b7571a08ee07 |
| example-owner/docs | add-ci-template | ci-template | 1 path | b7571a08ee07 |
| example-owner/docs | pin-starter | example-owner/docs:@clossys/starter | @clossys/starter@0.2.0 | b7571a08ee07 |
| example-owner/docs | write-ledger | ledger | 1 path | b7571a08ee07 |
| example-owner/docs | add-path-scope-job | path-scope-job | 1 path | b7571a08ee07 |
| example-owner/docs | compose-skills | skills | 7 paths | b7571a08ee07 |
| example-owner/docs | write-starter-request | starter-request | 1 path | b7571a08ee07 |
`;

// ---------------------------------------------------------------------------

describe("launcher-apply-plan plan", () => {
  it("--help prints the usage and exits 0; anything else on the command line is a usage error", async () => {
    const world = makeWorld();
    expect(await run(world, ["--help"])).toBe(0);
    expect(world.out.join("")).toBe(`${PLAN_USAGE}\n`);
    for (const argv of [["--approve"], ["--subject-digest", "sha256:x"], ["extra"], ["--help", "extra"]]) {
      world.err.length = 0;
      expect(await run(world, argv)).toBe(2);
      expect(world.err).toEqual(["launcher-apply-plan plan: usage; nothing was stored"]);
    }
    expect(storedFiles(world)).toEqual([]);
  });

  it(
    "plans two setup repositories, then after both merge two apply repositories, stores, prints the sheet, and repeats byte for byte",
    async () => {
      const world = makeWorld({ plan: pinnedPlan() });
      const before = stateSnapshot(world);

      // The first run: both repositories are new, and a Starter pin changes a lockfile. The dry tree proves it (V6) and the hub's check (V9).
      expect(await run(world)).toBe(0);
      expect(world.err).toEqual([]);
      const first = world.out.join("");
      expect(first).not.toContain("lockfile-not-run");
      expect(first).not.toContain("Checks not satisfied");
      // One dry tree for each repository: the lockfile step, then the provenance check on that same tree.
      const installs = world.spawned.lockfile.filter((request) => !request.args.includes("--version"));
      expect(installs).toHaveLength(2);
      expect(world.spawned.provenance).toHaveLength(2);
      expect(world.spawned.provenance.map((request) => request.args[request.args.indexOf("--cwd") + 1]).sort()).toEqual(installs.map((request) => request.cwd).sort());
      for (const request of installs) expect(existsSync(request.cwd)).toBe(false);
      expect(storedFiles(world)).toHaveLength(3);
      expect(listStoredChangeSets(world.hub).map((set) => set.repository.id).sort()).toEqual([DOCS, SITE]);
      expect(stateSnapshot(world)).toEqual(before);
      expect(first).toBe(FIRST_SHEET);

      // A second run over the same hub and clones is byte-identical, and stores nothing more.
      const stored = storedFiles(world);
      world.out.length = 0;
      expect(await run(world)).toBe(0);
      expect(world.out.join("")).toBe(first);
      expect(storedFiles(world)).toEqual(stored);

      // The sheet asks for exactly the digest of the bundle that was stored.
      const digest = /^Approve subjectDigest: (sha256:[0-9a-f]{64})$/mu.exec(first)![1]!;
      const bundle = readStoredApplyBundle(world.hub, digest)!;
      expect(bundle.mode).toBe("report");
      expect(bundle.plan.committed).toBe(true);
      expect(bundle.engine).toEqual(ENGINE);
      expect(bundle.authorization).toEqual({ planDigest: planDigest(world.plan), expiresAt: "2999-01-01T00:00:00Z" });
      expect(bundle.computedAt).toBe("2026-09-25T00:00:00.000Z");

      // Approve the bundle, materialize each setup set and merge it: both repositories are now apply repositories.
      write(world.hub, "clossys/advisor/plan.json", json(approvedPlan(digest, world.plan)));
      git(world.hub, "add", "clossys/advisor/plan.json");
      git(world.hub, "commit", "-m", "approve");
      const spawn = lockfileStub([]);
      for (const set of listStoredChangeSets(world.hub)) {
        const clone = cloneOf(world, set.repository.id);
        expect(await materializeRepository({ clone, hub: world.hub, set, texts: {}, spawn, now: NOW, runReadiness: READY })).toMatchObject({ exitCode: 0 });
        git(clone, "add", "-A");
        git(clone, "commit", "-m", "setup");
        git(clone, "checkout", "main");
        git(clone, "merge", "--squash", set.branch);
        git(clone, "commit", "-m", "setup (squashed)");
        git(clone, "push", "origin", "main");
      }

      world.out.length = 0;
      const before2 = stateSnapshot(world);
      const code = await run(world);
      const second = world.out.join("");
      expect(world.err).toEqual([]);
      expect(code).toBe(0);
      expect(stateSnapshot(world)).toEqual(before2);
      expect(second).not.toBe(first);
      expect(second).toBe(APPLY_SHEET);
      const applied = readStoredApplyBundle(world.hub, /^Approve subjectDigest: (sha256:[0-9a-f]{64})$/mu.exec(second)![1]!)!;
      expect(applied.repositories.map((entry) => ("phase" in entry ? [entry.id, entry.phase, entry.verdict] : [entry.id, "none", entry.verdict]))).toEqual([
        [SITE, "apply", "satisfied"],
        [DOCS, "apply", "satisfied"],
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  describe("what it reads from the hub", () => {
    it("carries the committed execution authorization into the bundle, and null without one", async () => {
      const withAuthorization = makeWorld();
      expect(await run(withAuthorization)).toBe(0);
      expect(withAuthorization.out.join("")).toContain(`Authorization: plan ${planDigest(withAuthorization.plan)} expires 2999-01-01T00:00:00Z\n`);

      // No blob at all: no authorization, so the planner reports V3 as violated on every repository.
      const without = makeWorld({ assessment: null });
      expect(await run(without)).toBe(1);
      expect(without.err).toEqual([]);
      const sheet = without.out.join("");
      expect(sheet).toContain("Authorization: none\n");
      expect(sheet).toContain("- example-owner/site V3 violated");
      expect(storedFiles(without)).toHaveLength(3);
    }, TEST_TIMEOUT_MS);

    it("reads the authorization from the committed blob, not from a working-tree edit", async () => {
      const world = makeWorld();
      write(world.hub, "clossys/advisor/assessment-input.json", json({ engagement: { executionAuthorization: { planDigest: "sha256:x", expiresAt: 5 } } }));
      expect(await run(world)).toBe(0);
      expect(world.err).toEqual([]);
      expect(world.out.join("")).toContain(`Authorization: plan ${planDigest(world.plan)} `);
    }, TEST_TIMEOUT_MS);

    it("reports whether the plan file it read is the committed one, from the bytes: an uncommitted edit says no", async () => {
      const world = makeWorld();
      expect(await run(world)).toBe(0);
      expect(world.out.join("")).toContain("Plan committed: yes\n");

      // The same plan with a trailing newline added in the working tree only: same digest, not the committed bytes.
      const edited = makeWorld();
      write(edited.hub, "clossys/advisor/plan.json", `${json(edited.plan)}\n`);
      expect(await run(edited)).toBe(0);
      expect(edited.err).toEqual([]);
      const sheet = edited.out.join("");
      expect(sheet).toContain("Plan committed: no\n");
      expect(sheet).not.toContain("Plan committed: yes");
      const digest = /^Approve subjectDigest: (sha256:[0-9a-f]{64})$/mu.exec(sheet)![1]!;
      expect(readStoredApplyBundle(edited.hub, digest)!.plan.committed).toBe(false);
    }, TEST_TIMEOUT_MS);

    it("reads the committed blob only from an attached HEAD: a detached HEAD gives no authorization and an uncommitted plan", async () => {
      const world = makeWorld();
      git(world.hub, "checkout", "--detach");
      expect(await run(world)).toBe(1);
      const sheet = world.out.join("");
      expect(sheet).toContain("Authorization: none\n");
      expect(sheet).toContain("Plan committed: no\n");
    }, TEST_TIMEOUT_MS);

    it("reads the committed blob only when it is a plain file: an executable or a symbolic link gives no authorization", async () => {
      const executable = makeWorld();
      chmodSync(join(executable.hub, "clossys/advisor/assessment-input.json"), 0o755);
      git(executable.hub, "add", "-A");
      git(executable.hub, "commit", "-m", "executable");
      expect(git(executable.hub, "ls-tree", "HEAD", "clossys/advisor/assessment-input.json")).toMatch(/^100755 blob /u);
      expect(await run(executable)).toBe(1);
      expect(executable.out.join("")).toContain("Authorization: none\n");

      const linked = makeWorld();
      rmSync(join(linked.hub, "clossys/advisor/assessment-input.json"));
      symlinkSync("brief.json", join(linked.hub, "clossys/advisor/assessment-input.json"));
      git(linked.hub, "add", "-A");
      git(linked.hub, "commit", "-m", "link");
      expect(git(linked.hub, "ls-tree", "HEAD", "clossys/advisor/assessment-input.json")).toMatch(/^120000 blob /u);
      expect(await run(linked)).toBe(1);
      expect(linked.err).toEqual([]);
      expect(linked.out.join("")).toContain("Authorization: none\n");
    }, TEST_TIMEOUT_MS);

    it("treats a document with no engagement, or no executionAuthorization, as no authorization", async () => {
      for (const assessment of [{}, { engagement: {} }] as Loose[]) {
        const world = makeWorld({ assessment });
        expect(await run(world)).toBe(1);
        expect(world.out.join("")).toContain("Authorization: none\n");
      }
    }, TEST_TIMEOUT_MS);

    it("plans no repository the inventory does not list, and says so", async () => {
      const world = makeWorld({ inventory: [SITE] });
      expect(await run(world)).toBe(2);
      const sheet = world.out.join("");
      expect(sheet).toContain("Skipped:\n- example-owner/docs indeterminate not-in-inventory\n");
      expect(listStoredChangeSets(world.hub).map((set) => set.repository.id)).toEqual([SITE]);
    }, TEST_TIMEOUT_MS);

    it("stores and prints a computed bundle even when a repository is violated, and exits 1", async () => {
      const world = makeWorld();
      write(cloneOf(world, DOCS), "README.md", "# Edited\n");
      const before = stateSnapshot(world);
      expect(await run(world)).toBe(1);
      expect(world.err).toEqual([]);
      expect(world.out.join("")).toContain("- example-owner/docs violated working-tree-dirty\n");
      expect(storedFiles(world).filter((name) => name.startsWith("bundles/"))).toHaveLength(1);
      expect(stateSnapshot(world)).toEqual(before);
    }, TEST_TIMEOUT_MS);
  });

  describe("refusals: a fixed token, nothing stored, hub and clones untouched", () => {
    const cases: readonly { name: string; token: string; options: () => WorldOptions }[] = [
      { name: "an invalid plan", token: "plan-invalid", options: () => ({ planText: json({ schemaVersion: 1 }) }) },
      { name: "a plan that is not JSON", token: "plan-unreadable", options: () => ({ planText: "not json\n" }) },
      { name: "an invalid brief", token: "brief-invalid", options: () => ({ briefText: json({ schemaVersion: 1 }) }) },
      { name: "a missing skill", token: "skill-unreadable", options: () => ({ skills: SKILLS.filter((skill) => skill.role !== "writer") }) },
      { name: "a ranged engine pin", token: "engine-pin-unreadable", options: () => ({ manifest: hubManifest({ advisor: "^0.8.0" }) }) },
      { name: "a ranged Integrator pin", token: "engine-pin-unreadable", options: () => ({ manifest: hubManifest({ integrator: "~0.6.0" }) }) },
      { name: "a hub brief the planner refuses", token: "planner-refused", options: () => ({ brief: { ...HUB_BRIEF, staffedHere: ["strategist"] } }) },
      { name: "an authorization that is not an object", token: "authorization-malformed", options: () => ({ assessment: { engagement: { executionAuthorization: "yes" } } }) },
      { name: "an authorization with no planDigest", token: "authorization-malformed", options: () => ({ assessment: { engagement: { executionAuthorization: { expiresAt: "2999-01-01T00:00:00Z" } } } }) },
      { name: "an authorization with a non-string expiresAt", token: "authorization-malformed", options: () => ({ assessment: { engagement: { executionAuthorization: { planDigest: `sha256:${"0".repeat(64)}`, expiresAt: 5 } } } }) },
      { name: "an assessment that is not JSON", token: "authorization-malformed", options: () => ({ assessment: "not json\n" }) },
    ];
    for (const { name, token, options } of cases) {
      it(`${name} exits 2 with ${token}`, async () => {
        const world = makeWorld(options());
        const before = stateSnapshot(world);
        expect(await run(world)).toBe(2);
        expect(world.err).toEqual([`launcher-apply-plan plan: ${token}; nothing was stored`]);
        expect(world.out).toEqual([]);
        expect(storedFiles(world)).toEqual([]);
        expect(stateSnapshot(world)).toEqual(before);
        expect(existsSync(join(world.hub, APPLY_STATE))).toBe(false);
      }, TEST_TIMEOUT_MS);
    }

    it("a sheet that refuses stores nothing: the sheet is rendered before anything is stored", async () => {
      const world = makeWorld();
      const before = stateSnapshot(world);
      sheetSwitch.refuse = true;
      expect(await run(world)).toBe(2);
      expect(world.err).toEqual(["launcher-apply-plan plan: sheet-refused; nothing was stored"]);
      expect(world.out).toEqual([]);
      expect(storedFiles(world)).toEqual([]);
      expect(existsSync(join(world.hub, APPLY_STATE))).toBe(false);
      expect(stateSnapshot(world)).toEqual(before);
    }, TEST_TIMEOUT_MS);

    it("reads the inventory like every other hub input: a symbolic link, inside the hub or out of it, is refused", async () => {
      for (const target of ["outside", "inside"]) {
        const world = makeWorld();
        const inventory = join(world.hub, "clossys/.state/inventory.json");
        const real = target === "outside" ? join(world.root, "inventory-elsewhere.json") : join(world.hub, "clossys/.state/inventory-real.json");
        writeFileSync(real, readFileSync(inventory));
        rmSync(inventory);
        symlinkSync(real, inventory);
        const before = stateSnapshot(world);
        expect(await run(world)).toBe(2);
        expect(world.err).toEqual(["launcher-apply-plan plan: inventory-unreadable; nothing was stored"]);
        expect(world.out).toEqual([]);
        expect(storedFiles(world)).toEqual([]);
        expect(stateSnapshot(world)).toEqual(before);
      }
    }, TEST_TIMEOUT_MS);

    it("refuses a working directory that is not a hub", async () => {
      const world = makeWorld();
      expect(await planMain([], { ...world.options, cwd: join(world.root, "does-not-exist") })).toBe(2);
      expect(world.err).toHaveLength(1);
      expect(world.err[0]).toMatch(/^launcher-apply-plan plan: [a-z-]+; nothing was stored$/u);
      expect(world.out).toEqual([]);
    });
  });
});
