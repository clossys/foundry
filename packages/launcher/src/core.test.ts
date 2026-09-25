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
  cloneMissingInventoryRepositories,
  checkInventoryEntries,
  formatHubHealth,
  hasAdvisorPin,
  inspectInventory,
  isHubDocument,
  observeWorkspace,
  parseGitHubRemote,
  planWorkspace,
  reportHubHealth,
  validateInventoryDocument,
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
    readBytes: (path) => {
      try {
        return readFileSync(path);
      } catch {
        return null;
      }
    },
    writeBytes: (path, contents) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, contents);
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
    remove: (path) => {
      rmSync(path, { recursive: true, force: true });
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
  mkdirSync(dirname(join(directory, WORKSPACE_INVENTORY_REL)), { recursive: true });
  writeFileSync(
    join(directory, WORKSPACE_INVENTORY_REL),
    `${JSON.stringify({ schemaVersion: 1, repositories }, null, 2)}\n`,
  );
}

function writeLegacyHub(directory: string, owner: string, repository: string, repositories: readonly unknown[] = [{ id: "app" }]): void {
  mkdirSync(join(directory, ".clossys"), { recursive: true });
  writeFileSync(
    join(directory, ".clossys", "workspace.json"),
    `${JSON.stringify({ schemaVersion: 1, kind: "account-hub", owner, repository: `${owner}/${repository}` }, null, 2)}\n`,
  );
  writeFileSync(
    join(directory, ".clossys", "inventory.json"),
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
    if (missing.action === "refuse") {
      // #1179: point the founder at choosing repositories, not at hand-writing a document.
      expect(missing.message).toMatch(/has no inventory yet: choose the repositories this hub covers on Advisor's repository card/);
      expect(missing.message).toMatch(/launcher --repositories/);
      expect(missing.message).not.toMatch(/--inventory/);
    }
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

  it("merges ids that differ only in letter case as one repository, keeping the on-disk entry and its packages, and writes a document the validator accepts", () => {
    const directory = tempDir();
    const kept = [{ name: "@example-scope/writer", version: "1.2.3", wiring: "devDependencies" }];
    writeInventory(directory, [{ id: "Example-Owner/App", packages: kept }, { id: "hub-c" }]);
    const source = join(directory, "supplied.json");
    writeFileSync(source, `${JSON.stringify({ schemaVersion: 1, repositories: [{ id: "example-owner/app" }, { id: "hub-d", packages: [] }] }, null, 2)}\n`);
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
    expect(decision).toMatchObject({
      action: "adopt",
      mergedInventoryIds: ["Example-Owner/App", "hub-c", "hub-d"],
      mergedInventoryRepositories: [{ id: "Example-Owner/App", packages: kept }, { id: "hub-c" }, { id: "hub-d", packages: [] }],
    });
    if (!("action" in decision) || decision.action !== "adopt") throw new Error("expected an adopt plan");
    applyWorkspacePlan(host(directory), decision, skeletonRoot);
    const written = readFileSync(join(directory, WORKSPACE_INVENTORY_REL), "utf8");
    expect(validateInventoryDocument(written)).toEqual({ valid: true, ids: ["Example-Owner/App", "hub-c", "hub-d"] });
    expect((JSON.parse(written) as { repositories: { packages?: unknown }[] }).repositories[0]?.packages).toEqual(kept);
  });
});

describe("validateInventoryDocument (#1334)", () => {
  it("accepts a well-formed populated document", () => {
    expect(validateInventoryDocument(JSON.stringify({ schemaVersion: 1, repositories: [{ id: "app" }, { id: "site" }] }))).toEqual({
      valid: true,
      ids: ["app", "site"],
    });
  });

  it("accepts a well-formed empty document", () => {
    expect(validateInventoryDocument(JSON.stringify({ schemaVersion: 1, repositories: [] }))).toEqual({ valid: true, ids: [] });
  });

  it("refuses garbage that is not valid JSON", () => {
    const result = validateInventoryDocument("not json at all {{{");
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) expect(result.reason).toMatch(/not valid JSON/);
  });

  it("refuses an empty file", () => {
    const result = validateInventoryDocument("");
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) expect(result.reason).toMatch(/not valid JSON/);
  });

  it("refuses a document that is not a JSON object", () => {
    const result = validateInventoryDocument(JSON.stringify(["app"]));
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) expect(result.reason).toMatch(/must be an object \(the hub repository inventory\), got array/);
  });

  it("refuses an unrecognized top-level field, by position", () => {
    const result = validateInventoryDocument(JSON.stringify({ schemaVersion: 1, repositories: [{ id: "app" }], generatedAt: "2026-01-01" }));
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) {
      expect(result.reason).toMatch(/^has a field the contract does not declare \(key 3 of this object\)/);
      expect(result.reason).not.toContain("generatedAt");
    }
  });

  it("refuses schemaVersion values other than 1 (wrong type)", () => {
    const result = validateInventoryDocument(JSON.stringify({ schemaVersion: "1", repositories: [{ id: "app" }] }));
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) expect(result.reason).toMatch(/schemaVersion must equal 1/);
  });

  it("refuses a non-array repositories field (wrong type)", () => {
    const result = validateInventoryDocument(JSON.stringify({ schemaVersion: 1, repositories: { app: true } }));
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) expect(result.reason).toMatch(/repositories must be an array/);
  });

  it("refuses a repository entry that is not an object", () => {
    const result = validateInventoryDocument(JSON.stringify({ schemaVersion: 1, repositories: ["app"] }));
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) expect(result.reason).toMatch(/repositories\[0\] must be an object/);
  });

  it("refuses a repository entry missing its required id field", () => {
    const result = validateInventoryDocument(JSON.stringify({ schemaVersion: 1, repositories: [{}] }));
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) expect(result.reason).toMatch(/repositories\[0\]\.id is required/);
  });

  it("refuses a repository entry carrying an unrecognized field alongside a valid id", () => {
    const result = validateInventoryDocument(JSON.stringify({ schemaVersion: 1, repositories: [{ id: "app", role: "product" }] }));
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) expect(result.reason).toMatch(/repositories\[0\] has a field the contract does not declare \(key \d+ of this object\), and unknown fields are refused/);
  });

  it("refuses a repository entry whose id is not a string (wrong type)", () => {
    const result = validateInventoryDocument(JSON.stringify({ schemaVersion: 1, repositories: [{ id: 42 }] }));
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) expect(result.reason).toMatch(/repositories\[0\]\.id must be a bare repository name or owner\/name.*, got integer/);
  });

  it("refuses a governance-record-shaped entry carrying unrecognized fields (issue #1334 repro)", () => {
    // The exact shape reported in #1334: entries close enough to look like an
    // inventory (id, role, visibility, status, notes) but not actually one.
    const result = validateInventoryDocument(
      JSON.stringify({
        schemaVersion: 1,
        repositories: [
          { id: "app", role: "product", visibility: "public", status: "active", notes: "primary surface" },
          { id: "site", role: "marketing", visibility: "public", status: "active", notes: "" },
        ],
      }),
    );
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) expect(result.reason).toMatch(/repositories\[0\] has a field the contract does not declare \(key \d+ of this object\), and unknown fields are refused/);
  });

  it("refuses a duplicate repository id", () => {
    const result = validateInventoryDocument(JSON.stringify({ schemaVersion: 1, repositories: [{ id: "app" }, { id: "app" }] }));
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) expect(result.reason).toMatch(/repositories\[1\]\.id names the same repository as repositories\[0\]\.id/);
  });

  it("refuses two ids naming the same repository under a different letter case", () => {
    const result = validateInventoryDocument(JSON.stringify({ schemaVersion: 1, repositories: [{ id: "Acme/App" }, { id: "acme/app" }] }));
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) {
      expect(result.reason).toMatch(/repositories\[1\]\.id names the same repository as repositories\[0\]\.id \(repository ids are compared case-insensitively/);
      expect(result.reason).not.toMatch(/acme/i);
    }
  });

  it("accepts a bare repository name and an owner/name id (ADOPTION.md's own example shape)", () => {
    expect(validateInventoryDocument(JSON.stringify({ schemaVersion: 1, repositories: [{ id: "app" }, { id: "acme/site" }] }))).toEqual({
      valid: true,
      ids: ["app", "acme/site"],
    });
  });

  it.each([
    ["acme/app/extra", "more than one /"],
    ["acme/", "empty segment"],
    ["/app", "empty segment"],
    [".", "\".\" segment"],
    ["..", "\"..\" segment"],
    ["acme/..", "\"..\" segment"],
    [" app", "leading whitespace"],
    ["app ", "trailing whitespace"],
    ["ac me/app", "internal whitespace"],
  ])("refuses id %j as not a valid repository id (%s)", (id) => {
    const result = validateInventoryDocument(JSON.stringify({ schemaVersion: 1, repositories: [{ id }] }));
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) {
      expect(result.reason).toMatch(/^repositories\[0\]\.id must be a bare repository name or owner\/name/);
      // Position only: the refused id itself is never echoed (#1179).
      if (id.trim() !== "" && id.trim().length > 2) expect(result.reason).not.toContain(id.trim());
    }
  });

  it("accepts a repository entry whose packages field matches Integrator's InventoryPackageEntry exactly (#996)", () => {
    const result = validateInventoryDocument(
      JSON.stringify({
        schemaVersion: 1,
        repositories: [
          {
            id: "app",
            packages: [
              { name: "@example-scope/one", version: "2.0.0" },
              { name: "@example-scope/stray", wiring: "unknown" },
              { name: "@example-scope/pinned" },
            ],
          },
        ],
      }),
    );
    expect(result).toEqual({ valid: true, ids: ["app"] });
  });

  it("accepts an empty packages array", () => {
    expect(
      validateInventoryDocument(JSON.stringify({ schemaVersion: 1, repositories: [{ id: "app", packages: [] }] })),
    ).toEqual({ valid: true, ids: ["app"] });
  });

  it("refuses a non-array packages field", () => {
    const result = validateInventoryDocument(JSON.stringify({ schemaVersion: 1, repositories: [{ id: "app", packages: { name: "x" } }] }));
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) expect(result.reason).toMatch(/repositories\[0\]\.packages must be an array/);
  });

  it("refuses a packages entry carrying an unrecognized field", () => {
    const result = validateInventoryDocument(
      JSON.stringify({ schemaVersion: 1, repositories: [{ id: "app", packages: [{ name: "x", declaredRange: "^1.0.0" }] }] }),
    );
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) expect(result.reason).toMatch(/repositories\[0\]\.packages\[0\] has a field the contract does not declare \(key \d+ of this object\)/);
  });

  it("refuses a packages entry missing its required name", () => {
    const result = validateInventoryDocument(JSON.stringify({ schemaVersion: 1, repositories: [{ id: "app", packages: [{ version: "1.0.0" }] }] }));
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) expect(result.reason).toMatch(/repositories\[0\]\.packages\[0\]\.name is required/);
  });

  it("refuses a packages entry with an invalid wiring value", () => {
    const result = validateInventoryDocument(
      JSON.stringify({ schemaVersion: 1, repositories: [{ id: "app", packages: [{ name: "x", wiring: "bundledDependencies" }] }] }),
    );
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) expect(result.reason).toMatch(/repositories\[0\]\.packages\[0\]\.wiring must be one of/);
  });

  it("every failure reason points at the contract", () => {
    const result = validateInventoryDocument(JSON.stringify({ schemaVersion: 1, repositories: [{ id: "app", role: "product" }] }));
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) expect(result.reason).toMatch(/repository-inventory\.json/);
  });
});

