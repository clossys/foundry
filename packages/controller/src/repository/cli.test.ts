import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "./cli.js";

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "repository-cli-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function writeProfile(name: string, value: unknown): string {
  const path = join(directory, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

function writeProfileUnder(root: string, relativePath: string, value: unknown): string {
  const path = join(root, ...relativePath.split("/"));
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
  return path;
}

function report(): { ok: boolean; findings: Array<{ rule: string; path: string; message: string }> } {
  const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls;
  return JSON.parse(calls[calls.length - 1]?.[0] as string) as {
    ok: boolean;
    findings: Array<{ rule: string; path: string; message: string }>;
  };
}

const validProfile = {
  schemaVersion: 1,
  defaultBranch: "main",
  commands: [{ name: "check", run: "npm run check" }],
  protectedPaths: [".github/workflows/**"],
};

describe("repository-check arguments", () => {
  it("prints help and returns 0 without requiring a path", () => {
    expect(main(["--help"])).toBe(0);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Usage: repository-check"));
  });

  // #392: main() must never let an exception escape — it is self-contained
  // and always returns 0 | 1 | 2 itself, the same contract inspector's and
  // builder's own CLI main functions already follow. Bad input used to
  // throw CliInputError PAST main(), caught only by a separate run()
  // wrapper; these assert the exit code main() now returns directly.
  it("accepts at most one path argument and rejects unknown options", () => {
    expect(main(["--help", "profile.json"])).toBe(2);
    expect(main(["--unknown"])).toBe(2);
    expect(main(["one.json", "two.json"])).toBe(2);
  });

  it("maps a missing explicit path to an input error", () => {
    expect(main([join(directory, "missing.json")])).toBe(2);
  });

  it("treats malformed JSON at an explicit file path as unable to run", () => {
    const path = join(directory, "malformed.json");
    writeFileSync(path, "{ not JSON");
    expect(main([path])).toBe(2);
  });

  it("treats malformed JSON at a located canonical path as unable to run", () => {
    const path = join(directory, "governance", "repository-profile.json");
    mkdirSync(join(directory, "governance"), { recursive: true });
    writeFileSync(path, "{ not JSON");
    expect(main([directory])).toBe(2);
  });
});

describe("repository-check with an explicit file argument", () => {
  it("validates exactly that file with no location search, and prints a clean report", () => {
    expect(main([writeProfile("valid.json", validProfile)])).toBe(0);
    expect(report()).toEqual({ ok: true, findings: [] });
  });

  it("still validates a file living outside governance/, since an explicit file bypasses discovery entirely", () => {
    const path = writeProfileUnder(directory, "config/foundry/repository-profile.json", validProfile);
    expect(main([path])).toBe(0);
    expect(report()).toEqual({ ok: true, findings: [] });
  });

  it("prints ordered validation findings and returns 1", () => {
    const profile = writeProfile("invalid.json", {
      schemaVersion: 4,
      defaultBranch: "bad branch",
      commands: {},
      protectedPaths: "src/**",
      requirements: [],
      rootEntries: [],
    });

    expect(main([profile])).toBe(1);
    expect(report().ok).toBe(false);
    expect(report().findings.map((finding) => finding.rule)).toEqual([
      "schema-version",
      "default-branch",
      "commands-shape",
      "protected-paths-shape",
    ]);
  });
});

describe("repository-check declaration discovery (issue #315)", () => {
  it("given a repository root, locates and validates the canonical path with no location finding", () => {
    writeProfileUnder(directory, "governance/repository-profile.json", validProfile);
    expect(main([directory])).toBe(0);
    expect(report()).toEqual({ ok: true, findings: [] });
  });

  it("reports no declaration as a distinct finding, not a thrown error, and returns 1", () => {
    expect(main([directory])).toBe(1);
    expect(report()).toEqual({
      ok: false,
      findings: [{
        rule: "declaration-not-found",
        severity: "error",
        path: "$",
        message: expect.stringContaining("governance/repository-profile.json"),
      }],
    });
  });

  it("reports a declaration at a non-canonical directory as a distinct finding, never as not-found", () => {
    writeProfileUnder(directory, "config/foundry/repository-profile.json", validProfile);
    expect(main([directory])).toBe(1);
    const found = report();
    expect(found.ok).toBe(false);
    expect(found.findings).toHaveLength(1);
    expect(found.findings[0]).toMatchObject({
      rule: "declaration-non-canonical-location",
      severity: "error",
    });
    expect(found.findings[0]?.message).toContain("config/foundry/repository-profile.json");
    expect(found.findings[0]?.message).toContain("governance/repository-profile.json");
  });

  it("reports a declaration under the canonical directory but a different filename as non-canonical too", () => {
    writeProfileUnder(directory, "governance/repository-declaration.json", validProfile);
    expect(main([directory])).toBe(1);
    expect(report().findings[0]?.rule).toBe("declaration-non-canonical-location");
  });

  it("combines the location finding with the declaration's own content findings", () => {
    writeProfileUnder(directory, "config/foundry/repository-profile.json", {
      schemaVersion: 4,
      defaultBranch: "main",
      commands: [],
      protectedPaths: [],
    });
    expect(main([directory])).toBe(1);
    expect(report().findings.map((finding) => finding.rule)).toEqual([
      "declaration-non-canonical-location",
      "schema-version",
      "requirements-shape",
      "root-entries-shape",
    ]);
  });

  it("never lets a non-canonical declaration shadow a canonical one", () => {
    writeProfileUnder(directory, "governance/repository-profile.json", validProfile);
    writeProfileUnder(directory, "config/foundry/repository-profile.json", validProfile);
    expect(main([directory])).toBe(0);
    expect(report()).toEqual({ ok: true, findings: [] });
  });

  it("defaults to the current working directory when no path argument is given", () => {
    const originalCwd = process.cwd();
    try {
      process.chdir(directory);
      expect(main([])).toBe(1);
      expect(report().findings[0]?.rule).toBe("declaration-not-found");

      writeProfileUnder(directory, "governance/repository-profile.json", validProfile);
      expect(main([])).toBe(0);
      expect(report()).toEqual({ ok: true, findings: [] });
    } finally {
      process.chdir(originalCwd);
    }
  });
});
