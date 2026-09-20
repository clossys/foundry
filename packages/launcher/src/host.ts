import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, readSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CommandResult, WorkspaceHost } from "./types.js";

function run(command: string, args: readonly string[], options?: { cwd?: string }): CommandResult {
  const result = spawnSync(command, [...args], {
    cwd: options?.cwd,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 2_000_000,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function prompt(message: string, choices: readonly string[]): string | null {
  if (!process.stdin.isTTY || !process.stdout.isTTY || choices.length === 0) return null;
  process.stdout.write(`${message}\n`);
  for (const [index, choice] of choices.entries()) process.stdout.write(`  ${index + 1}. ${choice}\n`);
  process.stdout.write("Enter a number: ");
  const buffer = Buffer.alloc(256);
  let bytes = 0;
  try {
    bytes = readSync(0, buffer, 0, buffer.length, null);
  } catch {
    return null;
  }
  const answer = buffer.toString("utf8", 0, bytes).trim();
  const index = Number.parseInt(answer, 10);
  if (!Number.isInteger(index) || index < 1 || index > choices.length) return null;
  return choices[index - 1] ?? null;
}

/** Node-backed host used by the installed CLI. */
export function createNodeHost(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): WorkspaceHost {
  return {
    cwd,
    env,
    isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    now: () => new Date().toISOString(),
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
      writeFileSync(path, contents, "utf8");
    },
    mkdirp: (path) => {
      mkdirSync(path, { recursive: true });
    },
    symlink: (relativeTarget, linkPath) => {
      mkdirSync(dirname(linkPath), { recursive: true });
      if (existsSync(linkPath)) rmSync(linkPath, { recursive: true, force: true });
      symlinkSync(relativeTarget, linkPath, "dir");
    },
    readDir: (path) => readdirSync(path),
    run,
    prompt,
  };
}
