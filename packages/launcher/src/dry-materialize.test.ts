// Dry materialization (issue #1699, V6 and V9 of issue #1178): a real git clone, a real temporary tree, and the two
// process spawns replaced by recorders. Nothing here reaches the network or needs the package manager or Integrator.
// Every test that drives git carries its own timeout.

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { reseal } from "./admission-fixture.js";
import type { Loose } from "./admission-fixture.js";
import type { ApplyCheck, RepositoryChangeSet } from "./change-set-contract.js";
import { DRY_TREE_FAILED, LOCKFILE_NOT_REGENERATED, dryMaterialize, treeIsSafe, writeBaseTree } from "./dry-materialize.js";
import type { DryMaterializePorts } from "./dry-materialize.js";
import type { LockfileSpawn, LockfileSpawnRequest, LockfileSpawnResult } from "./lockfile-regen.js";
import { readCommittedFiles } from "./observe-repository.js";
import { planApplyBundle } from "./plan-bundle.js";
import { NPM_LOCK_TEXT, SITE_ID, STARTER_INTEGRITY, STARTER_NAME, STARTER_VERSION, setupInputs, setupObservation, setupPlan, sha } from "./plan-bundle-setup-fixture.js";
import { PROVENANCE_CHECK_BIN } from "./provenance-gate.js";
import { PACKAGE_SCOPE } from "./generated/package-scope.generated.js";

const TEST_TIMEOUT_MS = 120_000;
const NOW = () => new Date("2026-09-25T00:00:00Z");
const STDERR_SENTINEL = "sentinel-stderr-4f9a2c";
const FILE_SENTINEL = "sentinel-file-name-7d1e5b";
const REASON_SENTINEL = "sentinel-reason-93b0aa";

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
  return execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd, env: gitEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const OS_TEMP = realpathSync(tmpdir());
const scratch = mkdtempSync(join(OS_TEMP, "dry-materialize-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let counter = 0;
const nextDir = (name: string): string => {
  counter += 1;
  const directory = join(scratch, `${name}-${counter}`);
  mkdirSync(directory, { recursive: true });
  return directory;
};

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const MANIFEST = json({ name: "site", private: true, packageManager: "npm@10.9.0" });

/** The lockfile npm would write once Starter is pinned in the manifest. */
const LOCK_WITH_STARTER = json({
  name: "site",
  version: "1.0.0",
  lockfileVersion: 3,
  requires: true,
  packages: {
    "": { name: "site", version: "1.0.0", devDependencies: { [STARTER_NAME]: STARTER_VERSION } },
    [`node_modules/${STARTER_NAME}`]: {
      version: STARTER_VERSION,
      resolved: `https://registry.npmjs.org/${STARTER_NAME}/-/starter-${STARTER_VERSION}.tgz`,
      integrity: STARTER_INTEGRITY,
      dev: true,
    },
  },
});

// ---------------------------------------------------------------------------
// the world: a clone, its set, a hub with the bin, and recorders

interface Repo {
  readonly clone: string;
  readonly head: string;
}

/** A clone with one commit holding a manifest and a lockfile, plus `extra` files; `mutate` may add more commits' worth of index changes. */
function makeRepo(extra: Readonly<Record<string, string>> = {}, mutate?: (clone: string) => void): Repo {
  const clone = nextDir("clone");
  git(clone, "init", "-b", "main");
  const files: Record<string, string> = { "README.md": "# Example\n", "package.json": MANIFEST, "package-lock.json": NPM_LOCK_TEXT, ...extra };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(clone, path)), { recursive: true });
    writeFileSync(join(clone, path), text);
  }
  git(clone, "add", "-A");
  mutate?.(clone);
  git(clone, "commit", "-m", "initial");
  return { clone, head: git(clone, "rev-parse", "HEAD") };
}

/** The set the planner makes for the setup phase of a repository that pins Starter only: it changes the manifest and the lockfile. */
function setFor(head: string, patch: Loose = {}): RepositoryChangeSet {
  const observation = setupObservation({ baseCommit: head, files: [{ path: "package-lock.json", sha256: sha(NPM_LOCK_TEXT) }, { path: "package.json", sha256: sha(MANIFEST) }], ...patch });
  const { changeSets } = planApplyBundle(setupInputs(observation, setupPlan({ withoutInstall: true })));
  expect(changeSets).toHaveLength(1);
  return changeSets[0]!;
}

