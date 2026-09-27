import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it } from "vitest";
import { isDirectInvocation } from "./cli.js";
import { StarterInputError, readContainedRegularFile, resolveInstalledBin, runNode, validateInstalledIdentity } from "./node-runtime.js";
import type { StarterRequest } from "./types.js";
import { evaluateProcessResult } from "./core.js";

const roots: string[] = [];
const integrity = `sha512-${"a".repeat(85)}A==`;
function root(): string { const value = mkdtempSync(join(tmpdir(), "starter-")); roots.push(value); return value; }
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("installed identity without advisor", () => {
  const starter = { name: "@clossys/starter", version: "0.1.0", integrity, bin: "foundry-starter" as const };
  const target = { name: "@fixture/starter-target", version: "1.2.3", integrity, bin: "target-check", invocation: "single-json-input" as const };
  it("does not require @clossys/advisor in the base install when the request omits advisor", () => {
    const directory = root();
    const manifest = { devDependencies: { [starter.name]: starter.version, [target.name]: target.version } };
    const lock = { packages: { "": manifest, [`node_modules/${starter.name}`]: { version: starter.version, integrity }, [`node_modules/${target.name}`]: { version: target.version, integrity } } };
    writeFileSync(join(directory, "package.json"), JSON.stringify(manifest));
    writeFileSync(join(directory, "package-lock.json"), JSON.stringify(lock));
    const starterRoot = join(directory, "node_modules", "@clossys", "starter");
    const targetRoot = join(directory, "node_modules", "@fixture", "starter-target");
    mkdirSync(join(starterRoot, "dist"), { recursive: true });
    mkdirSync(join(targetRoot, "dist"), { recursive: true });
    writeFileSync(join(starterRoot, "package.json"), JSON.stringify({ name: starter.name, version: starter.version, bin: { "foundry-starter": "./dist/cli.js" } }));
    writeFileSync(join(starterRoot, "dist", "cli.js"), "export {};\n");
    writeFileSync(join(targetRoot, "package.json"), JSON.stringify({ name: target.name, version: target.version, bin: { "target-check": "./dist/cli.js" } }));
    writeFileSync(join(targetRoot, "dist", "cli.js"), "export {};\n");
    const request = {
      schemaVersion: 1,
      phase: "activation",
      packageManager: "npm",
      snapshot: { repository: "consumer/repository", maxAgeMs: 60_000 },
      starter,
      target,
      evidence: { assessment: "evidence/assessment.json", targetInput: "evidence/target.json" },
    } satisfies StarterRequest;
    expect(validateInstalledIdentity(directory, request)).toEqual([]);
  });
});

describe("filesystem containment", () => {
  it("rejects symlinks, traversal, absolute paths, and oversize evidence", () => {
    const directory = root(); mkdirSync(join(directory, "evidence")); writeFileSync(join(directory, "evidence", "ok.json"), "{}"); writeFileSync(join(directory, "outside.json"), "{}"); symlinkSync(join(directory, "outside.json"), join(directory, "evidence", "link.json")); writeFileSync(join(directory, "evidence", "large.json"), "x".repeat(20));
    expect(readContainedRegularFile(directory, "evidence/ok.json").toString()).toBe("{}");
    for (const path of ["../outside.json", "/outside.json", "evidence/link.json"]) expect(() => readContainedRegularFile(directory, path)).toThrow(StarterInputError);
    expect(() => readContainedRegularFile(directory, "evidence/large.json", 10)).toThrow(StarterInputError);
  });
});

describe("manifest-derived executable", () => {
  const expected = { name: "@clossys/advisor", version: "0.1.3", integrity, bin: "advisor-check" };
  function installed(bin: string, manifest: Record<string, unknown> = {}): string {
    const directory = root(); const packageRoot = join(directory, "node_modules", "@clossys", "advisor"); mkdirSync(join(packageRoot, "dist"), { recursive: true }); writeFileSync(join(packageRoot, "dist", "cli.js"), "export {};\n"); writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name: expected.name, version: expected.version, bin: { [expected.bin]: bin }, ...manifest })); return directory;
  }
  it("derives the clean bin from the installed manifest", () => {
    expect(resolveInstalledBin(installed("./dist/cli.js"), expected)).toContain("dist/cli.js");
  });
  it("rejects manifest bin escape and package identity mismatch", () => {
    expect(() => resolveInstalledBin(installed("../escape.js"), expected)).toThrow(StarterInputError);
    expect(() => resolveInstalledBin(installed("./dist/cli.js", { version: "0.1.4" }), expected)).toThrow(StarterInputError);
  });
});

describe("direct invocation and fixed process deadline", () => {
  it("recognizes an installed-style POSIX bin symlink", () => {
    const directory = root(); const source = new URL("./cli.ts", import.meta.url); const bin = join(directory, "foundry-starter");
    symlinkSync(fileURLToPath(source), bin);
    expect(isDirectInvocation(source.href, bin)).toBe(true);
  });

  it("maps hostile hanging Advisor and target fixtures to indeterminate", () => {
    const directory = root(); const hanging = join(directory, "hang.mjs"); writeFileSync(hanging, "setInterval(() => {}, 1_000);\n");
    for (const label of ["advisor", "target"]) {
      const observation = runNode(hanging, [], label === "advisor" ? "2026-08-27T12:00:00.000Z" : undefined, 25);
      expect(observation.timedOut, label).toBe(true);
      expect(evaluateProcessResult(observation, label, label === "advisor" ? "2026-08-27T12:00:00.000Z" : undefined).state, label).toBe("indeterminate");
    }
  });

  it("kills a SIGTERM-ignoring child within the bounded deadline and keeps the result indeterminate", () => {
    const directory = root(); const ignoringTerm = join(directory, "ignore-term.mjs");
    writeFileSync(ignoringTerm, "process.on(\"SIGTERM\", () => {}); setTimeout(() => process.exit(0), 2_000); setInterval(() => {}, 1_000);\n");
    const started = performance.now();
    const observation = runNode(ignoringTerm, [], "2026-08-27T12:00:00.000Z", 100);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(1_000);
    expect(observation.timedOut).toBe(true);
    expect(observation.exitCode).not.toBe(0);
    expect(evaluateProcessResult(observation, "advisor", "2026-08-27T12:00:00.000Z").state).toBe("indeterminate");
  });
});
