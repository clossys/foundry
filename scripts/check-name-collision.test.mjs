import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = resolve(dirname(fileURLToPath(import.meta.url)), "check-name-collision.mjs");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "npmjs-name-collision-"));
  const packageDirectory = join(root, "packages", "probe");
  mkdirSync(packageDirectory, { recursive: true });
  writeFileSync(join(root, "package-scope.json"), JSON.stringify({ scope: "@clossys", registry: "https://registry.npmjs.org", access: "public" }));
  writeFileSync(join(packageDirectory, "package.json"), JSON.stringify({ name: "@clossys/probe", version: "1.2.3" }));
  execFileSync("git", ["init", "-q", root]);
  return { root, packageDirectory };
}

function run(packageDirectory, packument) {
  const path = join(dirname(dirname(packageDirectory)), "packument.json");
  writeFileSync(path, JSON.stringify(packument));
  try {
    const stdout = execFileSync(process.execPath, [script, packageDirectory, "--json", "--packument-json", path], {
      encoding: "utf8",
      env: { ...process.env, GITHUB_REPOSITORY: "clossys/platform" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    return { code: error.status, stdout: error.stdout?.toString() ?? "", stderr: error.stderr?.toString() ?? "" };
  }
}

test("public npmjs name collision lookup is anonymous, repository-bound, and fail closed", () => {
  const { root, packageDirectory } = fixture();
  try {
    const unused = run(packageDirectory, null);
    assert.equal(unused.code, 0);
    assert.equal(JSON.parse(unused.stdout).verdict, "safe");

    const same = run(packageDirectory, {
      name: "@clossys/probe",
      repository: { url: "git+https://github.com/clossys/platform.git" },
      versions: {},
    });
    assert.equal(same.code, 0);
    assert.equal(JSON.parse(same.stdout).verdict, "same-repo-version-bump");

    const foreign = run(packageDirectory, {
      name: "@clossys/probe",
      repository: { url: "https://github.com/other/project.git" },
      versions: {},
    });
    assert.equal(foreign.code, 1);
    assert.equal(JSON.parse(foreign.stdout).verdict, "collision");

    const malformed = run(packageDirectory, { name: "@clossys/other", versions: {} });
    assert.equal(malformed.code, 2);
    assert.match(malformed.stderr, /unreachable/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
