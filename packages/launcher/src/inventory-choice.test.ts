import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main, parseLauncherArgs } from "./cli.js";
import {
  applyWorkspacePlan,
  inspectInventory,
  isHubDocument,
  LEGACY_WORKSPACE_INVENTORY_REL,
  LEGACY_WORKSPACE_MARKER_REL,
  observeWorkspace,
  planWorkspace,
  readInventoryRepositories,
  reportHubHealth,
  WORKSPACE_INVENTORY_REL,
  WORKSPACE_MARKER_REL,
} from "./core.js";
import { reportInventoryDrift } from "./inventory-adoption.js";
import { validateAgainstContract } from "./generated/contract-schema.generated.js";
import { describeChosenInventory, resolveChosenInventory } from "./inventory-choice.js";
import { belongsToOwner, distinctOwners, inventoryKey, sameOwner, sameRepository } from "./identity.js";
import { validateInventoryDocument } from "./inventory-contract.js";
import { loadContract } from "./plan-contract.js";
import type { CommandResult, WorkspaceHost, WorkspaceObservation } from "./types.js";

const skeletonRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "skeleton");
const OWNER = "example-owner";
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempDir(prefix = "launcher-choice-"): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function host(directory: string, commands: Record<string, CommandResult> = {}): WorkspaceHost {
  return {
    cwd: directory,
    env: {},
    isTTY: false,
    now: () => "2026-09-24T00:00:00.000Z",
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
    prompt: () => null,
  };
}

/** A folder as the file system resolves it: on a case-insensitive file system, every spelling of one folder resolves alike. */
function folderOf(path: string): string | undefined {
  try {
    return realpathSync.native(path);
  } catch {
    return undefined;
  }
}

/**
 * The same host, answering `git remote get-url origin` for each listed
 * checkout with that repository's github.com origin -- in whichever
 * spelling of the folder git is run, as real git does.
 */
function withOrigins(base: WorkspaceHost, origins: Record<string, string>): WorkspaceHost {
  const byFolder = new Map(Object.entries(origins).map(([path, origin]) => [folderOf(path), origin] as const));
  return {
    ...base,
    run: (command, args, options) => {
      const origin = options?.cwd === undefined ? undefined : byFolder.get(folderOf(options.cwd));
      if (command === "git" && args.join(" ") === "remote get-url origin" && origin !== undefined) {
        return { status: 0, stdout: `git@github.com:${origin}.git\n`, stderr: "" };
      }
      return base.run(command, args, options);
    },
  };
}

const inventoryText = (repositories: readonly unknown[]) => `${JSON.stringify({ schemaVersion: 1, repositories }, null, 2)}\n`;

function writeInventory(directory: string, repositories: readonly unknown[]): void {
  mkdirSync(dirname(join(directory, WORKSPACE_INVENTORY_REL)), { recursive: true });
  writeFileSync(join(directory, WORKSPACE_INVENTORY_REL), inventoryText(repositories));
}

function writeHubMarker(directory: string): void {
  mkdirSync(dirname(join(directory, WORKSPACE_MARKER_REL)), { recursive: true });
  writeFileSync(
    join(directory, WORKSPACE_MARKER_REL),
    `${JSON.stringify({ schemaVersion: 1, kind: "account-hub", owner: OWNER, repository: `${OWNER}/example-hub` }, null, 2)}\n`,
  );
}

/** A GitHub checkout of example-owner/example-hub that is not yet a hub. */
const APPOINT_COMMANDS: Record<string, CommandResult> = {
  "git --version": { status: 0, stdout: "git\n", stderr: "" },
  "git remote get-url origin": { status: 0, stdout: `git@github.com:${OWNER}/example-hub.git\n`, stderr: "" },
  "git status --porcelain": { status: 0, stdout: "", stderr: "" },
  "npm view @clossys/advisor version": { status: 0, stdout: "0.5.0\n", stderr: "" },
  "npm view @clossys/integrator version": { status: 0, stdout: "0.8.2\n", stderr: "" },
};

function appointCheckout(): string {
  const directory = tempDir();
  mkdirSync(join(directory, ".git"), { recursive: true });
  return directory;
}

function resumableHub(repositories: readonly unknown[]): string {
  const directory = tempDir();
  writeHubMarker(directory);
  writeInventory(directory, repositories);
  return directory;
}

function stored(directory: string): string {
  return readFileSync(join(directory, WORKSPACE_INVENTORY_REL), "utf8");
}

function refusal(result: ReturnType<typeof resolveChosenInventory>): string {
  if (result.kind !== "refuse") throw new Error(`expected a refusal, got ${JSON.stringify(result)}`);
  return result.message;
}

