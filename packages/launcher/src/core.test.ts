import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  ADVISOR_PACKAGE,
  applyWorkspacePlan,
  inspectInventory,
  isHubDocument,
  observeWorkspace,
  parseGitHubRemote,
  planWorkspace,
  reportHubHealth,
  DEFAULT_REPOSITORY_NAME,
  WORKSPACE_INVENTORY_REL,
  WORKSPACE_MARKER_REL,
} from "./core.js";
import type { CommandResult, WorkspaceHost, WorkspaceObservation } from "./types.js";

const skeletonRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "skeleton");
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), "launcher-"));
  roots.push(root);
  return root;
}

function host(
  directory: string,
  commands: Record<string, CommandResult> = {},
  options: { env?: NodeJS.ProcessEnv; isTTY?: boolean; promptPick?: string | null } = {},
): WorkspaceHost {
  return {
    cwd: directory,
    env: options.env ?? {},
    isTTY: options.isTTY ?? false,
    now: () => "2026-09-18T00:00:00.000Z",
    exists: (path) => existsSync(path),
    isDirectory: (path) => existsSync(path) && statSync(path).isDirectory(),
    readText: (path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    writeText: (path, contents) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, contents);
    },
    mkdirp: (path) => {
      mkdirSync(path, { recursive: true });
    },
    readDir: (path) => (existsSync(path) ? readdirSync(path) : []),
    run: (command, args) => commands[`${command} ${args.join(" ")}`] ?? { status: 1, stdout: "", stderr: "unmocked" },
    prompt: (_message, choices) => {
      const pick = options.promptPick;
      return pick && choices.includes(pick) ? pick : null;
    },
  };
}

function writeInventory(directory: string, repositories: readonly unknown[] = [{ id: "app" }]): void {
  mkdirSync(join(directory, ".clossys"), { recursive: true });
  writeFileSync(
    join(directory, WORKSPACE_INVENTORY_REL),
    `${JSON.stringify({ schemaVersion: 1, repositories }, null, 2)}\n`,
  );
}

function observation(overrides: Partial<WorkspaceObservation> = {}): WorkspaceObservation {
  return {
    ownerCandidates: ["acme"],
    advisorVersion: "0.1.5",
    ghAvailable: true,
    gitAvailable: true,
    ...overrides,
    cwd: {
      absolutePath: "/tmp/hub",
      empty: true,
      git: false,
      looksLikeFoundry: false,
      ...overrides.cwd,
    },
  };
}

describe("parseGitHubRemote", () => {
  it("accepts github.com HTTPS and SSH and rejects every other host", () => {
    expect(parseGitHubRemote("https://github.com/acme/central.git")).toEqual({ owner: "acme", repository: "central" });
    expect(parseGitHubRemote("git@github.com:acme/central.git")).toEqual({ owner: "acme", repository: "central" });
    expect(parseGitHubRemote("https://gitlab.com/acme/central.git")).toBeNull();
    expect(parseGitHubRemote("git@example.com:acme/central.git")).toBeNull();
  });
});

describe("isHubDocument", () => {
  it("accepts a v1 account-hub marker and rejects a lookalike", () => {
    expect(isHubDocument({ schemaVersion: 1, kind: "account-hub", owner: "acme", repository: "acme/central" })).toBe(true);
    expect(isHubDocument({ schemaVersion: 1, kind: "workspace-looking", owner: "acme", repository: "acme/central" })).toBe(false);
  });
});

