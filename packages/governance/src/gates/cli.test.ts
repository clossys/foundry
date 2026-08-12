import { execFile as execFileCb } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

// Real subprocess tests against the BUILT dist/cli.js, matching
// @vespeneventures/release's own subprocess-testing style (pack-round-trip.ts,
// preflight.test.ts): the whole point of this file is proving what a real
// `node dist/cli.js` invocation does — exit code and stdout/stderr — which a
// direct in-process call to main() could never prove, since it would bypass
// process.exitCode and process.argv entirely.

const execFile = promisify(execFileCb);
const cliPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "gates", "cli.js");

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCli(args: string[]): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFile("node", [cliPath, ...args]);
    return { code: 0, stdout, stderr };
  } catch (error) {
    const err = error as { code?: number; stdout?: string; stderr?: string };
    // A non-numeric `code` (e.g. a signal) would be a real failure of the
    // subprocess itself, not one of the CLI's own exit paths — surfacing it
    // as NaN keeps that visible rather than silently coercing to 0/1/2.
    return { code: typeof err.code === "number" ? err.code : Number.NaN, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

function validLeafManifest(name: string, extra: Record<string, unknown> = {}) {
  return {
    name,
    version: "1.0.0",
    private: false,
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
    dependencies: {},
    ...extra,
  };
}

const createdRoots: string[] = [];

afterEach(() => {
  while (createdRoots.length > 0) {
    const root = createdRoots.pop() as string;
    rmSync(root, { recursive: true, force: true });
  }
});

/** A fixture root with one well-formed, self-consistent package — zero findings expected. */
function makeCleanRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "gates-cli-fixture-clean-"));
  createdRoots.push(root);
  const pkgDir = join(root, "packages", "widgets");
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify(validLeafManifest("@gates-cli-fixture/widgets"), null, 2), "utf8");
  return root;
}

/** A fixture root with one package declaring a real dependency on a package that does not exist — a guaranteed error-severity "internal-dep-missing" finding. */
function makeErrorRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "gates-cli-fixture-error-"));
  createdRoots.push(root);
  const pkgDir = join(root, "packages", "widgets");
  mkdirSync(pkgDir, { recursive: true });
  const manifest = validLeafManifest("@gates-cli-fixture/widgets", {
    dependencies: { "@gates-cli-fixture/missing": "^1.0.0" },
  });
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify(manifest, null, 2), "utf8");
  return root;
}

