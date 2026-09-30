import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { branchExists, buildMaterializedFixture, writeSnapshot } from "./apply-step-fixture.js";
import { reseal } from "./admission-fixture.js";
import { statusMain } from "./apply-plan-cli.js";
import type { RepositoryChangeSet } from "./change-set-contract.js";
import { materializeRepository } from "./materialize.js";
import { renderPullRequest } from "./pull-request-body.js";
import { MAX_OPEN_PULL_REQUESTS, createGhPorts, formatStatus, safeReason, statusRepository } from "./status.js";
import type { GhRun, StatusPorts, StatusResult } from "./status.js";

const SITE_ID = "example-owner/site";
const VIEWER = "U_exampleViewer1";
const OTHER = "U_exampleOther2";
const NODE = "R_exampleSite1";
const FORK = "R_exampleFork9";
const LOGIN_SENTINEL = "sentinel-login-4c1f";
const TITLE_SENTINEL = "sentinel-title-9a7e";
const BODY_SENTINEL = "sentinel-body-2b8d";
const REPO_SENTINEL = "example-other/sentinel-4d2c";
const TIMEOUT = 120_000;

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const gitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Example Author",
  GIT_AUTHOR_EMAIL: "author@example.com",
  GIT_COMMITTER_NAME: "Example Author",
  GIT_COMMITTER_EMAIL: "author@example.com",
};
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd, env: gitEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Every file name under the clone's object database: a grown pack or a new loose object shows here. */
function objectFiles(clone: string): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)).map((name) => `${entry.name}/${name}`) : [entry.name]));
  return walk(join(clone, ".git/objects")).sort();
}

/** A materialized clone whose branch holds one commit (the pull request's head), with the clone back on the default branch. */
async function proposedWorld(edit?: (clone: string) => void) {
  const fixture = buildMaterializedFixture(roots);
  const outcome = await materializeRepository({ clone: fixture.clone, hub: fixture.hub, set: fixture.set, texts: fixture.texts, heldChangeSets: [] });
  expect(outcome).toEqual({ exitCode: 0, verdict: "materialized" });
  edit?.(fixture.clone);
  git(fixture.clone, "add", "-A");
  git(fixture.clone, "commit", "-m", "apply");
  const head = git(fixture.clone, "rev-parse", "HEAD");
  git(fixture.clone, "checkout", "main");
  return { ...fixture, head };
}
type World = Awaited<ReturnType<typeof proposedWorld>>;

function bodyOf(world: World, extra = ""): string {
  const rendered = renderPullRequest({ set: world.set, binding: world.binding, taskRecord: 12 });
  if (rendered.state !== "rendered") throw new Error(`refused: ${rendered.reason}`);
  return extra === "" ? rendered.body : `${rendered.body}${extra}\n`;
}

function row(world: World, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 7,
    title: world.set.pullRequest.title,
    body: bodyOf(world),
    author: VIEWER,
    headSha: world.head,
    headRef: world.set.branch,
    headRepo: NODE,
    baseRepo: NODE,
    baseRef: "main",
    login: LOGIN_SENTINEL,
    ...over,
  };
}

interface Calls {
  viewer: number;
  open: string[];
  tip: string[];
}
function fakePorts(rows: unknown, tip: string | Error = "0".repeat(40), viewer: string | Error = VIEWER): { ports: StatusPorts; calls: Calls } {
  const calls: Calls = { viewer: 0, open: [], tip: [] };
  const ports: StatusPorts = {
    viewer: () => {
      calls.viewer += 1;
      if (viewer instanceof Error) throw viewer;
      return viewer;
    },
    openPullRequests: (id) => {
      calls.open.push(id);
      if (rows instanceof Error) throw rows;
      return rows;
    },
    tip: (id, branch) => {
      calls.tip.push(`${id} ${branch}`);
      if (tip instanceof Error) throw tip;
      return tip;
    },
  };
  return { ports, calls };
}

const statusOf = (world: World, ports: StatusPorts, heldChangeSets: readonly RepositoryChangeSet[] = []): Promise<StatusResult> =>
  statusRepository({ clone: world.clone, hub: world.hub, set: world.set, heldChangeSets, ports });