interface Hub {
  readonly hub: string;
  readonly integrator: string;
}

/** A hub with Integrator installed the way npm lays it out: a stub file and a relative `.bin` symlink. */
function makeHub(): Hub {
  const hub = nextDir("hub");
  const integrator = join(hub, "node_modules", "@clossys", "integrator");
  const stub = join(integrator, "dist", "provenance-check-cli.js");
  const bin = join(hub, "node_modules", ".bin", PROVENANCE_CHECK_BIN);
  mkdirSync(dirname(stub), { recursive: true });
  mkdirSync(dirname(bin), { recursive: true });
  writeFileSync(stub, "#!/usr/bin/env node\n", { mode: 0o755 });
  symlinkSync("../@clossys/integrator/dist/provenance-check-cli.js", bin);
  return { hub: realpathSync(hub), integrator };
}

const verifiedReport = (name = STARTER_NAME, version = STARTER_VERSION) =>
  json({ state: "verified", registryBaseUrl: PACKAGE_SCOPE.registry, packages: [{ name, installedVersion: version, latestVersion: version, currencyDistance: "current", state: "verified", reasons: [] }] });
const violatedReport = (reason: string) =>
  json({ state: "violated", registryBaseUrl: PACKAGE_SCOPE.registry, packages: [{ name: STARTER_NAME, installedVersion: STARTER_VERSION, state: "violated", reasons: [reason] }] });

interface Recorder {
  readonly calls: LockfileSpawnRequest[];
  readonly spawn: LockfileSpawn;
}
function recorder(answer: (request: LockfileSpawnRequest) => LockfileSpawnResult | Promise<LockfileSpawnResult>): Recorder {
  const calls: LockfileSpawnRequest[] = [];
  return {
    calls,
    spawn: async (request) => {
      calls.push(request);
      return answer(request);
    },
  };
}

/** The package manager: answers the version probe, then writes the lockfile the way npm would in the directory it is given. */
const npm = (after: (request: LockfileSpawnRequest) => void = (request) => writeFileSync(join(request.cwd, "package-lock.json"), LOCK_WITH_STARTER)): Recorder =>
  recorder((request) => {
    if (request.args.includes("--version")) return { status: 0, stdout: "10.9.0\n", stderr: "" };
    after(request);
    return { status: 0, stdout: "", stderr: "" };
  });
const engine = (stdout: string = verifiedReport(), status = 0): Recorder => recorder(() => ({ status, stdout, stderr: "" }));
const installCalls = (recorded: Recorder): LockfileSpawnRequest[] => recorded.calls.filter((request) => !request.args.includes("--version"));

interface Run {
  readonly checks: readonly ApplyCheck[] | null;
  readonly npm: Recorder;
  readonly engine: Recorder;
  readonly temp: string;
}
async function dry(repo: Repo, hub: Hub, set: RepositoryChangeSet, ports: { npm?: Recorder; engine?: Recorder; tempRoot?: string } = {}): Promise<Run> {
  const npmRecorder = ports.npm ?? npm();
  const engineRecorder = ports.engine ?? engine();
  const temp = ports.tempRoot ?? nextDir("temp");
  const checks = await dryMaterialize({ clone: repo.clone, hubRoot: hub.hub, set, now: NOW }, { lockfileSpawn: npmRecorder.spawn, provenanceSpawn: engineRecorder.spawn, tempRoot: temp } satisfies DryMaterializePorts);
  return { checks, npm: npmRecorder, engine: engineRecorder, temp };
}

const verdicts = (checks: readonly ApplyCheck[] | null): [string, string, string?][] => (checks ?? []).map((check) => (check.rule === undefined ? [check.check, check.verdict] : [check.check, check.verdict, check.rule]));

/** Everything in a clone that a read-only operation must leave as it was. */
function picture(clone: string): Record<string, unknown> {
  const walk = (directory: string, skipGit: boolean, base = directory): Record<string, string> => {
    const seen: Record<string, string> = {};
    for (const name of readdirSync(directory).sort()) {
      if (skipGit && name === ".git") continue;
      const full = join(directory, name);
      const rel = full.slice(base.length + 1);
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) seen[rel] = `link:${readlinkSync(full)}`;
      else if (stat.isDirectory()) Object.assign(seen, walk(full, false, base));
      else seen[rel] = skipGit ? readFileSync(full).toString("base64") : `mtime:${stat.mtimeMs}:size:${stat.size}`;
    }
    return seen;
  };
  return {
    tree: walk(clone, true),
    gitPaths: Object.keys(walk(join(clone, ".git"), false)),
    gitFiles: walk(join(clone, ".git"), false),
    refs: git(clone, "for-each-ref", "--format=%(refname) %(objectname)"),
    worktrees: git(clone, "worktree", "list", "--porcelain"),
    head: git(clone, "rev-parse", "HEAD"),
  };
}


