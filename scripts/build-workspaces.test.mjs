import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildOrder, listWorkspaces } from "./build-workspaces.mjs";

const ws = (dir, name, dependencies = {}, extra = {}) => ({ dir, manifest: { name, dependencies, ...extra } });

test("a dependency builds before a dependent that sorts ahead of it", () => {
  const order = buildOrder([
    ws("packages/designer", "@x/designer", { "@x/director": "1.0.0" }),
    ws("packages/publisher", "@x/publisher", { "@x/designer": "1.0.0", "@x/writer": "1.0.0" }),
    ws("packages/director", "@x/director"),
    ws("packages/writer", "@x/writer", { "@x/director": "1.0.0" }),
  ]).map((w) => w.dir);
  assert.deepEqual(order, ["packages/director", "packages/designer", "packages/writer", "packages/publisher"]);
});

test("dev and peer dependencies on workspaces are edges too", () => {
  const order = buildOrder([
    ws("packages/a", "@x/a", {}, { devDependencies: { "@x/c": "*" } }),
    ws("packages/b", "@x/b", {}, { peerDependencies: { "@x/a": "*" } }),
    ws("packages/c", "@x/c"),
  ]).map((w) => w.dir);
  assert.deepEqual(order, ["packages/c", "packages/a", "packages/b"]);
});

test("a cycle is refused", () => {
  assert.throws(() => buildOrder([ws("packages/a", "@x/a", { "@x/b": "*" }), ws("packages/b", "@x/b", { "@x/a": "*" })]), /cycle/);
});

test("workspace patterns expand dir/* and literal nested paths", () => {
  const root = mkdtempSync(join(tmpdir(), "build-workspaces-"));
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ workspaces: ["packages/*", "packages/a/ui"] }));
    for (const [dir, name] of [["packages/a", "@x/a"], ["packages/a/ui", "@x/a-ui"], ["packages/b", "@x/b"]]) {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, "package.json"), JSON.stringify({ name }));
    }
    mkdirSync(join(root, "packages/no-manifest"));
    assert.deepEqual(listWorkspaces(root).map((w) => w.dir), ["packages/a", "packages/a/ui", "packages/b"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
