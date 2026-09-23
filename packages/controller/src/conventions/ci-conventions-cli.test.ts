import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "./ci-conventions-cli.js";

// In-process tests against the exported `main`, not a subprocess against
// the built dist/ -- ci-conventions-cli.ts is presentation only (argv in,
// exit code out) over the already-tested evaluateCiConventions, so what
// this file needs to prove is argument handling, file I/O, and stdout/exit
// mapping, all of which `main` exercises directly without a build step.

const createdRoots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "ci-conventions-cli-"));
  createdRoots.push(root);
  return root;
}

function writeWorkflow(root: string, name: string, content: string): void {
  const dir = join(root, ".github", "workflows");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), content, "utf8");
}

const CONFORMING = [
  "on:",
  "  pull_request:",
  "  merge_group:",
  "permissions:",
  "  contents: read",
  "jobs:",
  "  build:",
  "    runs-on: ubuntu-latest",
  "    timeout-minutes: 5",
].join("\n");

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  while (createdRoots.length > 0) rmSync(createdRoots.pop() as string, { recursive: true, force: true });
});

describe("ci-conventions-check CLI", () => {
  it("prints --help and exits 0 without requiring --ruleset/--declaration", async () => {
    const code = await main(["--help"]);
    expect(code).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Usage: ci-conventions-check"));
  });

  it("exits 2 with a message when --ruleset is missing", async () => {
    const code = await main(["--declaration", "/nonexistent.json"]);
    expect(code).toBe(2);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("--ruleset is required"));
  });

  it("exits 2 on an unknown flag", async () => {
    const code = await main(["--nope"]);
    expect(code).toBe(2);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown option"));
  });

  it("exits 2 on an invalid --mode value", async () => {
    const code = await main(["--mode", "yolo", "--ruleset", "a.json", "--declaration", "b.json"]);
    expect(code).toBe(2);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--mode must be "report" or "enforce"'));
  });

  it("exits 0 and prints the envelope JSON for a conforming workflow set", async () => {
    const root = makeRoot();
    writeWorkflow(root, "ci.yml", CONFORMING);
    const rulesetPath = join(root, "ruleset.json");
    const declarationPath = join(root, "declaration.json");
    writeFileSync(rulesetPath, JSON.stringify({ requiredContexts: [], maxRetentionDays: 14 }), "utf8");
    writeFileSync(declarationPath, JSON.stringify({ visibility: "public" }), "utf8");

    const code = await main([
      join(root, ".github", "workflows"),
      "--ruleset",
      rulesetPath,
      "--declaration",
      declarationPath,
    ]);

    expect(code).toBe(0);
    const printed = (logSpy.mock.calls[0]?.[0] as string) ?? "";
    const envelope = JSON.parse(printed) as { verdict: string; package: string; findings: unknown[] };
    expect(envelope.verdict).toBe("satisfied");
    expect(envelope.package).toBe("@clossys/controller");
  });

  it("writes the envelope to --out when given", async () => {
    const root = makeRoot();
    writeWorkflow(root, "ci.yml", CONFORMING);
    const rulesetPath = join(root, "ruleset.json");
    const declarationPath = join(root, "declaration.json");
    const outPath = join(root, "report.json");
    writeFileSync(rulesetPath, JSON.stringify({ requiredContexts: [], maxRetentionDays: 14 }), "utf8");
    writeFileSync(declarationPath, JSON.stringify({ visibility: "public" }), "utf8");

    await main([
      join(root, ".github", "workflows"),
      "--ruleset",
      rulesetPath,
      "--declaration",
      declarationPath,
      "--out",
      outPath,
    ]);

    const written = JSON.parse(readFileSync(outPath, "utf8")) as { verdict: string };
    expect(written.verdict).toBe("satisfied");
  });

  it("in report mode (default), a violated verdict exits 2, not 1, and still prints every finding", async () => {
    const root = makeRoot();
    writeWorkflow(root, "ci.yml", "jobs:\n  build:\n    runs-on: ubuntu-latest\n");
    const rulesetPath = join(root, "ruleset.json");
    const declarationPath = join(root, "declaration.json");
    writeFileSync(rulesetPath, JSON.stringify({ requiredContexts: [], maxRetentionDays: 14 }), "utf8");
    writeFileSync(declarationPath, JSON.stringify({ visibility: "public" }), "utf8");

    const code = await main([
      join(root, ".github", "workflows"),
      "--ruleset",
      rulesetPath,
      "--declaration",
      declarationPath,
    ]);

    expect(code).toBe(2);
    const printed = (logSpy.mock.calls[0]?.[0] as string) ?? "";
    const envelope = JSON.parse(printed) as { verdict: string; findings: unknown[] };
    expect(envelope.verdict).toBe("violated");
    expect(envelope.findings.length).toBeGreaterThan(0);
  });

  it("in enforce mode, a violated verdict exits 1", async () => {
    const root = makeRoot();
    writeWorkflow(root, "ci.yml", "jobs:\n  build:\n    runs-on: ubuntu-latest\n");
    const rulesetPath = join(root, "ruleset.json");
    const declarationPath = join(root, "declaration.json");
    writeFileSync(rulesetPath, JSON.stringify({ requiredContexts: [], maxRetentionDays: 14 }), "utf8");
    writeFileSync(declarationPath, JSON.stringify({ visibility: "public" }), "utf8");

    const code = await main([
      join(root, ".github", "workflows"),
      "--ruleset",
      rulesetPath,
      "--declaration",
      declarationPath,
      "--mode",
      "enforce",
    ]);

    expect(code).toBe(1);
  });

  it("exits 2 with no workflow files (indeterminate), same in both modes", async () => {
    const root = makeRoot();
    mkdirSync(join(root, ".github", "workflows"), { recursive: true });
    const rulesetPath = join(root, "ruleset.json");
    const declarationPath = join(root, "declaration.json");
    writeFileSync(rulesetPath, JSON.stringify({ requiredContexts: [], maxRetentionDays: 14 }), "utf8");
    writeFileSync(declarationPath, JSON.stringify({ visibility: "public" }), "utf8");

    const code = await main([
      join(root, ".github", "workflows"),
      "--ruleset",
      rulesetPath,
      "--declaration",
      declarationPath,
      "--mode",
      "enforce",
    ]);

    expect(code).toBe(2);
  });

  it("exits 2 with a clear message when the ruleset file is not valid JSON", async () => {
    const root = makeRoot();
    writeWorkflow(root, "ci.yml", CONFORMING);
    const rulesetPath = join(root, "ruleset.json");
    const declarationPath = join(root, "declaration.json");
    writeFileSync(rulesetPath, "{ not valid json", "utf8");
    writeFileSync(declarationPath, JSON.stringify({ visibility: "public" }), "utf8");

    const code = await main([
      join(root, ".github", "workflows"),
      "--ruleset",
      rulesetPath,
      "--declaration",
      declarationPath,
    ]);

    expect(code).toBe(2);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("not valid JSON"));
  });
});
