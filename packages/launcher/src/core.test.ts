import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  ADVISOR_PACKAGE,
  CONSUMER_AGENTS_MD,
  LEGACY_CONSUMER_AGENTS_MD,
  applyWorkspacePlan,
  checkInventoryEntries,
  formatHubHealth,
  hasAdvisorPin,
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
    isSymlink: (path) => {
      try {
        return lstatSync(path).isSymbolicLink();
      } catch {
        return false;
      }
    },
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
    symlink: (relativeTarget, linkPath) => {
      mkdirSync(dirname(linkPath), { recursive: true });
      if (existsSync(linkPath)) rmSync(linkPath, { recursive: true, force: true });
      symlinkSync(relativeTarget, linkPath, "dir");
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

function skillFixture(name: string): string {
  return `---\nname: clossys-${name}\ndescription: test skill for ${name}\ndisable-model-invocation: true\n---\n\n# ${name}\n`;
}

function seedSkillCatalogue(packages: readonly string[]): string {
  const root = tempDir();
  for (const name of packages) {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), skillFixture(name));
  }
  return root;
}

function isolatedLauncherRoot(): string {
  const root = tempDir();
  const launcher = join(root, "packages", "launcher");
  mkdirSync(launcher, { recursive: true });
  return launcher;
}

function composeApplyOptions(catalogueRoot: string): { launcherPackageRoot: string; skillCatalogueRoot: string } {
  return { launcherPackageRoot: isolatedLauncherRoot(), skillCatalogueRoot: catalogueRoot };
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

  it("refuses when CLOSSYS_OWNER names a different account than the origin", () => {
    const decision = planWorkspace(
      observation({
        envOwner: "owner-a",
        cwd: {
          absolutePath: "/tmp/central",
          empty: false,
          git: true,
          githubOwner: "owner-b",
          githubRepository: "central",
          looksLikeFoundry: false,
          inventory: { status: "populated", count: 1 },
        },
      }),
      silent,
    );
    expect(decision).toMatchObject({ action: "refuse", state: "violated" });
    if (decision.action === "refuse") expect(decision.message).toMatch(/owner-a.*owner-b|owner-b.*owner-a/);
  });

  it("appoints normally when CLOSSYS_OWNER matches the origin owner", () => {
    expect(
      planWorkspace(
        observation({
          envOwner: "owner-a",
          cwd: {
            absolutePath: "/tmp/central",
            empty: false,
            git: true,
            githubOwner: "owner-a",
            githubRepository: "central",
            looksLikeFoundry: false,
            inventory: { status: "populated", count: 1 },
          },
        }),
        silent,
      ),
    ).toMatchObject({ action: "adopt", owner: "owner-a" });
  });

  it("still resumes a hub whose origin owner differs from CLOSSYS_OWNER", () => {
    expect(
      planWorkspace(
        observation({
          envOwner: "owner-a",
          cwd: {
            absolutePath: "/tmp/central",
            empty: false,
            git: true,
            githubOwner: "owner-b",
            githubRepository: "central",
            looksLikeFoundry: false,
            hub: { schemaVersion: 1, kind: "account-hub", owner: "owner-b", repository: "owner-b/central" },
          },
        }),
        silent,
      ),
    ).toMatchObject({ action: "resume", owner: "owner-b" });
  });

  it("merges a supplied --inventory into a populated on-disk inventory by id, on-disk order first", () => {
    const directory = tempDir();
    writeInventory(directory, [{ id: "hub-a" }, { id: "hub-c" }]);
    const source = join(directory, "supplied.json");
    writeFileSync(source, `${JSON.stringify({ schemaVersion: 1, repositories: [{ id: "hub-b" }, { id: "hub-a" }, { id: "hub-d" }] }, null, 2)}\n`);
    const decision = planWorkspace(
      observation({
        cwd: {
          absolutePath: directory,
          empty: false,
          git: true,
          githubOwner: "acme",
          githubRepository: "central",
          looksLikeFoundry: false,
          inventory: { status: "populated", count: 2 },
        },
      }),
      host(directory),
      { inventoryPath: "supplied.json" },
    );
    expect(decision).toMatchObject({ action: "adopt", mergedInventoryIds: ["hub-a", "hub-c", "hub-b", "hub-d"] });
    expect(decision).not.toHaveProperty("inventorySource");
  });
});