describe("inspectInventory reports invalid documents distinctly from empty (#1334)", () => {
  it("reports missing for no file", () => {
    expect(inspectInventory(null)).toEqual({ status: "missing", count: 0 });
  });

  it("reports empty for a well-formed zero-entry document", () => {
    expect(inspectInventory(JSON.stringify({ schemaVersion: 1, repositories: [] }))).toEqual({ status: "empty", count: 0 });
  });

  it("reports invalid, with a reason, for a malformed document instead of silently treating it as empty", () => {
    const observation = inspectInventory(JSON.stringify({ schemaVersion: 1, repositories: [{ id: "app", role: "product" }] }));
    expect(observation.status).toBe("invalid");
    expect(observation.count).toBe(0);
    expect(observation.reason).toMatch(/repositories\[0\] has a field the contract does not declare \(key \d+ of this object\)/);
  });

  it("reports invalid for garbage JSON instead of silently treating it as empty", () => {
    const observation = inspectInventory("{{{not json");
    expect(observation.status).toBe("invalid");
    expect(observation.reason).toMatch(/not valid JSON/);
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
    expect(result.health.degraded).toBe(true);
    expect(result.message).toMatch(/skill roster skipped/);
    expect(result.message).toMatch(/health:/);
  });

  it("refuses adopt with a schema-invalid --inventory and writes nothing, even re-validated at apply time (#1334)", () => {
    const directory = tempDir();
    const source = join(directory, "governance-record.json");
    // The exact #1334 repro shape: a repositories array whose entries look
    // inventory-adjacent (id, role, visibility, status, notes) but are not.
    writeFileSync(
      source,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          repositories: [
            { id: "app", role: "product", visibility: "public", status: "active", notes: "primary" },
            { id: "site", role: "marketing", visibility: "public", status: "active", notes: "" },
          ],
        },
        null,
        2,
      )}\n`,
    );
    expect(() =>
      applyWorkspacePlan(
        host(directory),
        { action: "adopt", owner: "acme", repository: "hub", directory, advisorVersion: "0.2.3", inventorySource: source },
        skeletonRoot,
      ),
    ).toThrow(/repositories\[0\] has a field the contract does not declare \(key \d+ of this object\)/);
    expect(existsSync(join(directory, WORKSPACE_MARKER_REL))).toBe(false);
    expect(existsSync(join(directory, WORKSPACE_INVENTORY_REL))).toBe(false);
    expect(existsSync(join(directory, "clossys"))).toBe(false);
    expect(existsSync(join(directory, "package.json"))).toBe(false);
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

  it("writes merged entries whole from a plan carrying mergedInventoryRepositories without mergedInventoryDocument", () => {
    const directory = tempDir();
    writeInventory(directory, [{ id: "hub-a" }]);
    const kept = [{ name: "@example-scope/writer", version: "1.2.3", wiring: "devDependencies" }];
    applyWorkspacePlan(
      host(directory),
      {
        action: "adopt",
        owner: "acme",
        repository: "hub",
        directory,
        advisorVersion: "0.2.3",
        mergedInventoryIds: ["hub-a", "hub-b"],
        mergedInventoryRepositories: [{ id: "hub-a", packages: kept }, { id: "hub-b" }],
      },
      skeletonRoot,
    );
    const written = readFileSync(join(directory, WORKSPACE_INVENTORY_REL), "utf8");
    expect(validateInventoryDocument(written, { hubOwner: "acme" })).toEqual({ valid: true, ids: ["hub-a", "hub-b"] });
    expect((JSON.parse(written) as { repositories: { packages?: unknown }[] }).repositories[0]?.packages).toEqual(kept);
  });

  it("refuses to write a plan's mergedInventoryRepositories that fail the inventory contract, before touching any file", () => {
    const directory = tempDir();
    writeInventory(directory, [{ id: "hub-a" }]);
    const before = readFileSync(join(directory, WORKSPACE_INVENTORY_REL), "utf8");
    expect(() =>
      applyWorkspacePlan(
        host(directory),
        {
          action: "adopt",
          owner: "acme",
          repository: "hub",
          directory,
          advisorVersion: "0.2.3",
          mergedInventoryIds: ["hub-a", "acme/hub-a"],
          mergedInventoryRepositories: [{ id: "hub-a" }, { id: "acme/hub-a" }],
        },
        skeletonRoot,
      ),
    ).toThrow(/the merged inventory repositories\[1\]\.id names the same repository as repositories\[0\]\.id/);
    expect(readFileSync(join(directory, WORKSPACE_INVENTORY_REL), "utf8")).toBe(before);
    expect(existsSync(join(directory, WORKSPACE_MARKER_REL))).toBe(false);
  });

  it("reportHubHealth reports a corrupted stored inventory as invalid, not silently as empty (#1334)", () => {
    // This exercises reportHubHealth directly, read-only -- not the full
    // resume path (applyWorkspacePlan with action: "resume"); see the
    // "resume with an invalid stored inventory" test below for that.
    const directory = tempDir();
    mkdirSync(dirname(join(directory, WORKSPACE_MARKER_REL)), { recursive: true });
    writeFileSync(
      join(directory, WORKSPACE_MARKER_REL),
      `${JSON.stringify({ schemaVersion: 1, kind: "account-hub", owner: "acme", repository: "acme/hub" }, null, 2)}\n`,
    );
    // Corrupted in place -- e.g. hand-edited or overwritten by something
    // else -- carrying fields the schema does not recognize.
    mkdirSync(dirname(join(directory, WORKSPACE_INVENTORY_REL)), { recursive: true });
    writeFileSync(
      join(directory, WORKSPACE_INVENTORY_REL),
      `${JSON.stringify({ schemaVersion: 1, repositories: [{ id: "acme/app", visibility: "public" }] }, null, 2)}\n`,
    );
    const report = reportHubHealth(host(directory), directory);
    expect(report.inventory.status).toBe("invalid");
    expect(report.inventory.count).toBe(0);
    expect(report.inventory.reason).toMatch(/repositories\[0\] has a field the contract does not declare \(key \d+ of this object\)/);
    expect(report.inventory.reason).toMatch(/repository-inventory\.json/);
    expect(formatHubHealth(report)).toMatch(/inventory: invalid -- .*repositories\[0\] has a field the contract does not declare/);
    // Read-only: reportHubHealth never rewrites clossys/.state/inventory.json,
    // and the corrupted content is left exactly as is.
    expect(readFileSync(join(directory, WORKSPACE_INVENTORY_REL), "utf8")).toContain("visibility");
  });

  it("resume with an invalid stored inventory writes nothing into a sibling checkout and clones nothing (#1334)", () => {
    const parent = tempDir();
    const hub = join(parent, "hub");
    const app = join(parent, "app");
    mkdirSync(dirname(join(hub, WORKSPACE_MARKER_REL)), { recursive: true });
    writeFileSync(
      join(hub, WORKSPACE_MARKER_REL),
      `${JSON.stringify({ schemaVersion: 1, kind: "account-hub", owner: "acme", repository: "acme/hub" }, null, 2)}\n`,
    );
    // The exact B2 probe: entries that look inventory-shaped but carry a
    // field the schema does not recognize -- the #1334 governance-record
    // failure mode, this time sitting in the STORED inventory, read back on
    // resume rather than supplied via --inventory.
    writeInventory(hub, [
      { id: "acme/app", role: "governance" },
      { id: "acme/missing", role: "x" },
    ]);
    mkdirSync(join(app, ".git"), { recursive: true });
    const before = readdirSync(app).sort();
    const catalogue = tempDir();
    const base = host(hub);
    let cloneAttempted = false;
    const workspaceHost: WorkspaceHost = {
      ...base,
      run: (command, args, opts) => {
        if (command === "gh" && args[0] === "repo" && args[1] === "clone") cloneAttempted = true;
        return base.run(command, args, opts);
      },
    };
    const result = applyWorkspacePlan(
      workspaceHost,
      { action: "resume", owner: "acme", repository: "hub", directory: hub, clone: false },
      skeletonRoot,
      composeApplyOptions(catalogue),
    );
    expect(result.health.inventory.status).toBe("invalid");
    expect(result.health.skillComposition?.rosterSkipped).toEqual([
      { inventoryId: WORKSPACE_INVENTORY_REL, note: expect.stringContaining("repositories[0] has a field the contract does not declare") },
    ]);
    expect(result.health.degraded).toBe(true);
    // Nothing was written into the sibling: its directory listing is exactly
    // what this test itself seeded, and no skill or guidance file landed.
    expect(readdirSync(app).sort()).toEqual(before);
    expect(existsSync(join(app, ".agents"))).toBe(false);
    expect(existsSync(join(app, "AGENTS.md"))).toBe(false);
    expect(cloneAttempted).toBe(false);

    // The --clone-missing path (cloneMissingInventoryRepositories) refuses
    // the same way: it reports the invalid stored inventory and skips,
    // never reaching `gh repo clone`.
    const outcomes = cloneMissingInventoryRepositories(workspaceHost, hub, "acme");
    expect(outcomes).toEqual([
      {
        inventoryId: WORKSPACE_INVENTORY_REL,
        result: "skipped-other-reason",
        note: expect.stringContaining("repositories[0] has a field the contract does not declare"),
      },
    ]);
    expect(cloneAttempted).toBe(false);
  });

  it("reports health on resume and composes skills plus refreshed guidance", () => {
    const parent = tempDir();
    const directory = join(parent, "hub");
    mkdirSync(dirname(join(directory, WORKSPACE_MARKER_REL)), { recursive: true });
    writeFileSync(
      join(directory, WORKSPACE_MARKER_REL),
      `${JSON.stringify({ schemaVersion: 1, kind: "account-hub", owner: "acme", repository: "acme/hub" }, null, 2)}\n`,
    );
    writeInventory(directory, [{ id: "acme/hub" }]);
    writeFileSync(
      join(directory, "package.json"),
      `${JSON.stringify({ name: "hub", devDependencies: { [ADVISOR_PACKAGE]: "0.1.5" } }, null, 2)}\n`,
    );
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
    expect(result.health.degraded).toBe(false);
    expect(result.message).not.toMatch(/skill roster skipped/);
    expect(reportHubHealth(host(directory), directory).marker).toBe("present");
  });

  it("composes skills into the hub and sibling clones resolved from inventory", () => {
    const parent = tempDir();
    const hub = join(parent, "hub");
    const app = join(parent, "app");
    const other = join(parent, "other");
    const foundry = join(parent, "foundry");
    for (const directory of [hub, app, other, foundry]) mkdirSync(directory, { recursive: true });
    mkdirSync(dirname(join(hub, WORKSPACE_MARKER_REL)), { recursive: true });
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
    expect(result.health.degraded).toBe(true);
    expect(formatHubHealth(result.health)).toMatch(/degraded: yes/);
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

describe("legacy .clossys/ -> clossys/.state/ migration (#1171)", () => {
  it("resumes a legacy-only hub by migrating it to clossys/.state/ and reports the migration", () => {
    const directory = tempDir();
    writeLegacyHub(directory, "acme", "hub", [{ id: "acme/hub" }]);
    const observed = observeWorkspace(host(directory));
    expect(observed.cwd.hubMigration).toBe("legacy");
    expect(observed.cwd.hub).toMatchObject({ owner: "acme" });

    const decision = planWorkspace(observed, host(directory));
    expect(decision).toMatchObject({ action: "resume", owner: "acme", migrateFrom: "legacy" });
    if (decision.action !== "resume") throw new Error("expected resume");

    const result = applyWorkspacePlan(host(directory), decision, skeletonRoot, composeApplyOptions(seedSkillCatalogue(["advisor"])));
    expect(existsSync(join(directory, ".clossys"))).toBe(false);
    expect(existsSync(join(directory, WORKSPACE_MARKER_REL))).toBe(true);
    expect(existsSync(join(directory, WORKSPACE_INVENTORY_REL))).toBe(true);
    expect(result.health.migration).toEqual({ status: "migrated", from: ".clossys", to: "clossys/.state" });
    expect(result.message).toMatch(/migration: moved hub state from \.clossys to clossys\/\.state/);
  });

  it("refuses as indeterminate, never silently merging, when both the current and legacy marker exist", () => {
    const directory = tempDir();
    writeLegacyHub(directory, "acme", "hub");
    writeInventory(directory, [{ id: "acme/hub" }]);
    mkdirSync(dirname(join(directory, WORKSPACE_MARKER_REL)), { recursive: true });
    writeFileSync(
      join(directory, WORKSPACE_MARKER_REL),
      `${JSON.stringify({ schemaVersion: 1, kind: "account-hub", owner: "acme", repository: "acme/hub" }, null, 2)}\n`,
    );
    const observed = observeWorkspace(host(directory));
    expect(observed.cwd.hubMigration).toBe("indeterminate");
    expect(observed.cwd.hub).toBeUndefined();

    const decision = planWorkspace(observed, host(directory));
    expect(decision).toMatchObject({ action: "refuse", state: "indeterminate" });
    if (decision.action === "refuse") {
      expect(decision.message).toMatch(/never merges them silently/);
    }
    // Refusal happens at plan time; apply never runs, so nothing is touched.
    expect(existsSync(join(directory, ".clossys"))).toBe(true);
  });

  it("plans and resumes a clean hub (current path only) exactly as before, with no migration reported", () => {
    const directory = tempDir();
    mkdirSync(dirname(join(directory, WORKSPACE_MARKER_REL)), { recursive: true });
    writeFileSync(
      join(directory, WORKSPACE_MARKER_REL),
      `${JSON.stringify({ schemaVersion: 1, kind: "account-hub", owner: "acme", repository: "acme/hub" }, null, 2)}\n`,
    );
    writeInventory(directory, [{ id: "acme/hub" }]);
    const observed = observeWorkspace(host(directory));
    expect(observed.cwd.hubMigration).toBe("clean");
    const decision = planWorkspace(observed, host(directory));
    expect(decision).toMatchObject({ action: "resume" });
    if (decision.action !== "resume") throw new Error("expected resume");
    expect(decision).not.toHaveProperty("migrateFrom");
    const result = applyWorkspacePlan(host(directory), decision, skeletonRoot, composeApplyOptions(seedSkillCatalogue(["advisor"])));
    expect(result.health.migration).toBeUndefined();
  });
});

describe("skills manifest and health (#1183)", () => {
  it("reports a stale catalogue-sourced skill against the live launcher version, and 0 retired on a read-only inspection", () => {
    const directory = tempDir();
    mkdirSync(join(directory, "clossys", ".state"), { recursive: true });
    writeFileSync(
      join(directory, "clossys", ".state", "skills.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          generatedAt: "2026-09-20T00:00:00.000Z",
          skills: [
            { name: "advisor", source: "catalogue", version: "0.1.0", sha256: "a".repeat(64) },
            { name: "designer", source: "installed", version: "0.4.9", sha256: "b".repeat(64) },
          ],
        },
        null,
        2,
      )}\n`,
    );
    const report = reportHubHealth(host(directory), directory, undefined, "0.2.0");
    expect(report.skillsManifest).toEqual({ status: "present", total: 2, stale: 1, retired: 0 });
    expect(formatHubHealth(report)).toMatch(/skills: 1 out of date, 0 retired \(2 composed\)/);
  });

  it("reports missing when no manifest has been written yet", () => {
    const directory = tempDir();
    const report = reportHubHealth(host(directory), directory);
    expect(report.skillsManifest).toEqual({ status: "missing", total: 0, stale: 0, retired: 0 });
  });

  it("surfaces this run's retired skills in the health report and message", () => {
    const directory = tempDir();
    const catalogue = seedSkillCatalogue(["advisor", "designer"]);
    const applyOpts = composeApplyOptions(catalogue);
    writeInventory(directory);
    applyWorkspacePlan(host(directory), { action: "adopt", owner: "acme", repository: "hub", directory, advisorVersion: "0.1.5" }, skeletonRoot, applyOpts);

    // designer's catalogue source disappears before the next resume.
    rmSync(join(applyOpts.skillCatalogueRoot, "designer"), { recursive: true, force: true });
    const result = applyWorkspacePlan(
      host(directory),
      { action: "resume", owner: "acme", repository: "hub", directory, clone: false },
      skeletonRoot,
      applyOpts,
    );
    expect(result.health.skillComposition?.retired).toEqual(["designer"]);
    expect(result.message).toMatch(/skills retired: clossys-designer/);
    expect(existsSync(join(directory, ".agents", "skills", "clossys-designer"))).toBe(false);
  });
});

