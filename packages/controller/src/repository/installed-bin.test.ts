import { execFile as execFileCallback } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const createdRoots: string[] = [];

async function pack(packageName: string, destination: string): Promise<string> {
  const { stdout } = await execFile("npm", ["pack", "--silent", "--pack-destination", destination], {
    cwd: join(repoRoot, "packages", packageName),
  });
  return join(destination, stdout.trim().split("\n").at(-1) as string);
}

async function installTarballs(consumer: string, tarballs: readonly string[]): Promise<void> {
  mkdirSync(consumer, { recursive: true });
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  await execFile("npm", [
    "install",
    "--offline",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    ...tarballs,
  ], { cwd: consumer });
}

const hostileImport = String.raw`
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

let ioCalls = 0;
for (const name of ["existsSync", "readFileSync", "realpathSync", "statSync", "writeFileSync"]) {
  fs[name] = () => { ioCalls += 1; throw new Error("unexpected " + name + " during import"); };
}
syncBuiltinESMExports();

let outputCalls = 0;
console.log = console.error = () => { outputCalls += 1; };
process.stdout.write = process.stderr.write = () => { outputCalls += 1; return true; };

const argv = [...process.argv];
const env = { ...process.env };
const exitCode = process.exitCode;
for (const target of process.argv.slice(1)) {
  await import(target.startsWith(".") ? pathToFileURL(resolve(target)).href : target);
}

assert.equal(ioCalls, 0);
assert.equal(outputCalls, 0);
assert.deepEqual(process.argv, argv);
assert.deepEqual({ ...process.env }, env);
assert.equal(process.exitCode, exitCode);
`;

afterEach(() => {
  while (createdRoots.length > 0) rmSync(createdRoots.pop() as string, { recursive: true, force: true });
});

describe("installed repository-check packages", () => {
  it("keep imports hostile-clean and execute through npm-created bin symlinks", { timeout: 60_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "repository-installed-bin-"));
    createdRoots.push(root);
    const tarballs = join(root, "tarballs");
    mkdirSync(tarballs);

    // `governance` no longer depends on `policy` directly (issue #282 moved
    // policy's source inside `@vespeneventures/controller`, and governance
    // is now a thin stub forwarding to controller), so the consumer
    // installs need controller's tarball in place of policy's.
    const controllerTarball = await pack("controller", tarballs);
    const governanceTarball = await pack("governance", tarballs);
    const repositoryTarball = await pack("repository", tarballs);

    const governanceConsumer = join(root, "governance-consumer");
    await installTarballs(governanceConsumer, [controllerTarball, governanceTarball]);
    await execFile("node", ["--input-type=module", "--eval", hostileImport,
      "@vespeneventures/governance/repository",
      "./node_modules/@vespeneventures/governance/dist/repository/cli.js",
    ], { cwd: governanceConsumer });
    const governanceBin = join(governanceConsumer, "node_modules", ".bin", "repository-check");
    expect(lstatSync(governanceBin).isSymbolicLink()).toBe(true);
    expect(basename(readlinkSync(governanceBin))).toBe("bin.js");
    const governanceHelp = await execFile(governanceBin, ["--help"], { cwd: governanceConsumer });
    expect(governanceHelp.stdout).toContain("Usage: repository-check");

    const facadeConsumer = join(root, "facade-consumer");
    await installTarballs(facadeConsumer, [controllerTarball, governanceTarball, repositoryTarball]);
    await execFile("node", ["--input-type=module", "--eval", hostileImport,
      "@vespeneventures/repository",
      "./node_modules/@vespeneventures/repository/dist/cli.js",
    ], { cwd: facadeConsumer });
    const facadeBin = join(facadeConsumer, "node_modules", ".bin", "repository-check");
    expect(lstatSync(facadeBin).isSymbolicLink()).toBe(true);
    expect(basename(readlinkSync(facadeBin))).toBe("bin.js");
    const facadeHelp = await execFile(facadeBin, ["--help"], { cwd: facadeConsumer });
    expect(facadeHelp.stdout).toContain("Usage: repository-check");
  });
});
