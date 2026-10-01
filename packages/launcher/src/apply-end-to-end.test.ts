// The whole apply path for a hub with two repositories, against real git: one
// approval covers both setup sets; each repository's setup is materialized,
// verified and squash-merged; the apply sets are admitted under that one
// approval, materialized on their branches, verified, given a pull request body
// and judged by status; and Starter admits each branch. The helpers are copied
// from plan-bundle-setup-flow.test.ts on purpose: a test file exports nothing.
// Every test drives git against temporary repositories, each with a bare
// origin, so each carries its own timeout.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// Starter's own source in this repository, read by this test only: the request
// validator and the admission judge each apply branch must satisfy.
import { admissionExitCode, evaluateAdmission, validateStarterRequest } from "../../starter/src/core.js";
import { approvedPlan, assessmentFor, authorityOf, committedPlanPackages, hubRepo } from "./admission-fixture.js";
import { decideSetBinding } from "./admission.js";
import type { HubAuthority } from "./admission.js";
import { storeApplyBundle } from "./apply-store.js";
import { bodyRepository } from "./body-command.js";
import { LEDGER_PATH } from "./change-set-contract.js";
import type { RepositoryChangeSet } from "./change-set-contract.js";
import { trustInstalledLedger } from "./ledger-trust.js";
import type { LockfileSpawn } from "./lockfile-regen.js";
import { materializeRepository, verifyRepository } from "./materialize.js";
import { defaultOriginId, observeRepository } from "./observe-repository.js";
import { planApplyBundle } from "./plan-bundle.js";
import type { RepositoryObservation } from "./plan-bundle.js";
import {
  STARTER_INTEGRITY,
  STARTER_NAME,
  STARTER_VERSION,
  WRITER_INTEGRITY,
  WRITER_NAME,
  WRITER_VERSION,
  setupInputs,
  setupPlan,
} from "./plan-bundle-setup-fixture.js";
import type { AdvisorPlan } from "./plan-contract.js";
import { readChangeSetMarker } from "./pull-request-body.js";
import { statusRepository } from "./status.js";
import type { StatusPorts } from "./status.js";

type Files = Record<string, string>;

const TEST_TIMEOUT_MS = 180_000;
const NOW = () => new Date("2026-09-25T00:00:00Z");
const READY = () => ({ status: 0 });
const PM_VERSION = "10.9.0";
const DEP_INTEGRITY = `sha512-${Buffer.alloc(64, 3).toString("base64")}`;
const TASK_RECORD = 12;
const VIEWER = "U_exampleViewer1";
const PULL_REQUEST_NUMBER = 7;

interface RepositorySpec {
  readonly id: string;
  readonly nodeId: string;
}

const FIRST: RepositorySpec = { id: "example-owner/site", nodeId: "R_exampleSite1" };
const SECOND: RepositorySpec = { id: "example-owner/docs", nodeId: "R_exampleDocs2" };
const THIRD: RepositorySpec = { id: "example-owner/third", nodeId: "R_exampleThird3" };

const gitEnv: NodeJS.ProcessEnv = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_AUTHOR_NAME: "Example Author",
  GIT_AUTHOR_EMAIL: "author@example.com",
  GIT_COMMITTER_NAME: "Example Author",
  GIT_COMMITTER_EMAIL: "author@example.com",
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd, env: gitEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