describe("resolveChosenInventory (#1179)", () => {
  it("writes the chosen repositories when there is no inventory, as a document the contract accepts", () => {
    const result = resolveChosenInventory(null, [`${OWNER}/example-app`, `${OWNER}/example-site`], OWNER, false);
    expect(result).toMatchObject({ kind: "resolved", chosen: { kind: "write", count: 2, previousCount: 0, removed: [], replaced: "nothing" } });
    if (result.kind !== "resolved" || result.chosen.kind !== "write") return;
    expect(JSON.parse(result.chosen.document)).toEqual({ schemaVersion: 1, repositories: [{ id: `${OWNER}/example-app` }, { id: `${OWNER}/example-site` }] });
    // The written file validates against the contract through the shared checker, and through the reader every later run uses.
    expect(validateAgainstContract(loadContract("repository-inventory.json"), JSON.parse(result.chosen.document), loadContract)).toEqual([]);
    expect(validateInventoryDocument(result.chosen.document)).toEqual({ valid: true, ids: [`${OWNER}/example-app`, `${OWNER}/example-site`] });
  });

  it("writes into an empty inventory without calling it a replacement", () => {
    expect(resolveChosenInventory(inventoryText([]), [`${OWNER}/example-app`], OWNER, false)).toMatchObject({
      kind: "resolved",
      chosen: { kind: "write", count: 1, replaced: "nothing" },
    });
  });

  it("leaves an inventory that already lists the same repositories unchanged: any order, a bare id for the hub's owner, any letter case", () => {
    const onDisk = inventoryText([{ id: "example-app" }, { id: `${OWNER}/Example-Site`, packages: [{ name: "@example-scope/one" }] }]);
    expect(resolveChosenInventory(onDisk, [`${OWNER}/example-site`, `${OWNER}/example-app`], OWNER, false)).toEqual({
      kind: "resolved",
      chosen: { kind: "unchanged", count: 2 },
    });
  });

  it("refuses to overwrite an existing inventory that differs, reporting counts and ids, and never merges", () => {
    const onDisk = inventoryText([{ id: `${OWNER}/example-app` }, { id: `${OWNER}/example-old` }]);
    const message = refusal(resolveChosenInventory(onDisk, [`${OWNER}/example-app`, `${OWNER}/example-new`, `${OWNER}/example-site`], OWNER, false));
    expect(message).toBe(
      `the hub inventory already lists 2 repositories and the choice has 3: 2 to add (${OWNER}/example-new, ${OWNER}/example-site), 1 to remove (${OWNER}/example-old). ` +
        "Launcher never merges or overwrites an inventory silently; to replace it with the choice, run again with --replace-inventory",
    );
  });

  it("with --replace-inventory, replaces a differing inventory and keeps what it recorded about repositories that stay", () => {
    const kept = { id: `${OWNER}/example-app`, packages: [{ name: "@example-scope/one", version: "2.0.0", wiring: "devDependencies" }] };
    const onDisk = inventoryText([kept, { id: `${OWNER}/example-old` }]);
    const result = resolveChosenInventory(onDisk, [`${OWNER}/example-new`, `${OWNER}/example-app`], OWNER, true);
    expect(result).toMatchObject({
      kind: "resolved",
      chosen: { kind: "write", count: 2, previousCount: 2, added: [`${OWNER}/example-new`], removed: [`${OWNER}/example-old`], replaced: "differing" },
    });
    if (result.kind !== "resolved" || result.chosen.kind !== "write") return;
    expect(JSON.parse(result.chosen.document).repositories).toEqual([{ id: `${OWNER}/example-new` }, kept]);
    expect(describeChosenInventory(result.chosen)).toBe(
      `inventory: replaced 2 with the 2 repositories you chose -- 1 added (${OWNER}/example-new), 1 removed (${OWNER}/example-old)`,
    );
  });

  it("refuses to replace an inventory that fails its contract without --replace-inventory, and replaces it with it", () => {
    const onDisk = inventoryText([{ id: `${OWNER}/example-app`, role: "product" }]);
    expect(refusal(resolveChosenInventory(onDisk, [`${OWNER}/example-app`], OWNER, false))).toMatch(
      /^the hub inventory repositories\[0\]\.role is not a field the contract declares.*; to replace it with the 1 repository chosen, run again with --replace-inventory$/,
    );
    expect(resolveChosenInventory(onDisk, [`${OWNER}/example-app`], OWNER, true)).toMatchObject({
      kind: "resolved",
      chosen: { kind: "write", count: 1, replaced: "invalid" },
    });
  });

  it.each([
    ["an empty choice", [], /^--repositories must name at least one repository$/],
    ["an empty id from a trailing comma", [`${OWNER}/example-app`, ""], /^--repositories is not a valid inventory: repositories\[1\]\.id must be a bare repository name or owner\/name/],
    ["an id with more than one slash", [`${OWNER}/example-app/extra`], /^--repositories is not a valid inventory: repositories\[0\]\.id must be a bare repository name/],
    ["an id with whitespace", [` ${OWNER}/example-app`], /^--repositories is not a valid inventory: repositories\[0\]\.id must be a bare repository name/],
    ["a dot-dot id", [`${OWNER}/..`], /^--repositories is not a valid inventory: repositories\[0\]\.id must be a bare repository name/],
    ["a duplicate id", [`${OWNER}/example-app`, `${OWNER}/Example-App`], /^--repositories is not a valid inventory: repositories\[1\]\.id names the same repository as repositories\[0\]\.id/],
  ])("refuses a malformed list: %s, by position and without echoing it", (_name, chosen, message) => {
    const text = refusal(resolveChosenInventory(null, chosen, OWNER, false));
    expect(text).toMatch(message);
    expect(text).not.toMatch(/example-app/i);
  });
});

