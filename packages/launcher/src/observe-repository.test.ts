// Invariant under test: an observation is exactly the committed head, as the
// clone's object database stores it, of a clean clone matching its id; anything unestablished is a skip reason, never
// a guess. Every test drives real git against temporary repositories, each
// with a bare origin, and injects an `originId` that recognises only that
// bare-path shape.

import { execFileSync } from "node:child_process";
import { appendFileSync, chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { delimiter, dirname, join, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LEDGER_PATH, TEMPLATE_PATHS, contentDigest } from "./change-set-contract.js";
import type { RepositoryVisibility } from "./change-set-contract.js";
import { serializeInstalledLedger } from "./ledger-contract.js";
import type { InstalledLedger } from "./ledger-contract.js";
import { defaultOriginId, observeRepository } from "./observe-repository.js";
import type { RepositoryObservationPorts } from "./observe-repository.js";
import type { RepositoryObservation, SkippedRepositoryObservation } from "./plan-bundle.js";

type Result = RepositoryObservation | SkippedRepositoryObservation;
type Files = Record<string, string | Buffer | { link: string }>;

interface Fixture {
  readonly root: string;
  readonly clone: string;
  readonly origin: string;
  readonly id: string;
  readonly originId: (url: string) => string | null;
}

interface Overrides {
  id?: string;
  clone?: string;
  hubOwner?: string;
  ports?: Partial<RepositoryObservationPorts>;
}

const ID = "acme/widgets";
const NODE_ID = "R_exampleNode1";
const STARTER = "@clossys/starter";
const INTEGRITY = `sha512-${Buffer.alloc(64, 7).toString("base64")}`;

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
  return execFileSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd, env: gitEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function writeTree(dir: string, files: Files): void {
  for (const [path, entry] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    if (typeof entry === "string" || Buffer.isBuffer(entry)) writeFileSync(full, entry);
    else symlinkSync(entry.link, full);
  }
}

function commit(fx: Fixture, files: Files, message = "change"): void {
  writeTree(fx.clone, files);
  git(fx.clone, "add", "-A");
  git(fx.clone, "commit", "-m", message);
  git(fx.clone, "push", "origin", "main");
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function originIdFor(root: string): (url: string) => string | null {
  const prefix = `${join(root, "origin")}${sep}`;
  return (url) => {
    if (!url.startsWith(prefix) || !url.endsWith(".git")) return null;
    const parts = url.slice(prefix.length, -".git".length).split("/");
    return parts.length === 2 && parts.every((part) => part.length > 0) ? parts.join("/") : null;
  };
}

function makeFixture(files: Files = plainFiles(), id = ID): Fixture {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "observe-repository-")));
  roots.push(root);
  const origin = join(root, "origin", `${id}.git`);
  const clone = join(root, "clone");
  mkdirSync(dirname(origin), { recursive: true });
  mkdirSync(clone);
  git(root, "init", "--bare", "-b", "main", origin);
  git(clone, "init", "-b", "main");
  git(clone, "remote", "add", "origin", origin);
  writeTree(clone, files);
  git(clone, "add", "-A");
  git(clone, "commit", "-m", "initial");
  git(clone, "push", "-u", "origin", "main");
  return { root, clone, origin, id, originId: originIdFor(root) };
}

function plainFiles(): Files {
  return {
    "README.md": "# Example\n",
    "package.json": `${JSON.stringify({ name: "example-site", private: true, packageManager: "npm@10.8.2" }, null, 2)}\n`,
  };
}

async function observe(fx: Fixture, over: Overrides = {}): Promise<Result> {
  const ports: RepositoryObservationPorts = { nodeId: () => NODE_ID, visibility: () => "private", originId: fx.originId, ...over.ports };
  return observeRepository({
    id: over.id ?? fx.id,
    clone: over.clone ?? fx.clone,
    ...(over.hubOwner === undefined ? {} : { hubOwner: over.hubOwner }),
    ports,
  });
}

function observed(result: Result): RepositoryObservation {
  if ("skipped" in result) throw new Error(`expected an observation, got the skip ${result.skipped}`);
  return result;
}

function skip(fx: Fixture, skipped: string, verdict: "violated" | "indeterminate", id = fx.id): SkippedRepositoryObservation {
  return { id, skipped, verdict };
}

function headOf(fx: Fixture): string {
  return git(fx.clone, "rev-parse", "HEAD").trim();
}

function ledgerText(): string {
  const digest = (fill: string) => `sha256:${fill.repeat(64)}`;
  const ledger: InstalledLedger = {
    schemaVersion: 1,
    kind: "clossys.installed-ledger",
    repository: { id: ID, nodeId: NODE_ID },
    generation: 1,
    history: [
      {
        generation: 1,
        changeSet: digest("a"),
        phase: "setup",
        planDigest: digest("b"),
        bundle: digest("c"),
        baseCommit: "d".repeat(40),
        binding: { kind: "approved", subjectDigest: digest("c") },
      },
    ],
    files: [],
    keys: [],
    entries: [],
    packages: [],
    deferred: [],
  };
  return serializeInstalledLedger(ledger);
}

function npmLock(range: string, resolved: string | null): string {
  const packages: Record<string, unknown> = { "": { name: "example-site", version: "0.0.0", devDependencies: { [STARTER]: range } } };
  if (resolved !== null) {
    packages[`node_modules/${STARTER}`] = { version: resolved, resolved: `https://registry.npmjs.org/${STARTER}/-/starter-${resolved}.tgz`, integrity: INTEGRITY, dev: true };
  }
  return `${JSON.stringify({ name: "example-site", version: "0.0.0", lockfileVersion: 3, requires: true, packages }, null, 2)}\n`;
}

const TEMPLATES = Object.values(TEMPLATE_PATHS).flat();

/** A repository that carries everything `apply` needs; each option removes or bends one proof. */
function applyFiles(opts: { ledger?: string | null; drop?: string; range?: string; resolved?: string | null } = {}): Files {
  const range = opts.range ?? "0.2.1";
  const resolved = opts.resolved === undefined ? "0.2.1" : opts.resolved;
  const files: Files = {
    "package.json": `${JSON.stringify({ name: "example-site", private: true, devDependencies: { [STARTER]: range } }, null, 2)}\n`,
    "package-lock.json": npmLock(range, resolved),
  };
  for (const path of TEMPLATES) if (path !== opts.drop) files[path] = `# template ${path}\n`;
  const ledger = opts.ledger === undefined ? ledgerText() : opts.ledger;
  if (ledger !== null) files[LEDGER_PATH] = ledger;
  return files;
}