const roots: string[] = [];
afterAll(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// the repositories

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (text: string): string => `sha256:${createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex")}`;

const manifestText = (): string => json({ name: "site", private: true, packageManager: `npm@${PM_VERSION}`, devDependencies: { "example-dep": "1.0.0" } });

/** The npm lockfile with the Starter pin and the Writer install each present or not. */
function npmLock(held: { readonly starter: boolean; readonly writer: boolean }): string {
  const tarball = (name: string, file: string, version: string) => `https://registry.npmjs.org/${name}/-/${file}-${version}.tgz`;
  const devDependencies: Record<string, string> = { "example-dep": "1.0.0" };
  const packages: Record<string, unknown> = {
    "node_modules/example-dep": { version: "1.0.0", resolved: tarball("example-dep", "example-dep", "1.0.0"), integrity: DEP_INTEGRITY, dev: true },
  };
  if (held.starter) {
    devDependencies[STARTER_NAME] = STARTER_VERSION;
    packages[`node_modules/${STARTER_NAME}`] = { version: STARTER_VERSION, resolved: tarball(STARTER_NAME, "starter", STARTER_VERSION), integrity: STARTER_INTEGRITY, dev: true };
  }
  if (held.writer) {
    devDependencies[WRITER_NAME] = WRITER_VERSION;
    packages[`node_modules/${WRITER_NAME}`] = { version: WRITER_VERSION, resolved: tarball(WRITER_NAME, "writer", WRITER_VERSION), integrity: WRITER_INTEGRITY, dev: true };
  }
  return json({ name: "site", version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "site", version: "1.0.0", devDependencies }, ...packages } });
}

interface Site {
  readonly spec: RepositorySpec;
  readonly root: string;
  readonly clone: string;
}

function originIdFor(root: string): (url: string) => string | null {
  const prefix = `${join(root, "origin")}${sep}`;
  return (url) => {
    if (!url.startsWith(prefix) || !url.endsWith(".git")) return defaultOriginId(url);
    const parts = url.slice(prefix.length, -".git".length).split("/");
    return parts.length === 2 && parts.every((part) => part.length > 0) ? parts.join("/") : null;
  };
}

function writeTree(dir: string, files: Files): void {
  for (const [path, text] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
}

function makeSite(spec: RepositorySpec): Site {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "apply-end-to-end-")));
  roots.push(root);
  const origin = join(root, "origin", `${spec.id}.git`);
  const clone = join(root, "clone");
  mkdirSync(dirname(origin), { recursive: true });
  mkdirSync(clone);
  git(root, "init", "--bare", "-b", "main", origin);
  git(clone, "init", "-b", "main");
  git(clone, "remote", "add", "origin", origin);
  writeTree(clone, { "README.md": "# Site\n", "package.json": manifestText(), "package-lock.json": npmLock({ starter: false, writer: false }) });
  git(clone, "add", "-A");
  git(clone, "commit", "-m", "initial");
  git(clone, "push", "-u", "origin", "main");
  return { spec, root, clone };
}

async function observe(site: Site, phase: "setup" | "apply"): Promise<RepositoryObservation> {
  const result = await observeRepository({
    id: site.spec.id,
    clone: site.clone,
    ports: { nodeId: () => site.spec.nodeId, visibility: () => "private", originId: originIdFor(site.root) },
  });
  if ("skipped" in result) throw new Error(`the clone was skipped: ${result.skipped}`);
  expect(result.phase).toBe(phase);
  return result;
}

/** Stands in for the package manager: it regenerates the lockfile with what the set installs, and nothing else. */
function spawnFor(writer: boolean): LockfileSpawn {
  return async (request) => {
    if (request.args.includes("--version")) return { status: 0, stdout: "10.9.0\n", stderr: "" };
    writeFileSync(join(request.cwd, "package-lock.json"), npmLock({ starter: true, writer }));
    return { status: 0, stdout: "", stderr: "" };
  };
}

// ---------------------------------------------------------------------------
// the hub: one plan and one approval for every repository in it

interface Repository {
  readonly site: Site;
  readonly setup: RepositoryChangeSet;
}

interface Hub {
  readonly hub: string;
  readonly approved: AdvisorPlan;
  readonly approvedBundle: string;
  readonly plan: AdvisorPlan;
  readonly repositories: readonly Repository[];
}

/** The plans of several repositories as one: the staffing and the packages of each, under one plan. */
function combinedPlan(specs: readonly RepositorySpec[]): AdvisorPlan {
  const plans = specs.map((spec) => setupPlan({ repository: spec.id }));
  return { ...plans[0]!, staffing: plans.flatMap((plan) => plan.staffing ?? []), packages: plans.flatMap((plan) => plan.packages ?? []) } as AdvisorPlan;
}

