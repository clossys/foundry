// Invariant under test: an observation is exactly the committed head of a
// clean clone matching its id; anything unestablished is a skip reason, never
// a guess. Every test drives real git against temporary repositories, each
// with a bare origin, and injects an `originId` that recognises only that
// bare-path shape.

import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LEDGER_PATH, TEMPLATE_PATHS, contentDigest } from "./change-set-contract.js";
import type { RepositoryVisibility } from "./change-set-contract.js";
import { serializeInstalledLedger } from "./ledger-contract.js";
import type { InstalledLedger } from "./ledger-contract.js";
import { observeRepository } from "./observe-repository.js";
import type { RepositoryObservationPorts } from "./observe-repository.js";
import type { RepositoryObservation, SkippedRepositoryObservation } from "./plan-bundle.js";

type Result = RepositoryObservation | SkippedRepositoryObservation;
type Files = Record<string, string | { link: string }>;

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
    if (typeof entry === "string") writeFileSync(full, entry);
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
  const range = opts.range ?? "1.2.3";
  const resolved = opts.resolved === undefined ? "1.2.3" : opts.resolved;
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
      expect(result.manifestEntries).toEqual([{ placement: "devDependencies", name: STARTER, value: "1.2.3" }]);
      expect(result.lockedPackages).toEqual([{ name: STARTER, version: "1.2.3", integrity: INTEGRITY }]);
      expect(Buffer.from(result.ledger!).toString("utf8")).toBe(ledgerText());
    });

    it("is setup when the starter is a range rather than an exact version", async () => {
      const fx = makeFixture(applyFiles({ range: "^1.2.3" }));
      expect(observed(await observe(fx)).phase).toBe("setup");
    });

    it("is setup when the lockfile resolves the starter to another version", async () => {
      const fx = makeFixture(applyFiles({ resolved: "1.2.4" }));
      expect(observed(await observe(fx)).phase).toBe("setup");
    });

    it("is setup when the lockfile does not resolve the starter at all", async () => {
      const fx = makeFixture(applyFiles({ resolved: null }));
      const result = observed(await observe(fx));
      expect(result.phase).toBe("setup");
      expect(result.lockedPackages).toEqual([]);
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

    it("sees a symlink at a case variant of the root", async () => {
      const fx = makeFixture({ ...plainFiles(), ".Claude/Skills": { link: "../shared/skills" } });
      expect(observed(await observe(fx)).symlinkedSkillRoots).toEqual([".claude/skills"]);
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
      const fx = makeFixture({ ...plainFiles(), "package-lock.json": npmLock("1.2.3", "1.2.3"), "yarn.lock": "# yarn lockfile v1\n" });
      expect(await observe(fx)).toEqual(skip(fx, "lockfile-ambiguous", "indeterminate"));
    });

    it("skips a repository with no lockfile and no packageManager field rather than guess", async () => {
      const fx = makeFixture({ ...plainFiles(), "package.json": '{"name":"example-site"}\n' });
      expect(await observe(fx)).toEqual(skip(fx, "package-manager-unknown", "indeterminate"));
    });

    it("refuses a lockfile that contradicts the packageManager field", async () => {
      const fx = makeFixture({
        "package.json": '{"name":"example-site","packageManager":"pnpm@9.0.0"}\n',
        "package-lock.json": npmLock("1.2.3", "1.2.3"),
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
      expect(result.repositoryProfile).toEqual({ path: "governance/repository-profile.json", rootVocabulary: "checked", undeclaredRoots: ["clossys"], prohibitedRoots: [] });
      expect(result.repositoryProfileText).toBe(text);
    });

    it("reports nothing to add, and no text, when the profile declares every root", async () => {
      const text = profileText(["README.md", "package.json", "governance", "clossys", ".agents", ".claude", ".cursor"]);
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
