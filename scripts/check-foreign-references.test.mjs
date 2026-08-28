import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const checker = join(scriptsDir, "check-foreign-references.mjs");
const futureScope = `@${"clossys"}`;

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function catalog({ malformed = false } = {}) {
  if (malformed) return "{";
  return JSON.stringify({
    schemaVersion: 1,
    defaultTarget: "current",
    targets: [
      { id: "current", status: "active", scope: "@fixture", registry: "https://npm.pkg.github.com", packages: "all" },
      { id: "clossys-npmjs-precutover", status: "planned", scope: futureScope, registry: "https://registry.npmjs.org", packages: ["advisor", "starter", "controller"] },
    ],
  });
}

function fixture({ malformed = false, extraFiles = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "foreign-release-catalog-"));
  write(join(root, "package-scope.json"), JSON.stringify({ scope: "@fixture", registry: "https://npm.pkg.github.com" }));
  write(join(root, "package.json"), JSON.stringify({ private: true, repository: { type: "git", url: "https://github.com/fixture/repository.git" } }));
  write(join(root, "governance/release-catalog.json"), catalog({ malformed }));
  for (const [path, contents] of Object.entries(extraFiles)) write(join(root, path), contents);
  return root;
}

function run(root) {
  return spawnSync(process.execPath, [checker, root], { encoding: "utf8" });
}

test("a future producer scope is admitted only in an exact release-contract documentation surface", () => {
  const root = fixture({ extraFiles: { "docs/PUBLISHING.md": `planned ${futureScope}/advisor target` } });
  try {
    const result = run(root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a future producer scope outside its release-contract surfaces is a foreign-reference finding", () => {
  const root = fixture({ extraFiles: { "src/leak.mjs": `export const leak = "${futureScope}/advisor";` } });
  try {
    const result = run(root);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stdout, /FOREIGN reference/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a malformed catalogue cannot grant a future producer scope exception", () => {
  const root = fixture({ malformed: true, extraFiles: { "docs/PUBLISHING.md": `planned ${futureScope}/advisor target` } });
  try {
    const result = run(root);
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(result.stderr, /cannot validate governance\/release-catalog\.json/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
