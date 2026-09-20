import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isDirectInvocation, main, USAGE } from "./cli.js";
import type { CommandResult, WorkspaceHost } from "./types.js";

const skeletonRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "skeleton");
const WORKSPACE_MARKER_REL = ".clossys/workspace.json";
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
    mkdirSync(join(directory, ".clossys"), { recursive: true });
    writeFileSync(
      join(directory, WORKSPACE_MARKER_REL),
      `${JSON.stringify({ schemaVersion: 1, kind: "account-hub", owner: "acme", repository: "acme/hub" }, null, 2)}\n`,
    );
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = main(["--inventory", "elsewhere.json"], host(directory, {}), skeletonRoot);
    expect(code).toBe(1);
    expect(String(err.mock.calls[0]?.[0])).toMatch(/already appointed; edit \.clossys\/inventory\.json/);
    expect(String(err.mock.calls[0]?.[0])).not.toMatch(/only valid when appointing/);
  });
});