describe("launcher --repositories (#1179)", () => {
  it("parses the flags in any order, splitting the ids on commas", () => {
    expect(parseLauncherArgs(["--replace-inventory", "--repositories", `${OWNER}/example-app,${OWNER}/example-site`])).toEqual({
      help: false,
      repositories: [`${OWNER}/example-app`, `${OWNER}/example-site`],
      replaceInventory: true,
      cloneMissing: false,
    });
    expect(() => parseLauncherArgs(["--repositories"])).toThrow(/no arguments except/);
    expect(() => parseLauncherArgs(["--repositories", "a", "--repositories", "b"])).toThrow(/each at most once/);
  });

  it("appoints a hub with the chosen repositories, and what it writes, Launcher reads back", () => {
    const directory = appointCheckout();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const chosen = [`${OWNER}/example-hub`, `${OWNER}/example-app`];
    expect(main(["--repositories", chosen.join(",")], host(directory, APPOINT_COMMANDS), skeletonRoot)).toBe(0);
    expect(String(log.mock.calls[0]?.[0])).toMatch(/appointed example-owner\/example-hub as the account hub/);
    expect(String(log.mock.calls[0]?.[0])).toMatch(/inventory: wrote the 2 repositories you chose/);
    // Round trip: every reader of the stored inventory accepts exactly what was written.
    expect(stored(directory)).toBe(inventoryText(chosen.map((id) => ({ id }))));
    expect(readInventoryRepositories(host(directory), join(directory, WORKSPACE_INVENTORY_REL), "the hub inventory")).toEqual(chosen);
    expect(inspectInventory(stored(directory))).toEqual({ status: "populated", count: 2 });
    // A later resume reads it back as the hub's inventory, and choosing the same set again changes nothing.
    log.mockClear();
    expect(main(["--repositories", [...chosen].reverse().join(",")], host(directory), skeletonRoot)).toBe(0);
    expect(String(log.mock.calls[0]?.[0])).toMatch(/resumed example-owner\/example-hub/);
    expect(String(log.mock.calls[0]?.[0])).toMatch(/inventory: unchanged -- it already lists the 2 repositories you chose/);
    expect(String(log.mock.calls[0]?.[0])).toMatch(/inventory: populated \(2\)/);
    expect(stored(directory)).toBe(inventoryText(chosen.map((id) => ({ id }))));
  });

  it("points appointing over an inventory that fails its contract at choosing again with --replace-inventory", () => {
    const directory = appointCheckout();
    writeInventory(directory, [{ id: `${OWNER}/example-app`, role: "product" }]);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(main([], host(directory, APPOINT_COMMANDS), skeletonRoot)).toBe(1);
    const message = String(err.mock.calls[0]?.[0]);
    expect(message).toMatch(/repositories\[0\]\.role is not a field the contract declares/);
    expect(message).toMatch(/to replace it, choose the repositories this hub covers on Advisor's repository card/);
    expect(message).toMatch(/launcher --repositories <owner\/name>\[,<owner\/name>\.\.\.\] --replace-inventory/);
    expect(existsSync(join(directory, WORKSPACE_MARKER_REL))).toBe(false);
  });

  it("refuses a malformed list before writing anything, when appointing", () => {
    const directory = appointCheckout();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(main(["--repositories", `${OWNER}/example-app,,${OWNER}/example-site`], host(directory, APPOINT_COMMANDS), skeletonRoot)).toBe(1);
    expect(String(err.mock.calls[0]?.[0])).toMatch(/repositories\[1\]\.id must be a bare repository name/);
    expect(existsSync(join(directory, "clossys"))).toBe(false);
  });

  it("refuses to overwrite a hub inventory that differs, writes nothing, and replaces it only with --replace-inventory", () => {
    const directory = resumableHub([{ id: `${OWNER}/example-app` }, { id: `${OWNER}/example-old` }]);
    const before = stored(directory);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main(["--repositories", `${OWNER}/example-app,${OWNER}/example-new`], host(directory), skeletonRoot)).toBe(1);
    expect(String(err.mock.calls[0]?.[0])).toMatch(
      /already lists 2 repositories and the choice has 2: 1 to add \(example-owner\/example-new\), 1 to remove \(example-owner\/example-old\)/,
    );
    expect(stored(directory)).toBe(before);
    expect(log).not.toHaveBeenCalled();

    expect(main(["--repositories", `${OWNER}/example-app,${OWNER}/example-new`, "--replace-inventory"], host(directory), skeletonRoot)).toBe(0);
    expect(String(log.mock.calls[0]?.[0])).toMatch(/inventory: replaced 2 with the 2 repositories you chose -- 1 added/);
    expect(readInventoryRepositories(host(directory), join(directory, WORKSPACE_INVENTORY_REL), "the hub inventory")).toEqual([
      `${OWNER}/example-app`,
      `${OWNER}/example-new`,
    ]);
  });

  it("refuses --replace-inventory alone, --repositories with --inventory, and --repositories in an empty directory", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const hub = resumableHub([{ id: `${OWNER}/example-app` }]);
    expect(main(["--replace-inventory"], host(hub), skeletonRoot)).toBe(1);
    expect(String(err.mock.calls.at(-1)?.[0])).toMatch(/--replace-inventory approves replacing the inventory with --repositories/);
    expect(main(["--repositories", `${OWNER}/example-app`, "--inventory", "elsewhere.json"], host(hub), skeletonRoot)).toBe(1);
    expect(String(err.mock.calls.at(-1)?.[0])).toMatch(/use one, not both/);
    const empty = tempDir();
    expect(
      main(
        ["--repositories", `${OWNER}/example-app`],
        host(empty, {
          "gh --version": { status: 0, stdout: "gh\n", stderr: "" },
          "git --version": { status: 0, stdout: "git\n", stderr: "" },
          "gh api user --jq .login": { status: 0, stdout: `${OWNER}\n`, stderr: "" },
          "gh org list": { status: 0, stdout: "", stderr: "" },
        }),
        skeletonRoot,
      ),
    ).toBe(1);
    expect(String(err.mock.calls.at(-1)?.[0])).toMatch(/this directory is empty; run launcher here first/);
    expect(readdirSync(empty)).toEqual([]);
  });

  it("keeps --inventory working when appointing", () => {
    const directory = appointCheckout();
    writeFileSync(join(directory, "prepared.json"), inventoryText([{ id: `${OWNER}/example-app` }]));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main(["--inventory", "prepared.json"], host(directory, APPOINT_COMMANDS), skeletonRoot)).toBe(0);
    expect(String(log.mock.calls[0]?.[0])).toMatch(/appointed/);
    expect(inspectInventory(stored(directory))).toEqual({ status: "populated", count: 1 });
  });

  it("re-validates the chosen document at apply time and writes nothing when it fails", () => {
    const directory = appointCheckout();
    expect(() =>
      applyWorkspacePlan(
        host(directory, APPOINT_COMMANDS),
        {
          action: "adopt",
          owner: OWNER,
          repository: "example-hub",
          directory,
          advisorVersion: "0.5.0",
          integratorVersion: "0.8.2",
          chosenInventory: {
            kind: "write",
            document: inventoryText([{ id: `${OWNER}/example-app`, role: "product" }]),
            count: 1,
            previousCount: 0,
            added: [],
            removed: [],
            replaced: "nothing",
          },
        },
        skeletonRoot,
      ),
    ).toThrow(/the chosen inventory repositories\[0\]\.role is not a field/);
    expect(existsSync(join(directory, "clossys"))).toBe(false);
  });

  it("refuses --repositories on a hub whose state is still in the legacy folder", () => {
    const observation: WorkspaceObservation = {
      ownerCandidates: [OWNER],
      ghAvailable: true,
      gitAvailable: true,
      advisorVersion: "0.5.0",
      integratorVersion: "0.8.2",
      cwd: {
        absolutePath: tempDir(),
        empty: false,
        git: true,
        looksLikeFoundry: false,
        hub: { schemaVersion: 1, kind: "account-hub", owner: OWNER, repository: `${OWNER}/example-hub` },
        hubMigration: "legacy",
      },
    };
    expect(planWorkspace(observation, host(observation.cwd.absolutePath), { repositories: [`${OWNER}/example-app`] })).toMatchObject({
      action: "refuse",
      state: "violated",
      message: expect.stringMatching(/legacy \.clossys\/ folder; run launcher once without --repositories/),
    });
  });
});

