import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  ADVISOR_PACKAGE,
  INTEGRATOR_PACKAGE,
  CONSUMER_AGENTS_MD,
  LEGACY_CONSUMER_AGENTS_MD,
  SIBLING_COMPOSING_CONSUMER_AGENTS_MD,
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

/** An `acme/hub` hub marker. */
function writeHubMarker(directory: string): void {
  mkdirSync(dirname(join(directory, WORKSPACE_MARKER_REL)), { recursive: true });
  writeFileSync(
    join(directory, WORKSPACE_MARKER_REL),
    `${JSON.stringify({ schemaVersion: 1, kind: "account-hub", owner: "acme", repository: "acme/hub" }, null, 2)}\n`,
  );
}

/** A hub package.json pinning both engines in devDependencies, so the health report grades only what a test is about. */
function writeEnginePins(directory: string, advisor = "0.5.0", integrator = "0.8.2"): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "package.json"),
    `${JSON.stringify({ name: "hub", devDependencies: { [ADVISOR_PACKAGE]: advisor, [INTEGRATOR_PACKAGE]: integrator } }, null, 2)}\n`,
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
    integratorVersion: "0.8.2",
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
    integratorVersion: "0.8.2",
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
    integratorVersion: "0.8.2",
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

describe("hub engine pins: Advisor and Integrator (S3-0)", () => {
  function writeHubMarker(directory: string): void {
    mkdirSync(dirname(join(directory, WORKSPACE_MARKER_REL)), { recursive: true });
    writeFileSync(
      join(directory, WORKSPACE_MARKER_REL),
      `${JSON.stringify({ schemaVersion: 1, kind: "account-hub", owner: "acme", repository: "acme/hub" }, null, 2)}\n`,
    );
    writeInventory(directory, [{ id: "acme/hub" }]);
  }

  function readManifest(directory: string): Record<string, Record<string, string> | string> {
    return JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as Record<string, Record<string, string> | string>;
  }

  function resume(directory: string, versions: { advisorVersion?: string; integratorVersion?: string }) {
    return applyWorkspacePlan(
      host(directory),
      { action: "resume", owner: "acme", repository: "hub", directory, clone: false, ...versions },
      skeletonRoot,
      composeApplyOptions(seedSkillCatalogue(["advisor"])),
    );
  }

  it("a fresh skeleton pins both engines exactly, in devDependencies only", () => {
    const directory = tempDir();
    const result = applyWorkspacePlan(
      host(directory, {
        [`gh repo create acme/workspace --private --source ${directory} --remote origin --push`]: { status: 0, stdout: "created\n", stderr: "" },
      }),
      { action: "create", owner: "acme", repository: "workspace", directory, advisorVersion: "0.5.0", integratorVersion: "0.8.2" },
      skeletonRoot,
    );
    const manifest = readManifest(directory);
    expect(manifest.devDependencies).toEqual({ [ADVISOR_PACKAGE]: "0.5.0", [INTEGRATOR_PACKAGE]: "0.8.2" });
    expect(manifest.dependencies).toBeUndefined();
    expect(readFileSync(join(directory, "package.json"), "utf8")).not.toContain("__INTEGRATOR_VERSION__");
    expect(result.health.advisorPin).toEqual({ devDependencies: "0.5.0", live: "0.5.0" });
    expect(result.health.integratorPin).toEqual({ devDependencies: "0.8.2", live: "0.8.2" });
    expect(result.health.extraClossys).toEqual([]);
  });

  it("an existing hub gains Integrator on resume, and on appoint", () => {
    const resumed = tempDir();
    writeHubMarker(resumed);
    writeFileSync(join(resumed, "package.json"), `${JSON.stringify({ name: "hub", devDependencies: { [ADVISOR_PACKAGE]: "0.5.0" } }, null, 2)}\n`);
    const result = resume(resumed, { advisorVersion: "0.5.0", integratorVersion: "0.8.2" });
    expect(readManifest(resumed).devDependencies).toEqual({ [ADVISOR_PACKAGE]: "0.5.0", [INTEGRATOR_PACKAGE]: "0.8.2" });
    expect(result.health.integratorPin).toEqual({ devDependencies: "0.8.2", live: "0.8.2" });
    expect(result.health.degraded).toBe(false);
    expect(result.message).toMatch(/integrator pin: devDependencies 0\.8\.2; live 0\.8\.2/);

    const appointed = tempDir();
    writeInventory(appointed);
    writeFileSync(join(appointed, "package.json"), `${JSON.stringify({ name: "hub", devDependencies: { [ADVISOR_PACKAGE]: "0.5.0" } }, null, 2)}\n`);
    applyWorkspacePlan(
      host(appointed),
      { action: "adopt", owner: "acme", repository: "hub", directory: appointed, advisorVersion: "0.5.0", integratorVersion: "0.8.2" },
      skeletonRoot,
    );
    expect(readManifest(appointed).devDependencies).toEqual({ [ADVISOR_PACKAGE]: "0.5.0", [INTEGRATOR_PACKAGE]: "0.8.2" });
  });

  it("a frozen 0.2.6 Advisor is bumped to live on resume", () => {
    const directory = tempDir();
    writeHubMarker(directory);
    writeFileSync(join(directory, "package.json"), `${JSON.stringify({ name: "hub", devDependencies: { [ADVISOR_PACKAGE]: "0.2.6" } }, null, 2)}\n`);
    const result = resume(directory, { advisorVersion: "0.5.0", integratorVersion: "0.8.2" });
    expect(readManifest(directory).devDependencies).toEqual({ [ADVISOR_PACKAGE]: "0.5.0", [INTEGRATOR_PACKAGE]: "0.8.2" });
    expect(result.health.pinFindings).toEqual([]);
  });

  it("other @clossys/* entries are left exactly as found", () => {
    const directory = tempDir();
    writeHubMarker(directory);
    writeFileSync(
      join(directory, "package.json"),
      `${JSON.stringify(
        {
          name: "hub",
          dependencies: { "@clossys/starter": "0.1.5", react: "19.0.0" },
          devDependencies: { "@clossys/writer": "^0.1.0", [ADVISOR_PACKAGE]: "0.2.6" },
          peerDependencies: { "@clossys/controller": "0.9.0" },
        },
        null,
        2,
      )}\n`,
    );
    const result = resume(directory, { advisorVersion: "0.5.0", integratorVersion: "0.8.2" });
    const manifest = readManifest(directory);
    expect(manifest.dependencies).toEqual({ "@clossys/starter": "0.1.5", react: "19.0.0" });
    expect(manifest.devDependencies).toEqual({ "@clossys/writer": "^0.1.0", [ADVISOR_PACKAGE]: "0.5.0", [INTEGRATOR_PACKAGE]: "0.8.2" });
    expect(manifest.peerDependencies).toEqual({ "@clossys/controller": "0.9.0" });
    expect(result.health.extraClossys).toEqual(["@clossys/controller", "@clossys/starter", "@clossys/writer"]);
  });

  it("a pin in dependencies is relocated to devDependencies, on resume and on appoint", () => {
    const resumed = tempDir();
    writeHubMarker(resumed);
    writeFileSync(
      join(resumed, "package.json"),
      `${JSON.stringify({ name: "hub", dependencies: { [INTEGRATOR_PACKAGE]: "0.7.0" }, devDependencies: { [ADVISOR_PACKAGE]: "0.5.0" } }, null, 2)}\n`,
    );
    const result = resume(resumed, { advisorVersion: "0.5.0", integratorVersion: "0.8.2" });
    const manifest = readManifest(resumed);
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.devDependencies).toEqual({ [ADVISOR_PACKAGE]: "0.5.0", [INTEGRATOR_PACKAGE]: "0.8.2" });
    expect(result.health.dualPin).toBe(false);
    expect(result.health.degraded).toBe(false);

    const appointed = tempDir();
    writeInventory(appointed);
    writeFileSync(
      join(appointed, "package.json"),
      `${JSON.stringify({ name: "hub", optionalDependencies: { [INTEGRATOR_PACKAGE]: "0.7.0", left: "1.0.0" } }, null, 2)}\n`,
    );
    applyWorkspacePlan(
      host(appointed),
      { action: "adopt", owner: "acme", repository: "hub", directory: appointed, advisorVersion: "0.5.0", integratorVersion: "0.8.2" },
      skeletonRoot,
    );
    expect(readManifest(appointed).optionalDependencies).toEqual({ left: "1.0.0" });
    expect(readManifest(appointed).devDependencies).toEqual({ [ADVISOR_PACKAGE]: "0.5.0", [INTEGRATOR_PACKAGE]: "0.8.2" });
  });

  it("resume leaves package.json byte for byte when a pin is already live, when no live version was read, or when it is unreadable", () => {
    const current = tempDir();
    writeHubMarker(current);
    const currentBytes = `{"name":"hub","devDependencies":{"${ADVISOR_PACKAGE}":"0.5.0","${INTEGRATOR_PACKAGE}":"0.8.2"}}`;
    writeFileSync(join(current, "package.json"), currentBytes);
    resume(current, { advisorVersion: "0.5.0", integratorVersion: "0.8.2" });
    expect(readFileSync(join(current, "package.json"), "utf8")).toBe(currentBytes);

    const unknown = tempDir();
    writeHubMarker(unknown);
    const frozenBytes = `${JSON.stringify({ name: "hub", devDependencies: { [ADVISOR_PACKAGE]: "0.2.6" } }, null, 2)}\n`;
    writeFileSync(join(unknown, "package.json"), frozenBytes);
    const unread = resume(unknown, {});
    expect(readFileSync(join(unknown, "package.json"), "utf8")).toBe(frozenBytes);
    expect(unread.health.integratorPin).toEqual({});
    expect(unread.health.degraded).toBe(true);

    const broken = tempDir();
    writeHubMarker(broken);
    writeFileSync(join(broken, "package.json"), "{ not json");
    const brokenResult = resume(broken, { advisorVersion: "0.5.0", integratorVersion: "0.8.2" });
    expect(readFileSync(join(broken, "package.json"), "utf8")).toBe("{ not json");
    expect(brokenResult.state).toBe("satisfied");
    expect(brokenResult.message).toMatch(/advisor pin: missing; live 0\.5\.0/);
    expect(brokenResult.message).toMatch(/integrator pin: missing; live 0\.8\.2/);
  });

  it("health grades each engine against its own live version", () => {
    const directory = tempDir();
    writeFileSync(
      join(directory, "package.json"),
      `${JSON.stringify({ name: "hub", devDependencies: { [ADVISOR_PACKAGE]: "0.5.0", [INTEGRATOR_PACKAGE]: "0.7.0" } }, null, 2)}\n`,
    );
    const report = reportHubHealth(host(directory), directory, "0.5.0", undefined, [], undefined, "0.8.2");
    expect(report.advisorPin).toEqual({ devDependencies: "0.5.0", live: "0.5.0" });
    expect(report.integratorPin).toEqual({ devDependencies: "0.7.0", live: "0.8.2" });
    expect(report.pinFindings).toEqual([
      { package: INTEGRATOR_PACKAGE, bucket: "devDependencies", pinned: "0.7.0", grade: "stale", note: "pinned 0.7.0 is older than live 0.8.2" },
    ]);
    expect(report.degraded).toBe(true);
    expect(formatHubHealth(report)).toMatch(/pin findings: @clossys\/integrator devDependencies pinned 0\.7\.0 is older than live 0\.8\.2/);
  });

  it("create and appoint refuse as indeterminate when the registry gives no Integrator version", () => {
    const silent = host(tempDir());
    expect(planWorkspace(observation({ integratorVersion: undefined }), silent)).toEqual({
      action: "refuse",
      state: "indeterminate",
      message: `cannot read a public ${INTEGRATOR_PACKAGE} version from the npm registry`,
    });
    expect(
      planWorkspace(
        observation({
          integratorVersion: undefined,
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
    ).toMatchObject({ action: "refuse", state: "indeterminate" });
  });

  const npmLock = (advisor: string, integrator?: string): string =>
    `${JSON.stringify(
      {
        name: "hub",
        lockfileVersion: 3,
        packages: {
          "": { name: "hub" },
          [`node_modules/${ADVISOR_PACKAGE}`]: { version: advisor, dev: true },
          ...(integrator === undefined ? {} : { [`node_modules/${INTEGRATOR_PACKAGE}`]: { version: integrator, dev: true } }),
        },
      },
      null,
      2,
    )}\n`;

  it("names each pin a resume changed, says to install and commit with the lockfile, and is degraded while package-lock.json does not resolve them", () => {
    const directory = tempDir();
    writeHubMarker(directory);
    writeFileSync(join(directory, "package.json"), `${JSON.stringify({ name: "hub", devDependencies: { [ADVISOR_PACKAGE]: "0.2.6" } }, null, 2)}\n`);
    const lock = npmLock("0.2.6");
    writeFileSync(join(directory, "package-lock.json"), lock);
    const result = resume(directory, { advisorVersion: "0.5.0", integratorVersion: "0.8.2" });
    expect(result.health.enginePins).toEqual({
      changed: [
        { package: ADVISOR_PACKAGE, from: "0.2.6", to: "0.5.0" },
        { package: INTEGRATOR_PACKAGE, to: "0.8.2" },
      ],
      nextStep: "run `npm install` in the hub, then commit package.json together with package-lock.json",
    });
    expect(result.message).toMatch(/^engine pins changed in package\.json: @clossys\/advisor 0\.2\.6 -> 0\.5\.0; @clossys\/integrator added at 0\.8\.2$/m);
    expect(result.message).toMatch(/^next: run `npm install` in the hub, then commit package\.json together with package-lock\.json$/m);
    expect(result.health.pinFindings).toEqual([]);
    expect(result.health.installNeeded).toMatchObject({
      kind: "engine-pins-changed-install-needed",
      lockfile: "package-lock.json",
      command: "npm install",
      packages: [ADVISOR_PACKAGE, INTEGRATOR_PACKAGE],
    });
    expect(result.message).toMatch(/^install needed \(engine-pins-changed-install-needed\): package-lock\.json does not resolve/m);
    expect(result.health.degraded).toBe(true);
    // The lockfile is the founder's to update, with an install; Launcher never touches it.
    expect(readFileSync(join(directory, "package-lock.json"), "utf8")).toBe(lock);

    // Nothing changes on the next run, but the lockfile still does not resolve the pins.
    const again = resume(directory, { advisorVersion: "0.5.0", integratorVersion: "0.8.2" });
    expect(again.health.enginePins).toBeUndefined();
    expect(again.health.installNeeded?.packages).toEqual([ADVISOR_PACKAGE, INTEGRATOR_PACKAGE]);
    expect(again.health.degraded).toBe(true);

    // After the install, the lockfile resolves both pins: no finding, not degraded.
    writeFileSync(join(directory, "package-lock.json"), npmLock("0.5.0", "0.8.2"));
    const installed = resume(directory, { advisorVersion: "0.5.0", integratorVersion: "0.8.2" });
    expect(installed.health.installNeeded).toBeUndefined();
    expect(installed.health.degraded).toBe(false);
  });

  it("with a lockfile it does not read, is degraded only on the run that changed a pin", () => {
    const directory = tempDir();
    writeHubMarker(directory);
    writeFileSync(join(directory, "package.json"), `${JSON.stringify({ name: "hub", devDependencies: { [ADVISOR_PACKAGE]: "0.5.0" } }, null, 2)}\n`);
    writeFileSync(join(directory, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    const changed = resume(directory, { advisorVersion: "0.5.0", integratorVersion: "0.8.2" });
    expect(changed.health.enginePins?.changed).toEqual([{ package: INTEGRATOR_PACKAGE, to: "0.8.2" }]);
    expect(changed.health.enginePins?.nextStep).toBe("run `pnpm install` in the hub, then commit package.json together with pnpm-lock.yaml");
    expect(changed.health.installNeeded).toMatchObject({ lockfile: "pnpm-lock.yaml", command: "pnpm install", packages: [INTEGRATOR_PACKAGE] });
    expect(changed.health.degraded).toBe(true);
    const unchanged = resume(directory, { advisorVersion: "0.5.0", integratorVersion: "0.8.2" });
    expect(unchanged.health.installNeeded).toBeUndefined();
    expect(unchanged.health.degraded).toBe(false);
  });

  it("without a lockfile, names the change and the install but is not degraded", () => {
    const directory = tempDir();
    writeHubMarker(directory);
    writeFileSync(join(directory, "package.json"), `${JSON.stringify({ name: "hub", dependencies: { [ADVISOR_PACKAGE]: "0.5.0" } }, null, 2)}\n`);
    const result = resume(directory, { advisorVersion: "0.5.0", integratorVersion: "0.8.2" });
    expect(result.health.enginePins?.changed).toEqual([
      { package: ADVISOR_PACKAGE, from: "0.5.0", to: "0.5.0", movedFrom: "dependencies" },
      { package: INTEGRATOR_PACKAGE, to: "0.8.2" },
    ]);
    expect(result.message).toMatch(/@clossys\/advisor 0\.5\.0 \(moved from dependencies to devDependencies\)/);
    expect(result.message).toMatch(/^next: run your package manager's install in the hub, then commit package\.json together with the lockfile it writes$/m);
    expect(result.health.installNeeded).toBeUndefined();
    expect(result.health.degraded).toBe(false);
  });

  it("appoint names the pins it changed as well", () => {
    const directory = tempDir();
    writeInventory(directory);
    writeFileSync(join(directory, "package.json"), `${JSON.stringify({ name: "hub", devDependencies: { [ADVISOR_PACKAGE]: "0.2.6" } }, null, 2)}\n`);
    writeFileSync(join(directory, "package-lock.json"), npmLock("0.2.6"));
    const result = applyWorkspacePlan(
      host(directory),
      { action: "adopt", owner: "acme", repository: "hub", directory, advisorVersion: "0.5.0", integratorVersion: "0.8.2" },
      skeletonRoot,
    );
    expect(result.health.enginePins?.changed).toEqual([
      { package: ADVISOR_PACKAGE, from: "0.2.6", to: "0.5.0" },
      { package: INTEGRATOR_PACKAGE, to: "0.8.2" },
    ]);
    expect(result.health.installNeeded?.kind).toBe("engine-pins-changed-install-needed");
    expect(result.health.degraded).toBe(true);
  });

  it("reads npm-shrinkwrap.json before package-lock.json when both exist, in either staleness order", () => {
    const current = npmLock("0.5.0", "0.8.2");
    const stale = npmLock("0.2.6");
    const pinned = `${JSON.stringify({ name: "hub", devDependencies: { [ADVISOR_PACKAGE]: "0.5.0", [INTEGRATOR_PACKAGE]: "0.8.2" } }, null, 2)}\n`;

    const shrinkwrapCurrent = tempDir();
    writeHubMarker(shrinkwrapCurrent);
    writeFileSync(join(shrinkwrapCurrent, "package.json"), pinned);
    writeFileSync(join(shrinkwrapCurrent, "npm-shrinkwrap.json"), current);
    writeFileSync(join(shrinkwrapCurrent, "package-lock.json"), stale);
    const resolved = resume(shrinkwrapCurrent, { advisorVersion: "0.5.0", integratorVersion: "0.8.2" });
    expect(resolved.health.installNeeded).toBeUndefined();
    expect(resolved.health.degraded).toBe(false);

    const shrinkwrapStale = tempDir();
    writeHubMarker(shrinkwrapStale);
    writeFileSync(join(shrinkwrapStale, "package.json"), pinned);
    writeFileSync(join(shrinkwrapStale, "npm-shrinkwrap.json"), stale);
    writeFileSync(join(shrinkwrapStale, "package-lock.json"), current);
    const unresolved = resume(shrinkwrapStale, { advisorVersion: "0.5.0", integratorVersion: "0.8.2" });
    expect(unresolved.health.installNeeded).toMatchObject({
      lockfile: "npm-shrinkwrap.json",
      command: "npm install",
      packages: [ADVISOR_PACKAGE, INTEGRATOR_PACKAGE],
    });
    expect(unresolved.health.degraded).toBe(true);
  });

  it("reads a version 1 npm lockfile through its dependencies field", () => {
    const v1 = (advisor: string, integrator: string): string =>
      `${JSON.stringify({ name: "hub", lockfileVersion: 1, dependencies: { [ADVISOR_PACKAGE]: { version: advisor, dev: true }, [INTEGRATOR_PACKAGE]: { version: integrator, dev: true } } }, null, 2)}\n`;
    const directory = tempDir();
    writeHubMarker(directory);
    writeEnginePins(directory);
    writeFileSync(join(directory, "package-lock.json"), v1("0.5.0", "0.8.2"));
    const current = resume(directory, { advisorVersion: "0.5.0", integratorVersion: "0.8.2" });
    expect(current.health.installNeeded).toBeUndefined();
    expect(current.health.degraded).toBe(false);
    writeFileSync(join(directory, "package-lock.json"), v1("0.5.0", "0.7.0"));
    expect(resume(directory, { advisorVersion: "0.5.0", integratorVersion: "0.8.2" }).health.installNeeded?.packages).toEqual([INTEGRATOR_PACKAGE]);
  });

  it("compares a pin with its locked version as versions, so a v-prefixed pin matches", () => {
    const directory = tempDir();
    writeHubMarker(directory);
    writeFileSync(join(directory, "package.json"), `${JSON.stringify({ name: "hub", devDependencies: { [ADVISOR_PACKAGE]: "v0.6.0", [INTEGRATOR_PACKAGE]: "0.8.2" } }, null, 2)}\n`);
    writeFileSync(join(directory, "package-lock.json"), npmLock("0.6.0", "0.8.2"));
    const result = resume(directory, { advisorVersion: "0.5.0", integratorVersion: "0.8.2" });
    expect(readManifest(directory).devDependencies).toEqual({ [ADVISOR_PACKAGE]: "v0.6.0", [INTEGRATOR_PACKAGE]: "0.8.2" });
    expect(result.health.enginePins).toBeUndefined();
    expect(result.health.installNeeded).toBeUndefined();
    expect(result.health.degraded).toBe(false);
  });

  it("reports a pin that only moved between buckets, and with a pnpm lockfile marks the install needed", () => {
    const directory = tempDir();
    writeHubMarker(directory);
    writeFileSync(
      join(directory, "package.json"),
      `${JSON.stringify({ name: "hub", dependencies: { [INTEGRATOR_PACKAGE]: "0.8.2" }, devDependencies: { [ADVISOR_PACKAGE]: "0.5.0" } }, null, 2)}\n`,
    );
    writeFileSync(join(directory, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    const result = resume(directory, { advisorVersion: "0.5.0", integratorVersion: "0.8.2" });
    expect(result.health.enginePins?.changed).toEqual([{ package: INTEGRATOR_PACKAGE, from: "0.8.2", to: "0.8.2", movedFrom: "dependencies" }]);
    expect(result.message).toMatch(/^engine pins changed in package\.json: @clossys\/integrator 0\.8\.2 \(moved from dependencies to devDependencies\)$/m);
    expect(result.health.installNeeded).toMatchObject({ lockfile: "pnpm-lock.yaml", command: "pnpm install", packages: [INTEGRATOR_PACKAGE] });
    expect(result.health.degraded).toBe(true);
  });

  it("only raises a pin: one newer than live is kept, one that is not a plain version becomes live", () => {
    const directory = tempDir();
    writeHubMarker(directory);
    const bytes = `${JSON.stringify({ name: "hub", devDependencies: { [ADVISOR_PACKAGE]: "0.6.0", [INTEGRATOR_PACKAGE]: "^0.8.0" } }, null, 2)}\n`;
    writeFileSync(join(directory, "package.json"), bytes);
    const result = resume(directory, { advisorVersion: "0.5.0", integratorVersion: "0.8.2" });
    expect(readManifest(directory).devDependencies).toEqual({ [ADVISOR_PACKAGE]: "0.6.0", [INTEGRATOR_PACKAGE]: "0.8.2" });
    expect(result.health.enginePins?.changed).toEqual([{ package: INTEGRATOR_PACKAGE, from: "^0.8.0", to: "0.8.2" }]);
    expect(result.health.pinFindings).toEqual([]);
  });

  it("resume writes no package.json into a hub that has none", () => {
    const directory = tempDir();
    writeHubMarker(directory);
    const result = resume(directory, { advisorVersion: "0.5.0", integratorVersion: "0.8.2" });
    expect(existsSync(join(directory, "package.json"))).toBe(false);
    expect(result.health.enginePins).toBeUndefined();
    expect(result.message).toMatch(/advisor pin: missing; live 0\.5\.0/);
  });

  it("resume never renames the hub package, even for a dedicated workspace hub", () => {
    const directory = tempDir();
    writeHubMarker(directory);
    writeFileSync(join(directory, "package.json"), `${JSON.stringify({ name: "control-plane", devDependencies: { [ADVISOR_PACKAGE]: "0.2.6" } }, null, 2)}\n`);
    applyWorkspacePlan(
      host(directory),
      { action: "resume", owner: "acme", repository: DEFAULT_REPOSITORY_NAME, directory, clone: false, advisorVersion: "0.5.0", integratorVersion: "0.8.2" },
      skeletonRoot,
      composeApplyOptions(seedSkillCatalogue(["advisor"])),
    );
    expect(readManifest(directory).name).toBe("control-plane");
    expect(readManifest(directory).devDependencies).toEqual({ [ADVISOR_PACKAGE]: "0.5.0", [INTEGRATOR_PACKAGE]: "0.8.2" });
  });

  it("dualPin covers Integrator", () => {
    const directory = tempDir();
    writeFileSync(
      join(directory, "package.json"),
      `${JSON.stringify({ name: "hub", dependencies: { [INTEGRATOR_PACKAGE]: "0.8.2" }, devDependencies: { [ADVISOR_PACKAGE]: "0.5.0", [INTEGRATOR_PACKAGE]: "0.8.2" } }, null, 2)}\n`,
    );
    const report = reportHubHealth(host(directory), directory, "0.5.0", undefined, [], undefined, "0.8.2");
    expect(report.dualPin).toBe(true);
    expect(report.degraded).toBe(true);
    expect(formatHubHealth(report)).toMatch(/^dual pin: yes$/m);
  });

  it("an invalid stored inventory marks reportHubHealth degraded", () => {
    const directory = tempDir();
    writeEnginePins(directory);
    writeInventory(directory, [{ id: "acme/app", visibility: "public" }]);
    const report = reportHubHealth(host(directory), directory);
    expect(report.inventory.status).toBe("invalid");
    expect(report.pinFindings).toEqual([]);
    expect(report.dualPin).toBe(false);
    expect(report.degraded).toBe(true);
    writeInventory(directory, [{ id: "acme/app" }]);
    expect(reportHubHealth(host(directory), directory).degraded).toBe(false);
  });
});

describe("applyWorkspacePlan", () => {
  it("copies the skeleton for create and does not pin the catalogue", () => {
    const directory = tempDir();
    applyWorkspacePlan(
      host(directory, {
        [`gh repo create acme/workspace --private --source ${directory} --remote origin --push`]: { status: 0, stdout: "created\n", stderr: "" },
      }),
      { action: "create", owner: "acme", repository: "workspace", directory, advisorVersion: "0.1.5", integratorVersion: "0.8.2" },
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
      { action: "adopt", owner: "acme", repository: "product", directory, advisorVersion: "0.1.5", integratorVersion: "0.8.2" },
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
    expect(Object.keys(manifest.devDependencies)).toEqual([ADVISOR_PACKAGE, INTEGRATOR_PACKAGE]);
    expect(manifest.devDependencies[INTEGRATOR_PACKAGE]).toBe("0.8.2");
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
      { action: "adopt", owner: "acme", repository: "hub", directory, advisorVersion: "0.2.3", integratorVersion: "0.8.2" },
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
      { action: "adopt", owner: "acme", repository: "hub", directory, advisorVersion: "0.2.3", integratorVersion: "0.8.2" },
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
      { action: "adopt", owner: "acme", repository: DEFAULT_REPOSITORY_NAME, directory, advisorVersion: "0.2.3", integratorVersion: "0.8.2" },
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
      { action: "adopt", owner: "acme", repository: "hub", directory, advisorVersion: "0.2.3", integratorVersion: "0.8.2", inventorySource: source },
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
    // An inventoried repository not cloned beside the hub is reported, and is not a hub defect.
    // "one" sits at stored-inventory position 0; the line names that position, never the id itself (#1179).
    expect(result.message).toMatch(
      /sibling \(repositories\[0\] in the stored inventory\): not cloned beside the hub; a hub run writes nothing here; once this repository is staffed in an approved plan, @clossys-advisor and the voices of the roles staffed there arrive with that plan's setup pull request/,
    );
    expect(result.health.degraded).toBe(false);
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
        { action: "adopt", owner: "acme", repository: "hub", directory, advisorVersion: "0.2.3", integratorVersion: "0.8.2", inventorySource: source },
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
        { action: "adopt", owner: "acme", repository: "product", directory, advisorVersion: "0.2.3", integratorVersion: "0.8.2" },
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
        { action: "adopt", owner: "acme", repository: "product", directory, advisorVersion: "0.2.3", integratorVersion: "0.8.2" },
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
        integratorVersion: "0.8.2",
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
        integratorVersion: "0.8.2",
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
          integratorVersion: "0.8.2",
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
    expect(result.message).toMatch(/inventory: invalid -- .*repositories\[0\] has a field the contract does not declare \(key \d+ of this object\)/);
    expect(result.health.skillComposition?.siblings).toEqual([]);
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
      `${JSON.stringify({ name: "hub", devDependencies: { [ADVISOR_PACKAGE]: "0.1.5", [INTEGRATOR_PACKAGE]: "0.8.2" } }, null, 2)}\n`,
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
    expect(result.message).not.toMatch(/^sibling /m);
    expect(reportHubHealth(host(directory), directory).marker).toBe("present");
  });

  it("composes skills into the hub only, and reports each inventoried sibling without degrading", () => {
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
    writeEnginePins(hub);
    const catalogue = seedSkillCatalogue(["advisor", "designer"]);
    const result = applyWorkspacePlan(
      workspaceHost,
      { action: "resume", owner: "acme", repository: "hub", directory: hub, clone: false },
      skeletonRoot,
      composeApplyOptions(catalogue),
    );
    expect(readFileSync(join(hub, ".agents/skills/clossys-advisor/SKILL.md"), "utf8")).toContain("clossys-advisor");
    expect(readdirSync(app)).toEqual([".git"]);
    expect(readdirSync(other)).toEqual([".git"]);
    expect(existsSync(join(foundry, ".agents"))).toBe(false);
    // "acme/app" sits at stored-inventory position 0; every message below names a
    // repository by that stored-inventory position, never by its id (#1179) --
    // "acme/missing", "acme/other" and "acme/foundry" sit at positions 1-3.
    expect(result.health.skillComposition?.rosterTargets).toEqual(["acme/hub"]);
    expect(result.health.skillComposition?.siblings).toEqual([
      {
        inventoryId: "repositories[0] in the stored inventory",
        note: "checkout beside the hub; a hub run writes nothing here; once this repository is staffed in an approved plan, @clossys-advisor and the voices of the roles staffed there arrive with that plan's setup pull request",
      },
      {
        inventoryId: "repositories[1] in the stored inventory",
        note: "not cloned beside the hub; a hub run writes nothing here; once this repository is staffed in an approved plan, @clossys-advisor and the voices of the roles staffed there arrive with that plan's setup pull request",
      },
      { inventoryId: "repositories[2] in the stored inventory", note: "git origin does not match inventory id" },
      { inventoryId: "repositories[3] in the stored inventory", note: "foundry supplier tree; skills are not written here" },
    ]);
    expect(result.message).toMatch(/^skill roster written: acme\/hub$/m);
    expect(result.message).toMatch(
      /^sibling \(repositories\[0\] in the stored inventory\): checkout beside the hub; a hub run writes nothing here; once this repository is staffed in an approved plan, @clossys-advisor and the voices of the roles staffed there arrive with that plan's setup pull request$/m,
    );
    expect(result.message).not.toMatch(/acme\/app|acme\/missing|acme\/other|acme\/foundry/);
    expect(result.health.degraded).toBe(false);
    expect(formatHubHealth(result.health)).toMatch(/degraded: no/);
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
      { action: "create", owner: "acme", repository: "workspace", directory: created, advisorVersion: "0.1.5", integratorVersion: "0.8.2" },
      skeletonRoot,
      applyOpts,
    );
    expect(readFileSync(join(created, ".agents/skills/clossys-advisor/SKILL.md"), "utf8")).toContain("clossys-advisor");
    expect(readFileSync(join(created, ".agents/skills/clossys-designer/SKILL.md"), "utf8")).toContain("clossys-designer");

    const adopted = tempDir();
    writeInventory(adopted);
    applyWorkspacePlan(
      host(adopted),
      { action: "adopt", owner: "acme", repository: "hub", directory: adopted, advisorVersion: "0.1.5", integratorVersion: "0.8.2" },
      skeletonRoot,
      applyOpts,
    );
    expect(readFileSync(join(adopted, ".agents/skills/clossys-designer/SKILL.md"), "utf8")).toContain("clossys-designer");
  });

  it("grades a stale pin as degraded and an equal exclusive devDependency as current", () => {
    const directory = tempDir();
    writeFileSync(
      join(directory, "package.json"),
      `${JSON.stringify({ name: "hub", devDependencies: { [ADVISOR_PACKAGE]: "0.1.0", [INTEGRATOR_PACKAGE]: "0.8.2" } }, null, 2)}\n`,
    );
    writeInventory(directory);
    const stale = reportHubHealth(host(directory), directory, "0.2.0");
    expect(stale.pinFindings).toEqual([
      { package: ADVISOR_PACKAGE, bucket: "devDependencies", pinned: "0.1.0", grade: "stale", note: expect.stringContaining("older than live 0.2.0") },
    ]);
    expect(stale.degraded).toBe(true);
    expect(formatHubHealth(stale)).toMatch(/pin findings: @clossys\/advisor devDependencies pinned 0\.1\.0 is older than live 0\.2\.0/);
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
      `${JSON.stringify({ name: "hub", devDependencies: { [ADVISOR_PACKAGE]: "next", [INTEGRATOR_PACKAGE]: "0.8.2" } }, null, 2)}\n`,
    );
    const report = reportHubHealth(host(directory), directory, "0.2.0");
    expect(report.pinFindings).toEqual([
      { package: ADVISOR_PACKAGE, bucket: "devDependencies", pinned: "next", grade: "indeterminate", note: expect.stringContaining("cannot compare") },
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
    applyWorkspacePlan(host(directory), { action: "adopt", owner: "acme", repository: "hub", directory, advisorVersion: "0.1.5", integratorVersion: "0.8.2" }, skeletonRoot, applyOpts);

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
    applyWorkspacePlan(host(directory), { action: "adopt", owner: "acme", repository: "hub", directory, advisorVersion: "0.1.5", integratorVersion: "0.8.2" }, skeletonRoot, applyOpts);
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

  it("leaves a skill an earlier release composed into a sibling clone untouched, unreported, and not degrading", () => {
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
    writeEnginePins(hub);
    const applyOpts = composeApplyOptions(seedSkillCatalogue(["advisor"]));
    const resume = () =>
      applyWorkspacePlan(
        workspaceHost,
        { action: "resume", owner: "acme", repository: "hub", directory: hub, clone: false },
        skeletonRoot,
        applyOpts,
      );
    // Output an earlier Launcher release composed into the sibling, since edited by the client.
    const appSkill = join(app, ".agents", "skills", "clossys-advisor", "SKILL.md");
    mkdirSync(dirname(appSkill), { recursive: true });
    const edited = `${skillFixture("advisor")}\nClient's own note.\n`;
    writeFileSync(appSkill, edited);

    const result = resume();
    expect(result.health.skillComposition?.preserved).toEqual([]);
    expect(result.message).not.toMatch(/skill preserved/);
    expect(result.health.degraded).toBe(false);
    expect(readFileSync(appSkill, "utf8")).toBe(edited);
    expect(readdirSync(app).sort()).toEqual([".agents", ".git"]);
  });
});

describe("generated clossys/README.md", () => {
  it("notes there is no engagement brief yet, then reflects clossys/brief.json once it exists", () => {
    const directory = tempDir();
    writeInventory(directory);
    const applyOpts = composeApplyOptions(seedSkillCatalogue(["advisor"]));
    applyWorkspacePlan(
      host(directory),
      { action: "adopt", owner: "acme", repository: "hub", directory, advisorVersion: "0.1.5", integratorVersion: "0.8.2" },
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
        "npm view @clossys/integrator version": { status: 0, stdout: "0.8.2\n", stderr: "" },
      }),
    );
    expect(seen.cwd.githubOwner).toBe("acme");
    expect(seen.cwd.inventory).toEqual({ status: "missing", count: 0 });
    expect(seen.advisorVersion).toBe("0.2.6");
    expect(seen.integratorVersion).toBe("0.8.2");
  });
});

describe("a hub run writes nothing into any sibling checkout (S3-7a)", () => {
  // Real git repositories, so each sibling's state is compared the way a
  // person would see it: `git status --porcelain` plus a hash over every
  // path in the working tree (type, mode, mtime, and bytes or link target).
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
    return execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], {
      cwd,
      env: gitEnv,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  function treeHash(root: string): string {
    const hash = createHash("sha256");
    const walk = (directory: string, relative: string): void => {
      for (const name of readdirSync(directory).sort()) {
        if (relative === "" && name === ".git") continue;
        const path = join(directory, name);
        const rel = relative === "" ? name : `${relative}/${name}`;
        const stat = lstatSync(path);
        if (stat.isSymbolicLink()) {
          hash.update(`link ${rel} ${readlinkSync(path)} ${stat.mtimeMs}\n`);
        } else if (stat.isDirectory()) {
          hash.update(`dir ${rel} ${stat.mode} ${stat.mtimeMs}\n`);
          walk(path, rel);
        } else {
          hash.update(`file ${rel} ${stat.mode} ${stat.mtimeMs} ${stat.size}\n`);
          hash.update(readFileSync(path));
        }
      }
    };
    walk(root, "");
    return hash.digest("hex");
  }

  function checkoutState(directory: string): { status: string; head: string; tree: string } {
    return {
      status: git(directory, "status", "--porcelain", "--untracked-files=all", "--ignored"),
      head: git(directory, "rev-parse", "HEAD"),
      tree: treeHash(directory),
    };
  }

  function write(root: string, relative: string, contents: string): void {
    mkdirSync(dirname(join(root, relative)), { recursive: true });
    writeFileSync(join(root, relative), contents);
  }

  function commitAll(directory: string, message: string): void {
    git(directory, "add", "-A");
    git(directory, "commit", "-q", "-m", message);
  }

  const legacyManifest = (skills: readonly string[]): string =>
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: "2026-01-01T00:00:00.000Z",
        skills: skills.map((name) => ({ name: `clossys-${name}`, source: "catalogue", version: "0.1.0", sha256: createHash("sha256").update(skillFixture(name)).digest("hex") })),
      },
      null,
      2,
    )}\n`;

  /** Four inventoried product checkouts beside a hub: one clean, three dirty with output and pins an earlier release left. */
  function siblingsBeside(parent: string): Record<string, string> {
    const siblings: Record<string, string> = {};
    for (const name of ["clean-app", "dirty-app", "legacy-app", "pinned-app"]) {
      const directory = join(parent, name);
      mkdirSync(directory, { recursive: true });
      git(directory, "init", "-q");
      write(directory, "README.md", `# ${name}\n`);
      write(directory, "package.json", `${JSON.stringify({ name, private: true }, null, 2)}\n`);
      commitAll(directory, "initial");
      siblings[name] = directory;
    }
    // dirty-app: untracked skills, discovery link and manifest from an earlier appoint, and edited guidance.
    const dirty = siblings["dirty-app"] as string;
    write(dirty, ".agents/skills/clossys-advisor/SKILL.md", skillFixture("advisor"));
    mkdirSync(join(dirty, ".claude", "skills"), { recursive: true });
    symlinkSync("../../.agents/skills/clossys-advisor", join(dirty, ".claude", "skills", "clossys-advisor"), "dir");
    write(dirty, "clossys/.state/skills.json", legacyManifest(["advisor", "retired-role"]));
    write(dirty, "AGENTS.md", "# Product repository\n\nEdited by the client.\n");
    // legacy-app: a committed legacy hub-state folder and composed skills, then an uncommitted edit to one.
    const legacy = siblings["legacy-app"] as string;
    write(legacy, ".clossys/workspace.json", `${JSON.stringify({ schemaVersion: 1, kind: "account-hub", owner: "acme", repository: "acme/legacy-app" }, null, 2)}\n`);
    write(legacy, ".agents/skills/clossys-designer/SKILL.md", skillFixture("designer"));
    write(legacy, "clossys/.state/skills.json", legacyManifest(["designer"]));
    write(legacy, "CLAUDE.md", "@AGENTS.md\n");
    commitAll(legacy, "legacy output");
    write(legacy, ".agents/skills/clossys-designer/SKILL.md", `${skillFixture("designer")}\nClient note.\n`);
    // pinned-app: old engine pins, a staged change, a Cursor discovery link, and a hosts record.
    const pinned = siblings["pinned-app"] as string;
    write(pinned, "package.json", `${JSON.stringify({ name: "pinned-app", dependencies: { [INTEGRATOR_PACKAGE]: "0.1.0" }, devDependencies: { [ADVISOR_PACKAGE]: "0.2.6" } }, null, 2)}\n`);
    commitAll(pinned, "old pins");
    write(pinned, "src/staged.ts", "export {};\n");
    git(pinned, "add", "src/staged.ts");
    mkdirSync(join(pinned, ".cursor"), { recursive: true });
    symlinkSync("../.agents/skills", join(pinned, ".cursor", "skills"), "dir");
    write(pinned, "clossys/.state/hosts.json", `${JSON.stringify({ schemaVersion: 1, linkedHosts: ["cursor"], recordedAt: "2026-01-01T00:00:00.000Z" }, null, 2)}\n`);
    return siblings;
  }

  /** Answers `git remote get-url origin` for the hub and each sibling; every other command from `commands`. */
  function hubHost(hub: string, siblings: Record<string, string>, commands: Record<string, CommandResult> = {}): WorkspaceHost {
    const base = host(hub, commands);
    const origins = new Map<string, string>([[hub, "acme/hub"], ...Object.entries(siblings).map(([name, path]) => [path, `acme/${name}`] as const)]);
    return {
      ...base,
      run: (command, args, options) => {
        const origin = origins.get(options?.cwd ?? hub);
        if (command === "git" && args.join(" ") === "remote get-url origin" && origin !== undefined) {
          return { status: 0, stdout: `git@github.com:${origin}.git\n`, stderr: "" };
        }
        return base.run(command, args, options);
      },
    };
  }

  const inventory = [{ id: "acme/hub" }, { id: "acme/clean-app" }, { id: "acme/dirty-app" }, { id: "acme/legacy-app" }, { id: "acme/pinned-app" }];

  function snapshot(siblings: Record<string, string>): Record<string, ReturnType<typeof checkoutState>> {
    return Object.fromEntries(Object.entries(siblings).map(([name, path]) => [name, checkoutState(path)]));
  }

  it("D32: resume with four inventoried siblings, one clean and three dirty with legacy output, writes nothing into any of them and is neither failed nor degraded", () => {
    const parent = tempDir();
    const siblings = siblingsBeside(parent);
    const hub = join(parent, "hub");
    writeHubMarker(hub);
    writeInventory(hub, inventory);
    writeEnginePins(hub);
    const before = snapshot(siblings);
    expect(before["clean-app"]?.status).toBe("");
    for (const name of ["dirty-app", "legacy-app", "pinned-app"]) expect(before[name]?.status).not.toBe("");

    const result = applyWorkspacePlan(
      hubHost(hub, siblings),
      { action: "resume", owner: "acme", repository: "hub", directory: hub, clone: false, advisorVersion: "0.5.0", integratorVersion: "0.8.2" },
      skeletonRoot,
      composeApplyOptions(seedSkillCatalogue(["advisor", "designer"])),
    );

    expect(snapshot(siblings)).toEqual(before);
    expect(result.state).toBe("satisfied");
    expect(result.health.degraded).toBe(false);
    expect(result.health.pinFindings).toEqual([]);
    expect(result.health.skillComposition?.preserved).toEqual([]);
    expect(result.health.skillComposition?.rosterTargets).toEqual(["acme/hub"]);
    // The inventory is [hub, clean-app, dirty-app, legacy-app, pinned-app]; the hub is
    // recognised by identity and never listed as a sibling, so the four siblings sit at
    // stored-inventory positions 1-4 -- named that way, never by id (#1179).
    expect(result.health.skillComposition?.siblings).toEqual(
      [1, 2, 3, 4].map((position) => ({
        inventoryId: `repositories[${position}] in the stored inventory`,
        note: "checkout beside the hub; a hub run writes nothing here; once this repository is staffed in an approved plan, @clossys-advisor and the voices of the roles staffed there arrive with that plan's setup pull request",
      })),
    );
    expect(result.message).not.toMatch(/violated|failed/i);
    // The hub's own team is still composed.
    expect(readFileSync(join(hub, ".agents/skills/clossys-designer/SKILL.md"), "utf8")).toContain("name: clossys-designer");
  });

  it("writes nothing into a sibling on create, resume, or appoint", () => {
    const catalogue = seedSkillCatalogue(["advisor"]);

    // create: a new hub beside existing checkouts; its fresh inventory lists none of them.
    const createParent = tempDir();
    const createSiblings = siblingsBeside(createParent);
    const created = join(createParent, "workspace");
    mkdirSync(created);
    const createBefore = snapshot(createSiblings);
    const createdResult = applyWorkspacePlan(
      hubHost(created, createSiblings, {
        [`gh repo create acme/workspace --private --source ${created} --remote origin --push`]: { status: 0, stdout: "created\n", stderr: "" },
      }),
      { action: "create", owner: "acme", repository: "workspace", directory: created, advisorVersion: "0.5.0", integratorVersion: "0.8.2" },
      skeletonRoot,
      composeApplyOptions(catalogue),
    );
    expect(snapshot(createSiblings)).toEqual(createBefore);
    expect(createdResult.health.skillComposition?.rosterTargets).toEqual(["acme/workspace"]);

    // resume, with --repositories choosing all four siblings in the same run.
    const resumeParent = tempDir();
    const resumeSiblings = siblingsBeside(resumeParent);
    const resumed = join(resumeParent, "hub");
    writeHubMarker(resumed);
    writeInventory(resumed, [{ id: "acme/hub" }]);
    const resumeBefore = snapshot(resumeSiblings);
    const resumeResult = applyWorkspacePlan(
      hubHost(resumed, resumeSiblings),
      {
        action: "resume",
        owner: "acme",
        repository: "hub",
        directory: resumed,
        clone: false,
        chosenInventory: {
          kind: "write",
          document: `${JSON.stringify({ schemaVersion: 1, repositories: inventory }, null, 2)}\n`,
          count: 5,
          previousCount: 1,
          added: ["acme/clean-app", "acme/dirty-app", "acme/legacy-app", "acme/pinned-app"],
          removed: [],
          replaced: "nothing",
        },
      },
      skeletonRoot,
      composeApplyOptions(catalogue),
    );
    expect(snapshot(resumeSiblings)).toEqual(resumeBefore);
    expect(resumeResult.health.skillComposition?.siblings).toHaveLength(4);

    // appoint: the hub checkout is clean; its inventory lists all four siblings.
    const appointParent = tempDir();
    const appointSiblings = siblingsBeside(appointParent);
    const appointed = join(appointParent, "hub");
    mkdirSync(appointed);
    writeInventory(appointed, inventory);
    const appointBefore = snapshot(appointSiblings);
    const appointResult = applyWorkspacePlan(
      hubHost(appointed, appointSiblings, { "git status --porcelain": { status: 0, stdout: "", stderr: "" } }),
      { action: "adopt", owner: "acme", repository: "hub", directory: appointed, advisorVersion: "0.5.0", integratorVersion: "0.8.2" },
      skeletonRoot,
      composeApplyOptions(catalogue),
    );
    expect(snapshot(appointSiblings)).toEqual(appointBefore);
    expect(appointResult.state).toBe("satisfied");
    expect(appointResult.health.degraded).toBe(false);
    expect(appointResult.health.skillComposition?.siblings).toHaveLength(4);
  });

  it("resume refreshes hub guidance written when appoint still composed into siblings", () => {
    const directory = tempDir();
    writeHubMarker(directory);
    writeInventory(directory, [{ id: "acme/hub" }]);
    writeFileSync(join(directory, "AGENTS.md"), SIBLING_COMPOSING_CONSUMER_AGENTS_MD);
    applyWorkspacePlan(
      host(directory),
      { action: "resume", owner: "acme", repository: "hub", directory, clone: false },
      skeletonRoot,
      composeApplyOptions(seedSkillCatalogue(["advisor"])),
    );
    const agents = readFileSync(join(directory, "AGENTS.md"), "utf8");
    expect(agents).toBe(CONSUMER_AGENTS_MD);
    expect(agents).toContain("it gets `@clossys-advisor` and the voices of the roles\nstaffed there, with that plan's setup pull request. A missing `@` mention\nis a bug only here in the hub");
  });
});

describe("cloneMissingInventoryRepositories (#1179)", () => {
  it("clones exactly the inventory ids that classifyInventoriedSiblings found 'not beside the hub', and reports the clone path", () => {
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
    expect(outcomes).toEqual([{ inventoryId: "app", position: 0, result: "cloned", note: "cloned beside the hub" }]);
  });

  it("never attempts a clone for an id skipped for a DIFFERENT reason (wrong account)", () => {
    const directory = tempDir();
    mkdirSync(join(directory, ".git"));
    writeInventory(directory, [{ id: "other-org/app" }]);
    const outcomes = cloneMissingInventoryRepositories(host(directory, {}), directory, "acme");
    expect(outcomes).toEqual([{ inventoryId: "other-org/app", position: 0, result: "skipped-other-reason", note: "other account; not this roster" }]);
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
    expect(outcomes).toEqual([{ inventoryId: "app", position: 0, result: "failed", note: "gh repo clone exited 1" }]);
  });

  it("keeps the note fixed text on both success and failure, even for a hostile id (see cli.test.ts for the printed-output check)", () => {
    // `note` never repeats the folder name (success) or `gh`'s own stderr (failure),
    // which would otherwise carry the inventory id straight through (#1179).
    // `inventoryId` itself stays on the outcome for internal use only -- see its own
    // doc comment -- so cli.test.ts is what actually proves a hostile id never reaches
    // printed --clone-missing output.
    const hostileId = "acme/run.rm-rf-home-x";
    const directory = tempDir();
    mkdirSync(join(directory, ".git"));
    writeInventory(directory, [{ id: hostileId }]);
    const siblingPath = join(dirname(directory), "run.rm-rf-home-x");
    const succeeded = cloneMissingInventoryRepositories(
      host(directory, { [`gh repo clone ${hostileId} ${siblingPath}`]: { status: 0, stdout: "Cloning...\n", stderr: "" } }),
      directory,
      "acme",
    );
    expect(succeeded).toEqual([{ inventoryId: hostileId, position: 0, result: "cloned", note: "cloned beside the hub" }]);

    const failed = cloneMissingInventoryRepositories(
      host(directory, {
        [`gh repo clone ${hostileId} ${siblingPath}`]: {
          status: 1,
          stdout: "",
          stderr: `gh: repository ${hostileId} not found (or you do not have access)\n`,
        },
      }),
      directory,
      "acme",
    );
    expect(failed).toEqual([{ inventoryId: hostileId, position: 0, result: "failed", note: "gh repo clone exited 1" }]);
  });

  it("leaves a checkout already beside the hub out of its outcomes, and clones only the missing one", () => {
    const parent = tempDir();
    const hub = join(parent, "hub");
    mkdirSync(join(hub, ".git"), { recursive: true });
    writeInventory(hub, [{ id: "present" }, { id: "absent" }]);
    const present = join(parent, "present");
    mkdirSync(join(present, ".git"), { recursive: true });
    const base = host(hub, {
      [`gh repo clone acme/absent ${join(parent, "absent")}`]: { status: 0, stdout: "Cloning...\n", stderr: "" },
    });
    const cloneHost: WorkspaceHost = {
      ...base,
      run: (command, args, options) =>
        command === "git" && args.join(" ") === "remote get-url origin" && options?.cwd === present
          ? { status: 0, stdout: "git@github.com:acme/present.git\n", stderr: "" }
          : base.run(command, args, options),
    };
    expect(cloneMissingInventoryRepositories(cloneHost, hub, "acme")).toEqual([
      { inventoryId: "absent", position: 1, result: "cloned", note: "cloned beside the hub" },
    ]);
  });

  it("names a folder beside the hub that is not a git checkout, and one git refuses to read, each for what it is", () => {
    const parent = tempDir();
    const hub = join(parent, "hub");
    mkdirSync(join(hub, ".git"), { recursive: true });
    writeHubMarker(hub);
    writeEnginePins(hub);
    writeInventory(hub, [{ id: "plain" }, { id: "guarded" }]);
    mkdirSync(join(parent, "plain"), { recursive: true });
    const guarded = join(parent, "guarded");
    mkdirSync(join(guarded, ".git"), { recursive: true });
    const base = host(hub);
    const refusingHost: WorkspaceHost = {
      ...base,
      run: (command, args, options) =>
        command === "git" && args.join(" ") === "remote get-url origin" && options?.cwd === guarded
          ? { status: 128, stdout: "", stderr: `fatal: detected dubious ownership in repository at '${guarded}'\n` }
          : base.run(command, args, options),
    };
    const result = applyWorkspacePlan(
      refusingHost,
      { action: "resume", owner: "acme", repository: "hub", directory: hub, clone: false },
      skeletonRoot,
      composeApplyOptions(seedSkillCatalogue(["advisor"])),
    );
    // "plain" and "guarded" sit at stored-inventory positions 0 and 1; each entry names
    // that position, never the id itself (#1179).
    expect(result.health.skillComposition?.siblings).toEqual([
      {
        inventoryId: "repositories[0] in the stored inventory",
        note: "the folder beside the hub with this name is not a git checkout, so it cannot be matched to this inventory id",
      },
      {
        inventoryId: "repositories[1] in the stored inventory",
        note: "git refuses to read this checkout (it reports dubious ownership), so its origin could not be matched to this inventory id",
      },
    ]);
    expect(result.health.degraded).toBe(false);
    expect(readdirSync(join(parent, "plain"))).toEqual([]);
    expect(cloneMissingInventoryRepositories(refusingHost, hub, "acme").map((outcome) => outcome.result)).toEqual([
      "skipped-other-reason",
      "skipped-other-reason",
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

  it("records hosts.json for the hub only, never in a sibling clone", () => {
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
    expect(existsSync(join(hub, "clossys", ".state", "hosts.json"))).toBe(true);
    expect(existsSync(join(app, "clossys"))).toBe(false);
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
    // external: "app"(0), "site"(1). stored (launcher): "site"(0), "legacy"(1). Every
    // entry below is named by position, never by id (#1179).
    expect(result.health.inventoryDrift).toEqual({
      status: "reconciled",
      externalOnly: { count: 1, positions: ["externalInventory[0]"] },
      launcherOnly: { count: 1, positions: ["repositories[1]"] },
      agreeing: { count: 1, positions: ["externalInventory[1]"] },
    });
    expect(result.message).toMatch(/inventory drift: external-only 1, launcher-only 1, agreeing 1/);
    expect(result.message).not.toMatch(/"app"|"site"|"legacy"/);
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
