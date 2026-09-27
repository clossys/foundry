#!/usr/bin/env node
/**
 * The installed `builder` executable. `./cli.ts` holds the logic.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyFrozenInstallOutput } from "./install.js";
import type { FrozenInstallRequest, FrozenInstallStatus, UserConfigHandle } from "./install.js";
import { main } from "./cli.js";
import type { HostingCliPort } from "./cli.js";

function environmentValue(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function writeUserConfig(body: string): UserConfigHandle {
  const directory = mkdtempSync(join(tmpdir(), "builder-hosting-"));
  const path = join(directory, "npmrc");
  writeFileSync(path, body, { encoding: "utf8", mode: 0o600 });
  return {
    path,
    restore() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function runFrozenInstall(request: FrozenInstallRequest): FrozenInstallStatus {
  const result = spawnSync("npm", [...request.args], {
    cwd: request.cwd,
    env: request.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return classifyFrozenInstallOutput(result.status, result.stderr ?? "");
}

function listChangedPaths(): readonly string[] {
  const previous = environmentValue("VERCEL_GIT_PREVIOUS_SHA");
  if (previous === undefined) return [];
  if (!/^[0-9a-f]{7,64}$/i.test(previous)) throw new Error("previous revision is not a git sha");
  const result = spawnSync("git", ["diff", "--name-only", previous, "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) throw new Error("could not list changed paths");
  return (result.stdout ?? "").split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
}

const port: HostingCliPort = {
  repositoryRoot: process.cwd(),
  routeFileText: "",
  readTextFile: (path) => readFileSync(path, "utf8"),
  hasEnvironmentName: (name) => environmentValue(name) !== undefined,
  readCredential: (name) => environmentValue(name) ?? "",
  parentEnvironment: process.env,
  presentEnvironmentNames: Object.keys(process.env).filter((name) => environmentValue(name) !== undefined),
  writeUserConfig,
  runFrozenInstall,
  writeOut: (text) => process.stdout.write(text),
  writeErr: (text) => process.stderr.write(text),
  listChangedPaths,
  hasPreviousRevision: () => environmentValue("VERCEL_GIT_PREVIOUS_SHA") !== undefined,
};

process.exitCode = main(process.argv.slice(2), port);
