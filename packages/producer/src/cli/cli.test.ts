import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const entry = resolve(dirname(fileURLToPath(import.meta.url)), "../../dist/cli/index.js");
const verbs = ["direct", "design", "write", "publish", "produce"] as const;
let fixture: string;
beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), "producer-cli-"));
  mkdirSync(join(fixture, "clossys"));
  writeFileSync(join(fixture, "clossys", "clossys.config.ts"), "export default {};\n");
  writeFileSync(join(fixture, "notes.txt"), "Example fixture.\n");
});
afterEach(() => { rmSync(fixture, { recursive: true, force: true }); });

function run(args: string[], cwd = fixture) {
  return spawnSync(process.execPath, [entry, ...args], { cwd, encoding: "utf8" });
}

function snapshot(root: string): unknown[] {
  return readdirSync(root).sort().flatMap((name): unknown[] => {
    const path = join(root, name);
    const stat = statSync(path);
    const item = { path: relative(fixture, path), mtimeMs: stat.mtimeMs, directory: stat.isDirectory() };
    return stat.isDirectory()
      ? [item, ...snapshot(path)]
      : [{ ...item, hash: createHash("sha256").update(readFileSync(path)).digest("hex") }];
  });
}

describe("clossys bin", () => {
  it.each([[], ["unknown"]])("rejects missing or unknown verbs: %j", (...args) => {
    const result = run(args as string[]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Usage:");
  });

  it("prints help with exit 0", () => {
    const result = run(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage:");
    for (const verb of verbs) expect(result.stdout).toContain(verb);
    expect(result.stderr).toBe("");
  });

  it.each(verbs.filter(verb => verb !== "produce"))("recognizes %s with a stub refusal", (verb) => {
    const result = run([verb]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(`${verb}: not implemented in this build`);
  });

  it("discovers a root from nested cwd", () => {
    const nested = join(fixture, "apps", "example", "src");
    mkdirSync(nested, { recursive: true });
    const result = run(["direct", "--json"], nested);
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ verb: "direct", root: fixture });
  });

  it("uses --root relative to cwd and chooses the nearest ancestor", () => {
    const inner = join(fixture, "nested");
    mkdirSync(join(inner, "clossys"), { recursive: true });
    writeFileSync(join(inner, "clossys", "clossys.config.ts"), "export default {};\n");
    const result = run(["design", "--root", "nested", "--json"]);
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ verb: "design", root: inner });
  });

  it("reports missing roots with exit 2", () => {
    rmSync(join(fixture, "clossys"), { recursive: true });
    const result = run(["direct"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("clossys/clossys.config.ts");
  });

  it.each([
    ["publish", "--port", "4330"],
    ["write", "--check", "--root", "."],
  ])("parses supported flags without implementing behavior: %j", (...args) => {
    const result = run(args);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("not implemented in this build");
  });

  it.each([
    ["direct", "--root"], ["direct", "--bogus"], ["design", "--once"],
    ["produce", "--port", "bad"], ["produce", "--port", "65536"],
    ["publish", "--target"], ["write", "--target", "example"],
    ["publish", "--target", "example"], ["publish", "--target", "preview", "--port", "80"],
    ["write", "--out", "site"], ["write", "--port", "4330"],
  ])("rejects invalid arguments: %j", (...args) => {
    const result = run(args);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Usage:");
    expect(result.stderr).not.toContain("not implemented in this build");
  });

  it.each([["--help"], [], ["unknown"], ["direct"], ["produce", "--port", "bad"]])(
    "prints exactly one JSON object: %j", (...args) => {
      const result = run([...args, "--json"]);
      expect(result.stdout.trim().split("\n")).toHaveLength(1);
      const parsed = JSON.parse(result.stdout);
      expect(parsed).toMatchObject({ exitCode: result.status, message: expect.any(String) });
      expect(result.stderr).toBe("");
    },
  );

  it("does not evaluate config during the scaffold", () => {
    writeFileSync(join(fixture, "clossys", "clossys.config.ts"), "throw new Error('Config executed');\n");
    const result = run(["direct"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("not implemented in this build");
  });

  it("--check leaves file lists, hashes and mtimes unchanged for every stub", () => {
    const before = snapshot(fixture);
    for (const verb of verbs) {
      const result = run([verb, "--check"]);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain(verb === "produce" ? "missing" : "not implemented in this build");
    }
    expect(snapshot(fixture)).toEqual(before);
  });
});