function profileText(names: readonly string[]): string {
  const rootEntries = names.map((name) => ({ name, classification: "canonical", disposition: "allowed" }));
  return `${JSON.stringify({ schemaVersion: 3, rootEntries }, null, 2)}\n`;
}

function plantHostile(fx: Fixture): { canary: string; script: string; hooks: string; config: string } {
  const canary = join(fx.root, "canary");
  const script = join(fx.root, "hostile.sh");
  const hooks = join(fx.root, "hostile-hooks");
  const config = join(fx.root, "hostile.gitconfig");
  writeFileSync(script, `#!/bin/sh\ntouch "${canary}"\n`);
  chmodSync(script, 0o755);
  mkdirSync(hooks);
  for (const name of ["post-checkout", "post-merge", "pre-commit", "reference-transaction", "post-index-change"]) copyFileSync(script, join(hooks, name));
  writeFileSync(config, `[core]\n\tfsmonitor = ${script}\n`);
  return { canary, script, hooks, config };
}

function snapshot(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(dir, rel)).sort()) {
    const path = join(rel, name);
    const stat = lstatSync(join(dir, path));
    out.push(`${path}\t${stat.isDirectory() ? "dir" : stat.isSymbolicLink() ? "link" : "file"}\t${stat.size}\t${stat.mtimeMs}`);
    if (stat.isDirectory()) out.push(...snapshot(dir, path));
  }
  return out;
}

