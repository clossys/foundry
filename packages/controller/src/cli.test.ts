import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeDigest } from "./policy/index.js";
import { CliInputError, main, mainAsync } from "./cli.js";

let root: string;
let lifecycleFile: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "governance-cli-"));
  mkdirSync(join(root, "packages", "core"), { recursive: true });
  writeFileSync(join(root, "packages", "core", "package.json"), JSON.stringify({ name: "@example/core", version: "0.1.0" }));
  lifecycleFile = join(root, "lifecycle.json");
  writeFileSync(lifecycleFile, JSON.stringify({ schemaVersion: 1, packages: [{ name: "@example/core", status: "active" }] }));
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("foundry-governance", () => {
  it("prints a compact clean text report by default", () => {
    expect(main([lifecycleFile, root, "--scope", "@example"])).toBe(0);
    expect((console.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain("Package governance: PASS");
    expect((console.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).not.toContain('"catalog"');
  });

  it("supports compact JSON and verbose full reports", () => {
    expect(main([lifecycleFile, root, "--scope", "@example", "--format", "json"])).toBe(0);
    const compact = JSON.parse((console.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string);
    expect(compact).toMatchObject({ ok: true, packages: 1, lifecycleEntries: 1, buildOrder: "valid" });
    expect(compact).toMatchObject({ lifecycleMaturity: { active: 1 } });
    expect(compact.foundation).toBeUndefined();

    expect(main([lifecycleFile, root, "--scope", "@example", "--format", "json", "--verbose"])).toBe(0);
    const verbose = JSON.parse((console.log as ReturnType<typeof vi.fn>).mock.calls[1]?.[0] as string);
    expect(verbose.foundation.catalog.entries).toHaveLength(1);
  });

  it("distinguishes invalid invocation from governance findings", () => {
    expect(() => main([])).toThrow(CliInputError);
    expect(() => main([lifecycleFile, root, "--unknown"])).toThrow(CliInputError);
    expect(() => main([lifecycleFile, join(root, "missing")])).toThrow(CliInputError);
    writeFileSync(join(root, "not-a-directory"), "");
    expect(() => main([lifecycleFile, join(root, "not-a-directory")])).toThrow(CliInputError);
    expect(() => main([lifecycleFile, root, "--format", "yaml"])).toThrow(CliInputError);
    writeFileSync(lifecycleFile, "{");
    expect(() => main([lifecycleFile, root])).toThrow(CliInputError);
  });
});

// ---------------------------------------------------------------------------
// #377: `preflight` and `verify-published` give `preflightGovernedPackage`
// (which itself calls `preflightPackage` and `packRoundTrip`) and
// `verifyPublishedArtifact` a real CLI entry point, on the SAME bin rather
// than a new one. Dispatched via `mainAsync`, not `main` (see cli.ts's own
// header for why) — every case below goes through `mainAsync`, including the
// ones that still fall through to the unchanged, synchronous `main`.

/** A real, on-disk, minimal package `preflight`'s round trip can genuinely pack, install, and import. */
function makePackageFixture(dir: string, name: string): string {
  const packageDir = join(dir, "fixture-package");
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(
    join(packageDir, "package.json"),
    JSON.stringify({ name, version: "1.0.0", type: "module", exports: "./index.js" }, null, 2),
  );
  writeFileSync(join(packageDir, "index.js"), "export const ok = true;\n");
  return packageDir;
}

describe("foundry-governance preflight (#377)", () => {
  it("prints help and returns 0", async () => {
    expect(await mainAsync(["preflight", "--help"])).toBe(0);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Usage: foundry-governance preflight"));
  });

  it(
    "runs preflightGovernedPackage for real (packs, installs into an isolated dir, imports) and returns 0 for a clean package",
    { timeout: 60_000 },
    async () => {
      const packageDir = makePackageFixture(root, "preflight-fixture-clean");
      expect(await mainAsync(["preflight", lifecycleFile, packageDir, root, "--scope", "@example"])).toBe(0);
      const printed = (console.log as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as string;
      const report = JSON.parse(printed) as { ok: boolean; preflight: { ok: boolean }; governance: { ok: boolean } };
      expect(report.ok).toBe(true);
      expect(report.preflight.ok).toBe(true);
      expect(report.governance.ok).toBe(true);
    },
  );

  it(
    "returns 1, not 0, when the round trip itself fails (a package with empty exports checks nothing and must not read as clean)",
    { timeout: 60_000 },
    async () => {
      const packageDir = join(root, "fixture-empty-exports");
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(
        join(packageDir, "package.json"),
        JSON.stringify({ name: "preflight-fixture-empty", version: "1.0.0", type: "module", exports: {} }, null, 2),
      );
      expect(await mainAsync(["preflight", lifecycleFile, packageDir, root])).toBe(1);
      const printed = (console.log as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as string;
      const report = JSON.parse(printed) as { ok: boolean };
      expect(report.ok).toBe(false);
    },
  );

  it("rejects (never resolves to a number) on bad arguments — mainAsync never silently maps invalid input to an exit code", async () => {
    await expect(mainAsync(["preflight"])).rejects.toThrow(CliInputError);
    await expect(mainAsync(["preflight", lifecycleFile])).rejects.toThrow(CliInputError);
    await expect(mainAsync(["preflight", lifecycleFile, join(root, "does-not-exist")])).rejects.toThrow(CliInputError);
    writeFileSync(lifecycleFile, "{");
    await expect(mainAsync(["preflight", lifecycleFile, root])).rejects.toThrow(CliInputError);
  });
});

describe("foundry-governance verify-published (#377)", () => {
  it("prints help and returns 0", async () => {
    expect(await mainAsync(["verify-published", "--help"])).toBe(0);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Usage: foundry-governance verify-published"));
  });

  it("returns 0 when the content-file's digest matches expected-digest", async () => {
    const contentPath = join(root, "artifact.tgz");
    writeFileSync(contentPath, "published tarball bytes");
    const digest = computeDigest(readFileSync(contentPath));
    expect(await mainAsync(["verify-published", digest, contentPath])).toBe(0);
    const printed = (console.log as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as string;
    expect(JSON.parse(printed)).toEqual({ ok: true, findings: [] });
  });

  it("returns 1 on a digest mismatch, not a thrown error", async () => {
    const contentPath = join(root, "artifact.tgz");
    writeFileSync(contentPath, "published tarball bytes");
    expect(await mainAsync(["verify-published", "0".repeat(64), contentPath])).toBe(1);
    const printed = (console.log as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as string;
    const report = JSON.parse(printed) as { ok: boolean; findings: Array<{ rule: string }> };
    expect(report.ok).toBe(false);
    expect(report.findings.map((finding) => finding.rule)).toContain("digest-mismatch");
  });

  it("rejects on bad arguments — a missing content-file never silently reads as a mismatch", async () => {
    await expect(mainAsync(["verify-published"])).rejects.toThrow(CliInputError);
    await expect(mainAsync(["verify-published", "abc"])).rejects.toThrow(CliInputError);
    await expect(mainAsync(["verify-published", "abc", join(root, "does-not-exist.tgz")])).rejects.toThrow(CliInputError);
  });
});

// ---------------------------------------------------------------------------
// REGRESSION (a defect of exactly this kind shipped once already, per
// issue #377): dispatch must key off the literal `argv[0]`, never off the
// invoked binary's path or filename (`basename(process.argv[1])`). This
// repository always invokes a gate by its compiled path (e.g. `node
// packages/controller/dist/cli.js`), so a basename-keyed dispatch would
// always see `cli.js` and silently run the wrong command — every test above
// calls `mainAsync`/`main` in-process and would never catch that, since it
// never exercises `process.argv[1]` at all. This is the one describe block
// that spawns the REAL compiled `dist/cli.js` as a real subprocess and
// asserts its real exit code — including that the pre-existing no-subcommand
// path is unchanged.
describe("dist/cli.js — direct-path subprocess reachability (#377)", () => {
  const cliPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

  function runRealCli(args: string[]): { status: number; stdout: string; stderr: string } {
    try {
      const stdout = execFileSync("node", [cliPath, ...args], { encoding: "utf8" });
      return { status: 0, stdout, stderr: "" };
    } catch (error) {
      const err = error as { status?: number | null; stdout?: string; stderr?: string };
      return { status: typeof err.status === "number" ? err.status : Number.NaN, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
    }
  }

  it(
    "`node dist/cli.js preflight <lifecycle-file> <package-dir> <root>` reaches preflightGovernedPackage -> preflightPackage -> packRoundTrip and exits 0 for a clean package",
    { timeout: 60_000 },
    () => {
      const packageDir = makePackageFixture(root, "subprocess-preflight-fixture");
      const result = runRealCli(["preflight", lifecycleFile, packageDir, root, "--scope", "@example"]);
      expect(result.status).toBe(0);
      const report = JSON.parse(result.stdout) as { ok: boolean };
      expect(report.ok).toBe(true);
    },
  );

  it("`node dist/cli.js verify-published <digest> <content-file>` reaches verifyPublishedArtifact and exits 0 on a match, 1 on a mismatch", () => {
    const contentPath = join(root, "subprocess-artifact.tgz");
    writeFileSync(contentPath, "published tarball bytes");
    const digest = computeDigest(readFileSync(contentPath));

    const match = runRealCli(["verify-published", digest, contentPath]);
    expect(match.status).toBe(0);

    const mismatch = runRealCli(["verify-published", "0".repeat(64), contentPath]);
    expect(mismatch.status).toBe(1);
  });

  it("`node dist/cli.js <lifecycle-file> <root>` with NO subcommand still runs the pre-existing governance check, unchanged", () => {
    const result = runRealCli([lifecycleFile, root, "--scope", "@example"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Package governance: PASS");
  });
});