describe("status", () => {
  it(
    "counts only the viewer's same-repository pull request",
    async () => {
      const world = await proposedWorld();
      const proposed = await statusOf(world, fakePorts([row(world)]).ports);
      expect(proposed).toEqual({ exitCode: 0, state: "proposed", pullRequests: [7] });

      for (const over of [{ author: OTHER }, { author: null }, { headRepo: FORK }, { headRepo: null }, { baseRepo: FORK }, { baseRepo: undefined }]) {
        const result = await statusOf(world, fakePorts([row(world, over)]).ports);
        expect(result, JSON.stringify(over)).toEqual({ exitCode: 2, state: "indeterminate", reason: "foreign-marker" });
      }
      // A foreign marker beside a good pull request still refuses: it is never ignored.
      const beside = await statusOf(world, fakePorts([row(world), row(world, { number: 8, author: OTHER })]).ports);
      expect(beside).toMatchObject({ state: "indeterminate", reason: "foreign-marker" });
      // A pull request that does not name the marker at all is not read.
      const unrelated = await statusOf(world, fakePorts([row(world), row(world, { number: 9, author: OTHER, body: "nothing here" })]).ports);
      expect(unrelated).toMatchObject({ state: "proposed", pullRequests: [7] });
      // The marker word in another case is still the marker word.
      const cased = await statusOf(world, fakePorts([row(world, { author: OTHER, body: "Clossys-Change-Set" })]).ports);
      expect(cased).toMatchObject({ state: "indeterminate", reason: "foreign-marker" });
    },
    TIMEOUT,
  );

  it(
    "CRLF or a marker below line 1 is malformed",
    async () => {
      const world = await proposedWorld();
      const body = bodyOf(world);
      const marker = body.split("\n", 1)[0]!;
      const bodies = [
        body.replaceAll("\n", "\r\n"),
        // one carriage return far from the marker: readChangeSetMarker alone still reads the marker
        body.replace("\n\n", "\n\r\n"),
        `intro line\n${body}`,
        `\n${body}`,
        `${body.split("\n").slice(1).join("\n")}\n${marker}\n`,
        `${marker} \n${body.split("\n").slice(1).join("\n")}`,
        "clossys-change-set with no marker line",
      ];
      for (const [index, text] of bodies.entries()) {
        const result = await statusOf(world, fakePorts([row(world, { body: text })]).ports);
        expect(result, `body ${index}`).toEqual({ exitCode: 2, state: "indeterminate", reason: "marker-malformed" });
      }
    },
    TIMEOUT,
  );

  it(
    "an undeclared path or a changed ledger byte is diverged",
    async () => {
      const matching = await proposedWorld();
      expect(await statusOf(matching, fakePorts([row(matching)]).ports)).toEqual({ exitCode: 0, state: "proposed", pullRequests: [7] });

      const undeclared = await proposedWorld((clone) => writeFileSync(join(clone, "README.md"), "# changed\n"));
      expect(await statusOf(undeclared, fakePorts([row(undeclared)]).ports)).toEqual({ exitCode: 1, state: "diverged", reason: "undeclared-path", pullRequests: [7] });

      const extra = await proposedWorld((clone) => writeFileSync(join(clone, "extra-file.txt"), "x\n"));
      expect(await statusOf(extra, fakePorts([row(extra)]).ports)).toMatchObject({ exitCode: 1, state: "diverged", reason: "undeclared-path" });

      const ledger = await proposedWorld((clone) => {
        const path = join(clone, "clossys/.state/installed.json");
        writeFileSync(path, `${readFileSync(path, "utf8")}\n`);
      });
      expect(await statusOf(ledger, fakePorts([row(ledger)]).ports)).toEqual({ exitCode: 1, state: "diverged", reason: "ledger-mismatch", pullRequests: [7] });
    },
    TIMEOUT,
  );

  it(
    "a pull request that is not this set's is diverged",
    async () => {
      const world = await proposedWorld();
      const cases: [Record<string, unknown>, string][] = [
        [{ baseRef: "release" }, "base-branch-mismatch"],
        [{ headRef: "clossys/apply-000000000000" }, "ref-mismatch"],
        [{ title: "Clossys: apply plan 000000000000" }, "title-mismatch"],
        [{ headSha: "a".repeat(40) }, "head-not-local"],
        [{ headSha: "not-a-commit" }, "head-not-local"],
      ];
      for (const [over, reason] of cases) {
        const result = await statusOf(world, fakePorts([row(world, over)]).ports);
        expect(result, reason).toEqual({ exitCode: 1, state: "diverged", reason, pullRequests: [7] });
      }
      // A head that is a commit in the clone but not the set's branch: the base commit itself holds none of the files.
      const base = world.set.repository.baseCommit;
      expect(await statusOf(world, fakePorts([row(world, { headSha: base })]).ports)).toMatchObject({ exitCode: 1, state: "diverged" });
      const malformed = await statusOf(world, fakePorts([row(world, { title: 5 })]).ports);
      expect(malformed).toEqual({ exitCode: 2, state: "indeterminate", reason: "port-malformed", pullRequests: [7] });
    },
    TIMEOUT,
  );

  it(
    "an older stored digest is superseded",
    async () => {
      const world = await proposedWorld();
      const older = reseal({ ...structuredClone(world.set), repository: { ...world.set.repository, baseCommit: "1".repeat(40) } } as never);
      expect(older.changeSetDigest).not.toBe(world.set.changeSetDigest);
      const olderBody = bodyOf(world).replace(world.set.changeSetDigest, older.changeSetDigest);
      const held = [older, world.set];

      const only = await statusOf(world, fakePorts([row(world, { number: 5, body: olderBody })]).ports, held);
      expect(only).toEqual({ exitCode: 2, state: "superseded", pullRequests: [5] });
      expect(formatStatus(only)).toBe("launcher-apply-plan status: superseded #5");

      // Diverged outranks superseded; superseded outranks proposed.
      const withBad = await statusOf(world, fakePorts([row(world, { number: 5, body: olderBody }), row(world, { title: "x" })]).ports, held);
      expect(withBad).toMatchObject({ exitCode: 1, state: "diverged" });
      const withGood = await statusOf(world, fakePorts([row(world, { number: 5, body: olderBody }), row(world)]).ports, held);
      expect(withGood).toEqual({ exitCode: 2, state: "superseded", pullRequests: [5] });

      // A digest this hub never stored is not superseded: it is unknown.
      const unknown = await statusOf(world, fakePorts([row(world, { number: 5, body: olderBody })]).ports, [world.set]);
      expect(unknown).toEqual({ exitCode: 2, state: "indeterminate", reason: "unknown-digest" });
      // A stored digest of another repository is unknown here too.
      const elsewhere = { ...structuredClone(older), repository: { ...older.repository, id: "example-owner/other" } } as RepositoryChangeSet;
      const other = await statusOf(world, fakePorts([row(world, { number: 5, body: olderBody })]).ports, [elsewhere, world.set]);
      expect(other).toMatchObject({ state: "indeterminate", reason: "unknown-digest" });
      // Two pull requests for one digest.
      const twice = await statusOf(world, fakePorts([row(world), row(world, { number: 8 })]).ports, held);
      expect(twice).toEqual({ exitCode: 2, state: "indeterminate", reason: "duplicate-digest" });
    },
    TIMEOUT,
  );

  it(
    "a full page of 100 open pull requests, a failing port or a malformed answer is indeterminate",
    async () => {
      const world = await proposedWorld();
      const plain = (number: number) => ({ number, body: "plain" });
      // 99 rows are a whole listing; 100 may hide the oldest pull request beyond the page, so they are refused.
      const short = await statusOf(world, fakePorts([row(world), ...Array.from({ length: MAX_OPEN_PULL_REQUESTS - 2 }, (_, i) => plain(i + 100))]).ports);
      expect(short).toMatchObject({ state: "proposed" });
      const full = await statusOf(world, fakePorts([row(world), ...Array.from({ length: MAX_OPEN_PULL_REQUESTS - 1 }, (_, i) => plain(i + 100))]).ports);
      expect(full).toEqual({ exitCode: 2, state: "indeterminate", reason: "too-many-open" });
      const over = await statusOf(world, fakePorts([row(world), ...Array.from({ length: MAX_OPEN_PULL_REQUESTS }, (_, i) => plain(i + 100))]).ports);
      expect(over).toEqual({ exitCode: 2, state: "indeterminate", reason: "too-many-open" });

      const cases: [StatusPorts, string][] = [
        [fakePorts(new Error("boom")).ports, "port-failed"],
        [fakePorts([row(world)], "0".repeat(40), new Error("boom")).ports, "port-failed"],
        [fakePorts([row(world)], "0".repeat(40), "not a node id!").ports, "port-malformed"],
        [fakePorts({ rows: [] }).ports, "port-malformed"],
        [fakePorts(["text"]).ports, "port-malformed"],
        [fakePorts([{ number: 1.5, body: "x" }]).ports, "port-malformed"],
        [fakePorts([{ number: 1, body: 4 }]).ports, "port-malformed"],
        [fakePorts([], new Error("boom")).ports, "port-failed"],
        [fakePorts([], "zzz").ports, "port-malformed"],
        [fakePorts([], "b".repeat(40)).ports, "tip-not-local"],
      ];
      for (const [ports, reason] of cases) expect(await statusOf(world, ports), reason).toEqual({ exitCode: 2, state: "indeterminate", reason });
    },
    TIMEOUT,
  );

  it(
    "a squash-merged set is applied",
    async () => {
      const world = await proposedWorld();
      git(world.clone, "merge", "--squash", world.set.branch);
      git(world.clone, "commit", "-m", "squash");
      const tip = git(world.clone, "rev-parse", "HEAD");
      git(world.clone, "push", "origin", "main");
      const { ports, calls } = fakePorts([], tip);
      const result = await statusOf(world, ports);
      expect(result).toEqual({ exitCode: 0, state: "applied" });
      expect(calls.tip).toEqual([`${SITE_ID} main`]);

      // An open pull request of this set that verifies outranks applied, and a mismatching one outranks both.
      expect(await statusOf(world, fakePorts([row(world)], tip).ports)).toEqual({ exitCode: 0, state: "proposed", pullRequests: [7] });
      expect(await statusOf(world, fakePorts([row(world, { title: "x" })], tip).ports)).toMatchObject({ exitCode: 1, state: "diverged" });

      // A branch that is only the branch, with no file of the set on the default tip, is planned.
      const planned = await statusOf(world, fakePorts([], world.set.repository.baseCommit).ports);
      expect(planned).toEqual({ exitCode: 2, state: "planned" });
      // One missing file is planned, not applied.
      git(world.clone, "rm", "-q", "--", ".claude/skills/clossys-writer");
      git(world.clone, "commit", "-m", "remove one link");
      const partial = await statusOf(world, fakePorts([], git(world.clone, "rev-parse", "HEAD")).ports);
      expect(partial).toEqual({ exitCode: 2, state: "planned" });
    },
    TIMEOUT,
  );

  it(
    "echoes nothing, writes nothing",
    async () => {
      const world = await proposedWorld();
      const before = writeSnapshot(world.clone, world.hub);
      const branchBefore = branchExists(world.clone, world.set.branch);
      const out: string[] = [];
      vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => void out.push(args.join(" ")));
      vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void out.push(args.join(" ")));

      const sentinelBody = bodyOf(world, `${BODY_SENTINEL}`);
      const cases: { rows: unknown[]; code: number }[] = [
        { rows: [row(world)], code: 0 },
        { rows: [row(world, { title: TITLE_SENTINEL })], code: 1 },
        { rows: [row(world, { headRef: `${TITLE_SENTINEL}/branch` })], code: 1 },
        { rows: [row(world, { body: `${sentinelBody}\r\n` })], code: 2 },
        { rows: [row(world, { author: LOGIN_SENTINEL })], code: 2 },
        { rows: [row(world, { body: `${BODY_SENTINEL} clossys-change-set` })], code: 2 },
      ];
      for (const { rows, code } of cases) {
        const { ports } = fakePorts(rows);
        expect(await statusMain(["--repo", SITE_ID], { cwd: world.hub, clone: world.clone, set: world.set, heldChangeSets: [], statusPorts: ports })).toBe(code);
      }
      expect(await statusMain(["--repo", REPO_SENTINEL], { cwd: world.hub, clone: world.clone, set: world.set, statusPorts: fakePorts([]).ports })).toBe(2);
      expect(await statusMain(["--repo", REPO_SENTINEL, "--extra"], { cwd: world.hub })).toBe(2);
      expect(await statusMain(["--repo", "a/b/c"], { cwd: world.hub })).toBe(2);
      expect(await statusMain(["--repo", SITE_ID], { cwd: world.hub, clone: world.clone, set: world.set, statusPorts: fakePorts(new Error(`${LOGIN_SENTINEL} ${BODY_SENTINEL}`)).ports })).toBe(2);

      const printed = out.join("\n");
      expect(out.length).toBeGreaterThan(0);
      for (const forbidden of [LOGIN_SENTINEL, TITLE_SENTINEL, BODY_SENTINEL, REPO_SENTINEL, SITE_ID, world.set.branch, world.set.pullRequest.title, world.head, world.hub, world.clone]) {
        expect(printed.includes(forbidden), forbidden).toBe(false);
      }
      // Every line is the fixed shape: a state, at most one fixed reason token, and #<n> for each number.
      for (const line of out) expect(line).toMatch(/^launcher-apply-plan status: (proposed|applied|planned|diverged|superseded|indeterminate)( \([a-z0-9-]+\))?( #[1-9][0-9]*)*$|^launcher-apply-plan status: usage: /u);
      // Nothing moved: hub, index, worktree and every ref.
      expect(writeSnapshot(world.clone, world.hub)).toBe(before);
      expect(branchExists(world.clone, world.set.branch)).toBe(branchBefore);
      expect(git(world.clone, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    },
    TIMEOUT,
  );

  it(
    "never fetches a head or an object a partial clone lacks",
    async () => {
      const world = await proposedWorld();
      // The head exists on the origin only: a blobless clone whose promisor remote would serve it to a lazy fetch.
      git(world.clone, "push", "origin", world.set.branch);
      git(world.origin, "config", "uploadpack.allowFilter", "true");
      git(world.origin, "config", "uploadpack.allowAnySHA1InWant", "true");
      git(world.clone, "config", "core.repositoryformatversion", "1");
      git(world.clone, "config", "extensions.partialClone", "origin");
      git(world.clone, "config", "remote.origin.promisor", "true");
      git(world.clone, "config", "remote.origin.partialclonefilter", "blob:none");
      git(world.clone, "branch", "-D", world.set.branch);
      git(world.clone, "update-ref", "-d", `refs/remotes/origin/${world.set.branch}`);
      git(world.clone, "reflog", "expire", "--expire=now", "--all");
      git(world.clone, "prune", "--expire=now");
      const before = objectFiles(world.clone);
      const snapshot = writeSnapshot(world.clone, world.hub);

      const result = await statusOf(world, fakePorts([row(world)]).ports);
      expect(result).toEqual({ exitCode: 1, state: "diverged", reason: "head-not-local", pullRequests: [7] });
      expect(objectFiles(world.clone)).toEqual(before);
      expect(writeSnapshot(world.clone, world.hub)).toBe(snapshot);
    },
    TIMEOUT,
  );

  it(
    "an object git cannot read is indeterminate, not diverged",
    async () => {
      const world = await proposedWorld();
      expect(await statusOf(world, fakePorts([row(world)]).ports)).toMatchObject({ state: "proposed" });
      // Lose the ledger blob of the head commit from the object database.
      const listed = git(world.clone, "ls-tree", world.head, "--", "clossys/.state/installed.json");
      const oid = /^\d+ blob ([0-9a-f]{40})\t/u.exec(listed)![1]!;
      rmSync(join(world.clone, ".git/objects", oid.slice(0, 2), oid.slice(2)), { force: true });
      const result = await statusOf(world, fakePorts([row(world)]).ports);
      expect(result).toEqual({ exitCode: 2, state: "indeterminate", reason: "object-unreadable", pullRequests: [7] });
    },
    TIMEOUT,
  );

  it(
    "a git call that hangs is indeterminate",
    async () => {
      const world = await proposedWorld();
      const shim = join(tmpdir(), `launcher-status-shim-${process.pid}-${Date.now()}`);
      roots.push(shim);
      mkdirSync(shim, { recursive: true });
      writeFileSync(join(shim, "git"), "#!/bin/sh\nexec sleep 20\n");
      chmodSync(join(shim, "git"), 0o755);
      const path = process.env.PATH;
      process.env.PATH = `${shim}:${path ?? ""}`;
      try {
        const started = Date.now();
        const result = await statusRepository({ clone: world.clone, hub: world.hub, set: world.set, heldChangeSets: [], ports: fakePorts([], "d".repeat(40)).ports, gitTimeoutMs: 300 });
        expect(result).toEqual({ exitCode: 2, state: "indeterminate", reason: "status-failed" });
        expect(Date.now() - started).toBeLessThan(10_000);
      } finally {
        process.env.PATH = path;
      }
    },
    TIMEOUT,
  );

  it(
    "a precondition that fails is indeterminate whatever the pull request says",
    async () => {
      const world = await proposedWorld();
      // The local default branch moves ahead of the remote's: the clone, not the pull request, is out of step.
      writeFileSync(join(world.clone, "unpushed.txt"), "x\n");
      git(world.clone, "add", "unpushed.txt");
      git(world.clone, "commit", "-m", "local only");
      for (const over of [{}, { title: "x" }, { headRef: "clossys/apply-000000000000" }]) {
        const result = await statusOf(world, fakePorts([row(world, over)]).ports);
        expect(result, JSON.stringify(over)).toEqual({ exitCode: 2, state: "indeterminate", reason: "remote-tip-mismatch", pullRequests: [7] });
      }
    },
    TIMEOUT,
  );

  it("prints only fixed tokens and safe numbers", () => {
    expect(safeReason("head-not-local")).toBe("head-not-local");
    for (const hostile of ["Has Space", "UPPER", "a\nb", "a/b", "x".repeat(65), "", undefined, 4, "-lead", "trail-"]) expect(safeReason(hostile)).toBe("refused");
    expect(formatStatus({ state: "diverged", reason: "sentinel/branch name", pullRequests: [3, 1.5, -1, 0, Number.NaN, 2 ** 60] })).toBe("launcher-apply-plan status: diverged (refused) #3");
    expect(formatStatus({ state: "boom" as never })).toBe("launcher-apply-plan status: indeterminate");
    expect(formatStatus({ state: "applied" })).toBe("launcher-apply-plan status: applied");
  });

  it("asks GitHub with read-only calls and nothing else", async () => {
    const calls: string[][] = [];
    const answers: Record<string, string> = {
      "user": "U_exampleViewer1",
      [`repos/${SITE_ID}/pulls?state=open&per_page=100&page=1`]: "[]",
      [`repos/${SITE_ID}/git/ref/heads/main`]: "c".repeat(40),
    };
    const run: GhRun = (args) => {
      calls.push([...args]);
      return { status: 0, stdout: `${answers[args[3]!] ?? "[]"}\n` };
    };
    const ports = createGhPorts(run);
    expect(await ports.viewer()).toBe("U_exampleViewer1");
    expect(await ports.openPullRequests(SITE_ID)).toEqual([]);
    expect(await ports.tip(SITE_ID, "main")).toBe("c".repeat(40));
    expect(calls).toHaveLength(3);
    for (const args of calls) {
      expect(args.slice(0, 3)).toEqual(["api", "--method", "GET"]);
      expect(args).toHaveLength(6);
      expect(args[4]).toBe("--jq");
      for (const flag of ["-f", "-F", "--field", "--raw-field", "--input", "-X", "--method=POST", "PATCH", "PUT", "POST", "DELETE"]) expect(args).not.toContain(flag);
      expect(args[3]).toMatch(/^(user|repos\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/(pulls\?state=open&per_page=100&page=1|git\/ref\/heads\/[A-Za-z0-9._\/-]+))$/u);
    }
    // A repository id or branch that is not a plain name never reaches a path.
    for (const bad of ["../x/y", "a/b/c", "a b/c", "a/b?x=1", "a/..", ""]) expect(() => ports.openPullRequests(bad), bad).toThrow();
    for (const bad of ["../x", "a b", "a?x", "a//b", "a/../b", "", "-x", "a#b"]) expect(() => ports.tip(SITE_ID, bad), bad).toThrow();
    expect(calls).toHaveLength(3);
    // A failing or malformed answer throws; only the first page is ever asked for, however full it is.
    expect(() => createGhPorts(() => ({ status: 1, stdout: "" })).viewer()).toThrow();
    expect(() => createGhPorts(() => ({ status: 0, stdout: "{}" })).openPullRequests(SITE_ID)).toThrow();
    const pages: string[] = [];
    const full = JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ number: i + 1 })));
    const paged = createGhPorts((args) => {
      pages.push(args[3]!);
      return { status: 0, stdout: full };
    });
    expect(((await paged.openPullRequests(SITE_ID)) as unknown[]).length).toBe(100);
    expect(pages).toHaveLength(1);
  });
});