/** Runs `body` with environment variables set, and puts them back whatever happens. */
async function withEnv<T>(vars: Record<string, string>, body: () => Promise<T>): Promise<T> {
  const before = Object.fromEntries(Object.keys(vars).map((name) => [name, process.env[name]]));
  Object.assign(process.env, vars);
  try {
    return await body();
  } finally {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

/** Observes with the default origin parser: no `originId` is injected. */
function observeWithDefaultParser(fx: Fixture): Promise<Result> {
  return observeRepository({ id: fx.id, clone: fx.clone, ports: { nodeId: () => NODE_ID, visibility: () => "private" } });
}

/**
 * Commits the same bytes at every path in one commit and pushes it, through git's
 * plumbing and not through the working tree: paths that differ only by letter case
 * cannot all be written on a case-insensitive file system, and identical bytes keep
 * the clone clean there too.
 */
function commitCollidingPaths(fx: Fixture, paths: readonly string[], content: string): void {
  const source = join(fx.root, "colliding-content");
  writeFileSync(source, content);
  const oid = git(fx.clone, "hash-object", "-w", source).trim();
  git(fx.clone, "config", "core.ignorecase", "false");
  for (const path of paths) git(fx.clone, "update-index", "--add", "--cacheinfo", `100644,${oid},${path}`);
  git(fx.clone, "commit", "-m", "colliding paths");
  git(fx.clone, "push", "origin", "main");
  git(fx.clone, "reset", "--hard", "HEAD");
}

/** A submodule, committed and checked out, whose own configuration would run a script for a clean filter and for fsmonitor. */
function addHostileSubmodule(fx: Fixture): { readonly canary: string } {
  const canary = join(fx.root, "submodule-canary");
  const script = join(fx.root, "submodule-hostile.sh");
  writeFileSync(script, `#!/bin/sh\ntouch "${canary}"\ncat\n`);
  chmodSync(script, 0o755);
  const source = join(fx.root, "submodule-source");
  mkdirSync(source);
  git(source, "init", "-b", "main");
  writeFileSync(join(source, "tracked.txt"), "tracked\n");
  git(source, "add", "-A");
  git(source, "commit", "-m", "submodule");
  git(fx.clone, "-c", "protocol.file.allow=always", "submodule", "add", source, "sub");
  git(fx.clone, "commit", "-m", "add the submodule");
  git(fx.clone, "push", "origin", "main");
  // The parent's own configuration keeps only what a plain clone carries; the submodule's is the hostile one.
  git(fx.clone, "config", "--remove-section", "submodule.sub");
  const modules = join(fx.clone, ".git", "modules", "sub");
  appendFileSync(join(modules, "config"), `[filter "evil"]\n\tclean = ${script}\n\tsmudge = ${script}\n[core]\n\tfsmonitor = ${script}\n`);
  mkdirSync(join(modules, "info"), { recursive: true });
  writeFileSync(join(modules, "info", "attributes"), "* filter=evil\n");
  // A file whose stat differs from the index makes git hash it again, through the clean filter.
  utimesSync(join(fx.clone, "sub", "tracked.txt"), 1, 1);
  return { canary };
}

describe("observeRepository: an observation is exactly the committed head of a clean clone", () => {
  describe("committed content", () => {
    it("reports the digests of committed bytes at owned paths, the head commit, the branch and a setup phase", async () => {
      const manifest = plainFiles()["package.json"] as string;
      const target = "../../.agents/skills/clossys-x";
      const fx = makeFixture({
        ...plainFiles(),
        "AGENTS.md": "# Agents\n",
        "clossys/brief.json": "{}\n",
        ".claude/skills/clossys-x": { link: target },
      });
      const result = observed(await observe(fx));
      expect(result.id).toBe(ID);
      expect(result.nodeId).toBe(NODE_ID);
      expect(result.visibility).toBe("private");
      expect(result.defaultBranch).toBe("main");
      expect(result.baseCommit).toBe(headOf(fx));
      expect(result.phase).toBe("setup");
      expect(result.packageManager).toBe("npm");
      expect(result.lockfile).toBe("none");
      expect(result.files).toEqual([
        { path: ".claude/skills/clossys-x", sha256: contentDigest(target) },
        { path: "AGENTS.md", sha256: contentDigest("# Agents\n") },
        { path: "clossys/brief.json", sha256: contentDigest("{}\n") },
        { path: "package.json", sha256: contentDigest(manifest) },
      ]);
      expect(result.manifestEntries).toEqual([]);
      expect(result.lockedPackages).toEqual([]);
      expect(result.ledger).toBeNull();
      expect(result.skillsManifest).toBeNull();
      expect(result.repositoryProfile).toBeNull();
      expect(result.symlinkedSkillRoots).toEqual([]);
      expect(result.linkedAgentsPaths).toEqual([]);
    });

    it("reports a committed symlink's digest as the digest of its target string, not of what it points at", async () => {
      const target = "../elsewhere/clossys-x";
      const fx = makeFixture({ ...plainFiles(), ".claude/skills/clossys-x": { link: target } });
      const result = observed(await observe(fx));
      expect(result.files).toContainEqual({ path: ".claude/skills/clossys-x", sha256: contentDigest(target) });
    });

    it("does not list a file that .gitignore hides and that was never committed", async () => {
      const fx = makeFixture({ ...plainFiles(), ".gitignore": "clossys/scratch.txt\n", "clossys/brief.json": "{}\n" });
      writeTree(fx.clone, { "clossys/scratch.txt": "local only\n" });
      const result = observed(await observe(fx));
      expect(result.files.map((file) => file.path)).toEqual(["clossys/brief.json", "package.json"]);
    });

    it("carries the values the ports return", async () => {
      const fx = makeFixture();
      const result = observed(await observe(fx, { ports: { nodeId: async () => "R_kgDOExample9", visibility: async () => "internal" } }));
      expect(result.nodeId).toBe("R_kgDOExample9");
      expect(result.visibility).toBe("internal");
    });
  });

  describe("the id", () => {
    it("refuses an id that is not an inventory id", async () => {
      const fx = makeFixture();
      expect(await observe(fx, { id: "../evil" })).toEqual(skip(fx, "invalid-id", "violated", "../evil"));
    });

    it("skips a bare id when no hub owner qualifies it", async () => {
      const fx = makeFixture();
      expect(await observe(fx, { id: "widgets" })).toEqual(skip(fx, "id-owner-unknown", "indeterminate", "widgets"));
    });

    it("qualifies a bare id with the hub owner and reports the id as given", async () => {
      const fx = makeFixture();
      const result = observed(await observe(fx, { id: "widgets", hubOwner: "acme" }));
      expect(result.id).toBe("widgets");
      expect(result.baseCommit).toBe(headOf(fx));
    });
  });

  describe("a clone that is not the clean committed head is refused", () => {
    it("refuses a modified tracked file", async () => {
      const fx = makeFixture();
      writeFileSync(join(fx.clone, "README.md"), "# Edited\n");
      expect(await observe(fx)).toEqual(skip(fx, "working-tree-dirty", "violated"));
    });

    it("refuses an untracked file", async () => {
      const fx = makeFixture();
      writeFileSync(join(fx.clone, "untracked.txt"), "new\n");
      expect(await observe(fx)).toEqual(skip(fx, "working-tree-dirty", "violated"));
    });

    it("refuses a staged change", async () => {
      const fx = makeFixture();
      writeFileSync(join(fx.clone, "README.md"), "# Staged\n");
      git(fx.clone, "add", "README.md");
      expect(await observe(fx)).toEqual(skip(fx, "working-tree-dirty", "violated"));
    });

    it("refuses a local commit the origin does not have", async () => {
      const fx = makeFixture();
      writeFileSync(join(fx.clone, "README.md"), "# Unpushed\n");
      git(fx.clone, "commit", "-am", "unpushed");
      expect(await observe(fx)).toEqual(skip(fx, "remote-tip-mismatch", "violated"));
    });

    it("refuses a clone that is behind the origin", async () => {
      const fx = makeFixture();
      const other = join(fx.root, "other");
      git(fx.root, "clone", fx.origin, other);
      writeFileSync(join(other, "README.md"), "# Ahead\n");
      git(other, "commit", "-am", "ahead");
      git(other, "push", "origin", "main");
      expect(await observe(fx)).toEqual(skip(fx, "remote-tip-mismatch", "violated"));
    });

    it("refuses an origin that is another repository", async () => {
      const fx = makeFixture();
      git(fx.clone, "remote", "set-url", "origin", join(fx.root, "origin", "rival", "gadgets.git"));
      expect(await observe(fx)).toEqual(skip(fx, "origin-mismatch", "violated"));
    });

    it("refuses an origin the mapper cannot name", async () => {
      const fx = makeFixture();
      git(fx.clone, "remote", "set-url", "origin", "https://example.com/acme/widgets.git");
      expect(await observe(fx)).toEqual(skip(fx, "origin-mismatch", "violated"));
    });

    it("skips a clone path that does not exist", async () => {
      const fx = makeFixture();
      expect(await observe(fx, { clone: join(fx.root, "no-such-clone") })).toEqual(skip(fx, "clone-missing", "indeterminate"));
    });

    it("refuses a clone checked out on another branch", async () => {
      const fx = makeFixture();
      git(fx.clone, "checkout", "-b", "feature");
      expect(await observe(fx)).toEqual(skip(fx, "not-on-default-branch", "violated"));
    });
  });

  describe("setup or apply", () => {
    it("is setup when the repository has no ledger", async () => {
      const fx = makeFixture(applyFiles({ ledger: null }));
      expect(observed(await observe(fx)).phase).toBe("setup");
    });

    it("is setup when the ledger is present but a template path is missing", async () => {
      const fx = makeFixture(applyFiles({ drop: TEMPLATES[TEMPLATES.length - 1]! }));
      expect(observed(await observe(fx)).phase).toBe("setup");
    });

    it("is apply with a ledger, all six template paths and the starter pinned exactly and locked", async () => {
      expect(TEMPLATES).toHaveLength(6);
      const fx = makeFixture(applyFiles());
      const result = observed(await observe(fx));
      expect(result.phase).toBe("apply");
      expect(result.packageManager).toBe("npm");
      expect(result.lockfile).toBe("package-lock.json");
      expect(result.manifestEntries).toEqual([{ placement: "devDependencies", name: STARTER, value: "0.2.1" }]);
      expect(result.lockedPackages).toEqual([{ name: STARTER, version: "0.2.1", integrity: INTEGRITY }]);
      expect(Buffer.from(result.ledger!).toString("utf8")).toBe(ledgerText());
    });

    it("is setup when the starter is a range rather than an exact version", async () => {
      const fx = makeFixture(applyFiles({ range: "^0.2.1" }));
      expect(observed(await observe(fx)).phase).toBe("setup");
    });

    it("is setup when the lockfile resolves the starter to another version", async () => {
      const fx = makeFixture(applyFiles({ resolved: "0.2.2" }));
      expect(observed(await observe(fx)).phase).toBe("setup");
    });

    it("is setup when the lockfile does not resolve the starter at all", async () => {
      const fx = makeFixture(applyFiles({ resolved: null }));
      const result = observed(await observe(fx));
      expect(result.phase).toBe("setup");
      expect(result.lockedPackages).toEqual([]);
    });

    it.each([
      ["a lockfile entry that is another package installed under the starter's name", "evil", "0.2.1", `https://registry.npmjs.org/evil/-/evil-0.2.1.tgz`, null],
      ["a lockfile whose root row aliases the starter to another package", "@clossys/starter", "0.2.1", `https://registry.npmjs.org/@clossys/starter/-/starter-0.2.1.tgz`, "npm:evil@0.2.1"],
      ["a lockfile entry resolved from another package's tarball", "@clossys/starter", "0.2.1", "https://registry.npmjs.org/evil/-/evil-0.2.1.tgz", null],
    ])("refuses %s rather than report the starter locked", async (_what, entryName, version, resolved, specifier) => {
      const lock = JSON.parse(npmLock("0.2.1", "0.2.1")) as { packages: Record<string, Record<string, unknown>> };
      lock.packages[`node_modules/${STARTER}`] = { name: entryName, version, resolved, integrity: INTEGRITY, dev: true };
      if (specifier !== null) (lock.packages[""]!.devDependencies as Record<string, string>)[STARTER] = specifier;
      const fx = makeFixture({ ...applyFiles(), "package-lock.json": `${JSON.stringify(lock, null, 2)}\n` });
      expect(await observe(fx)).toEqual(skip(fx, "lockfile-unreadable", "indeterminate"));
    });

    it("is setup when the ledger is not a valid ledger", async () => {
      const fx = makeFixture(applyFiles({ ledger: '{"not":"a ledger"}\n' }));
      expect(observed(await observe(fx)).phase).toBe("setup");
    });
  });

  describe("consumer CI", () => {
    it("is true for a workflow of the repository's own", async () => {
      const fx = makeFixture({ ...plainFiles(), ".github/workflows/ci.yml": "name: ci\n" });
      expect(observed(await observe(fx)).consumerCi).toBe(true);
    });

    it("is false when the only workflow is a clossys- one", async () => {
      const fx = makeFixture({ ...plainFiles(), ".github/workflows/clossys-ci.yml": "name: clossys\n" });
      expect(observed(await observe(fx)).consumerCi).toBe(false);
    });
  });

  describe("links", () => {
    it("lists .claude/skills when .claude is itself a symlink, and not .cursor/skills", async () => {
      const fx = makeFixture({ ...plainFiles(), ".claude": { link: "../shared/claude" } });
      expect(observed(await observe(fx)).symlinkedSkillRoots).toEqual([".claude/skills"]);
    });

    it("lists both roots when both parents are symlinks", async () => {
      const fx = makeFixture({ ...plainFiles(), ".claude": { link: "../shared/claude" }, ".cursor": { link: "../shared/cursor" } });
      expect(observed(await observe(fx)).symlinkedSkillRoots).toEqual([".claude/skills", ".cursor/skills"]);
    });

    it("lists .claude/skills when it is a symlink under a real .claude", async () => {
      const fx = makeFixture({ ...plainFiles(), ".claude/skills": { link: "../shared/skills" } });
      expect(observed(await observe(fx)).symlinkedSkillRoots).toEqual([".claude/skills"]);
    });

    it("sees a symlink at a case variant below the root", async () => {
      const fx = makeFixture({ ...plainFiles(), ".claude/Skills": { link: "../shared/skills" } });
      expect(observed(await observe(fx)).symlinkedSkillRoots).toEqual([".claude/skills"]);
    });

    it("refuses a symlink at a case variant of the root rather than read it", async () => {
      const fx = makeFixture({ ...plainFiles(), ".Claude/Skills": { link: "../shared/skills" } });
      expect(await observe(fx)).toEqual(skip(fx, "case-variant-owned-path", "indeterminate"));
    });

    it("lists .agents when it is a symlink", async () => {
      const fx = makeFixture({ ...plainFiles(), ".agents": { link: "shared/agents" } });
      expect(observed(await observe(fx)).linkedAgentsPaths).toEqual([".agents"]);
    });

    it("reports a linked skill under .agents/skills in its folded spelling", async () => {
      const fx = makeFixture({ ...plainFiles(), ".agents/skills/Clossys-Writer": { link: "../../shared/writer" } });
      expect(observed(await observe(fx)).linkedAgentsPaths).toEqual([".agents/skills/clossys-writer"]);
    });
  });

  describe("manifest and lockfile", () => {
    it("skips a lockfile that is not valid", async () => {
      const fx = makeFixture({ ...plainFiles(), "package-lock.json": "{ not json" });
      expect(await observe(fx)).toEqual(skip(fx, "lockfile-unreadable", "indeterminate"));
    });

    it("skips two lockfiles", async () => {
      const fx = makeFixture({ ...plainFiles(), "package-lock.json": npmLock("0.2.1", "0.2.1"), "yarn.lock": "# yarn lockfile v1\n" });
      expect(await observe(fx)).toEqual(skip(fx, "lockfile-ambiguous", "indeterminate"));
    });

    it("skips a repository with no lockfile and no packageManager field rather than guess", async () => {
      const fx = makeFixture({ ...plainFiles(), "package.json": '{"name":"example-site"}\n' });
      expect(await observe(fx)).toEqual(skip(fx, "package-manager-unknown", "indeterminate"));
    });

    it("refuses a lockfile that contradicts the packageManager field", async () => {
      const fx = makeFixture({
        "package.json": '{"name":"example-site","packageManager":"pnpm@9.0.0"}\n',
        "package-lock.json": npmLock("0.2.1", "0.2.1"),
      });
      expect(await observe(fx)).toEqual(skip(fx, "package-manager-conflict", "violated"));
    });

    it("skips a package.json with a duplicate key", async () => {
      const fx = makeFixture({ ...plainFiles(), "package.json": '{"name":"a","name":"b","packageManager":"npm@10.8.2"}\n' });
      expect(await observe(fx)).toEqual(skip(fx, "manifest-unreadable", "indeterminate"));
    });

    it("skips a package.json with a duplicate key nested in dependencies", async () => {
      const fx = makeFixture({ ...plainFiles(), "package.json": '{"packageManager":"npm@10.8.2","dependencies":{"left-pad":"1.0.0","left-pad":"2.0.0"}}\n' });
      expect(await observe(fx)).toEqual(skip(fx, "manifest-unreadable", "indeterminate"));
    });

    it("lists manifest entries by placement, then name, as written", async () => {
      const manifest = { packageManager: "npm@10.8.2", devDependencies: { c: "~3.0.0" }, dependencies: { b: "^1.0.0", a: "2.0.0" } };
      const fx = makeFixture({ ...plainFiles(), "package.json": `${JSON.stringify(manifest)}\n` });
      expect(observed(await observe(fx)).manifestEntries).toEqual([
        { placement: "dependencies", name: "a", value: "2.0.0" },
        { placement: "dependencies", name: "b", value: "^1.0.0" },
        { placement: "devDependencies", name: "c", value: "~3.0.0" },
      ]);
    });
  });

  describe("a hostile clone runs nothing", () => {
    const HOSTILE: readonly (readonly [string, (fx: Fixture, hostile: ReturnType<typeof plantHostile>) => void])[] = [
      ["core.fsmonitor", (fx, h) => git(fx.clone, "config", "core.fsmonitor", h.script)],
      [
        "filter.evil.clean",
        (fx, h) => {
          commit(fx, { ".gitattributes": "* filter=evil\n" }, "attributes");
          git(fx.clone, "config", "filter.evil.clean", h.script);
        },
      ],
      ["core.hooksPath", (fx, h) => git(fx.clone, "config", "core.hooksPath", h.hooks)],
      ["alias.st", (fx, h) => git(fx.clone, "config", "alias.st", `!${h.script}`)],
      ["include.path", (fx, h) => git(fx.clone, "config", "include.path", h.config)],
    ];

    it.each(HOSTILE)("refuses %s in .git/config and never runs what it points at", async (_key, plant) => {
      const fx = makeFixture();
      const hostile = plantHostile(fx);
      plant(fx, hostile);
      expect(await observe(fx)).toEqual(skip(fx, "clone-config-unsafe", "violated"));
      expect(existsSync(hostile.canary)).toBe(false);
    });

    it("observes a benign clone without running any hook in .git/hooks", async () => {
      const fx = makeFixture();
      const hostile = plantHostile(fx);
      for (const name of ["post-checkout", "post-merge", "pre-commit", "reference-transaction", "post-index-change", "fsmonitor-watchman"]) {
        copyFileSync(hostile.script, join(fx.clone, ".git", "hooks", name));
        chmodSync(join(fx.clone, ".git", "hooks", name), 0o755);
      }
      expect(observed(await observe(fx)).baseCommit).toBe(headOf(fx));
      expect(existsSync(hostile.canary)).toBe(false);
    });
  });

  describe("ports", () => {
    it.each([
      ["rejects", async (): Promise<string> => Promise.reject(new Error("unavailable"))],
      [
        "throws",
        (): string => {
          throw new Error("unavailable");
        },
      ],
      ["returns a malformed id", (): string => "not a node id"],
    ])("skips when the node id port %s", async (_what, nodeId) => {
      const fx = makeFixture();
      expect(await observe(fx, { ports: { nodeId } })).toEqual(skip(fx, "node-id-unavailable", "indeterminate"));
    });

    it("skips when the visibility port returns a value that is not a visibility", async () => {
      const fx = makeFixture();
      const visibility = (): RepositoryVisibility => "secret" as unknown as RepositoryVisibility;
      expect(await observe(fx, { ports: { visibility } })).toEqual(skip(fx, "visibility-unavailable", "indeterminate"));
    });
  });

  describe("repository profile", () => {
    it("is null when the repository declares none", async () => {
      const fx = makeFixture();
      const result = observed(await observe(fx));
      expect(result.repositoryProfile).toBeNull();
      expect(result.repositoryProfileText ?? null).toBeNull();
    });

    it("reports the roots a version 3 profile does not declare and carries its exact text", async () => {
      const text = profileText(["README.md", "package.json", "governance", ".agents", ".claude", ".cursor"]);
      const fx = makeFixture({ ...plainFiles(), "governance/repository-profile.json": text });
      const result = observed(await observe(fx));
      // A repository with no ledger is in its setup phase, so the roots its templates go in are introduced too.
      expect(result.repositoryProfile).toEqual({ path: "governance/repository-profile.json", rootVocabulary: "checked", undeclaredRoots: [".github", ".starter", "clossys"], prohibitedRoots: [] });
      expect(result.repositoryProfileText).toBe(text);
    });

    it("reports nothing to add, and no text, when the profile declares every root", async () => {
      const text = profileText(["README.md", "package.json", "governance", "clossys", ".agents", ".claude", ".cursor", ".github", ".starter"]);
      const fx = makeFixture({ ...plainFiles(), "governance/repository-profile.json": text });
      const result = observed(await observe(fx));
      expect(result.repositoryProfile).toEqual({ path: "governance/repository-profile.json", rootVocabulary: "checked", undeclaredRoots: [], prohibitedRoots: [] });
      expect(result.repositoryProfileText ?? null).toBeNull();
    });

    it("reports an unparseable profile as such", async () => {
      const fx = makeFixture({ ...plainFiles(), "governance/repository-profile.json": '{"schemaVersion":3,"schemaVersion":3}\n' });
      const result = observed(await observe(fx));
      expect(result.repositoryProfile).toEqual({ path: "governance/repository-profile.json", rootVocabulary: "unparseable", undeclaredRoots: [], prohibitedRoots: [] });
      expect(result.repositoryProfileText ?? null).toBeNull();
    });

    it("skips two profile candidates", async () => {
      const fx = makeFixture({
        ...plainFiles(),
        "docs/repository-profile.json": profileText(["README.md"]),
        "packages/site/repository-declaration.json": profileText(["README.md"]),
      });
      expect(await observe(fx)).toEqual(skip(fx, "profile-ambiguous", "indeterminate"));
    });
  });

  describe("case variants of an owned path", () => {
    it.each([["agents.md"], ["Clossys/notes.txt"], [".GitHub/workflows/clossys-ci.yml"]])("skips a committed %s beside no canonical spelling", async (path) => {
      const fx = makeFixture({ ...plainFiles(), [path]: "variant\n" });
      expect(await observe(fx)).toEqual(skip(fx, "case-variant-owned-path", "indeterminate"));
    });
  });

  describe("the object database is the only thing read", () => {
    it("runs nothing from a populated submodule's own configuration, and refuses the submodule", async () => {
      const fx = makeFixture();
      const { canary } = addHostileSubmodule(fx);
      expect(await observe(fx)).toEqual(skip(fx, "submodule-present", "indeterminate"));
      expect(existsSync(canary)).toBe(false);
    });

    it("refuses a submodule that is staged and not yet committed", async () => {
      const fx = makeFixture();
      git(fx.clone, "update-index", "--add", "--cacheinfo", `160000,${headOf(fx)},staged-sub`);
      expect(await observe(fx)).toEqual(skip(fx, "submodule-present", "indeterminate"));
    });

    it("never runs a `git` file committed at the root of the clone, whatever PATH holds", async () => {
      const fx = makeFixture();
      const canary = join(fx.root, "git-canary");
      writeFileSync(join(fx.clone, "git"), `#!/bin/sh\ntouch "${canary}"\nexit 1\n`);
      chmodSync(join(fx.clone, "git"), 0o755);
      git(fx.clone, "add", "-A");
      git(fx.clone, "commit", "-m", "a file named git");
      git(fx.clone, "push", "origin", "main");
      await withEnv({ PATH: `:${process.env.PATH ?? ""}:.` }, () => observe(fx));
      expect(existsSync(canary)).toBe(false);
    });

    it("refuses a clone that reads objects from an alternate object store", async () => {
      const fx = makeFixture();
      const other = makeFixture(plainFiles(), "rival/gadgets");
      writeFileSync(join(fx.clone, ".git", "objects", "info", "alternates"), `${join(other.clone, ".git", "objects")}\n`);
      expect(await observe(fx)).toEqual(skip(fx, "clone-config-unsafe", "violated"));
    });

    it("refuses when GIT_ALTERNATE_OBJECT_DIRECTORIES names an object store", async () => {
      const fx = makeFixture();
      const other = makeFixture(plainFiles(), "rival/gadgets");
      const result = await withEnv({ GIT_ALTERNATE_OBJECT_DIRECTORIES: join(other.clone, ".git", "objects") }, () => observe(fx));
      expect(result).toEqual(skip(fx, "clone-unreadable", "indeterminate"));
    });

    it.each([
      ["skip-worktree", "--skip-worktree"],
      ["assume-unchanged", "--assume-unchanged"],
    ])("refuses a tracked file marked %s, which hides an edit from git status", async (_name, flag) => {
      const fx = makeFixture();
      git(fx.clone, "update-index", flag, "README.md");
      writeFileSync(join(fx.clone, "README.md"), "# Edited behind git's back\n");
      expect(await observe(fx)).toEqual(skip(fx, "working-tree-dirty", "violated"));
    });
  });

  describe("the origin", () => {
    // Port-form URLs are assembled from parts so no literal host:port/owner/repo string sits in the file.
    const GITHUB_HOST = "github.com";

    it.each([
      ["https://github.com/acme/widgets", "acme/widgets"],
      ["https://github.com/acme/widgets.git", "acme/widgets"],
      ["git@github.com:acme/widgets.git", "acme/widgets"],
      ["git@github.com:acme/widgets", "acme/widgets"],
      ["ssh://git@github.com/acme/widgets.git", "acme/widgets"],
    ])("names %s as %s", (url, named) => {
      expect(defaultOriginId(url)).toBe(named);
    });

    it.each([
      "file://github.com/acme/widgets",
      "file://github.com/acme/widgets/extra/segments",
      "file:///github.com/acme/widgets",
      "http://github.com/acme/widgets",
      "git://github.com/acme/widgets",
      "https://github.com/acme/widgets/extra",
      "https://user@github.com/acme/widgets",
      `https://${GITHUB_HOST}${":8443"}/acme/widgets`,
      "https://github.com/acme/widgets?x=1",
      "https://github.com/acme/widgets#frag",
      "https://github.com.evil.example/acme/widgets",
      `ssh://git@${GITHUB_HOST}${":22"}/acme/widgets`,
      "/local/acme/widgets",
    ])("does not name %s", (url) => {
      expect(defaultOriginId(url)).toBeNull();
    });

    it("refuses a file:// origin that only reads like a GitHub one", async () => {
      const fx = makeFixture();
      git(fx.clone, "remote", "set-url", "origin", "file://github.com/acme/widgets");
      expect(await observeWithDefaultParser(fx)).toEqual(skip(fx, "origin-mismatch", "violated"));
    });

    it("does not fetch over the file protocol when the default parser names the origin", async () => {
      const fx = makeFixture();
      git(fx.clone, "remote", "set-url", "origin", "https://github.com/acme/widgets.git");
      const global = join(fx.root, "rewrite.gitconfig");
      writeFileSync(global, `[url "file://${join(fx.root, "origin", "acme")}/"]\n\tinsteadOf = https://github.com/acme/\n`);
      const result = await withEnv({ GIT_CONFIG_GLOBAL: global }, () => observeWithDefaultParser(fx));
      expect(result).toEqual(skip(fx, "remote-tip-unreadable", "indeterminate"));
    });
  });

  describe("an owned path holds whatever the head holds at it", () => {
    it.each([
      [".claude/skills/clossys-builder"],
      [".cursor/skills/clossys-builder"],
      [".github/workflows/clossys-ci.yml"],
      [".github/scripts/clossys-check.sh"],
      [".starter/request.json"],
    ])("lists the files of a directory committed at %s, so the path reads as occupied", async (path) => {
      const fx = makeFixture({ ...plainFiles(), [`${path}/SKILL.md`]: "# a directory where a link belongs\n" });
      const result = observed(await observe(fx));
      expect(result.files).toContainEqual({ path: `${path}/SKILL.md`, sha256: contentDigest("# a directory where a link belongs\n") });
      expect(result.files.some((file) => file.path === path)).toBe(false);
    });

    it("lists a regular file committed at a discovery-link path with the digest of its bytes", async () => {
      const fx = makeFixture({ ...plainFiles(), ".claude/skills/clossys-builder": "not a link\n" });
      expect(observed(await observe(fx)).files).toContainEqual({ path: ".claude/skills/clossys-builder", sha256: contentDigest("not a link\n") });
    });

    it("refuses a directory at a case variant of an owned path", async () => {
      const fx = makeFixture({ ...plainFiles(), ".claude/skills/CLOSSYS-builder/SKILL.md": "variant\n" });
      expect(await observe(fx)).toEqual(skip(fx, "case-variant-owned-path", "indeterminate"));
    });
  });

  describe("letter case at the root", () => {
    it.each([[".Claude/settings.json"], [".CLAUDE"], [".Agents/skills/notes.md"], [".CURSOR/rules.md"], ["Clossys/notes.md"]])("refuses a committed %s as a case variant of a root the flow adds", async (path) => {
      const fx = makeFixture({ ...plainFiles(), [path]: "variant\n" });
      expect(await observe(fx)).toEqual(skip(fx, "case-variant-owned-path", "indeterminate"));
    });

    it("does not let a case variant stand in for a root the profile prohibits", async () => {
      const text = `${JSON.stringify({ schemaVersion: 3, rootEntries: [{ name: ".Claude", classification: "canonical", disposition: "allowed" }, { name: ".claude", classification: "canonical", disposition: "prohibited" }] })}\n`;
      const fx = makeFixture({ ...plainFiles(), ".Claude/settings.json": "{}\n", "governance/repository-profile.json": text });
      expect(await observe(fx)).toEqual(skip(fx, "case-variant-owned-path", "indeterminate"));
    });

    it("refuses two root entries that differ only by case", async () => {
      const fx = makeFixture();
      commitCollidingPaths(fx, [".claude/settings.json", ".CLAUDE/settings.json"], "{}\n");
      expect(await observe(fx)).toEqual(skip(fx, "case-variant-owned-path", "indeterminate"));
    });

    it("refuses .github and .GitHub side by side", async () => {
      const fx = makeFixture();
      commitCollidingPaths(fx, [".github/workflows/ci.yml", ".GitHub/workflows/ci.yml"], "name: ci\n");
      expect(await observe(fx)).toEqual(skip(fx, "case-variant-owned-path", "indeterminate"));
    });

    it("does not read a .GitHub/Workflows directory as a workflow of the repository's own", async () => {
      const fx = makeFixture({ ...plainFiles(), ".GitHub/Workflows/build.yml": "name: build\n" });
      expect(observed(await observe(fx)).consumerCi).toBe(false);
    });

    it("does not read a symbolic link named like a workflow as one", async () => {
      const fx = makeFixture({ ...plainFiles(), ".github/workflows/build.yml": { link: "../../elsewhere.yml" } });
      expect(observed(await observe(fx)).consumerCi).toBe(false);
    });
  });

  describe("bytes as materialize reads them", () => {
    it("digests a blob that is not UTF-8 as materialize does, whether it reads the file or `git show`", async () => {
      const bytes = Buffer.from([0xff, 0xfe, 0x41, 0x80, 0xc3, 0x28, 0x0a]);
      const fx = makeFixture({ ...plainFiles(), "clossys/opaque.bin": bytes });
      const result = observed(await observe(fx));
      const row = result.files.find((file) => file.path === "clossys/opaque.bin");
      // materialize: contentDigest(readFileSync(path, "utf8")) on the disk, and contentDigest of `git show` decoded as UTF-8 on a ref.
      expect(row?.sha256).toBe(contentDigest(readFileSync(join(fx.clone, "clossys/opaque.bin"), "utf8")));
      expect(row?.sha256).toBe(contentDigest(git(fx.clone, "show", "HEAD:clossys/opaque.bin")));
    });

    it("digests a UTF-8 file that starts with a byte order mark as materialize does", async () => {
      const text = "\ufeff# with a mark\n";
      const fx = makeFixture({ ...plainFiles(), "clossys/marked.md": text });
      const row = observed(await observe(fx)).files.find((file) => file.path === "clossys/marked.md");
      expect(row?.sha256).toBe(contentDigest(readFileSync(join(fx.clone, "clossys/marked.md"), "utf8")));
      expect(row?.sha256).toBe(contentDigest(text));
    });
  });

  describe("git inside the clone reads no configuration but the vetted .git/config", () => {
    type Source = (fx: Fixture, xdg: string, definition: readonly [string, string][]) => Record<string, string>;
    const gitConfigText = (definition: readonly [string, string][]): string => `[filter "x"]\n${definition.map(([key, value]) => `\t${key} = ${value}\n`).join("")}`;
    const SOURCES: readonly (readonly [string, Source])[] = [
      [
        "GIT_CONFIG_SYSTEM",
        (fx, _xdg, definition) => {
          const file = join(fx.root, "system.gitconfig");
          writeFileSync(file, gitConfigText(definition));
          return { GIT_CONFIG_SYSTEM: file };
        },
      ],
      [
        "GIT_CONFIG_GLOBAL",
        (fx, _xdg, definition) => {
          const file = join(fx.root, "global.gitconfig");
          writeFileSync(file, gitConfigText(definition));
          return { GIT_CONFIG_GLOBAL: file };
        },
      ],
      [
        "XDG config",
        (_fx, xdg, definition) => {
          mkdirSync(join(xdg, "git"), { recursive: true });
          writeFileSync(join(xdg, "git", "config"), gitConfigText(definition));
          return {};
        },
      ],
      [
        "GIT_CONFIG_COUNT",
        (_fx, _xdg, definition) => ({
          GIT_CONFIG_COUNT: String(definition.length),
          ...Object.fromEntries(definition.flatMap(([key, value], at) => [[`GIT_CONFIG_KEY_${at}`, `filter.x.${key}`], [`GIT_CONFIG_VALUE_${at}`, value]])),
        }),
      ],
      ["GIT_CONFIG_PARAMETERS", (_fx, _xdg, definition) => ({ GIT_CONFIG_PARAMETERS: definition.map(([key, value]) => `'filter.x.${key}'='${value}'`).join(" ") })],
    ];
    const SELECTORS: readonly (readonly [string, (fx: Fixture, xdg: string) => void])[] = [
      ["committed .gitattributes", (fx) => commit(fx, { ".gitattributes": "* filter=x\n" }, "attributes")],
      ["info/attributes", (fx) => writeFileSync(join(fx.clone, ".git", "info", "attributes"), "* filter=x\n")],
      [
        "XDG attributes",
        (_fx, xdg) => {
          mkdirSync(join(xdg, "git"), { recursive: true });
          writeFileSync(join(xdg, "git", "attributes"), "* filter=x\n");
        },
      ],
    ];
    const DRIVERS: readonly (readonly [string, (script: string) => readonly [string, string][]])[] = [
      ["clean", (script) => [["clean", script]]],
      ["process", (script) => [["process", script], ["required", "true"]]],
    ];
    const CELLS = SOURCES.flatMap(([source, define]) => SELECTORS.flatMap(([selector, select]) => DRIVERS.map(([driver, spell]) => [source, selector, driver, define, select, spell] as const)));

    it("covers thirty cells", () => {
      expect(CELLS).toHaveLength(30);
    });

    it.each(CELLS)("runs no filter defined by %s and selected by %s, driver %s, and leaves the clone as it was", async (_source, _selector, _driver, define, select, spell) => {
      const fx = makeFixture();
      const canary = join(fx.root, "canary");
      const script = join(fx.root, "filter.sh");
      writeFileSync(script, `#!/bin/sh\ntouch "${canary}"\ncat\n`);
      chmodSync(script, 0o755);
      const xdg = join(fx.root, "xdg");
      select(fx, xdg);
      const environment = { XDG_CONFIG_HOME: xdg, ...define(fx, xdg, spell(script)) };
      // A tracked file whose stat differs from the index makes git hash it again, through any clean filter.
      utimesSync(join(fx.clone, "README.md"), 1, 1);
      const before = snapshot(fx.clone);
      const result = await withEnv(environment, () => observe(fx));
      expect(existsSync(canary)).toBe(false);
      expect("skipped" in result || result.baseCommit === headOf(fx)).toBe(true);
      expect(snapshot(fx.clone)).toEqual(before);
    });

    it.each([["GIT_CONFIG_COUNT"], ["GIT_CONFIG_KEY_0"], ["GIT_CONFIG_VALUE_0"], ["GIT_CONFIG_SYSTEM"], ["GIT_ATTR_SOURCE"]])("does not pass %s on to git", async (name) => {
      const fx = makeFixture();
      const capture = join(fx.root, "environment");
      const wrapper = join(fx.root, "bin");
      mkdirSync(wrapper);
      const real = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
      writeFileSync(join(wrapper, "git"), `#!/bin/sh\nenv >> "${capture}"\nexec "${real}" "$@"\n`);
      chmodSync(join(wrapper, "git"), 0o755);
      const result = await withEnv({ PATH: `${wrapper}${delimiter}${process.env.PATH ?? ""}`, [name]: "1" }, () => observe(fx));
      expect("skipped" in result || result.baseCommit === headOf(fx)).toBe(true);
      const lines = readFileSync(capture, "utf8").split("\n");
      expect(lines.length).toBeGreaterThan(1);
      expect(lines.some((line) => line.startsWith(`${name}=`))).toBe(false);
      expect(lines).toContain("GIT_CONFIG_NOSYSTEM=1");
    });
  });

  describe("folding trailing dots and spaces", () => {
    it.each([["clossys. . ./notes.md"], ["clossys.../notes.md"], ["clossys  /notes.md"], [".agents. /notes.md"]])("reads %s as the owned name without its trailing dots and spaces", async (path) => {
      const fx = makeFixture({ ...plainFiles(), [path]: "text\n" });
      expect(await observe(fx)).toEqual(skip(fx, "case-variant-owned-path", "indeterminate"));
    });
  });

  describe("a split index is refused before any git command reads the index", () => {
    function sharedIndexes(fx: Fixture): string[] {
      return readdirSync(join(fx.clone, ".git")).filter((name) => name.startsWith("sharedindex."));
    }

    it("refuses a clone made split with `git update-index --split-index`, and leaves its lstat snapshot unchanged", async () => {
      const fx = makeFixture();
      git(fx.clone, "update-index", "--split-index");
      const shared = sharedIndexes(fx);
      expect(shared).toHaveLength(1);
      // git freshens the shared file's mtime on every index read, so start from a time that a freshening cannot equal.
      utimesSync(join(fx.clone, ".git", shared[0]!), 1, 1);
      const before = snapshot(fx.clone);
      expect(await observe(fx)).toEqual(skip(fx, "clone-config-unsafe", "violated"));
      expect(snapshot(fx.clone)).toEqual(before);
    });

    it("refuses a leftover `.git/sharedindex.deadbeef` file, whatever it holds", async () => {
      const fx = makeFixture();
      writeFileSync(join(fx.clone, ".git", "sharedindex.deadbeef"), "");
      const before = snapshot(fx.clone);
      expect(await observe(fx)).toEqual(skip(fx, "clone-config-unsafe", "violated"));
      expect(snapshot(fx.clone)).toEqual(before);
    });

    it("refuses a `sharedindex.` entry that is a directory or a link", async () => {
      const dir = makeFixture();
      mkdirSync(join(dir.clone, ".git", "sharedindex.deadbeef"));
      expect(await observe(dir)).toEqual(skip(dir, "clone-config-unsafe", "violated"));
      const link = makeFixture();
      symlinkSync("index", join(link.clone, ".git", "sharedindex.deadbeef"));
      expect(await observe(link)).toEqual(skip(link, "clone-config-unsafe", "violated"));
    });

    it("observes a normal clone as before, and it has no shared index", async () => {
      const fx = makeFixture();
      expect(sharedIndexes(fx)).toEqual([]);
      expect(observed(await observe(fx)).baseCommit).toBe(headOf(fx));
    });
  });

  describe("observing writes nothing", () => {
    it("leaves the clone's .git directory and status exactly as they were", async () => {
      const fx = makeFixture({ ...plainFiles(), "clossys/brief.json": "{}\n", ".github/workflows/ci.yml": "name: ci\n" });
      const gitDir = join(fx.clone, ".git");
      const statusBefore = git(fx.clone, "status", "--porcelain=v2", "--branch");
      const before = snapshot(gitDir);
      observed(await observe(fx));
      expect(snapshot(gitDir)).toEqual(before);
      expect(git(fx.clone, "status", "--porcelain=v2", "--branch")).toBe(statusBefore);
    });
  });
});