/** Fresh clones of `specs`, every setup set computed in one bundle, and one hub whose committed plan approves that bundle. */
async function makeHub(specs: readonly RepositorySpec[]): Promise<Hub> {
  const sites = specs.map(makeSite);
  const observations = await Promise.all(sites.map((site) => observe(site, "setup")));
  const plan = combinedPlan(specs);
  const { bundle, changeSets } = planApplyBundle(setupInputs(null, plan, { repositories: observations }));
  const approved = approvedPlan(bundle.bundleDigest, plan);
  const repositories = sites.map((site): Repository => {
    const setup = changeSets.find((set) => set.repository.id === site.spec.id);
    if (setup === undefined) throw new Error(`no setup set was computed for ${site.spec.id}: ${JSON.stringify(bundle.repositories)}`);
    expect(setup.phase).toBe("setup");
    return { site, setup };
  });
  const hub = hubRepo(roots, {
    plans: [approved],
    sets: repositories.map((repository) => repository.setup),
    bundles: [bundle],
    assessment: assessmentFor(approved, {}, specs.map((spec) => spec.id)),
  }).hub;
  return { hub, approved, approvedBundle: bundle.bundleDigest, plan, repositories };
}

/** Materializes and verifies one repository's setup set, then lands it on the default branch as one squashed commit. */
async function landSetup(hub: Hub, repository: Repository) {
  const { clone } = repository.site;
  const common = { clone, hub: hub.hub, set: repository.setup, now: NOW, runReadiness: READY };
  const materialized = await materializeRepository({ ...common, texts: {}, spawn: spawnFor(false), toolVersion: null });
  const verified = await verifyRepository(common);
  git(clone, "add", "-A");
  git(clone, "commit", "-m", "setup");
  git(clone, "checkout", "main");
  git(clone, "merge", "--squash", repository.setup.branch);
  git(clone, "commit", "-m", "setup (squashed)");
  git(clone, "push", "origin", "main");
  return { materialized, verified };
}

interface ApplyWorld {
  readonly bundle: string;
  readonly sets: ReadonlyMap<string, RepositoryChangeSet>;
  readonly observations: ReadonlyMap<string, RepositoryObservation>;
}

/** Observes the merged repositories, computes every apply set in one bundle, and stores that bundle in the hub. */
async function computeApply(hub: Hub): Promise<ApplyWorld> {
  const observations = await Promise.all(hub.repositories.map((repository) => observe(repository.site, "apply")));
  const { bundle, changeSets } = planApplyBundle(
    setupInputs(null, hub.plan, { repositories: observations, heldChangeSets: hub.repositories.map((repository) => repository.setup) }),
  );
  storeApplyBundle(hub.hub, bundle);
  const sets = new Map<string, RepositoryChangeSet>();
  for (const repository of hub.repositories) {
    const apply = changeSets.find((set) => set.repository.id === repository.site.spec.id);
    if (apply === undefined) throw new Error(`no apply set was computed for ${repository.site.spec.id}: ${JSON.stringify(bundle.repositories)}`);
    expect(apply.phase).toBe("apply");
    sets.set(repository.site.spec.id, apply);
  }
  return { bundle: bundle.bundleDigest, sets, observations: new Map(observations.map((observation) => [observation.id, observation])) };
}

/**
 * What `against` decides for an apply set under its plan's one approval. The merged ledger is trusted as `hub`, the hub that
 * approved the repository's setup, left it; `against` is that same hub unless a test asks another hub.
 */
async function decideApply(hub: Hub, repository: Repository, apply: RepositoryChangeSet, observation: RepositoryObservation, against: Hub = hub) {
  const own = authorityOf(hub.approved);
  const trust = trustInstalledLedger(observation.ledger, { id: repository.site.spec.id, nodeId: repository.site.spec.nodeId }, [repository.setup], {
    planPackageActs: [{ planDigest: own.planDigest, packages: committedPlanPackages(hub.approved, repository.site.spec.id) }],
  });
  if (trust.state !== "trusted") throw new Error(`the merged ledger was not trusted: ${trust.rule}`);
  const authority: HubAuthority = authorityOf(against.approved);
  return decideSetBinding({
    hub: against.hub,
    clone: repository.site.clone,
    set: apply,
    authority,
    baseLedger: trust.ledger,
    baseLedgerBytes: observation.ledger,
    now: NOW,
    runReadiness: READY,
  });
}

