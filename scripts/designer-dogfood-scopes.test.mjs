import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { designerDogfoodRoots, designerDogfoodScopes } from "./lib/designer-dogfood-scopes.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const command = resolve(repo, "scripts/check-designer-dogfood.mjs");

test("required Studio directory and Publisher closure survive every additional root", () => {
  const sources = designerDogfoodScopes(["--root", "extra/Page.tsx", "--admin-root", "admin/Shell.tsx"], "/fixture/repository", "/fixture/consumer");
  assert.deepEqual(sources, {
    studio: ["/fixture/repository/packages/designer/src/studio"],
    publisher: ["/fixture/repository/packages/publisher/src/web/publisher/PublisherPage.tsx"],
    adminShell: ["/fixture/consumer/admin/Shell.tsx"],
    additional: ["/fixture/consumer/extra/Page.tsx"],
  });
  assert.ok(sources.studio[0].endsWith("/src/studio"), "unreachable shipped Studio sources remain in scope");
});

test("admin roots are explicit, repeatable, deduplicated and never inferred", () => {
  const args = ["--admin-root", "admin/Shell.tsx", "--admin-root", "admin/console.css", "--admin-root", "admin/Shell.tsx"];
  assert.deepEqual(designerDogfoodScopes(args, "/fixture/repository", "/fixture/consumer").adminShell,
    ["/fixture/consumer/admin/Shell.tsx", "/fixture/consumer/admin/console.css"]);
  for (const missing of [[], ["--root", "extra/Page.tsx"]]) {
    assert.throws(() => designerDogfoodScopes(missing, "/fixture/repository"), /Admin shell source scope is required/);
  }
});

test("unknown flags, omissions and any proposed scope-override flag are refused", () => {
  for (const args of [["--admin-root"], ["--root"], ["--admin-root", "--root", "other"], ["--skip-studio"], ["--skip-publisher"], ["--allowlist", "exceptions.json"]]) {
    assert.throws(() => designerDogfoodScopes(args, "/fixture/repository"), /usage:/);
  }
});

test("the real CLI emits a failed machine report when admin scope is omitted", () => {
  for (const args of [[], ["--root", "scripts/lib/designer-dogfood-scopes.mjs"]]) {
    const child = spawnSync(process.execPath, [command, ...args], { cwd: repo, encoding: "utf8" });
    assert.equal(child.status, 1);
    assert.equal(child.stderr, "");
    const report = JSON.parse(child.stdout);
    assert.equal(report.ok, false);
    assert.deepEqual(report.inventory, []);
    assert.ok(report.findings.some(row => row.code === "DG0" && /Admin shell source scope is required/.test(row.message)));
  }
});


test("flattened scanner roots retain Studio and Publisher when additional roots are supplied", () => {
  const scopes = designerDogfoodScopes(["--root", "extra/Page.tsx", "--admin-root", "admin/Shell.tsx"], "/fixture/repository", "/fixture/consumer");
  assert.deepEqual(designerDogfoodRoots(scopes), [...scopes.studio, ...scopes.publisher, ...scopes.adminShell, ...scopes.additional]);
});

test("the real CLI forwards mandatory and additional roots to the scanner", () => {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), "dogfood-command-wiring-")));
  try {
    mkdirSync(resolve(root, "scripts/lib"), { recursive: true });
    copyFileSync(command, resolve(root, "scripts/check-designer-dogfood.mjs"));
    copyFileSync(resolve(repo, "scripts/lib/designer-dogfood-scopes.mjs"), resolve(root, "scripts/lib/designer-dogfood-scopes.mjs"));
    // A test-only scanner records actual arguments. It does not inspect or qualify production sources.
    writeFileSync(resolve(root, "scripts/lib/designer-dogfood.mjs"), 'export function scanDesignerDogfood({roots}) { return { ok: true, findings: [], inventory: roots.map(file => ({file})) }; }');
    const child = spawnSync(process.execPath, [resolve(root, "scripts/check-designer-dogfood.mjs"), "--root", "extra/Page.tsx", "--admin-root", "admin/Shell.tsx"], { cwd: root, encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr);
    const report = JSON.parse(child.stdout);
    assert.deepEqual(report.inventory.map(row => row.file).sort(), [
      resolve(root, "packages/designer/src/studio"),
      resolve(root, "packages/publisher/src/web/publisher/PublisherPage.tsx"),
      resolve(root, "admin/Shell.tsx"),
      resolve(root, "extra/Page.tsx"),
    ].sort());
  } finally { rmSync(root, { recursive: true, force: true }); }
});