/** An inventory file whose first package name holds the bytes FF FE C0, which are not UTF-8. */
function invalidUtf8Inventory(): Uint8Array {
  const text = inventoryText([{ id: `${OWNER}/example-app`, packages: [{ name: "@example-scope/XXX" }] }]);
  const bytes = new TextEncoder().encode(text);
  const at = text.indexOf("XXX");
  bytes.set([0xff, 0xfe, 0xc0], at);
  return bytes;
}

const REPLACEMENT_CHARACTER_BYTES = [0xef, 0xbf, 0xbd];

function containsBytes(haystack: Uint8Array, needle: readonly number[]): boolean {
  outer: for (let index = 0; index + needle.length <= haystack.length; index += 1) {
    for (const [offset, byte] of needle.entries()) if (haystack[index + offset] !== byte) continue outer;
    return true;
  }
  return false;
}

describe("inventory files are read as bytes (#1179)", () => {
  it("reports a stored inventory whose bytes are not UTF-8 as invalid, never as populated", () => {
    const directory = resumableHub([]);
    writeFileSync(join(directory, WORKSPACE_INVENTORY_REL), invalidUtf8Inventory());
    expect(reportHubHealth(host(directory), directory).inventory).toEqual({
      status: "invalid",
      count: 0,
      reason: "is not valid UTF-8 (see docs/contracts/repository-inventory.json)",
    });
    expect(() => readInventoryRepositories(host(directory), join(directory, WORKSPACE_INVENTORY_REL), "the hub inventory")).toThrow(/is not valid UTF-8/);
  });

  it("refuses --repositories over it, and --replace-inventory never writes a U+FFFD back", () => {
    const directory = resumableHub([]);
    writeFileSync(join(directory, WORKSPACE_INVENTORY_REL), invalidUtf8Inventory());
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main(["--repositories", `${OWNER}/example-app`], host(directory), skeletonRoot)).toBe(1);
    expect(String(err.mock.calls[0]?.[0])).toMatch(/the hub inventory is not valid UTF-8 .*run again with --replace-inventory/);
    expect(main(["--repositories", `${OWNER}/example-app`, "--replace-inventory"], host(directory), skeletonRoot)).toBe(0);
    const written = readFileSync(join(directory, WORKSPACE_INVENTORY_REL));
    expect(containsBytes(written, REPLACEMENT_CHARACTER_BYTES)).toBe(false);
    expect(written.toString("utf8")).toBe(inventoryText([{ id: `${OWNER}/example-app` }]));
  });

  it("refuses --inventory whose bytes are not UTF-8 when appointing, and writes nothing", () => {
    const directory = appointCheckout();
    writeFileSync(join(directory, "prepared.json"), invalidUtf8Inventory());
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(main(["--inventory", "prepared.json"], host(directory, APPOINT_COMMANDS), skeletonRoot)).toBe(1);
    expect(String(err.mock.calls[0]?.[0])).toMatch(/--inventory at .* is not valid UTF-8/);
    expect(existsSync(join(directory, "clossys"))).toBe(false);
  });

  it("copies a valid --inventory byte for byte, non-ASCII text included", () => {
    const directory = appointCheckout();
    const prepared = new TextEncoder().encode(`{"schemaVersion":1,"repositories":[{"id":"${OWNER}/example-app","packages":[{"name":"@example-scope/caf\u00e9-\u00e9"}]}]}`);
    writeFileSync(join(directory, "prepared.json"), prepared);
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main(["--inventory", "prepared.json"], host(directory, APPOINT_COMMANDS), skeletonRoot)).toBe(0);
    expect([...readFileSync(join(directory, WORKSPACE_INVENTORY_REL))]).toEqual([...prepared, 0x0a]);
  });

  it("moves a legacy inventory byte for byte, so its invalid bytes are still refused afterwards", () => {
    const directory = tempDir();
    mkdirSync(dirname(join(directory, LEGACY_WORKSPACE_MARKER_REL)), { recursive: true });
    writeFileSync(
      join(directory, LEGACY_WORKSPACE_MARKER_REL),
      `${JSON.stringify({ schemaVersion: 1, kind: "account-hub", owner: OWNER, repository: `${OWNER}/example-hub` }, null, 2)}\n`,
    );
    const legacy = invalidUtf8Inventory();
    writeFileSync(join(directory, LEGACY_WORKSPACE_INVENTORY_REL), legacy);
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main([], host(directory), skeletonRoot)).toBe(0);
    expect([...readFileSync(join(directory, WORKSPACE_INVENTORY_REL))]).toEqual([...legacy]);
    expect(reportHubHealth(host(directory), directory).inventory.status).toBe("invalid");
  });

  it("refuses a lone surrogate, escaped in the file or raw in a string, in a package name or version", () => {
    for (const field of ["name", "version"]) {
      const escaped = `{"schemaVersion":1,"repositories":[{"id":"app","packages":[{"name":"x","${field}":"\\ud800"}]}]}`.replace('"name":"x","name"', '"name"');
      expect(validateInventoryDocument(new TextEncoder().encode(escaped))).toEqual({
        valid: false,
        reason: `repositories[0].packages[0].${field} must be well-formed Unicode, and contains a lone surrogate (see docs/contracts/repository-inventory.json)`,
      });
    }
    // JSON.stringify would escape it; this string carries the raw surrogate itself.
    expect(validateInventoryDocument(`{"schemaVersion":1,"repositories":[{"id":"app","packages":[{"name":"${"\ud800"}"}]}]}`)).toMatchObject({
      valid: false,
      reason: expect.stringMatching(/^is not well-formed Unicode: it contains a lone surrogate/),
    });
  });
});