describe("preserved composed skills in the health report (#1473)", () => {
  it("names an edited composed skill, leaves it as found, and marks the report degraded", () => {
    const directory = tempDir();
    const catalogue = seedSkillCatalogue(["advisor"]);
    const applyOpts = composeApplyOptions(catalogue);
    writeInventory(directory);
    applyWorkspacePlan(host(directory), { action: "adopt", owner: "acme", repository: "hub", directory, advisorVersion: "0.1.5" }, skeletonRoot, applyOpts);
    const skillPath = join(directory, ".agents", "skills", "clossys-advisor", "SKILL.md");
    const edited = `${readFileSync(skillPath, "utf8")}\nClient's own note.\n`;
    writeFileSync(skillPath, edited);

    const result = applyWorkspacePlan(
      host(directory),
      { action: "resume", owner: "acme", repository: "hub", directory, clone: false },
      skeletonRoot,
      applyOpts,
    );
    expect(result.state).toBe("satisfied");
    expect(result.health.degraded).toBe(true);
    expect(result.health.skillComposition?.preserved).toEqual([
      expect.objectContaining({ packageDir: "advisor", action: "rewrite" }),
    ]);
    expect(result.message).toMatch(/skill preserved \(clossys-advisor, not rewritten\): \.agents\/skills\/clossys-advisor\/SKILL\.md was edited since Launcher last wrote it/);
    expect(result.message).toContain('"preserved":[');
    expect(readFileSync(skillPath, "utf8")).toBe(edited);
  });

  it("tags a skill left as is in a sibling clone with that clone's inventory id", () => {
    const parent = tempDir();
    const hub = join(parent, "hub");
    const app = join(parent, "app");
    for (const directory of [hub, app]) mkdirSync(directory, { recursive: true });
    mkdirSync(dirname(join(hub, WORKSPACE_MARKER_REL)), { recursive: true });
    writeFileSync(
      join(hub, WORKSPACE_MARKER_REL),
      `${JSON.stringify({ schemaVersion: 1, kind: "account-hub", owner: "acme", repository: "acme/hub" }, null, 2)}\n`,
    );
    writeInventory(hub, [{ id: "acme/app" }]);
    mkdirSync(join(app, ".git"), { recursive: true });
    const base = host(hub);
    const workspaceHost: WorkspaceHost = {
      ...base,
      run: (command, args, opts) => {
        if (command === "git" && args[0] === "remote" && args[1] === "get-url" && opts?.cwd === app) {
          return { status: 0, stdout: "git@github.com:acme/app.git\n", stderr: "" };
        }
        return base.run(command, args, opts);
      },
    };
    const applyOpts = composeApplyOptions(seedSkillCatalogue(["advisor"]));
    const resume = () =>
      applyWorkspacePlan(
        workspaceHost,
        { action: "resume", owner: "acme", repository: "hub", directory: hub, clone: false },
        skeletonRoot,
        applyOpts,
      );
    resume();
    const appSkill = join(app, ".agents", "skills", "clossys-advisor", "SKILL.md");
    const edited = `${readFileSync(appSkill, "utf8")}\nClient's own note.\n`;
    writeFileSync(appSkill, edited);

    const result = resume();
    expect(result.health.skillComposition?.preserved).toEqual([
      expect.objectContaining({ target: "acme/app", packageDir: "advisor", action: "rewrite" }),
    ]);
    expect(result.message).toMatch(/skill preserved \(clossys-advisor in acme\/app, not rewritten\): /);
    expect(result.health.degraded).toBe(true);
    expect(readFileSync(appSkill, "utf8")).toBe(edited);
  });
});