describe("foundry-check CLI — exit codes", () => {
  it("exits 0 on a clean tree with no error-severity finding", async () => {
    const root = makeCleanRoot();

    const result = await runCli([root]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Checked 1 package.");
    expect(result.stdout).toContain("No findings.");
    expect(result.stdout).toMatch(/0 errors, 0 warnings across 0 findings\./);
  });

  it("exits 1 on a tree with an error-severity finding, and reports it grouped by package", async () => {
    const root = makeErrorRoot();

    const result = await runCli([root]);

    expect(result.code).toBe(1);
    expect(result.stdout).toContain("@gates-cli-fixture/widgets");
    expect(result.stdout).toContain("internal-dep-missing");
    expect(result.stdout).toMatch(/1 error, \d+ warnings? across \d+ findings?\./);
  });

  it("a tree with a skipped path (packages dir missing) does NOT fail the CLI — exits 0, warning only", async () => {
    const root = mkdtempSync(join(tmpdir(), "gates-cli-fixture-warn-"));
    createdRoots.push(root);
    // No "packages" directory at all — a warning-severity "skipped:packages-dir-missing" finding.

    const result = await runCli([root]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("packages-dir-missing");
    expect(result.stdout).toMatch(/0 errors, 1 warning across 1 finding\./);
  });

  it("exits 2 on an unknown flag, with a message on stderr", async () => {
    const root = makeCleanRoot();

    const result = await runCli(["--not-a-real-flag", root]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("unknown flag");
    expect(result.stdout).not.toContain("Checked");
  });

  it("exits 2 on a non-positive-integer --max-depth", async () => {
    const root = makeCleanRoot();

    for (const bad of ["0", "-1", "2.5", "abc"]) {
      const result = await runCli([root, "--max-depth", bad]);
      expect(result.code).toBe(2);
      expect(result.stderr).toContain("--max-depth must be a positive integer");
    }
  });

  it("exits 2 on a root that does not exist", async () => {
    const result = await runCli([join(tmpdir(), "definitely-does-not-exist-gates-cli-fixture")]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("does not exist");
  });

  it("exits 2 when root is a file, not a directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "gates-cli-fixture-file-"));
    createdRoots.push(root);
    const filePath = join(root, "not-a-dir.txt");
    writeFileSync(filePath, "hello", "utf8");

    const result = await runCli([filePath]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("is not a directory");
  });

  it("--help exits 0 and prints usage without running a check", async () => {
    const result = await runCli(["--help"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: foundry-check");
    expect(result.stdout).not.toContain("Checked");
  });

  it("honours --packages-dir: finds packages only in the named directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "gates-cli-fixture-packagesdir-"));
    createdRoots.push(root);
    const pkgDir = join(root, "modules", "widgets");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify(validLeafManifest("@gates-cli-fixture/widgets"), null, 2), "utf8");

    const withoutFlag = await runCli([root]);
    expect(withoutFlag.code).toBe(0);
    expect(withoutFlag.stdout).toContain("Checked 0 packages.");

    const withFlag = await runCli([root, "--packages-dir", "modules"]);
    expect(withFlag.code).toBe(0);
    expect(withFlag.stdout).toContain("Checked 1 package.");
  });

  it("defaults root to the current working directory when omitted", async () => {
    const root = makeCleanRoot();

    const result = await execFile("node", [cliPath], { cwd: root });

    expect(result.stdout).toContain("Checked 1 package.");
  });
});

describe("foundry-check CLI — coverage reporting (Part A)", () => {
  it("a real chmod-000 package directory drives exit 1, with the skip visible in the output", async () => {
    // Real reproduction, not a mock: a clean package next to one whose
    // directory cannot be read at all (chmod 000). The skipped-directory
    // finding is error-severity (unreadable), so this must exit 1 through
    // the existing severity-based exit-code path — and the coverage banner
    // this test also asserts on must make the incomplete scan impossible to
    // miss, not just technically present in a findings list.
    const root = mkdtempSync(join(tmpdir(), "gates-cli-fixture-chmod-"));
    createdRoots.push(root);
    const cleanDir = join(root, "packages", "clean");
    mkdirSync(cleanDir, { recursive: true });
    writeFileSync(join(cleanDir, "package.json"), JSON.stringify(validLeafManifest("@gates-cli-fixture/clean"), null, 2), "utf8");
    const lockedDir = join(root, "packages", "locked");
    mkdirSync(lockedDir, { recursive: true });
    chmodSync(lockedDir, 0o000);

    try {
      const result = await runCli([root]);

      expect(result.code).toBe(1);
      expect(result.stdout).toContain("Checked 1 package. 1 path skipped.");
      expect(result.stdout).toContain("COVERAGE INCOMPLETE");
      expect(result.stdout).toContain("skipped:unreadable-directory");
      expect(result.stdout).toMatch(/packages\/locked/);
    } finally {
      // Restore permissions so afterEach's recursive rmSync can clean up.
      chmodSync(lockedDir, 0o755);
    }
  });

  it("a clean tree with nothing skipped shows zero skipped and no coverage banner", async () => {
    const root = makeCleanRoot();

    const result = await runCli([root]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Checked 1 package. 0 paths skipped.");
    expect(result.stdout).not.toContain("COVERAGE INCOMPLETE");
  });

  it("states the resolved root and packages directory it actually scanned", async () => {
    const root = makeCleanRoot();

    const result = await runCli([root]);

    expect(result.stdout).toContain(`Scanning root: ${root}`);
    expect(result.stdout).toContain(`Packages directory: ${join(root, "packages")}`);
  });
});

describe("foundry-check CLI — --packages-dir must be relative to root (B2)", () => {
  it("rejects an absolute --packages-dir with exit 2, rather than silently scanning a different tree", async () => {
    // The exact reproduction: --packages-dir pointing at an absolute path in
    // a completely different tree. Before this fix, `path.resolve(root,
    // packagesDir)` discarded `root` entirely and the CLI scanned and
    // reported on `otherRoot` instead, with `root` ignored and nothing in
    // the output revealing it.
    const root = makeCleanRoot();
    const otherRoot = mkdtempSync(join(tmpdir(), "gates-cli-fixture-other-"));
    createdRoots.push(otherRoot);
    const otherPkgDir = join(otherRoot, "packages", "widgets");
    mkdirSync(otherPkgDir, { recursive: true });
    writeFileSync(
      join(otherPkgDir, "package.json"),
      JSON.stringify(validLeafManifest("@gates-cli-fixture/other-tree-widgets"), null, 2),
      "utf8",
    );

    const result = await runCli([root, "--packages-dir", join(otherRoot, "packages")]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("--packages-dir must be relative to root");
    expect(result.stdout).not.toContain("other-tree-widgets");
    expect(result.stdout).not.toContain("Checked");
  });

  it("still accepts a relative --packages-dir normally", async () => {
    const root = mkdtempSync(join(tmpdir(), "gates-cli-fixture-relpkgdir-"));
    createdRoots.push(root);
    const pkgDir = join(root, "modules", "widgets");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify(validLeafManifest("@gates-cli-fixture/widgets"), null, 2), "utf8");

    const result = await runCli([root, "--packages-dir", "modules"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Checked 1 package.");
  });
});

describe("foundry-check CLI — --max-depth overflow (B4)", () => {
  it("rejects a numeral that overflows Number() to Infinity, rather than silently falling back to the default depth", async () => {
    const root = makeCleanRoot();
    // 310 digits — comfortably past Number.MAX_VALUE's ~309-digit range, so
    // Number(value) is Infinity: it still matches /^\d+$/ and is > 0, so the
    // pre-fix check (`!/^\d+$/.test(value) || Number(value) <= 0`) let it
    // through, silently reverting to the default depth (4) downstream in
    // buildCatalog with no signal at all.
    const overflowing = "9".repeat(310);

    const result = await runCli([root, "--max-depth", overflowing]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("--max-depth must be a positive integer");
  });

  it("still accepts an ordinary positive integer --max-depth", async () => {
    const root = makeCleanRoot();

    const result = await runCli([root, "--max-depth", "4"]);

    expect(result.code).toBe(0);
  });
});

// Regression: the CLI is SHIPPED as a `bin`, and npm installs a bin as a
// SYMLINK at node_modules/.bin/foundry-check pointing at dist/cli.js. Every
// test above invokes `node <real path to dist/cli.js>` directly, so none of
// them ever exercised the only invocation path a real consumer uses.
//
// The `isMainModule` guard compared `resolve(process.argv[1])` against
// `fileURLToPath(import.meta.url)`. `import.meta.url` is always a realpath;
// `resolve` only normalises and does NOT follow symlinks. So when invoked
// through the bin symlink the two disagreed, the guard was false, `run()`
// never fired — and the process printed NOTHING and exited 0. A consumer's
// CI would have gone green having validated precisely nothing, which is the
// single worst failure mode a gate can have.
describe("invocation through a bin symlink (how npm actually installs it)", () => {
  /** Creates a symlink to dist/cli.js, mirroring node_modules/.bin/foundry-check. */
  function makeBinSymlink(): string {
    const binDir = mkdtempSync(join(tmpdir(), "gates-cli-bin-"));
    createdRoots.push(binDir);
    const linkPath = join(binDir, "foundry-check");
    symlinkSync(cliPath, linkPath);
    return linkPath;
  }

  async function runVia(linkPath: string, args: string[]): Promise<CliResult> {
    try {
      const { stdout, stderr } = await execFile("node", [linkPath, ...args]);
      return { code: 0, stdout, stderr };
    } catch (error) {
      const err = error as { code?: number; stdout?: string; stderr?: string };
      return { code: typeof err.code === "number" ? err.code : Number.NaN, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
    }
  }

  it("actually runs and reports, rather than silently exiting 0", async () => {
    const root = makeCleanRoot();
    const link = makeBinSymlink();

    const result = await runVia(link, [root]);

    // The bug produced empty stdout with code 0. Assert on real output, not
    // just the exit code — the exit code alone could not tell the two apart.
    expect(result.stdout).toContain("Scanning root:");
    expect(result.stdout).toContain("Checked 1 package.");
    expect(result.code).toBe(0);
  });

  it("still reports errors (exit 1) when invoked through the symlink", async () => {
    const root = makeErrorRoot();
    const link = makeBinSymlink();

    const result = await runVia(link, [root]);

    expect(result.stdout).toContain("internal-dep-missing");
    expect(result.code).toBe(1);
  });

  it("still rejects bad input (exit 2) when invoked through the symlink", async () => {
    const link = makeBinSymlink();

    const result = await runVia(link, ["--not-a-real-flag"]);

    expect(result.stderr).toContain('unknown flag "--not-a-real-flag"');
    expect(result.code).toBe(2);
  });
});
