import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BootstrapInputError, readContainedRegularFile, resolveInstalledBin } from "./node-runtime.js";

const roots: string[] = [];
const integrity = `sha512-${"a".repeat(86)}==`;
function root(): string { const value = mkdtempSync(join(tmpdir(), "adoption-bootstrap-")); roots.push(value); return value; }
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("filesystem containment", () => {
  it("rejects symlinks, traversal, absolute paths, and oversize evidence", () => {
    const directory = root(); mkdirSync(join(directory, "evidence")); writeFileSync(join(directory, "evidence", "ok.json"), "{}"); writeFileSync(join(directory, "outside.json"), "{}"); symlinkSync(join(directory, "outside.json"), join(directory, "evidence", "link.json")); writeFileSync(join(directory, "evidence", "large.json"), "x".repeat(20));
    expect(readContainedRegularFile(directory, "evidence/ok.json").toString()).toBe("{}");
    for (const path of ["../outside.json", "/outside.json", "evidence/link.json"]) expect(() => readContainedRegularFile(directory, path)).toThrow(BootstrapInputError);
    expect(() => readContainedRegularFile(directory, "evidence/large.json", 10)).toThrow(BootstrapInputError);
  });
});

describe("manifest-derived executable", () => {
  const expected = { name: "@vespeneventures/advisor", version: "0.1.3", integrity, bin: "advisor-check" };
  function installed(bin: string, manifest: Record<string, unknown> = {}): string {
    const directory = root(); const packageRoot = join(directory, "node_modules", "@vespeneventures", "advisor"); mkdirSync(join(packageRoot, "dist"), { recursive: true }); writeFileSync(join(packageRoot, "dist", "cli.js"), "export {};\n"); writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name: expected.name, version: expected.version, bin: { [expected.bin]: bin }, ...manifest })); return directory;
  }
  it("derives the clean bin from the installed manifest", () => {
    expect(resolveInstalledBin(installed("./dist/cli.js"), expected)).toContain("dist/cli.js");
  });
  it("rejects manifest bin escape and package identity mismatch", () => {
    expect(() => resolveInstalledBin(installed("../escape.js"), expected)).toThrow(BootstrapInputError);
    expect(() => resolveInstalledBin(installed("./dist/cli.js", { version: "0.1.4" }), expected)).toThrow(BootstrapInputError);
  });
});