describe("planWorkspace", () => {
  const silent = host(tempDir());

  it("appoints the current GitHub repository instead of requiring a new exclusive hub", () => {
    expect(
      planWorkspace(
        observation({
          cwd: {
            absolutePath: "/tmp/central",
            empty: false,
            git: true,
            githubOwner: "acme",
            githubRepository: "central",
            looksLikeFoundry: false,
            inventory: { status: "populated", count: 1 },
          },
        }),
        silent,
      ),
    ).toEqual({
      action: "adopt",
      owner: "acme",
      repository: "central",
      directory: "/tmp/central",
      advisorVersion: "0.1.5",
    });
  });

  it("resumes an appointed hub from its marker without creating a second repo", () => {
    expect(
      planWorkspace(
        observation({
          cwd: {
            absolutePath: "/tmp/central",
            empty: false,
            git: true,
            githubOwner: "acme",
            githubRepository: "central",
            looksLikeFoundry: false,
            hub: { schemaVersion: 1, kind: "account-hub", owner: "acme", repository: "acme/central" },
          },
        }),
        silent,
      ),
    ).toMatchObject({ action: "resume", owner: "acme", repository: "central", clone: false });
  });

  it("creates owner/workspace only from an empty directory", () => {
    expect(planWorkspace(observation(), silent)).toEqual({
      action: "create",
      owner: "acme",
      repository: DEFAULT_REPOSITORY_NAME,
      directory: "/tmp/hub",
      advisorVersion: "0.1.5",
    });
  });

  it("refuses the Foundry supplier tree, a non-GitHub remote, and extra files with no git repo", () => {
    expect(planWorkspace(observation({ cwd: { absolutePath: "/tmp/foundry", empty: false, git: true, looksLikeFoundry: true } }), silent)).toMatchObject({
      action: "refuse",
      state: "violated",
    });
    expect(planWorkspace(observation({ cwd: { absolutePath: "/tmp/other", empty: false, git: true, looksLikeFoundry: false } }), silent)).toMatchObject({
      action: "refuse",
      state: "violated",
    });
    expect(planWorkspace(observation({ cwd: { absolutePath: "/tmp/messy", empty: false, git: false, looksLikeFoundry: false } }), silent)).toMatchObject({
      action: "refuse",
      state: "violated",
    });
  });

  it("refuses appoint when inventory is missing or empty", () => {
    const missing = planWorkspace(
      observation({
        cwd: {
          absolutePath: "/tmp/central",
          empty: false,
          git: true,
          githubOwner: "acme",
          githubRepository: "central",
          looksLikeFoundry: false,
          inventory: { status: "missing", count: 0 },
        },
      }),
      silent,
    );
    expect(missing).toMatchObject({ action: "refuse", state: "violated" });
    if (missing.action === "refuse") expect(missing.message).toMatch(/generated hub inventory/);
  });

  it("accepts --inventory when the cwd inventory is missing", () => {
    const directory = tempDir();
    const source = join(directory, "members.json");
    writeFileSync(source, `${JSON.stringify({ schemaVersion: 1, repositories: [{ id: "app" }] })}\n`);
    expect(
      planWorkspace(
        observation({
          cwd: {
            absolutePath: directory,
            empty: false,
            git: true,
            githubOwner: "acme",
            githubRepository: "central",
            looksLikeFoundry: false,
            inventory: { status: "missing", count: 0 },
          },
        }),
        host(directory),
        { inventoryPath: "members.json" },
      ),
    ).toMatchObject({
      action: "adopt",
      owner: "acme",
      repository: "central",
      inventorySource: resolve(directory, "members.json"),
    });
  });

  it("stays indeterminate when several owners are visible and stdin is not a TTY", () => {
    const decision = planWorkspace(observation({ ownerCandidates: ["acme", "widgets"] }), silent);
    expect(decision).toMatchObject({ action: "refuse", state: "indeterminate" });
  });
});