// ---------------------------------------------------------------------------
// the two-repository run

interface Applied {
  readonly repository: Repository;
  readonly apply: RepositoryChangeSet;
  readonly decided: Awaited<ReturnType<typeof decideApply>>;
  readonly setupMaterialized: Awaited<ReturnType<typeof landSetup>>["materialized"];
  readonly setupVerified: Awaited<ReturnType<typeof landSetup>>["verified"];
  readonly materialized: Awaited<ReturnType<typeof materializeRepository>>;
  readonly verified: Awaited<ReturnType<typeof verifyRepository>>;
  readonly body: Awaited<ReturnType<typeof bodyRepository>>;
  /** The set as the hub stored it once `body` recorded the hash of the body. */
  readonly bound: RepositoryChangeSet;
  /** The commit the apply branch holds, which is the pull request's head. */
  readonly head: string;
  /** What the status command reports for the open pull request carrying exactly that body. */
  readonly status: Awaited<ReturnType<typeof statusRepository>>;
}

interface Run {
  readonly hub: Hub;
  readonly applyBundle: string;
  readonly applied: readonly Applied[];
}

function portsFor(rows: Readonly<Record<string, Record<string, unknown>[]>>): StatusPorts {
  return {
    viewer: () => VIEWER,
    openPullRequests: (id) => rows[id] ?? [],
    tip: () => {
      throw new Error("the tip is not asked for while a pull request is proposed");
    },
  };
}

function pullRequestRow(applied: Pick<Applied, "bound" | "head" | "repository">, body: string): Record<string, unknown> {
  return {
    number: PULL_REQUEST_NUMBER,
    title: applied.bound.pullRequest.title,
    body,
    author: VIEWER,
    headSha: applied.head,
    headRef: applied.bound.branch,
    headRepo: applied.repository.site.spec.nodeId,
    baseRepo: applied.repository.site.spec.nodeId,
    baseRef: "main",
  };
}

async function runTwoRepositories(): Promise<Run> {
  const hub = await makeHub([FIRST, SECOND]);
  const landed = new Map<string, Awaited<ReturnType<typeof landSetup>>>();
  for (const repository of hub.repositories) landed.set(repository.site.spec.id, await landSetup(hub, repository));

  const world = await computeApply(hub);
  const held = hub.repositories.map((repository) => repository.setup);
  const applied: Applied[] = [];
  for (const repository of hub.repositories) {
    const id = repository.site.spec.id;
    const apply = world.sets.get(id)!;
    const decided = await decideApply(hub, repository, apply, world.observations.get(id)!);
    const { clone } = repository.site;
    const common = { clone, hub: hub.hub, set: apply, heldChangeSets: held, now: NOW, runReadiness: READY };
    const materialized = await materializeRepository({ ...common, texts: {}, spawn: spawnFor(true), toolVersion: null });
    const verified = await verifyRepository(common);
    // What the agent does next: commit the branch, and the pull request opens on that commit.
    git(clone, "add", "-A");
    git(clone, "commit", "-m", "apply");
    const head = git(clone, "rev-parse", "HEAD").trim();
    git(clone, "checkout", "main");
    const body = await bodyRepository({ clone, hub: hub.hub, set: apply, heldChangeSets: held, taskRecord: TASK_RECORD, now: NOW, runReadiness: READY });
    if (body.exitCode !== 0) throw new Error(`body was refused for ${id}: ${body.reason}`);
    // The set the hub stored once `body` recorded the hash of exactly the body it printed.
    const bound = JSON.parse(readFileSync(join(hub.hub, "clossys/.state/apply/change-sets", `${apply.changeSetDigest.slice("sha256:".length)}.json`), "utf8")) as RepositoryChangeSet;
    const partial = { repository, bound, head };
    const status = await statusRepository({
      clone,
      hub: hub.hub,
      set: bound,
      heldChangeSets: held,
      now: NOW,
      runReadiness: READY,
      ports: portsFor({ [id]: [pullRequestRow(partial, body.body)] }),
    });
    const setup = landed.get(id)!;
    applied.push({ repository, apply, decided, setupMaterialized: setup.materialized, setupVerified: setup.verified, materialized, verified, body, bound, head, status });
  }
  return { hub, applyBundle: world.bundle, applied };
}