interface TreeEntry {
  readonly mode: "100644" | "100755" | "120000";
  readonly content: string;
}

/**
 * A commit on top of `repo` whose tree is the base's files plus `extra`, built with `git mktree` so that a path a case-folding
 * disk could not hold (two spellings of one name, a link beside a directory) is committed all the same.
 */
function commitWith(repo: Repo, extra: Readonly<Record<string, TreeEntry>>): string {
  const entries = new Map<string, { mode: string; sha: string }>();
  for (const line of git(repo.clone, "ls-tree", "-r", repo.head).split("\n")) {
    const match = /^(\d+) blob ([0-9a-f]+)\t(.+)$/u.exec(line)!;
    entries.set(match[3]!, { mode: match[1]!, sha: match[2]! });
  }
  for (const [path, entry] of Object.entries(extra)) {
    const sha = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: repo.clone, env: gitEnv, input: entry.content, encoding: "utf8" }).trim();
    entries.set(path, { mode: entry.mode, sha });
  }
  const build = (prefix: string): string => {
    const lines: string[] = [];
    const directories = new Set<string>();
    for (const [path, entry] of entries) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash === -1) lines.push(`${entry.mode} blob ${entry.sha}\t${rest}`);
      else directories.add(rest.slice(0, slash));
    }
    for (const name of directories) lines.push(`040000 tree ${build(`${prefix}${name}/`)}\t${name}`);
    return execFileSync("git", ["mktree"], { cwd: repo.clone, env: gitEnv, input: `${lines.join("\n")}\n`, encoding: "utf8" }).trim();
  };
  return git(repo.clone, "commit-tree", build(""), "-p", repo.head, "-m", "extra entries");
}

/** Every path under `directory`, links and directories included, relative to it. */
function everything(directory: string, base = directory): string[] {
  return readdirSync(directory).sort().flatMap((name) => {
    const full = join(directory, name);
    const rest = full.slice(base.length + 1);
    return lstatSync(full).isDirectory() ? [rest, ...everything(full, base)] : [rest];
  });
}

// ---------------------------------------------------------------------------