describe("one repository identity (#1179)", () => {
  it("inventoryKey qualifies a bare id with the hub's owner, then ignores letter case", () => {
    expect(inventoryKey("Example-App", OWNER)).toBe("example-owner/example-app");
    expect(inventoryKey("Example-Owner/Example-App", OWNER)).toBe("example-owner/example-app");
    expect(inventoryKey("other-owner/example-app", OWNER)).toBe("other-owner/example-app");
    expect(inventoryKey("Example-App")).toBe("example-app");
  });

  it("refuses a stored inventory listing app and <owner>/app, by position, instead of silently dropping app's packages", () => {
    const onDisk = inventoryText([
      { id: "example-app", packages: [{ name: "@example-scope/one" }] },
      { id: `${OWNER}/example-app` },
      { id: `${OWNER}/example-site` },
    ]);
    const message = refusal(resolveChosenInventory(onDisk, [`${OWNER}/example-app`, `${OWNER}/example-site`], OWNER, false));
    expect(message).toBe(
      "the hub inventory repositories[1].id names the same repository as repositories[0].id (repository ids are compared case-insensitively, " +
        "and a bare id names a repository of the hub's own owner; see docs/contracts/repository-inventory.json); " +
        "to replace it with the 2 repositories chosen, run again with --replace-inventory",
    );
    // Only an explicit replacement touches it, and then the choice is written as it stands: nothing is merged.
    const replaced = resolveChosenInventory(onDisk, [`${OWNER}/example-app`], OWNER, true);
    expect(replaced).toMatchObject({ kind: "resolved", chosen: { kind: "write", count: 1, replaced: "invalid" } });
    if (replaced.kind === "resolved" && replaced.chosen.kind === "write") {
      expect(JSON.parse(replaced.chosen.document).repositories).toEqual([{ id: `${OWNER}/example-app` }]);
    }
  });

  it("reports that stored inventory as invalid on resume, and writes nothing into a sibling", () => {
    const parent = tempDir();
    const directory = join(parent, "example-hub");
    const sibling = join(parent, "example-app");
    mkdirSync(join(sibling, ".git"), { recursive: true });
    writeHubMarker(directory);
    writeInventory(directory, [{ id: "example-app" }, { id: `${OWNER}/Example-App` }]);
    expect(reportHubHealth(host(directory), directory).inventory).toMatchObject({
      status: "invalid",
      reason: expect.stringMatching(/^repositories\[1\]\.id names the same repository as repositories\[0\]\.id/),
    });
    // The contract alone, with no owner to read a bare id against, cannot know they are the same repository.
    expect(validateInventoryDocument(stored(directory))).toEqual({ valid: true, ids: ["example-app", `${OWNER}/Example-App`] });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main([], withOrigins(host(directory), { [sibling]: `${OWNER}/example-app` }), skeletonRoot)).toBe(0);
    const message = String(log.mock.calls[0]?.[0]);
    expect(message).toMatch(/skill roster written: example-owner\/example-hub\n|skill roster written: example-owner\/example-hub$/m);
    expect(message).toMatch(/^inventory: invalid -- repositories\[1\]\.id names the same repository/m);
    expect(message).toMatch(/^degraded: yes$/m);
    expect(message).not.toMatch(/^sibling /m);
    // Nothing was written into the sibling the invalid inventory names.
    expect(readdirSync(sibling)).toEqual([".git"]);
  });

  it("refuses --repositories app,<owner>/app as one repository chosen twice, by position", () => {
    const text = refusal(resolveChosenInventory(null, ["example-app", `${OWNER}/example-app`], OWNER, false));
    expect(text).toMatch(/^--repositories is not a valid inventory: repositories\[1\]\.id names the same repository as repositories\[0\]\.id/);
    const directory = appointCheckout();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(main(["--repositories", `example-app,${OWNER}/example-app`], host(directory, APPOINT_COMMANDS), skeletonRoot)).toBe(1);
    expect(String(err.mock.calls[0]?.[0])).toMatch(/repositories\[1\]\.id names the same repository as repositories\[0\]\.id/);
    expect(existsSync(join(directory, "clossys"))).toBe(false);
  });

  it("drift compares an external bare id and the hub's qualified id as the same repository", () => {
    const directory = resumableHub([{ id: `${OWNER}/example-app` }]);
    const external = join(directory, "external.json");
    writeFileSync(external, inventoryText([{ id: "Example-App" }, { id: "example-site" }]));
    expect(reportInventoryDrift(host(directory), directory, { path: external, shape: "foundry" }, WORKSPACE_INVENTORY_REL, OWNER)).toEqual({
      status: "reconciled",
      externalOnly: ["example-site"],
      launcherOnly: [],
      agreeing: ["Example-App"],
    });
  });

  it("drift cannot read an external inventory whose bytes are not UTF-8", () => {
    const directory = resumableHub([{ id: `${OWNER}/example-app` }]);
    const external = join(directory, "external.json");
    writeFileSync(external, invalidUtf8Inventory());
    expect(reportInventoryDrift(host(directory), directory, { path: external, shape: "foundry" }, WORKSPACE_INVENTORY_REL, OWNER).status).toBe("indeterminate");
  });
});