describe("applyWorkspacePlan", () => {
  it("copies the skeleton for create and does not pin the catalogue", () => {
    const directory = tempDir();
    applyWorkspacePlan(
      host(directory, {
        [`gh repo create acme/workspace --private --source ${directory} --remote origin --push`]: { status: 0, stdout: "created\n", stderr: "" },
      }),
      { action: "create", owner: "acme", repository: "workspace", directory, advisorVersion: "0.1.5" },
      skeletonRoot,
    );
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as { devDependencies: Record<string, string> };
    expect(manifest.devDependencies[ADVISOR_PACKAGE]).toBe("0.1.5");
    expect(manifest.devDependencies["@clossys/starter"]).toBeUndefined();
    expect(manifest.devDependencies["@clossys/controller"]).toBeUndefined();
    expect(manifest.devDependencies["@clossys/architect"]).toBeUndefined();
    expect(manifest.devDependencies["@clossys/bouncer"]).toBeUndefined();
    expect(JSON.parse(readFileSync(join(directory, WORKSPACE_MARKER_REL), "utf8"))).toMatchObject({ kind: "account-hub", owner: "acme" });
    expect(inspectInventory(readFileSync(join(directory, WORKSPACE_INVENTORY_REL), "utf8"))).toEqual({ status: "empty", count: 0 });
    expect(readFileSync(join(directory, "AGENTS.md"), "utf8")).toContain("account hub");
  });

  it("appoints an existing product repo without rewriting its README or dumping packages", () => {
    const directory = tempDir();
    writeFileSync(join(directory, "README.md"), "# Product\n");
    writeFileSync(join(directory, "package.json"), `${JSON.stringify({ name: "product", private: false, dependencies: { react: "19.0.0" } }, null, 2)}\n`);
    writeInventory(directory);
    const result = applyWorkspacePlan(
      host(directory),
      { action: "adopt", owner: "acme", repository: "product", directory, advisorVersion: "0.1.5" },
      skeletonRoot,
    );
    expect(readFileSync(join(directory, "README.md"), "utf8")).toBe("# Product\n");
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as {
      name: string;
      private: boolean;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(manifest.name).toBe("product");
    expect(manifest.private).toBe(false);
    expect(manifest.dependencies.react).toBe("19.0.0");
    expect(manifest.devDependencies[ADVISOR_PACKAGE]).toBe("0.1.5");
    expect(Object.keys(manifest.devDependencies)).toEqual([ADVISOR_PACKAGE]);
    expect(JSON.parse(readFileSync(join(directory, WORKSPACE_MARKER_REL), "utf8"))).toEqual({
      schemaVersion: 1,
      kind: "account-hub",
      owner: "acme",
      repository: "acme/product",
    });
    expect(result.health.inventory).toEqual({ status: "populated", count: 1 });
    expect(result.health.marker).toBe("present");
  });

  it("leaves an existing Advisor pin and does not dual-pin", () => {
    const directory = tempDir();
    writeFileSync(
      join(directory, "package.json"),
      `${JSON.stringify({ name: "hub", dependencies: { [ADVISOR_PACKAGE]: "0.2.1" } }, null, 2)}\n`,
    );
    writeInventory(directory);
    applyWorkspacePlan(
      host(directory),
      { action: "adopt", owner: "acme", repository: "hub", directory, advisorVersion: "0.2.3" },
      skeletonRoot,
    );
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(manifest.dependencies[ADVISOR_PACKAGE]).toBe("0.2.1");
    expect(manifest.devDependencies?.[ADVISOR_PACKAGE]).toBeUndefined();
  });

  it("does not overwrite an existing Advisor devDependency", () => {
    const directory = tempDir();
    writeFileSync(
      join(directory, "package.json"),
      `${JSON.stringify({ name: "hub", devDependencies: { [ADVISOR_PACKAGE]: "0.1.6" } }, null, 2)}\n`,
    );
    writeInventory(directory);
    applyWorkspacePlan(
      host(directory),
      { action: "adopt", owner: "acme", repository: "hub", directory, advisorVersion: "0.2.3" },
      skeletonRoot,
    );
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as {
      devDependencies: Record<string, string>;
    };
    expect(manifest.devDependencies[ADVISOR_PACKAGE]).toBe("0.1.6");
  });

  it("copies --inventory onto the hub and reports extra @clossys names without removing them", () => {
    const directory = tempDir();
    const source = join(directory, "supplied-inventory.json");
    writeFileSync(source, `${JSON.stringify({ schemaVersion: 1, repositories: [{ id: "one" }, { id: "two" }] }, null, 2)}\n`);
    writeFileSync(
      join(directory, "package.json"),
      `${JSON.stringify({
        name: "hub",
        dependencies: { [ADVISOR_PACKAGE]: "0.2.1", "@clossys/starter": "0.1.5" },
      }, null, 2)}\n`,
    );
    const result = applyWorkspacePlan(
      host(directory),
      { action: "adopt", owner: "acme", repository: "hub", directory, advisorVersion: "0.2.3", inventorySource: source },
      skeletonRoot,
    );
    expect(inspectInventory(readFileSync(join(directory, WORKSPACE_INVENTORY_REL), "utf8"))).toEqual({
      status: "populated",
      count: 2,
    });
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(manifest.dependencies["@clossys/starter"]).toBe("0.1.5");
    expect(manifest.devDependencies?.[ADVISOR_PACKAGE]).toBeUndefined();
    expect(result.health.extraClossys).toEqual(["@clossys/starter"]);
    expect(result.health.dualPin).toBe(false);
    expect(result.message).toMatch(/health:/);
  });

  it("reports health on resume without writing a marker", () => {
    const directory = tempDir();
    mkdirSync(join(directory, ".clossys"), { recursive: true });
    writeFileSync(
      join(directory, WORKSPACE_MARKER_REL),
      `${JSON.stringify({ schemaVersion: 1, kind: "account-hub", owner: "acme", repository: "acme/hub" }, null, 2)}\n`,
    );
    writeInventory(directory);
    const result = applyWorkspacePlan(
      host(directory),
      { action: "resume", owner: "acme", repository: "hub", directory, clone: false },
      skeletonRoot,
    );
    expect(result.health.marker).toBe("present");
    expect(result.health.inventory.status).toBe("populated");
    expect(reportHubHealth(host(directory), directory).marker).toBe("present");
  });
});

describe("observeWorkspace", () => {
  it("treats a GitHub origin as appointable even when the directory already has files", () => {
    const directory = tempDir();
    writeFileSync(join(directory, "README.md"), "# already\n");
    mkdirSync(join(directory, ".git"));
    const seen = observeWorkspace(
      host(directory, {
        "gh --version": { status: 0, stdout: "gh 2.0.0\n", stderr: "" },
        "git --version": { status: 0, stdout: "git 2.0.0\n", stderr: "" },
        "git remote get-url origin": { status: 0, stdout: "git@github.com:acme/central.git\n", stderr: "" },
        "gh api user --jq .login": { status: 0, stdout: "acme\n", stderr: "" },
        "gh org list": { status: 0, stdout: "", stderr: "" },
        "gh repo view acme/workspace --json name": { status: 1, stdout: "", stderr: "not found" },
        "npm view @clossys/advisor version": { status: 0, stdout: "0.1.5\n", stderr: "" },
      }),
    );
    expect(seen.cwd.githubOwner).toBe("acme");
    expect(seen.cwd.githubRepository).toBe("central");
    expect(seen.cwd.empty).toBe(false);
    expect(seen.cwd.inventory).toEqual({ status: "missing", count: 0 });
    expect(seen.advisorVersion).toBe("0.1.5");
  });
});
