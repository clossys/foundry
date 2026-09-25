import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isDirectInvocation, main, USAGE } from "./cli.js";
import type { CommandResult, WorkspaceHost } from "./types.js";

const skeletonRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "skeleton");
const WORKSPACE_MARKER_REL = join("clossys", ".state", "workspace.json");
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function host(directory: string, commands: Record<string, CommandResult>): WorkspaceHost {
  return {
    cwd: directory,
    env: {},
    isTTY: false,
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
    prompt: () => null,
  };
}

describe("launcher CLI", () => {
  it("prints usage on --help", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main(["--help"], host("/tmp", {}), skeletonRoot)).toBe(0);
    expect(log.mock.calls[0]?.[0]).toBe(USAGE);
  });

  it("maps extra arguments to a thrown input error", () => {
    expect(() => main(["--org", "acme"], host("/tmp", {}), skeletonRoot)).toThrow(/no arguments except optional --inventory/);
  });

  it("prints usage from a non-empty non-git directory instead of refusing", () => {
    const directory = mkdtempSync(join(tmpdir(), "launcher-files-"));
    roots.push(directory);
    writeFileSync(join(directory, "notes.txt"), "keep\n");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main([], host(directory, {}), skeletonRoot)).toBe(0);
    expect(log.mock.calls[0]?.[0]).toBe(USAGE);
  });

  it("refuses (exit 1), rather than printing usage, when --repositories is given in a non-empty non-git directory (#1179)", () => {
    const directory = mkdtempSync(join(tmpdir(), "launcher-files-"));
    roots.push(directory);
    writeFileSync(join(directory, "notes.txt"), "keep\n");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(main(["--repositories", "example-owner/example-app"], host(directory, {}), skeletonRoot)).toBe(1);
    expect(String(error.mock.calls[0]?.[0])).toMatch(/not empty and is not a GitHub repository/);
    expect(log).not.toHaveBeenCalled();
  });

  it("refuses (exit 1) for --inventory too, in the same non-empty non-git directory (#1179)", () => {
    const directory = mkdtempSync(join(tmpdir(), "launcher-files-"));
    roots.push(directory);
    writeFileSync(join(directory, "notes.txt"), "keep\n");
    const inventoryPath = join(directory, "inventory.json");
    writeFileSync(inventoryPath, JSON.stringify({ schemaVersion: 1, repositories: [{ id: "example-owner/example-app" }] }));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(main(["--inventory", inventoryPath], host(directory, {}), skeletonRoot)).toBe(1);
    expect(String(error.mock.calls[0]?.[0])).toMatch(/not empty and is not a GitHub repository/);
    expect(log).not.toHaveBeenCalled();
  });

  it("creates a hub from an empty directory through the CLI", () => {
    const directory = mkdtempSync(join(tmpdir(), "launcher-cli-"));
    roots.push(directory);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = main(
      [],
      host(directory, {
        "gh --version": { status: 0, stdout: "gh\n", stderr: "" },
        "git --version": { status: 0, stdout: "git\n", stderr: "" },
        "gh api user --jq .login": { status: 0, stdout: "acme\n", stderr: "" },
        "gh org list": { status: 0, stdout: "", stderr: "" },
        "gh repo view acme/workspace --json name": { status: 1, stdout: "", stderr: "not found" },
        "npm view @clossys/advisor version": { status: 0, stdout: "0.1.5\n", stderr: "" },
        "npm view @clossys/integrator version": { status: 0, stdout: "0.8.2\n", stderr: "" },
        [`gh repo create acme/workspace --private --source ${directory} --remote origin --push`]: {
          status: 0,
          stdout: "created\n",
          stderr: "",
        },
      }),
      skeletonRoot,
    );
    expect(code).toBe(0);
    expect(String(log.mock.calls[0]?.[0])).toContain("created acme/workspace");
    expect(String(log.mock.calls[0]?.[0])).toContain("health:");
  });

  it("recognizes an installed-style POSIX bin symlink", () => {
    const directory = mkdtempSync(join(tmpdir(), "launcher-bin-"));
    roots.push(directory);
    const source = new URL("./cli.ts", import.meta.url);
    const bin = join(directory, "launcher");
    symlinkSync(fileURLToPath(source), bin);
    expect(isDirectInvocation(source.href, bin)).toBe(true);
  });

  it("tells a resume run that the hub is already appointed instead of 'only valid when appointing'", () => {
    const directory = mkdtempSync(join(tmpdir(), "launcher-resume-"));
    roots.push(directory);
    mkdirSync(dirname(join(directory, WORKSPACE_MARKER_REL)), { recursive: true });
    writeFileSync(
      join(directory, WORKSPACE_MARKER_REL),
      `${JSON.stringify({ schemaVersion: 1, kind: "account-hub", owner: "acme", repository: "acme/hub" }, null, 2)}\n`,
    );
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = main(["--inventory", "elsewhere.json"], host(directory, {}), skeletonRoot);
    expect(code).toBe(1);
    expect(String(err.mock.calls[0]?.[0])).toMatch(/already appointed; to change the repositories it covers, choose them again .* launcher --repositories/);
    expect(String(err.mock.calls[0]?.[0])).not.toMatch(/only valid when appointing/);
  });

  it("refuses --inventory whose entries carry unrecognized fields and writes nothing (issue #1334 repro)", () => {
    const directory = mkdtempSync(join(tmpdir(), "launcher-strict-inventory-"));
    roots.push(directory);
    mkdirSync(join(directory, ".git"), { recursive: true });
    const source = join(directory, "governance-record.json");
    // Shaped closely enough to look like an inventory -- a `repositories`
    // array with `id`, `role`, `visibility`, `status`, `notes` -- but not
    // actually a launcher inventory document (the exact #1334 repro).
    writeFileSync(
      source,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          repositories: [
            { id: "app", role: "product", visibility: "public", status: "active", notes: "primary surface" },
            { id: "site", role: "marketing", visibility: "public", status: "active", notes: "" },
            { id: "billing", role: "internal", visibility: "private", status: "active", notes: "" },
            { id: "docs", role: "docs", visibility: "public", status: "retired", notes: "" },
          ],
        },
        null,
        2,
      )}\n`,
    );
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = main(
      ["--inventory", "governance-record.json"],
      host(directory, {
        "git --version": { status: 0, stdout: "git\n", stderr: "" },
        "git remote get-url origin": { status: 0, stdout: "git@github.com:acme/central.git\n", stderr: "" },
        "npm view @clossys/advisor version": { status: 0, stdout: "0.1.5\n", stderr: "" },
        "npm view @clossys/integrator version": { status: 0, stdout: "0.8.2\n", stderr: "" },
      }),
      skeletonRoot,
    );
    expect(code).toBe(1);
    expect(String(err.mock.calls[0]?.[0])).toMatch(/repositories\[0\] has a field the contract does not declare \(key \d+ of this object\)/);
    // Refusal happens before any file is touched: no hub marker, no
    // inventory, no clossys/ folder, no package.json, nothing beyond the
    // two files this test itself seeded.
    expect(existsSync(join(directory, WORKSPACE_MARKER_REL))).toBe(false);
    expect(existsSync(join(directory, "clossys"))).toBe(false);
    expect(existsSync(join(directory, "package.json"))).toBe(false);
    expect(readdirSync(directory).sort()).toEqual([".git", "governance-record.json"]);
    expect(log).not.toHaveBeenCalled();
  });

  it("resumes and migrates a legacy .clossys/ hub marker automatically, reporting the migration", () => {
    const directory = mkdtempSync(join(tmpdir(), "launcher-legacy-resume-"));
    roots.push(directory);
    mkdirSync(join(directory, ".clossys"), { recursive: true });
    writeFileSync(
      join(directory, ".clossys", "workspace.json"),
      `${JSON.stringify({ schemaVersion: 1, kind: "account-hub", owner: "acme", repository: "acme/hub" }, null, 2)}\n`,
    );
    writeFileSync(
      join(directory, ".clossys", "inventory.json"),
      `${JSON.stringify({ schemaVersion: 1, repositories: [{ id: "acme/hub" }] }, null, 2)}\n`,
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = main([], host(directory, {}), skeletonRoot);
    expect(code).toBe(0);
    expect(existsSync(join(directory, ".clossys"))).toBe(false);
    expect(existsSync(join(directory, WORKSPACE_MARKER_REL))).toBe(true);
    expect(String(log.mock.calls[0]?.[0])).toContain("moved hub state from .clossys to clossys/.state");
  });

  it("--clone-missing is only valid on resume, refused elsewhere (before any write happens)", () => {
    const directory = mkdtempSync(join(tmpdir(), "launcher-clone-missing-create-"));
    roots.push(directory);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = main(
      ["--clone-missing"],
      host(directory, {
        "gh --version": { status: 0, stdout: "gh 2.0.0\n", stderr: "" },
        "git --version": { status: 0, stdout: "git 2.0.0\n", stderr: "" },
        "gh api user --jq .login": { status: 0, stdout: "acme\n", stderr: "" },
        "gh org list": { status: 0, stdout: "", stderr: "" },
        "gh repo view acme/workspace --json name": { status: 1, stdout: "", stderr: "not found" },
        "npm view @clossys/advisor version": { status: 0, stdout: "0.2.6\n", stderr: "" },
        "npm view @clossys/integrator version": { status: 0, stdout: "0.8.2\n", stderr: "" },
      }),
      skeletonRoot,
    );
    expect(code).toBe(1);
    expect(String(err.mock.calls[0]?.[0])).toMatch(/only valid on an already-appointed hub/);
  });

  it("--clone-missing on resume clones each inventoried id not yet sitting beside the hub, and reports it", () => {
    const directory = mkdtempSync(join(tmpdir(), "launcher-clone-missing-resume-"));
    roots.push(directory);
    mkdirSync(dirname(join(directory, WORKSPACE_MARKER_REL)), { recursive: true });
    writeFileSync(
      join(directory, WORKSPACE_MARKER_REL),
      `${JSON.stringify({ schemaVersion: 1, kind: "account-hub", owner: "acme", repository: "acme/hub" }, null, 2)}\n`,
    );
    const inventoryPath = join(dirname(join(directory, WORKSPACE_MARKER_REL)), "inventory.json");
    writeFileSync(inventoryPath, `${JSON.stringify({ schemaVersion: 1, repositories: [{ id: "app" }] }, null, 2)}\n`);
    const siblingPath = join(dirname(directory), "app");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = main(
      ["--clone-missing"],
      host(directory, {
        [`gh repo clone acme/app ${siblingPath}`]: { status: 0, stdout: "Cloning...\n", stderr: "" },
      }),
      skeletonRoot,
    );
    expect(code).toBe(0);
    const logged = log.mock.calls.map((call) => String(call[0])).join("\n");
    // "app" sits at stored-inventory position 0; the line names that position, never the id itself (#1179).
    expect(logged).toContain("clone-missing (repositories[0] in the stored inventory): cloned");
  });

  it("never prints a hostile inventory id in --clone-missing output, on a successful clone or a failed one", () => {
    // A repository id is document content (chosen on Advisor's repository-choice card,
    // or supplied via --inventory / --repositories): the printed line must name it by
    // stored-inventory position only, never repeat the id itself -- whether the clone
    // succeeds (the folder name it would otherwise report comes straight from the id)
    // or gh fails and names the repository in its own stderr (#1179).
    const hostileId = "acme/run.rm-rf-home-x";
    const hostileFragment = "run.rm-rf-home-x";

    const successDirectory = mkdtempSync(join(tmpdir(), "launcher-clone-missing-hostile-ok-"));
    roots.push(successDirectory);
    mkdirSync(dirname(join(successDirectory, WORKSPACE_MARKER_REL)), { recursive: true });
    writeFileSync(
      join(successDirectory, WORKSPACE_MARKER_REL),
      `${JSON.stringify({ schemaVersion: 1, kind: "account-hub", owner: "acme", repository: "acme/hub" }, null, 2)}\n`,
    );
    writeFileSync(
      join(dirname(join(successDirectory, WORKSPACE_MARKER_REL)), "inventory.json"),
      `${JSON.stringify({ schemaVersion: 1, repositories: [{ id: hostileId }] }, null, 2)}\n`,
    );
    const successSiblingPath = join(dirname(successDirectory), "run.rm-rf-home-x");
    const successLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const successCode = main(
      ["--clone-missing"],
      host(successDirectory, { [`gh repo clone ${hostileId} ${successSiblingPath}`]: { status: 0, stdout: "Cloning...\n", stderr: "" } }),
      skeletonRoot,
    );
    expect(successCode).toBe(0);
    const successLogged = successLog.mock.calls.map((call) => String(call[0])).join("\n");
    expect(successLogged).toContain("clone-missing (repositories[0] in the stored inventory): cloned -- cloned beside the hub");
    expect(successLogged).not.toContain(hostileFragment);
    successLog.mockRestore();

    const failureDirectory = mkdtempSync(join(tmpdir(), "launcher-clone-missing-hostile-fail-"));
    roots.push(failureDirectory);
    mkdirSync(dirname(join(failureDirectory, WORKSPACE_MARKER_REL)), { recursive: true });
    writeFileSync(
      join(failureDirectory, WORKSPACE_MARKER_REL),
      `${JSON.stringify({ schemaVersion: 1, kind: "account-hub", owner: "acme", repository: "acme/hub" }, null, 2)}\n`,
    );
    writeFileSync(
      join(dirname(join(failureDirectory, WORKSPACE_MARKER_REL)), "inventory.json"),
      `${JSON.stringify({ schemaVersion: 1, repositories: [{ id: hostileId }] }, null, 2)}\n`,
    );
    const failureSiblingPath = join(dirname(failureDirectory), "run.rm-rf-home-x");
    const failureLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const failureCode = main(
      ["--clone-missing"],
      host(failureDirectory, {
        [`gh repo clone ${hostileId} ${failureSiblingPath}`]: {
          status: 1,
          stdout: "",
          stderr: `gh: repository ${hostileId} not found (or you do not have access)\n`,
        },
      }),
      skeletonRoot,
    );
    expect(failureCode).toBe(0);
    const failureLogged = failureLog.mock.calls.map((call) => String(call[0])).join("\n");
    expect(failureLogged).toContain("clone-missing (repositories[0] in the stored inventory): failed -- gh repo clone exited 1");
    expect(failureLogged).not.toContain(hostileFragment);
    failureLog.mockRestore();
  });

  it("the real `launcher` resume command writes clossys/.state/hosts.json, not just a library function nothing calls (#1180)", () => {
    const directory = mkdtempSync(join(tmpdir(), "launcher-hosts-cli-"));
    roots.push(directory);
    mkdirSync(dirname(join(directory, WORKSPACE_MARKER_REL)), { recursive: true });
    writeFileSync(
      join(directory, WORKSPACE_MARKER_REL),
      `${JSON.stringify({ schemaVersion: 1, kind: "account-hub", owner: "acme", repository: "acme/hub" }, null, 2)}\n`,
    );
    writeFileSync(
      join(directory, "clossys", ".state", "inventory.json"),
      `${JSON.stringify({ schemaVersion: 1, repositories: [{ id: "acme/hub" }] }, null, 2)}\n`,
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = main([], host(directory, {}), skeletonRoot);
    expect(code).toBe(0);
    expect(String(log.mock.calls[0]?.[0])).toMatch(/linked hosts: none detected/);
    expect(existsSync(join(directory, "clossys", ".state", "hosts.json"))).toBe(true);
    const record = JSON.parse(readFileSync(join(directory, "clossys", ".state", "hosts.json"), "utf8"));
    expect(record).toMatchObject({ schemaVersion: 1, linkedHosts: [] });
  });

  it("the real `launcher` resume command surfaces inventory drift for a declared external inventory, not just a library function nothing calls (#1216)", () => {
    const directory = mkdtempSync(join(tmpdir(), "launcher-drift-cli-"));
    roots.push(directory);
    const externalPath = join(directory, "..", "external-inventory.json");
    mkdirSync(dirname(join(directory, WORKSPACE_MARKER_REL)), { recursive: true });
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
    writeFileSync(
      join(directory, "clossys", ".state", "inventory.json"),
      `${JSON.stringify({ schemaVersion: 1, repositories: [{ id: "legacy" }] }, null, 2)}\n`,
    );
    writeFileSync(externalPath, `${JSON.stringify({ schemaVersion: 1, repositories: [{ id: "app" }] })}\n`);
    roots.push(externalPath);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = main([], host(directory, {}), skeletonRoot);
    expect(code).toBe(0);
    expect(String(log.mock.calls[0]?.[0])).toMatch(/inventory drift: external-only 1, launcher-only 1, agreeing 0/);
  });
});