describe("resume writes the chosen inventory before composing (#1179)", () => {
  it("reports, in the same run, a sibling listed only in the inventory it just wrote, and writes nothing into it", () => {
    const parent = tempDir();
    const hub = join(parent, "example-hub");
    const sibling = join(parent, "example-app");
    mkdirSync(join(sibling, ".git"), { recursive: true });
    writeHubMarker(hub);
    writeInventory(hub, []);
    const base = host(hub);
    const siblingHost: WorkspaceHost = {
      ...base,
      run: (command, args, options) =>
        command === "git" && args.join(" ") === "remote get-url origin" && options?.cwd === sibling
          ? { status: 0, stdout: `git@github.com:${OWNER}/example-app.git\n`, stderr: "" }
          : base.run(command, args, options),
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(existsSync(join(sibling, ".agents"))).toBe(false);
    expect(main(["--repositories", `${OWNER}/example-app`], siblingHost, skeletonRoot)).toBe(0);
    const message = String(log.mock.calls[0]?.[0]);
    expect(message).toMatch(/inventory: wrote the 1 repository you chose/);
    expect(message).toMatch(/^sibling \(example-owner\/example-app\): checkout beside the hub; its @clossys-\* team arrives with the setup pull request$/m);
    expect(readdirSync(sibling)).toEqual([".git"]);
  });
});

describe("one repository identity for the roster, the merge and drift (#1179)", () => {
  function hubBeside(parent: string, repositories: readonly unknown[]): string {
    const hub = join(parent, "example-hub");
    mkdirSync(join(hub, ".git"), { recursive: true });
    writeHubMarker(hub);
    writeInventory(hub, repositories);
    return hub;
  }

  it("never composes the hub a second time as its own sibling when the inventory spells it in another case", () => {
    const parent = tempDir();
    const hub = hubBeside(parent, [{ id: `${OWNER}/Example-Hub` }]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main([], withOrigins(host(hub), { [hub]: `${OWNER}/example-hub` }), skeletonRoot)).toBe(0);
    const message = String(log.mock.calls[0]?.[0]);
    // On a case-insensitive file system `Example-Hub` beside the hub IS the hub's folder; on any file system it is the hub's repository.
    expect(message).toMatch(/^skill roster written: example-owner\/example-hub$/m);
    expect(message).not.toMatch(/Example-Hub|EXAMPLE-HUB/);
  });

  it("recognises the hub by the repository its marker records when the checkout has no github.com origin", () => {
    const parent = tempDir();
    const hub = join(parent, "example-hub");
    writeHubMarker(hub);
    writeInventory(hub, [{ id: `${OWNER}/EXAMPLE-HUB` }]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main([], host(hub), skeletonRoot)).toBe(0);
    const message = String(log.mock.calls[0]?.[0]);
    expect(message).toMatch(/^skill roster written: example-owner\/example-hub$/m);
    expect(message).not.toMatch(/^sibling /m);
  });

  it("matches a sibling's owner and origin without regard to letter case", () => {
    const parent = tempDir();
    const sibling = join(parent, "example-app");
    mkdirSync(join(sibling, ".git"), { recursive: true });
    const hub = hubBeside(parent, [{ id: "EXAMPLE-OWNER/example-app" }]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(
      main([], withOrigins(host(hub), { [hub]: `${OWNER}/example-hub`, [sibling]: "Example-Owner/Example-App" }), skeletonRoot),
    ).toBe(0);
    const message = String(log.mock.calls[0]?.[0]);
    expect(message).toMatch(/^skill roster written: example-owner\/example-hub$/m);
    expect(message).toMatch(/^sibling \(EXAMPLE-OWNER\/example-app\): checkout beside the hub; its @clossys-\* team arrives with the setup pull request$/m);
    expect(message).not.toMatch(/other account|origin does not match/);
    expect(readdirSync(sibling)).toEqual([".git"]);
  });

  it("merges an appoint --inventory by repository identity, keeping every kept entry whole, packages included", () => {
    const directory = appointCheckout();
    const app = { id: "example-app", packages: [{ name: "@example-scope/one", version: "2.0.0", wiring: "devDependencies" }] };
    const site = { id: `${OWNER}/example-site`, packages: [{ name: "@example-scope/two" }] };
    writeInventory(directory, [app, site]);
    const extra = { id: `${OWNER}/example-extra`, packages: [{ name: "@example-scope/three" }] };
    writeFileSync(join(directory, "prepared.json"), inventoryText([{ id: `${OWNER}/Example-App`, packages: [] }, { id: "EXAMPLE-SITE" }, extra]));
    const decision = planWorkspace(
      {
        ownerCandidates: [OWNER],
        advisorVersion: "0.5.0",
        integratorVersion: "0.8.2",
        ghAvailable: true,
        gitAvailable: true,
        cwd: {
          absolutePath: directory,
          empty: false,
          git: true,
          githubOwner: OWNER,
          githubRepository: "example-hub",
          looksLikeFoundry: false,
          inventory: { status: "populated", count: 2 },
        },
      },
      host(directory),
      { inventoryPath: "prepared.json" },
    );
    expect(decision).toMatchObject({ action: "adopt", mergedInventoryIds: ["example-app", `${OWNER}/example-site`, `${OWNER}/example-extra`] });
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main(["--inventory", "prepared.json"], host(directory, APPOINT_COMMANDS), skeletonRoot)).toBe(0);
    expect(JSON.parse(stored(directory))).toEqual({ schemaVersion: 1, repositories: [app, site, extra] });
  });

  it("drift is indeterminate, not empty, when the hub's own inventory cannot be read", () => {
    const directory = resumableHub([{ id: "example-app", role: "product" }]);
    const external = join(directory, "external.json");
    writeFileSync(external, inventoryText([{ id: `${OWNER}/example-app` }]));
    const report = reportInventoryDrift(host(directory), directory, { path: external, shape: "foundry" }, WORKSPACE_INVENTORY_REL, OWNER);
    expect(report).toMatchObject({ status: "indeterminate", externalOnly: [], launcherOnly: [], agreeing: [] });
    expect(report.note).toMatch(/^the hub's own inventory repositories\[0\]\.role is not a field the contract declares/);
    writeFileSync(join(directory, WORKSPACE_INVENTORY_REL), invalidUtf8Inventory());
    expect(reportInventoryDrift(host(directory), directory, { path: external, shape: "foundry" }, WORKSPACE_INVENTORY_REL, OWNER).status).toBe("indeterminate");
  });

  it("drift compares against nothing when the hub has no inventory file at all", () => {
    const directory = resumableHub([]);
    rmSync(join(directory, WORKSPACE_INVENTORY_REL));
    const external = join(directory, "external.json");
    writeFileSync(external, inventoryText([{ id: `${OWNER}/example-app` }]));
    expect(reportInventoryDrift(host(directory), directory, { path: external, shape: "foundry" }, WORKSPACE_INVENTORY_REL, OWNER)).toEqual({
      status: "reconciled",
      externalOnly: [`${OWNER}/example-app`],
      launcherOnly: [],
      agreeing: [],
    });
  });
});

describe("one account identity (#1179)", () => {
  it("accepts CLOSSYS_OWNER that differs from the origin owner only in letter case", () => {
    const directory = appointCheckout();
    writeInventory(directory, [{ id: `${OWNER}/example-app` }]);
    const decision = planWorkspace(
      {
        ownerCandidates: [OWNER],
        envOwner: "Example-Owner",
        advisorVersion: "0.5.0",
        integratorVersion: "0.8.2",
        ghAvailable: true,
        gitAvailable: true,
        cwd: {
          absolutePath: directory,
          empty: false,
          git: true,
          githubOwner: OWNER,
          githubRepository: "example-hub",
          looksLikeFoundry: false,
          inventory: { status: "populated", count: 1 },
        },
      },
      host(directory),
    );
    expect(decision).toMatchObject({ action: "adopt", owner: OWNER });
  });

  it("counts two spellings of one account as one owner candidate", () => {
    const directory = tempDir();
    const observed = observeWorkspace(
      host(directory, {
        "gh --version": { status: 0, stdout: "gh\n", stderr: "" },
        "git --version": { status: 0, stdout: "git\n", stderr: "" },
        "gh api user --jq .login": { status: 0, stdout: "Example-Owner\n", stderr: "" },
        "gh org list": { status: 0, stdout: `${OWNER}\nexample-org\n`, stderr: "" },
      }),
    );
    expect(observed.ownerCandidates).toEqual(["Example-Owner", "example-org"]);
  });

  it("reads a hub marker whose repository names its owner in another letter case", () => {
    expect(isHubDocument({ schemaVersion: 1, kind: "account-hub", owner: OWNER, repository: "Example-Owner/example-hub" })).toBe(true);
    expect(isHubDocument({ schemaVersion: 1, kind: "account-hub", owner: OWNER, repository: "other-owner/example-hub" })).toBe(false);
  });

  it("the identity functions agree with each other", () => {
    expect(sameRepository("Example-App", `${OWNER}/example-app`, OWNER)).toBe(true);
    expect(sameRepository("example-app", `other-owner/example-app`, OWNER)).toBe(false);
    expect(sameOwner("Example-Owner", OWNER)).toBe(true);
    expect(belongsToOwner("example-app", OWNER)).toBe(true);
    expect(belongsToOwner("EXAMPLE-OWNER/example-app", OWNER)).toBe(true);
    expect(belongsToOwner("other-owner/example-app", OWNER)).toBe(false);
    expect(distinctOwners(["Example-Owner", "example-org", OWNER])).toEqual(["Example-Owner", "example-org"]);
  });
});