describe("generated clossys/README.md", () => {
  it("notes there is no engagement brief yet, then reflects clossys/brief.json once it exists", () => {
    const directory = tempDir();
    writeInventory(directory);
    const applyOpts = composeApplyOptions(seedSkillCatalogue(["advisor"]));
    applyWorkspacePlan(
      host(directory),
      { action: "adopt", owner: "acme", repository: "hub", directory, advisorVersion: "0.1.5" },
      skeletonRoot,
      applyOpts,
    );
    const before = readFileSync(join(directory, "clossys", "README.md"), "utf8");
    expect(before).toContain("No engagement brief yet.");
    expect(before).toContain("@clossys-advisor` writes `clossys/brief.json`");

    // Written by the apply-plan step (#1178, wave 2) in real use; here a
    // fixture stands in for that so this generator's own behavior is
    // covered without depending on that unimplemented step.
    mkdirSync(join(directory, "clossys"), { recursive: true });
    writeFileSync(join(directory, "clossys", "brief.json"), `${JSON.stringify({ schemaVersion: 1 })}\n`);
    applyWorkspacePlan(
      host(directory),
      { action: "resume", owner: "acme", repository: "hub", directory, clone: false },
      skeletonRoot,
      applyOpts,
    );
    const after = readFileSync(join(directory, "clossys", "README.md"), "utf8");
    expect(after).toContain("`clossys/brief.json` — why each role is staffed here, its goals, handoffs, and sequence (owner: @clossys/advisor).");
    expect(after).not.toContain("No engagement brief yet.");
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

describe("cloneMissingInventoryRepositories (#1179)", () => {
  it("clones exactly the inventory ids that resolveSisterCloneTargets skipped for 'not beside the hub', and reports the clone path", () => {
    const directory = tempDir();
    mkdirSync(join(directory, ".git"));
    writeInventory(directory, [{ id: "app" }]);
    const siblingPath = join(dirname(directory), "app");
    const outcomes = cloneMissingInventoryRepositories(
      host(directory, {
        [`gh repo clone acme/app ${siblingPath}`]: { status: 0, stdout: "Cloning...\n", stderr: "" },
      }),
      directory,
      "acme",
    );
    expect(outcomes).toEqual([{ inventoryId: "app", result: "cloned", note: `cloned to ${siblingPath}` }]);
  });

  it("never attempts a clone for an id skipped for a DIFFERENT reason (wrong account)", () => {
    const directory = tempDir();
    mkdirSync(join(directory, ".git"));
    writeInventory(directory, [{ id: "other-org/app" }]);
    const outcomes = cloneMissingInventoryRepositories(host(directory, {}), directory, "acme");
    expect(outcomes).toEqual([{ inventoryId: "other-org/app", result: "skipped-other-reason", note: "other account; not this roster" }]);
  });

  it("reports failed, not thrown, when gh repo clone itself fails", () => {
    const directory = tempDir();
    mkdirSync(join(directory, ".git"));
    writeInventory(directory, [{ id: "app" }]);
    const siblingPath = join(dirname(directory), "app");
    const outcomes = cloneMissingInventoryRepositories(
      host(directory, {
        [`gh repo clone acme/app ${siblingPath}`]: { status: 1, stdout: "", stderr: "repository not found" },
      }),
      directory,
      "acme",
    );
    expect(outcomes).toEqual([
      { inventoryId: "app", result: "failed", note: "gh repo clone exited 1: repository not found" },
    ]);
  });

  it("an inventory with nothing to clone (already sibling-present, or empty) returns an empty array, not a throw", () => {
    const directory = tempDir();
    mkdirSync(join(directory, ".git"));
    writeInventory(directory, []);
    expect(cloneMissingInventoryRepositories(host(directory, {}), directory, "acme")).toEqual([]);
  });
});

describe("host discovery recording, wired into applyWorkspacePlan (#1180)", () => {
  it("resume records an empty linkedHosts snapshot, and hosts.json, when nothing was linked beforehand", () => {
    const parent = tempDir();
    const directory = join(parent, "hub");
    mkdirSync(dirname(join(directory, WORKSPACE_MARKER_REL)), { recursive: true });
    writeFileSync(
      join(directory, WORKSPACE_MARKER_REL),
      `${JSON.stringify({ schemaVersion: 1, kind: "account-hub", owner: "acme", repository: "acme/hub" }, null, 2)}\n`,
    );
    writeInventory(directory, [{ id: "acme/hub" }]);
    const catalogue = seedSkillCatalogue(["advisor"]);
    const result = applyWorkspacePlan(
      host(directory),
      { action: "resume", owner: "acme", repository: "hub", directory, clone: false },
      skeletonRoot,
      composeApplyOptions(catalogue),
    );
    expect(result.health.linkedHosts).toEqual([]);
    expect(result.message).toMatch(/linked hosts: none detected/);
    const hostsRaw = JSON.parse(readFileSync(join(directory, "clossys", ".state", "hosts.json"), "utf8"));
    expect(hostsRaw).toMatchObject({ schemaVersion: 1, linkedHosts: [] });
  });

  it("resume records the host a client's own IDE already linked, read BEFORE compose stamps every discovery path", () => {
    const parent = tempDir();
    const directory = join(parent, "hub");
    mkdirSync(dirname(join(directory, WORKSPACE_MARKER_REL)), { recursive: true });
    writeFileSync(
      join(directory, WORKSPACE_MARKER_REL),
      `${JSON.stringify({ schemaVersion: 1, kind: "account-hub", owner: "acme", repository: "acme/hub" }, null, 2)}\n`,
    );
    writeInventory(directory, [{ id: "acme/hub" }]);
    // Simulates a client whose coding agent already created a real .claude/skills
    // directory before ever running launcher -- the exact signal #1180 exists to
    // capture. If detection ran AFTER compose (which stamps every host's discovery
    // path unconditionally), this distinction would be lost.
    mkdirSync(join(directory, ".claude", "skills"), { recursive: true });
    const catalogue = seedSkillCatalogue(["advisor"]);
    const result = applyWorkspacePlan(
      host(directory),
      { action: "resume", owner: "acme", repository: "hub", directory, clone: false },
      skeletonRoot,
      composeApplyOptions(catalogue),
    );
    expect(result.health.linkedHosts).toEqual(["claude-code"]);
    const hostsRaw = JSON.parse(readFileSync(join(directory, "clossys", ".state", "hosts.json"), "utf8"));
    expect(hostsRaw.linkedHosts).toEqual(["claude-code"]);
  });

  it("records a hosts.json for a sibling clone too, not only the hub", () => {
    const parent = tempDir();
    const hub = join(parent, "hub");
    const app = join(parent, "app");
    mkdirSync(dirname(join(hub, WORKSPACE_MARKER_REL)), { recursive: true });
    writeFileSync(
      join(hub, WORKSPACE_MARKER_REL),
      `${JSON.stringify({ schemaVersion: 1, kind: "account-hub", owner: "acme", repository: "acme/hub" }, null, 2)}\n`,
    );
    writeInventory(hub, [{ id: "acme/app" }]);
    mkdirSync(join(app, ".git"), { recursive: true });
    const base = host(hub);
    const workspaceHost: WorkspaceHost = {
      ...base,
      run: (command, args, opts) => {
        const cwd = opts?.cwd ?? hub;
        if (command === "git" && args[0] === "remote" && args[1] === "get-url" && args[2] === "origin") {
          return cwd === app
            ? { status: 0, stdout: "git@github.com:acme/app.git\n", stderr: "" }
            : { status: 1, stdout: "", stderr: "no remote" };
        }
        return base.run(command, args, opts);
      },
    };
    const catalogue = seedSkillCatalogue(["advisor"]);
    applyWorkspacePlan(
      workspaceHost,
      { action: "resume", owner: "acme", repository: "hub", directory: hub, clone: false },
      skeletonRoot,
      composeApplyOptions(catalogue),
    );
    expect(existsSync(join(app, "clossys", ".state", "hosts.json"))).toBe(true);
  });
});

describe("inventory drift reporting, wired into applyWorkspacePlan (#1216)", () => {
  it("surfaces nothing in health or message when the hub marker declares no external inventory", () => {
    const parent = tempDir();
    const directory = join(parent, "hub");
    mkdirSync(dirname(join(directory, WORKSPACE_MARKER_REL)), { recursive: true });
    writeFileSync(
      join(directory, WORKSPACE_MARKER_REL),
      `${JSON.stringify({ schemaVersion: 1, kind: "account-hub", owner: "acme", repository: "acme/hub" }, null, 2)}\n`,
    );
    writeInventory(directory, [{ id: "acme/hub" }]);
    const catalogue = seedSkillCatalogue(["advisor"]);
    const result = applyWorkspacePlan(
      host(directory),
      { action: "resume", owner: "acme", repository: "hub", directory, clone: false },
      skeletonRoot,
      composeApplyOptions(catalogue),
    );
    expect(result.health.inventoryDrift).toBeUndefined();
    expect(result.message).not.toMatch(/inventory drift/);
  });

  it("reports reconciled drift -- external-only, launcher-only, and agreeing -- against a declared external inventory on resume", () => {
    const parent = tempDir();
    const directory = join(parent, "hub");
    mkdirSync(dirname(join(directory, WORKSPACE_MARKER_REL)), { recursive: true });
    const externalPath = join(parent, "external.json");
    writeFileSync(
      join(directory, WORKSPACE_MARKER_REL),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          kind: "account-hub",
          owner: "acme",
          repository: "acme/hub",
          externalInventory: { path: externalPath, shape: "foundry" },
        },
        null,
        2,
      )}\n`,
    );
    writeInventory(directory, [{ id: "site" }, { id: "legacy" }]);
    writeFileSync(externalPath, `${JSON.stringify({ schemaVersion: 1, repositories: [{ id: "app" }, { id: "site" }] })}\n`);
    const catalogue = seedSkillCatalogue(["advisor"]);
    const result = applyWorkspacePlan(
      host(directory),
      { action: "resume", owner: "acme", repository: "hub", directory, clone: false },
      skeletonRoot,
      composeApplyOptions(catalogue),
    );
    expect(result.health.inventoryDrift).toEqual({
      status: "reconciled",
      externalOnly: ["app"],
      launcherOnly: ["legacy"],
      agreeing: ["site"],
    });
    expect(result.message).toMatch(/inventory drift: external-only 1, launcher-only 1, agreeing 1/);
  });

  it("reports indeterminate, surfaced in the message, for a declared custom-shape external inventory -- never a guessed mapping", () => {
    const parent = tempDir();
    const directory = join(parent, "hub");
    mkdirSync(dirname(join(directory, WORKSPACE_MARKER_REL)), { recursive: true });
    writeFileSync(
      join(directory, WORKSPACE_MARKER_REL),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          kind: "account-hub",
          owner: "acme",
          repository: "acme/hub",
          externalInventory: { path: join(parent, "external.json"), shape: "custom" },
        },
        null,
        2,
      )}\n`,
    );
    writeInventory(directory, [{ id: "acme/hub" }]);
    const catalogue = seedSkillCatalogue(["advisor"]);
    const result = applyWorkspacePlan(
      host(directory),
      { action: "resume", owner: "acme", repository: "hub", directory, clone: false },
      skeletonRoot,
      composeApplyOptions(catalogue),
    );
    expect(result.health.inventoryDrift?.status).toBe("indeterminate");
    expect(result.message).toMatch(/inventory drift: indeterminate.*no mapping/);
  });
});