describe("hasAdvisorPin", () => {
  it("finds a pin in any dependency bucket and rejects a pinless manifest", () => {
    expect(hasAdvisorPin({ dependencies: { [ADVISOR_PACKAGE]: "0.2.1" } })).toBe(true);
    expect(hasAdvisorPin({ optionalDependencies: { [ADVISOR_PACKAGE]: "0.2.1" } })).toBe(true);
    expect(hasAdvisorPin({ peerDependencies: { [ADVISOR_PACKAGE]: "0.2.1" } })).toBe(true);
    expect(hasAdvisorPin({ devDependencies: { react: "19.0.0" } })).toBe(false);
    expect(hasAdvisorPin("not-an-object")).toBe(false);
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
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as {
      name: string;
      devDependencies: Record<string, string>;
    };
    expect(manifest.name).toBe("@acme/workspace");
    expect(manifest.devDependencies[ADVISOR_PACKAGE]).toBe("0.1.5");
    expect(manifest.devDependencies["@clossys/starter"]).toBeUndefined();
    expect(manifest.devDependencies["@clossys/controller"]).toBeUndefined();
    expect(manifest.devDependencies["@clossys/architect"]).toBeUndefined();
    expect(manifest.devDependencies["@clossys/bouncer"]).toBeUndefined();
    expect(JSON.parse(readFileSync(join(directory, WORKSPACE_MARKER_REL), "utf8"))).toMatchObject({ kind: "account-hub", owner: "acme" });
    expect(inspectInventory(readFileSync(join(directory, WORKSPACE_INVENTORY_REL), "utf8"))).toEqual({ status: "empty", count: 0 });
    expect(readFileSync(join(directory, "AGENTS.md"), "utf8")).toContain("@clossys-advisor");
    expect(readFileSync(join(directory, "AGENTS.md"), "utf8")).not.toMatch(/again to resume/i);
    expect(readFileSync(join(directory, "AGENTS.md"), "utf8")).toContain("Speak like a");
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

  it("relocates an existing Advisor pin into devDependencies at the live version", () => {
    const directory = tempDir();
    writeFileSync(
      join(directory, "package.json"),
      `${JSON.stringify({ name: "hub", dependencies: { [ADVISOR_PACKAGE]: "0.2.1", react: "19.0.0" } }, null, 2)}\n`,
    );
    writeInventory(directory);
    applyWorkspacePlan(
      host(directory),
      { action: "adopt", owner: "acme", repository: "hub", directory, advisorVersion: "0.2.3" },
      skeletonRoot,
    );
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as {
      name: string;
      dependencies: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(manifest.name).toBe("hub");
    expect(manifest.dependencies[ADVISOR_PACKAGE]).toBeUndefined();
    expect(manifest.dependencies.react).toBe("19.0.0");
    expect(manifest.devDependencies?.[ADVISOR_PACKAGE]).toBe("0.2.3");
  });

  it("overwrites a frozen Advisor devDependency with the live version", () => {
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
    expect(manifest.devDependencies[ADVISOR_PACKAGE]).toBe("0.2.3");
  });

  it("names a dedicated workspace hub @owner/workspace without rewriting a product name", () => {
    const directory = tempDir();
    writeFileSync(
      join(directory, "package.json"),
      `${JSON.stringify({ name: "workspace-control-plane", private: true }, null, 2)}\n`,
    );
    writeInventory(directory);
    applyWorkspacePlan(
      host(directory),
      { action: "adopt", owner: "acme", repository: DEFAULT_REPOSITORY_NAME, directory, advisorVersion: "0.2.3" },
      skeletonRoot,
    );
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as {
      name: string;
      devDependencies: Record<string, string>;
    };
    expect(manifest.name).toBe("@acme/workspace");
    expect(manifest.devDependencies[ADVISOR_PACKAGE]).toBe("0.2.3");
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
    expect(manifest.dependencies[ADVISOR_PACKAGE]).toBeUndefined();
    expect(manifest.devDependencies?.[ADVISOR_PACKAGE]).toBe("0.2.3");
    expect(result.health.extraClossys).toEqual(["@clossys/starter"]);
    expect(result.health.dualPin).toBe(false);
    expect(result.health.degraded).toBe(false);
    expect(result.message).toMatch(/health:/);
  });

  it("refuses adopt on a dirty tree and writes nothing", () => {
    const directory = tempDir();
    writeFileSync(join(directory, "package.json"), `${JSON.stringify({ name: "product" }, null, 2)}\n`);
    writeInventory(directory);
    mkdirSync(join(directory, ".git"), { recursive: true });
    const commands: Record<string, CommandResult> = {
      "git status --porcelain": { status: 0, stdout: " M src/app.ts\n", stderr: "" },
      "git remote get-url origin": { status: 0, stdout: "https://gitlab.example.net/acme/product.git\n", stderr: "" },
    };
    expect(() =>
      applyWorkspacePlan(
        host(directory, commands),
        { action: "adopt", owner: "acme", repository: "product", directory, advisorVersion: "0.2.3" },
        skeletonRoot,
      ),
    ).toThrow(/gitlab\.example\.net.*uncommitted changes/s);
    expect(JSON.parse(readFileSync(join(directory, "package.json"), "utf8"))).toEqual({ name: "product" });
    expect(existsSync(join(directory, WORKSPACE_MARKER_REL))).toBe(false);
  });

  it("names a github.com origin generically in the dirty-tree refusal", () => {
    const directory = tempDir();
    writeFileSync(join(directory, "package.json"), `${JSON.stringify({ name: "product" }, null, 2)}\n`);
    writeInventory(directory);
    mkdirSync(join(directory, ".git"), { recursive: true });
    const commands: Record<string, CommandResult> = {
      "git status --porcelain": { status: 0, stdout: "?? notes.txt\n", stderr: "" },
      "git remote get-url origin": { status: 0, stdout: "git@github.com:acme/product.git\n", stderr: "" },
    };
    expect(() =>
      applyWorkspacePlan(
        host(directory, commands),
        { action: "adopt", owner: "acme", repository: "product", directory, advisorVersion: "0.2.3" },
        skeletonRoot,
      ),
    ).toThrow(/this checkout has uncommitted changes/);
  });

  it("writes merged inventory ids when both the on-disk inventory and --inventory are populated", () => {
    const directory = tempDir();
    writeInventory(directory, [{ id: "hub-a" }, { id: "hub-c" }]);
    const source = join(directory, "supplied.json");
    writeFileSync(source, `${JSON.stringify({ schemaVersion: 1, repositories: [{ id: "hub-b" }, { id: "hub-a" }] }, null, 2)}\n`);
    applyWorkspacePlan(
      host(directory),
      {
        action: "adopt",
        owner: "acme",
        repository: "hub",
        directory,
        advisorVersion: "0.2.3",
        mergedInventoryIds: ["hub-a", "hub-c", "hub-b"],
      },
      skeletonRoot,
    );
    expect(inspectInventory(readFileSync(join(directory, WORKSPACE_INVENTORY_REL), "utf8"))).toEqual({
      status: "populated",
      count: 3,
    });
    const ids = (JSON.parse(readFileSync(join(directory, WORKSPACE_INVENTORY_REL), "utf8")) as { repositories: { id: string }[] })
      .repositories.map((entry) => entry.id);
    expect(ids).toEqual(["hub-a", "hub-c", "hub-b"]);
  });

  it("reports health on resume and composes skills plus refreshed guidance", () => {
    const directory = tempDir();
    mkdirSync(join(directory, ".clossys"), { recursive: true });
    writeFileSync(
      join(directory, WORKSPACE_MARKER_REL),
      `${JSON.stringify({ schemaVersion: 1, kind: "account-hub", owner: "acme", repository: "acme/hub" }, null, 2)}\n`,
    );
    writeInventory(directory);
    writeFileSync(join(directory, "AGENTS.md"), LEGACY_CONSUMER_AGENTS_MD);
    const catalogue = seedSkillCatalogue(["advisor", "designer"]);
    const result = applyWorkspacePlan(
      host(directory),
      { action: "resume", owner: "acme", repository: "hub", directory, clone: false },
      skeletonRoot,
      composeApplyOptions(catalogue),
    );
    expect(result.health.marker).toBe("present");
    expect(result.health.inventory.status).toBe("populated");
    expect(readFileSync(join(directory, ".agents/skills/clossys-advisor/SKILL.md"), "utf8")).toContain("name: clossys-advisor");
    expect(readFileSync(join(directory, ".agents/skills/clossys-designer/SKILL.md"), "utf8")).toContain("name: clossys-designer");
    const agents = readFileSync(join(directory, "AGENTS.md"), "utf8");
    expect(agents).toContain("@clossys-advisor");
    expect(agents).not.toMatch(/again to resume/i);
    expect(reportHubHealth(host(directory), directory).marker).toBe("present");
  });

  it("composes skills into the hub and sibling clones resolved from inventory", () => {
    const parent = tempDir();
    const hub = join(parent, "hub");
    const app = join(parent, "app");
    const other = join(parent, "other");
    const foundry = join(parent, "foundry");
    for (const directory of [hub, app, other, foundry]) mkdirSync(directory, { recursive: true });
    mkdirSync(join(hub, ".clossys"), { recursive: true });
    writeFileSync(
      join(hub, WORKSPACE_MARKER_REL),
      `${JSON.stringify({ schemaVersion: 1, kind: "account-hub", owner: "acme", repository: "acme/hub" }, null, 2)}\n`,
    );
    writeInventory(hub, [
      { id: "acme/app" },
      { id: "acme/missing" },
      { id: "acme/other" },
      { id: "acme/foundry" },
    ]);
    for (const directory of [app, other, foundry]) mkdirSync(join(directory, ".git"), { recursive: true });
    writeFileSync(join(foundry, "AGENTS.md"), "# supplier tree\n");
    mkdirSync(join(foundry, "packages", "advisor"), { recursive: true });
    writeFileSync(join(foundry, "packages", "advisor", "package.json"), "{}");
    mkdirSync(join(foundry, "docs"), { recursive: true });
    writeFileSync(join(foundry, "docs", "LIFECYCLE.md"), "# lifecycle\n");
    const gitRemotes: Record<string, string> = {
      [app]: "git@github.com:acme/app.git",
      [other]: "git@github.com:otherowner/other.git",
      [foundry]: "git@github.com:acme/foundry.git",
    };
    const base = host(hub);
    const workspaceHost: WorkspaceHost = {
      ...base,
      run: (command, args, opts) => {
        const cwd = opts?.cwd ?? hub;
        if (command === "git" && args[0] === "remote" && args[1] === "get-url" && args[2] === "origin") {
          const url = gitRemotes[cwd];
          if (url !== undefined) return { status: 0, stdout: `${url}\n`, stderr: "" };
          return { status: 1, stdout: "", stderr: "no remote" };
        }
        return base.run(command, args, opts);
      },
    };
    const catalogue = seedSkillCatalogue(["advisor", "designer"]);
    const result = applyWorkspacePlan(
      workspaceHost,
      { action: "resume", owner: "acme", repository: "hub", directory: hub, clone: false },
      skeletonRoot,
      composeApplyOptions(catalogue),
    );
    expect(readFileSync(join(hub, ".agents/skills/clossys-advisor/SKILL.md"), "utf8")).toContain("clossys-advisor");
    expect(readFileSync(join(app, ".agents/skills/clossys-advisor/SKILL.md"), "utf8")).toContain("clossys-advisor");
    expect(existsSync(join(other, ".agents/skills/clossys-advisor/SKILL.md"))).toBe(false);
    expect(existsSync(join(foundry, ".agents/skills/clossys-advisor/SKILL.md"))).toBe(false);
    expect(readFileSync(join(app, "AGENTS.md"), "utf8")).toContain("@clossys-advisor");
    expect(result.health.skillComposition?.rosterTargets).toEqual(expect.arrayContaining(["acme/hub", "acme/app"]));
    expect(result.message).toMatch(/skill roster skipped \(acme\/missing\)/);
    expect(result.message).toMatch(/skill roster skipped \(acme\/other\).*origin does not match/);
    expect(result.message).toMatch(/skill roster skipped \(acme\/foundry\).*foundry supplier/);
    expect(result.state).toBe("satisfied");
  });

  it("composes catalogue skills on create and adopt", () => {
    const catalogue = seedSkillCatalogue(["advisor", "designer"]);
    const applyOpts = composeApplyOptions(catalogue);
    const created = tempDir();
    applyWorkspacePlan(
      host(created, {
        [`gh repo create acme/workspace --private --source ${created} --remote origin --push`]: { status: 0, stdout: "created\n", stderr: "" },
      }),
      { action: "create", owner: "acme", repository: "workspace", directory: created, advisorVersion: "0.1.5" },
      skeletonRoot,
      applyOpts,
    );
    expect(readFileSync(join(created, ".agents/skills/clossys-advisor/SKILL.md"), "utf8")).toContain("clossys-advisor");
    expect(readFileSync(join(created, ".agents/skills/clossys-designer/SKILL.md"), "utf8")).toContain("clossys-designer");

    const adopted = tempDir();
    writeInventory(adopted);
    applyWorkspacePlan(
      host(adopted),
      { action: "adopt", owner: "acme", repository: "hub", directory: adopted, advisorVersion: "0.1.5" },
      skeletonRoot,
      applyOpts,
    );
    expect(readFileSync(join(adopted, ".agents/skills/clossys-designer/SKILL.md"), "utf8")).toContain("clossys-designer");
  });

  it("grades a stale pin as degraded and an equal exclusive devDependency as current", () => {
    const directory = tempDir();
    writeFileSync(
      join(directory, "package.json"),
      `${JSON.stringify({ name: "hub", devDependencies: { [ADVISOR_PACKAGE]: "0.1.0" } }, null, 2)}\n`,
    );
    writeInventory(directory);
    const stale = reportHubHealth(host(directory), directory, "0.2.0");
    expect(stale.pinFindings).toEqual([
      { bucket: "devDependencies", pinned: "0.1.0", grade: "stale", note: expect.stringContaining("older than live 0.2.0") },
    ]);
    expect(stale.degraded).toBe(true);
    expect(formatHubHealth(stale)).toMatch(/pin findings: devDependencies pinned 0\.1\.0 is older than live 0\.2\.0/);
    expect(formatHubHealth(stale)).toMatch(/degraded: yes/);
    const current = reportHubHealth(host(directory), directory, "0.1.0");
    expect(current.pinFindings).toEqual([]);
    expect(current.degraded).toBe(false);
  });

  it("degrades a current Advisor pin that is not exclusively in devDependencies", () => {
    const directory = tempDir();
    writeFileSync(
      join(directory, "package.json"),
      `${JSON.stringify({ name: "hub", dependencies: { [ADVISOR_PACKAGE]: "0.2.0" } }, null, 2)}\n`,
    );
    const misplaced = reportHubHealth(host(directory), directory, "0.2.0");
    expect(misplaced.pinFindings).toEqual([]);
    expect(misplaced.degraded).toBe(true);
    writeFileSync(join(directory, "package.json"), `${JSON.stringify({ name: "hub" }, null, 2)}\n`);
    const absent = reportHubHealth(host(directory), directory, "0.2.0");
    expect(absent.degraded).toBe(true);
  });

  it("marks an unparseable pin-versus-live comparison as indeterminate, not stale", () => {
    const directory = tempDir();
    writeFileSync(
      join(directory, "package.json"),
      `${JSON.stringify({ name: "hub", devDependencies: { [ADVISOR_PACKAGE]: "next" } }, null, 2)}\n`,
    );
    const report = reportHubHealth(host(directory), directory, "0.2.0");
    expect(report.pinFindings).toEqual([
      { bucket: "devDependencies", pinned: "next", grade: "indeterminate", note: expect.stringContaining("cannot compare") },
    ]);
    expect(report.degraded).toBe(false);
  });

  it("scans optionalDependencies and peerDependencies for pins and extra names", () => {
    const directory = tempDir();
    writeFileSync(
      join(directory, "package.json"),
      `${JSON.stringify(
        {
          name: "hub",
          optionalDependencies: { [ADVISOR_PACKAGE]: "0.2.1", "@clossys/writer": "0.1.0" },
          peerDependencies: { [ADVISOR_PACKAGE]: "0.2.0" },
        },
        null,
        2,
      )}\n`,
    );
    const report = reportHubHealth(host(directory), directory, "0.2.2");
    expect(report.advisorPin.optionalDependencies).toBe("0.2.1");
    expect(report.advisorPin.peerDependencies).toBe("0.2.0");
    expect(report.dualPin).toBe(true);
    expect(report.degraded).toBe(true);
    expect(report.extraClossys).toEqual(["@clossys/writer"]);
    expect(report.pinFindings.map((finding) => finding.bucket)).toEqual(["optionalDependencies", "peerDependencies"]);
  });

  it("validates inventory ids read-only, skipping when gh is unavailable", () => {
    const directory = tempDir();
    writeInventory(directory, [{ id: "acme/alpha" }, { id: "acme/gone" }, { id: "acme/beta" }]);
    const commands = (viewStatuses: Record<string, number>): Record<string, CommandResult> => ({
      "gh --version": { status: 0, stdout: "gh 2.0.0\n", stderr: "" },
      ...Object.fromEntries(
        Object.entries(viewStatuses).map(([id, status]) => [
          `gh repo view ${id} --json name`,
          { status, stdout: status === 0 ? `{"name":"${id.split("/")[1]}"}\n` : "", stderr: status === 0 ? "" : "not found" },
        ]),
      ),
    });
    const checked = checkInventoryEntries(host(directory, commands({ "acme/alpha": 0, "acme/gone": 1, "acme/beta": 0 })), directory);
    expect(checked.skipped).toBe(false);
    expect(checked.entries).toEqual([
      { id: "acme/alpha", known: true },
      { id: "acme/gone", known: false, note: expect.stringContaining("may not exist") },
      { id: "acme/beta", known: true },
    ]);
    const skipped = checkInventoryEntries(host(directory, {}), directory);
    expect(skipped.skipped).toBe(true);
    expect(skipped.note).toMatch(/`gh` is unavailable/);
    expect(skipped.entries).toEqual([]);
    expect(readFileSync(join(directory, WORKSPACE_INVENTORY_REL), "utf8")).toContain("acme/gone");
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

  it("always reads the public Advisor version, even when a pin already exists", () => {
    const directory = tempDir();
    mkdirSync(join(directory, ".git"));
    writeFileSync(
      join(directory, "package.json"),
      `${JSON.stringify({ name: "hub", optionalDependencies: { [ADVISOR_PACKAGE]: "0.2.1" } }, null, 2)}\n`,
    );
    const seen = observeWorkspace(
      host(directory, {
        "gh --version": { status: 0, stdout: "gh 2.0.0\n", stderr: "" },
        "git --version": { status: 0, stdout: "git 2.0.0\n", stderr: "" },
        "git remote get-url origin": { status: 0, stdout: "git@github.com:acme/central.git\n", stderr: "" },
        "gh api user --jq .login": { status: 0, stdout: "acme\n", stderr: "" },
        "gh org list": { status: 0, stdout: "", stderr: "" },
        "gh repo view acme/workspace --json name": { status: 1, stdout: "", stderr: "not found" },
        "npm view @clossys/advisor version": { status: 0, stdout: "0.2.6\n", stderr: "" },
      }),
    );
    expect(seen.cwd.githubOwner).toBe("acme");
    expect(seen.cwd.inventory).toEqual({ status: "missing", count: 0 });
    expect(seen.advisorVersion).toBe("0.2.6");
  });
});