describe("dry materialization", () => {
  it(
    "pin-starter set runs lockfile and V9 in one temp tree, then removes it",
    async () => {
      const repo = makeRepo();
      const hub = makeHub();
      const set = setFor(repo.head);

      // The real operating-system temporary directory, as it is used when no port says otherwise.
      const provenanceTrees: string[] = [];
      const engineSeeing = recorder((request) => {
        const tree = request.args[request.args.indexOf("--cwd") + 1]!;
        // The tree the engine is given already holds the set's manifest and the regenerated lockfile, and the committed files.
        expect(JSON.parse(readFileSync(join(tree, "package.json"), "utf8")).devDependencies).toEqual({ [STARTER_NAME]: STARTER_VERSION });
        expect(readFileSync(join(tree, "package-lock.json"), "utf8")).toBe(LOCK_WITH_STARTER);
        expect(readFileSync(join(tree, "README.md"), "utf8")).toBe("# Example\n");
        provenanceTrees.push(tree);
        return { status: 0, stdout: verifiedReport(), stderr: "" };
      });
      const packageManager = npm();
      const checks = await dryMaterialize({ clone: repo.clone, hubRoot: hub.hub, set, now: NOW }, { lockfileSpawn: packageManager.spawn, provenanceSpawn: engineSeeing.spawn });

      expect(verdicts(checks)).toEqual([
        ["V6", "satisfied"],
        ["V9", "satisfied"],
      ]);
      const installs = installCalls(packageManager);
      expect(installs).toHaveLength(1);
      expect(engineSeeing.calls).toHaveLength(1);
      const engineTree = engineSeeing.calls[0]!.args[engineSeeing.calls[0]!.args.indexOf("--cwd") + 1]!;
      // One tree: the package manager ran in the directory the engine was pointed at, under the real temporary directory.
      expect(installs[0]!.cwd).toBe(engineTree);
      expect(provenanceTrees).toEqual([engineTree]);
      expect(engineTree.startsWith(`${OS_TEMP}${sep}`)).toBe(true);
      expect(engineTree.startsWith(`${repo.clone}${sep}`)).toBe(false);
      expect(engineTree).not.toBe(repo.clone);
      // It is gone once the call returns, and so is its parent's entry.
      expect(existsSync(engineTree)).toBe(false);

      // The same, in a temporary root of the test's own, which then holds nothing.
      const run = await dry(repo, hub, set);
      expect(verdicts(run.checks)).toEqual([
        ["V6", "satisfied"],
        ["V9", "satisfied"],
      ]);
      const inTemp = installCalls(run.npm)[0]!.cwd;
      expect(dirname(inTemp)).toBe(run.temp);
      expect(inTemp).toBe(run.engine.calls[0]!.args[run.engine.calls[0]!.args.indexOf("--cwd") + 1]);
      expect(existsSync(inTemp)).toBe(false);
      expect(readdirSync(run.temp)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "clone is untouched",
    async () => {
      const repo = makeRepo({ "docs/notes.md": "notes\n" });
      const hub = makeHub();
      const set = setFor(repo.head);
      const before = picture(repo.clone);
      const run = await dry(repo, hub, set);
      expect(verdicts(run.checks)).toEqual([
        ["V6", "satisfied"],
        ["V9", "satisfied"],
      ]);
      expect(picture(repo.clone)).toEqual(before);
      expect(git(repo.clone, "status", "--porcelain")).toBe("");

      // A tree that fails part-way leaves it as it was too.
      const failing = await dry(repo, hub, set, { npm: recorder(() => ({ status: 1, stdout: "", stderr: STDERR_SENTINEL })) });
      expect(failing.checks![0]!.verdict).not.toBe("satisfied");
      expect(picture(repo.clone)).toEqual(before);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a tool writing package.json gives V6 violated, no engine run",
    async () => {
      const repo = makeRepo();
      const hub = makeHub();
      const set = setFor(repo.head);
      const tampering = npm((request) => {
        writeFileSync(join(request.cwd, "package.json"), json({ name: "site", private: true, scripts: { postinstall: "example" } }));
        writeFileSync(join(request.cwd, "package-lock.json"), LOCK_WITH_STARTER);
      });
      const run = await dry(repo, hub, set, { npm: tampering });
      expect(verdicts(run.checks)).toEqual([
        ["V6", "violated", "tree-changed-outside-lockfile"],
        ["V9", "indeterminate", LOCKFILE_NOT_REGENERATED],
      ]);
      expect(run.engine.calls).toHaveLength(0);
      expect(readdirSync(run.temp)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a lockfile that does not carry the pinned package is violated and launches no engine",
    async () => {
      const repo = makeRepo();
      const hub = makeHub();
      const unchanged = npm((request) => writeFileSync(join(request.cwd, "package-lock.json"), NPM_LOCK_TEXT));
      const run = await dry(repo, hub, setFor(repo.head), { npm: unchanged });
      expect(run.checks![0]).toEqual({ check: "V6", verdict: "violated", rule: "lockfile-invariants" });
      expect(run.checks![1]).toEqual({ check: "V9", verdict: "indeterminate", rule: LOCKFILE_NOT_REGENERATED });
      expect(run.engine.calls).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a set whose bytes no longer match its digest is V6 indeterminate change-set-invalid, and nothing is launched",
    async () => {
      const repo = makeRepo();
      const hub = makeHub();
      // The contract ties every text to the digest of the bytes the set names, so the set is refused before a tree is built.
      const set = structuredClone(setFor(repo.head)) as unknown as Loose;
      const row = set.texts[0];
      row.text = `${row.text} `;
      for (const tampered of [set as RepositoryChangeSet, reseal(structuredClone(set))]) {
        const run = await dry(repo, hub, tampered);
        expect(verdicts(run.checks)).toEqual([
          ["V6", "indeterminate", "change-set-invalid"],
          ["V9", "indeterminate", LOCKFILE_NOT_REGENERATED],
        ]);
        expect(run.npm.calls).toHaveLength(0);
        expect(run.engine.calls).toHaveLength(0);
        expect(readdirSync(run.temp)).toEqual([]);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a file the set says is new that the base already has is V6 violated base-mismatch, and nothing is launched",
    async () => {
      const repo = makeRepo({ "clossys/brief.json": "{}\n" });
      const hub = makeHub();
      const run = await dry(repo, hub, setFor(repo.head));
      expect(verdicts(run.checks)).toEqual([
        ["V6", "violated", "base-mismatch"],
        ["V9", "indeterminate", LOCKFILE_NOT_REGENERATED],
      ]);
      expect(run.npm.calls).toHaveLength(0);
      expect(run.engine.calls).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );

  describe("a committed tree that could reach outside the temporary directory launches nothing", () => {
    const escaping: [string, string, (clone: string) => void][] = [
      [
        "a submodule",
        "submodule-present",
        (clone) => git(clone, "update-index", "--add", "--cacheinfo", `160000,${"1".repeat(40)},vendor/sub`),
      ],
      [
        "a link that leaves the tree",
        "tree-unsafe",
        (clone) => {
          symlinkSync("../../outside", join(clone, "docs-link"));
          git(clone, "add", "docs-link");
        },
      ],
      [
        "an absolute link",
        "tree-unsafe",
        (clone) => {
          symlinkSync("/etc", join(clone, "abs-link"));
          git(clone, "add", "abs-link");
        },
      ],
      [
        "a link through a dot-dot segment after a name",
        "tree-unsafe",
        (clone) => {
          mkdirSync(join(clone, "docs"));
          symlinkSync("docs/../../outside", join(clone, "docs", "deep-link"));
          git(clone, "add", "docs/deep-link");
        },
      ],
    ];
    it.each(escaping)(
      "%s",
      async (_name, rule, mutate) => {
        const repo = makeRepo({}, mutate);
        const hub = makeHub();
        const run = await dry(repo, hub, setFor(repo.head));
        expect(run.checks![0]).toEqual({ check: "V6", verdict: "indeterminate", rule });
        expect(run.checks![1]).toEqual({ check: "V9", verdict: "indeterminate", rule: LOCKFILE_NOT_REGENERATED });
        expect(run.npm.calls).toHaveLength(0);
        expect(run.engine.calls).toHaveLength(0);
        expect(readdirSync(run.temp)).toEqual([]);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "a `.git` entry in a committed tree",
      async () => {
        const repo = makeRepo();
        // git add refuses the name, so the commit is built from a tree object: the entry is a regular file called .git.
        const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: repo.clone, env: gitEnv, input: "gitdir: ../elsewhere\n", encoding: "utf8" }).trim();
        const listing = git(repo.clone, "ls-tree", "HEAD");
        const tree = execFileSync("git", ["mktree"], { cwd: repo.clone, env: gitEnv, input: `${listing}\n100644 blob ${blob}\t.git\n`, encoding: "utf8" }).trim();
        const commit = git(repo.clone, "commit-tree", tree, "-p", repo.head, "-m", "dot-git entry");
        const hub = makeHub();
        const run = await dry(repo, hub, setFor(commit));
        expect(run.checks![0]).toEqual({ check: "V6", verdict: "indeterminate", rule: "tree-unsafe" });
        expect(run.npm.calls).toHaveLength(0);
        expect(run.engine.calls).toHaveLength(0);
        expect(readdirSync(run.temp)).toEqual([]);
      },
      TEST_TIMEOUT_MS,
    );
  });

  describe("a link that a folding filesystem would read as a parent directory of a later entry", () => {
    const link = (content: string): TreeEntry => ({ mode: "120000", content });
    const file = (content: string): TreeEntry => ({ mode: "100644", content });
    const aliased: [string, Record<string, TreeEntry>][] = [
      ["case aliases chained upward to reach any ancestor", { "x/Y": link(".."), "x/y/L": link("../.."), "x/y/l/PWNED": file("owned\n") }],
      ["a link whose case variant is the parent of a link that leads out", { "a/L": link(".."), "a/l/M": link("../../outside"), "m/pwned.sh": file("payload\n") }],
      ["the same name spelled composed and decomposed", { "d/caf\u00e9": link(".."), "d/cafe\u0301/N": file("owned\n") }],
    ];

    it.each(aliased)(
      "%s is refused before anything is written, and nothing appears outside the temporary directory",
      async (_name, extra) => {
        const repo = makeRepo();
        const commit = commitWith(repo, extra);
        const committed = readCommittedFiles(repo.clone, commit);
        expect(committed.ok).toBe(true);
        // The decision is about the tree's names alone, so it holds on a filesystem that keeps the spellings apart too.
        expect(treeIsSafe(committed.ok ? committed.files : [])).toBe(false);

        const outer = nextDir("outer");
        const tempRoot = join(outer, "a", "b");
        mkdirSync(tempRoot, { recursive: true });
        const hub = makeHub();
        const run = await dry(repo, hub, setFor(commit), { tempRoot });
        expect(run.checks![0]).toEqual({ check: "V6", verdict: "indeterminate", rule: "tree-unsafe" });
        expect(run.checks![1]).toEqual({ check: "V9", verdict: "indeterminate", rule: LOCKFILE_NOT_REGENERATED });
        expect(run.npm.calls).toHaveLength(0);
        expect(run.engine.calls).toHaveLength(0);
        expect(readdirSync(tempRoot)).toEqual([]);
        expect(everything(outer)).toEqual(["a", "a/b"]);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "a tree that repeats a name only as directories, or names a file beside a longer name, is still safe",
      () => {
        const repo = makeRepo({ "docs/Guide.md": "a\n", "docs/guide/intro.md": "b\n", "docs/guide.txt": "c\n" });
        const committed = readCommittedFiles(repo.clone, repo.head);
        expect(committed.ok && treeIsSafe(committed.files)).toBe(true);
      },
      TEST_TIMEOUT_MS,
    );

    it.each(aliased)(
      "the writer itself refuses %s rather than write through a link",
      (_name, extra) => {
        const repo = makeRepo();
        const committed = readCommittedFiles(repo.clone, commitWith(repo, extra));
        expect(committed.ok).toBe(true);
        // Deep enough that every level a chain of links could climb is still inside `outer`, which is searched afterwards.
        const outer = nextDir("outer");
        const inner = join(outer, "one", "two", "three");
        mkdirSync(inner, { recursive: true });
        const outside = (kept: readonly string[]): string[] => everything(outer).filter((path) => !["one", "one/two", "one/two/three"].includes(path) && !kept.some((name) => path === `one/two/three/${name}` || path.startsWith(`one/two/three/${name}/`)));
        const root = join(inner, "root");
        mkdirSync(root);
        // Whether or not this disk folds the spellings, the writer either finishes inside the root or throws, and the throw comes
        // before any write that would land outside it.
        try {
          writeBaseTree(root, committed.ok ? committed.files : []);
        } catch {
          // refused
        }
        expect(outside(["root"])).toEqual([]);
        const probe = nextDir("probe");
        writeFileSync(join(probe, "a"), "");
        if (existsSync(join(probe, "A"))) {
          const again = join(inner, "again");
          mkdirSync(again);
          expect(() => writeBaseTree(again, committed.ok ? committed.files : [])).toThrow();
          expect(outside(["root", "again"])).toEqual([]);
        }
      },
      TEST_TIMEOUT_MS,
    );

    it.each([
      ["a `.git` segment", "../.git/config"],
      ["a control character", "a\u0001b"],
    ])(
      "a link target with %s is refused and launches nothing",
      async (_name, target) => {
        const repo = makeRepo();
        const commit = commitWith(repo, { "docs/entry": link(target) });
        const committed = readCommittedFiles(repo.clone, commit);
        expect(committed.ok && treeIsSafe(committed.files)).toBe(false);
        const run = await dry(repo, makeHub(), setFor(commit));
        expect(run.checks![0]).toEqual({ check: "V6", verdict: "indeterminate", rule: "tree-unsafe" });
        expect(run.npm.calls).toHaveLength(0);
        expect(run.engine.calls).toHaveLength(0);
        expect(readdirSync(run.temp)).toEqual([]);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "a tree with more files than the cap is V6 indeterminate tree-too-large and launches nothing",
      async () => {
        const repo = makeRepo();
        const empty = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: repo.clone, env: gitEnv, input: "", encoding: "utf8" }).trim();
        const lines = [git(repo.clone, "ls-tree", "HEAD")];
        for (let index = 0; index <= 20_000; index += 1) lines.push(`100644 blob ${empty}\tfiller-${index}`);
        const tree = execFileSync("git", ["mktree"], { cwd: repo.clone, env: gitEnv, input: `${lines.join("\n")}\n`, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
        const commit = git(repo.clone, "commit-tree", tree, "-p", repo.head, "-m", "many files");
        const run = await dry(repo, makeHub(), setFor(commit));
        expect(run.checks![0]).toEqual({ check: "V6", verdict: "indeterminate", rule: "tree-too-large" });
        expect(run.checks![1]).toEqual({ check: "V9", verdict: "indeterminate", rule: LOCKFILE_NOT_REGENERATED });
        expect(run.npm.calls).toHaveLength(0);
        expect(run.engine.calls).toHaveLength(0);
        expect(readdirSync(run.temp)).toEqual([]);
      },
      TEST_TIMEOUT_MS,
    );
  });

  it(
    "a lockfile step that is indeterminate never reaches the provenance check",
    async () => {
      const repo = makeRepo();
      const hub = makeHub();
      const failing = await dry(repo, hub, setFor(repo.head), { npm: recorder((request) => (request.args.includes("--version") ? { status: 0, stdout: "10.9.0\n", stderr: "" } : { status: 1, stdout: "", stderr: STDERR_SENTINEL })) });
      expect(verdicts(failing.checks)).toEqual([
        ["V6", "indeterminate", "tool-failed"],
        ["V9", "indeterminate", LOCKFILE_NOT_REGENERATED],
      ]);
      expect(installCalls(failing.npm)).toHaveLength(1);
      expect(failing.engine.calls).toHaveLength(0);
      expect(readdirSync(failing.temp)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a lockfile on disk that is not the bytes the runner reported is V6 violated lockfile-invariants, and no engine runs",
    async () => {
      const repo = makeRepo();
      const hub = makeHub();
      const temp = nextDir("temp");
      vi.resetModules();
      vi.doMock("./lockfile-regen.js", async (importOriginal) => {
        const original = await importOriginal<typeof import("./lockfile-regen.js")>();
        return {
          ...original,
          // The runner's own verdict is satisfied, but it names bytes other than the ones the tree holds.
          regenerateLockfile: async (...args: Parameters<typeof original.regenerateLockfile>) => {
            const result = await original.regenerateLockfile(...args);
            return result.verdict === "satisfied" ? { ...result, after: "0".repeat(64) } : result;
          },
        };
      });
      try {
        const mocked = await import("./dry-materialize.js");
        const packageManager = npm();
        const engineRecorder = engine();
        const checks = await mocked.dryMaterialize(
          { clone: repo.clone, hubRoot: hub.hub, set: setFor(repo.head), now: NOW },
          { lockfileSpawn: packageManager.spawn, provenanceSpawn: engineRecorder.spawn, tempRoot: temp },
        );
        expect(verdicts(checks)).toEqual([
          ["V6", "violated", "lockfile-invariants"],
          ["V9", "indeterminate", LOCKFILE_NOT_REGENERATED],
        ]);
        expect(installCalls(packageManager)).toHaveLength(1);
        expect(engineRecorder.calls).toHaveLength(0);
        expect(readdirSync(temp)).toEqual([]);
      } finally {
        vi.doUnmock("./lockfile-regen.js");
        vi.resetModules();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a clone that is not the base commit's repository, or a commit it lacks, gives V6 indeterminate and launches nothing",
    async () => {
      const repo = makeRepo();
      const hub = makeHub();
      const set = setFor("b".repeat(40));
      const run = await dry(repo, hub, set);
      expect(run.checks![0]!.check).toBe("V6");
      expect(run.checks![0]!.verdict).toBe("indeterminate");
      expect(run.npm.calls).toHaveLength(0);
      expect(run.engine.calls).toHaveLength(0);

      const missing = await dry({ clone: join(scratch, "no-such-clone"), head: repo.head }, hub, setFor(repo.head));
      expect(missing.checks![0]!.verdict).toBe("indeterminate");
      expect(missing.npm.calls).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a throw from a port is V6 dry-tree-failed, V9 not run, and the tree is still removed",
    async () => {
      const repo = makeRepo();
      const hub = makeHub();
      const throwing = recorder(() => {
        throw new Error(STDERR_SENTINEL);
      });
      const run = await dryOne(repo, hub, { npm: throwing });
      expect(verdicts(run.checks)).toEqual([
        ["V6", "indeterminate", DRY_TREE_FAILED],
        ["V9", "indeterminate", LOCKFILE_NOT_REGENERATED],
      ]);
      expect(JSON.stringify(run.checks)).not.toContain(STDERR_SENTINEL);
      expect(readdirSync(run.temp)).toEqual([]);

      // A throw while the engine runs is the gate's own verdict, and the tree is removed there too.
      const engineThrows = await dryOne(repo, hub, {
        engine: recorder(() => {
          throw new Error(STDERR_SENTINEL);
        }),
      });
      expect(engineThrows.checks![0]).toEqual({ check: "V6", verdict: "satisfied" });
      expect(engineThrows.checks![1]!.check).toBe("V9");
      expect(engineThrows.checks![1]!.verdict).toBe("indeterminate");
      expect(JSON.stringify(engineThrows.checks)).not.toContain(STDERR_SENTINEL);
      expect(readdirSync(engineThrows.temp)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a set that changes no lockfile is not dry materialized",
    async () => {
      const repo = makeRepo();
      const hub = makeHub();
      const set = structuredClone(setFor(repo.head)) as unknown as Loose;
      set.files = set.files.filter((file: Loose) => !("derived" in file) || file.path === "clossys/ledger.json");
      const run = await dry(repo, hub, reseal(set));
      expect(run.checks).toBeNull();
      expect(run.npm.calls).toHaveLength(0);
      expect(run.engine.calls).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "no rule echoes a stderr or file-name sentinel",
    async () => {
      const hub = makeHub();
      const gathered: (readonly ApplyCheck[] | null)[] = [];
      const paths: string[] = [];

      // A package manager that fails and says a sentinel on stderr and stdout.
      const repo = makeRepo();
      const failing = await dry(repo, hub, setFor(repo.head), { npm: recorder(() => ({ status: 1, stdout: STDERR_SENTINEL, stderr: STDERR_SENTINEL })) });
      gathered.push(failing.checks);
      paths.push(failing.temp);
      const oddExit = await dry(repo, hub, setFor(repo.head), { npm: recorder(() => ({ status: 7, stdout: "", stderr: `${STDERR_SENTINEL} ${repo.clone}` })) });
      gathered.push(oddExit.checks);

      // An engine whose report puts a sentinel in a package's reasons and its stderr.
      const reasoned = await dry(repo, hub, setFor(repo.head), { engine: recorder(() => ({ status: 1, stdout: violatedReport(REASON_SENTINEL), stderr: STDERR_SENTINEL })) });
      gathered.push(reasoned.checks);
      const garbled = await dry(repo, hub, setFor(repo.head), { engine: recorder(() => ({ status: 0, stdout: STDERR_SENTINEL, stderr: STDERR_SENTINEL })) });
      gathered.push(garbled.checks);

      // A committed link, and a committed file, whose names are sentinels.
      const named = makeRepo({ [`${FILE_SENTINEL}.txt`]: "x\n" }, (clone) => {
        symlinkSync(`../${FILE_SENTINEL}`, join(clone, `${FILE_SENTINEL}-link`));
        git(clone, "add", `${FILE_SENTINEL}-link`);
      });
      const unsafe = await dry(named, hub, setFor(named.head));
      gathered.push(unsafe.checks);
      // Two paths that differ only in case are committed through the index, since a case-folding disk cannot hold both.
      const clash = makeRepo({}, (clone) => {
        for (const name of [`${FILE_SENTINEL}-a`, `${FILE_SENTINEL}-A`]) {
          const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: clone, env: gitEnv, input: `${name}\n`, encoding: "utf8" }).trim();
          git(clone, "update-index", "--add", "--cacheinfo", `100644,${blob},${name}`);
        }
      });
      const clashed = await dry(clash, hub, setFor(clash.head));
      gathered.push(clashed.checks);

      for (const checks of gathered) {
        expect(checks).not.toBeNull();
        const text = JSON.stringify(checks);
        for (const banned of [STDERR_SENTINEL, FILE_SENTINEL, REASON_SENTINEL, SITE_ID, scratch, OS_TEMP, repo.clone, named.clone, "launcher-dry-materialize", "/"]) expect(text).not.toContain(banned);
        for (const check of checks!) if (check.rule !== undefined) expect(check.rule).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
      }
      // The runs really did reach the places where a sentinel could have been echoed.
      expect(failing.npm.calls.length).toBeGreaterThan(0);
      expect(reasoned.engine.calls).toHaveLength(1);
      expect(reasoned.checks![1]!.verdict).toBe("violated");
      expect(unsafe.checks![0]!.verdict).toBe("indeterminate");
      expect(clashed.checks![0]!.verdict).toBe("indeterminate");
      expect(paths.length).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );
});

/** `dry` with the set and repository of the common case. */
async function dryOne(repo: Repo, hub: Hub, ports: { npm?: Recorder; engine?: Recorder } = {}): Promise<Run> {
  return dry(repo, hub, setFor(repo.head), ports);
}
