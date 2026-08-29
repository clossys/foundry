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

describe("installed controller package", () => {
  it("keep imports hostile-clean and execute through npm-created bin symlinks", { timeout: 60_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "repository-installed-bin-"));
    createdRoots.push(root);
    const tarballs = join(root, "tarballs");
    mkdirSync(tarballs);

    // `governance` and `repository` were separate compatibility packages
    // before issue #282's recut folded governance's source (including the
    // `repository` subpath) directly into `@clossys/controller` and
    // deleted both standalone packages with zero consumers left behind.
    // `repository-check` (declared in controller's own package.json `bin`
    // map — verified as-is, not invented) is controller's own bin now, so
    // there is exactly one tarball, and one consumer, to install.
    const controllerTarball = await pack("controller", tarballs);

    const consumer = join(root, "controller-consumer");
    await installTarballs(consumer, [controllerTarball]);
    await execFile("node", ["--input-type=module", "--eval", hostileImport,
      "@clossys/controller/repository",
      "./node_modules/@clossys/controller/dist/repository/cli.js",
      "./node_modules/@clossys/controller/dist/repository/run-cli.js",
      "./node_modules/@clossys/controller/dist/repository/adoption-cli.js",
      "./node_modules/@clossys/controller/dist/release/singular-authority-cli.js",
    ], { cwd: consumer });
    const bin = join(consumer, "node_modules", ".bin", "repository-check");
    expect(lstatSync(bin).isSymbolicLink()).toBe(true);
    expect(basename(readlinkSync(bin))).toBe("bin.js");
    const help = await execFile(bin, ["--help"], { cwd: consumer });
    expect(help.stdout).toContain("Usage: repository-check");

    // The full runner (issue #321) installs as its own bin, alongside the
    // declaration-only checker above — one tarball, two commands, each
    // reachable through its own symlink.
    const runBin = join(consumer, "node_modules", ".bin", "repository-profile-check");
    expect(lstatSync(runBin).isSymbolicLink()).toBe(true);
    expect(basename(readlinkSync(runBin))).toBe("run-bin.js");
    const runHelp = await execFile(runBin, ["--help"], { cwd: consumer });
    expect(runHelp.stdout).toContain("Usage: repository-profile-check");

    const adoptionBin = join(consumer, "node_modules", ".bin", "repository-package-adoption-check");
    expect(lstatSync(adoptionBin).isSymbolicLink()).toBe(true);
    expect(basename(readlinkSync(adoptionBin))).toBe("adoption-bin.js");
    const adoptionHelp = await execFile(adoptionBin, ["--help"], { cwd: consumer });
    expect(adoptionHelp.stdout).toContain("Usage: repository-package-adoption-check");

    const singularAuthorityBin = join(consumer, "node_modules", ".bin", "singular-authority-check");
    expect(lstatSync(singularAuthorityBin).isSymbolicLink()).toBe(true);
    expect(basename(readlinkSync(singularAuthorityBin))).toBe("singular-authority-bin.js");
    const singularAuthorityHelp = await execFile(singularAuthorityBin, ["--help"], { cwd: consumer });
    expect(singularAuthorityHelp.stdout).toContain("Usage: singular-authority-check");
  });
});