// ---------------------------------------------------------------------------

describe("a hub with two repositories, from setup to a proposed apply pull request", () => {
  let run: Run;
  beforeAll(async () => {
    run = await runTwoRepositories();
  }, TEST_TIMEOUT_MS);

  const bodyText = (applied: Applied): string => {
    if (applied.body.exitCode !== 0) throw new Error("the body was refused");
    return applied.body.body;
  };

  it(
    "two repositories go from setup to a proposed apply pull request",
    () => {
      expect(run.applied.map((applied) => applied.repository.site.spec.id)).toEqual([FIRST.id, SECOND.id]);
      for (const applied of run.applied) {
        const { repository, apply } = applied;
        // Setup: materialized and verified under the one approval, then squash-merged to the remote's default branch.
        expect(applied.setupMaterialized).toMatchObject({ exitCode: 0, verdict: "materialized" });
        expect(applied.setupVerified).toMatchObject({ exitCode: 0, verdict: "materialized" });
        const { clone } = repository.site;
        expect(git(clone, "rev-parse", "main").trim()).toBe(git(clone, "rev-parse", "origin/main").trim());
        expect(git(clone, "show", `main:${LEDGER_PATH}`)).toContain(repository.setup.changeSetDigest);

        // Apply: admitted under that approval, on the branch the set names, verified.
        expect(applied.decided).toEqual({
          state: "bound",
          binding: { kind: "admitted", subjectDigest: run.hub.approvedBundle, setupChangeSet: repository.setup.changeSetDigest },
        });
        expect(apply.branch).toMatch(/^clossys\/apply-[0-9a-f]{12}$/u);
        expect(apply.bundle).toBe(run.applyBundle);
        expect(git(clone, "rev-parse", apply.branch).trim()).toBe(applied.head);
        expect(applied.materialized).toMatchObject({ exitCode: 0, verdict: "materialized" });
        expect(applied.verified).toMatchObject({ exitCode: 0, verdict: "materialized" });

        // The body carries the change-set marker, and the hub recorded the hash of exactly that body.
        expect(applied.body.exitCode).toBe(0);
        const body = bodyText(applied);
        expect(body.startsWith(`<!-- clossys-change-set: ${apply.changeSetDigest} -->\n`)).toBe(true);
        expect(readChangeSetMarker(body)).toBe(apply.changeSetDigest);
        expect(applied.bound.pullRequest.bodySha256).toBe(sha256(body));

        expect(applied.status).toEqual({ exitCode: 0, state: "proposed", pullRequests: [PULL_REQUEST_NUMBER] });
      }
      // One approval, two different pull requests.
      expect(new Set(run.applied.map((applied) => applied.apply.changeSetDigest)).size).toBe(2);
      expect(new Set(run.applied.map((applied) => applied.apply.branch)).size).toBe(2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "Starter admits both apply branches",
    () => {
      for (const applied of run.applied) {
        const { clone } = applied.repository.site;
        const request: unknown = JSON.parse(git(clone, "show", `${applied.apply.branch}:.starter/request.json`));
        const parsed = validateStarterRequest(request);
        expect(parsed.findings).toEqual([]);
        expect(parsed.request).toMatchObject({ schemaVersion: 1, phase: "admission", packageManager: "npm" });

        // The protected base is the merged default branch; its install is what a frozen install of that branch holds.
        const report = evaluateAdmission({
          request,
          baseLedger: Buffer.from(git(clone, "show", `main:${LEDGER_PATH}`), "utf8"),
          headLedger: Buffer.from(git(clone, "show", `${applied.apply.branch}:${LEDGER_PATH}`), "utf8"),
          install: { manifest: JSON.parse(git(clone, "show", "main:package.json")), lock: JSON.parse(git(clone, "show", "main:package-lock.json")) },
        });
        expect(report.findings).toEqual([]);
        expect(admissionExitCode(report)).toBe(0);
        // The head ledger is the next generation: the Writer the plan installed is a package row there, and only deferred in the base.
        const installed = (ref: string): string[] => (JSON.parse(git(clone, "show", `${ref}:${LEDGER_PATH}`)) as { packages: { name: string }[] }).packages.map((row) => row.name);
        expect(installed("main")).toEqual([STARTER_NAME]);
        expect(installed(applied.apply.branch)).toEqual([STARTER_NAME, WRITER_NAME]);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "an edited body is not proposed",
    async () => {
      const [first, second] = run.applied as [Applied, Applied];
      const edited = `${bodyText(first)}One line appended by hand.\n`;
      const ports = portsFor({
        [first.repository.site.spec.id]: [pullRequestRow(first, edited)],
        [second.repository.site.spec.id]: [pullRequestRow(second, bodyText(second))],
      });
      const judged = (applied: Applied) =>
        statusRepository({
          clone: applied.repository.site.clone,
          hub: run.hub.hub,
          set: applied.bound,
          heldChangeSets: run.hub.repositories.map((repository) => repository.setup),
          now: NOW,
          runReadiness: READY,
          ports,
        });
      expect(await judged(first)).toEqual({ exitCode: 1, state: "diverged", reason: "body-mismatch", pullRequests: [PULL_REQUEST_NUMBER] });
      expect(await judged(second)).toEqual({ exitCode: 0, state: "proposed", pullRequests: [PULL_REQUEST_NUMBER] });
    },
    TEST_TIMEOUT_MS,
  );
});

describe("a repository outside the approved bundle", () => {
  it(
    "is refused, and materialize changes nothing in its clone",
    async () => {
      const approved = await makeHub([FIRST, SECOND]);
      // The third repository is approved by a hub of its own, merged, and given its own apply set: a real set, but not this hub's approval.
      const outside = await makeHub([THIRD]);
      const repository = outside.repositories[0]!;
      await landSetup(outside, repository);
      const world = await computeApply(outside);
      const apply = world.sets.get(THIRD.id)!;

      // Control: the hub that approved it admits it, so the refusal below is about the approval and not about the set.
      expect(await decideApply(outside, repository, apply, world.observations.get(THIRD.id)!)).toMatchObject({ state: "bound", binding: { kind: "admitted" } });

      const { clone } = repository.site;
      const snapshot = () => [git(clone, "status", "--porcelain", "--untracked-files=all"), git(clone, "branch", "--list", "--format=%(refname) %(objectname)"), git(clone, "rev-parse", "HEAD")];
      const before = snapshot();
      // Admission itself says no: the ledger is trusted as its own hub left it, and the approved hub's bundle does not hold the repository.
      const decided = await decideApply(outside, repository, apply, world.observations.get(THIRD.id)!, approved);
      expect(decided).toMatchObject({ state: "refused", reason: "awaiting-approval" });
      const held = [repository.setup];
      const result = await materializeRepository({ clone, hub: approved.hub, set: apply, texts: {}, heldChangeSets: held, spawn: spawnFor(true), toolVersion: null, now: NOW, runReadiness: READY });
      expect(result.exitCode).not.toBe(0);
      expect(result.verdict).not.toBe("materialized");
      expect(snapshot()).toEqual(before);
      expect(() => git(clone, "show-ref", "--verify", "--quiet", `refs/heads/${apply.branch}`)).toThrow();
    },
    TEST_TIMEOUT_MS,
  );
});
