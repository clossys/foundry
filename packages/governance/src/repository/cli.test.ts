import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliInputError, main } from "./cli.js";

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

const validProfile = {
  schemaVersion: 1,
  defaultBranch: "main",
  commands: [{ name: "check", run: "npm run check" }],
  protectedPaths: [".github/workflows/**"],
};

describe("repository-check arguments", () => {
  it("prints help and returns 0 without requiring a profile", () => {
    expect(main(["--help"])).toBe(0);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Usage: repository-check"));
  });

  it("requires exactly one profile file and rejects unknown options", () => {
    expect(() => main([])).toThrow(CliInputError);
    expect(() => main(["--help", "profile.json"])).toThrow(CliInputError);
    expect(() => main(["--unknown"])).toThrow(CliInputError);
    expect(() => main(["one.json", "two.json"])).toThrow(CliInputError);
  });

  it("maps missing and non-file paths to input errors", () => {
    expect(() => main([join(directory, "missing.json")])).toThrow(CliInputError);
    expect(() => main([directory])).toThrow(CliInputError);
  });
});

describe("repository-check reports", () => {
  it("prints a deterministic clean JSON report and returns 0", () => {
    expect(main([writeProfile("valid.json", validProfile)])).toBe(0);
    expect(console.log).toHaveBeenCalledWith(JSON.stringify({ ok: true, findings: [] }, null, 2));
  });

  it("prints ordered validation findings and returns 1", () => {
    const profile = writeProfile("invalid.json", {
      schemaVersion: 3,
      defaultBranch: "bad branch",
      commands: {},
      protectedPaths: "src/**",
      requirements: [],
    });

    expect(main([profile])).toBe(1);
    const report = JSON.parse((console.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string) as {
      ok: boolean;
      findings: Array<{ rule: string }>;
    };
    expect(report.ok).toBe(false);
    expect(report.findings.map((finding) => finding.rule)).toEqual([
      "schema-version",
      "default-branch",
      "commands-shape",
      "protected-paths-shape",
    ]);
  });

  it("treats malformed JSON as unable to run", () => {
    const path = join(directory, "malformed.json");
    writeFileSync(path, "{ not JSON");
    expect(() => main([path])).toThrow(CliInputError);
  });
});
