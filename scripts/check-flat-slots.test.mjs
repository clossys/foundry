import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { codeFindings, storeFindings } from "./check-flat-slots.mjs";

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "flat-slots-"));
  for (const [path, text] of Object.entries(files)) { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); }
  return root;
}
const kinds = findings => findings.map(finding => `${finding.kind} ${finding.path}`);

test("a flat store passes", () => {
  const root = tree({ "clossys/agents/designer/ia.json": "{}", "clossys/agents/designer/hero.main/pin.json": "{}", "clossys/agents/designer/hero.main/candidates/hero-v1.json": "{}" });
  try { assert.deepEqual(storeFindings(root), []); assert.deepEqual(codeFindings(root), []); } finally { rmSync(root, { recursive: true, force: true }); }
});

test("legacy stores and grouping folders fail", () => {
  const root = tree({
    "clossys/library/frames.shell/v1/element.json": "{}",
    "clossys/cells/x/v1.md": "",
    "clossys/agents/director/tree.json": "{}",
    "clossys/agents/director/citations.json": "{}",
    "clossys/agents/writer/group/copy.hero/candidates/a-v1.md": "",
    "clossys/agents/writer/copy.cta/candidates/nested/a-v1.md": "",
  });
  try {
    assert.deepEqual(kinds(storeFindings(root)), [
      "store clossys/library", "store clossys/cells", "layout clossys/agents/director/citations.json", "store clossys/agents/director/tree.json",
      "layout clossys/agents/writer/copy.cta/candidates/nested", "layout clossys/agents/writer/group/copy.hero",
    ]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("readers and shipped manifests of a legacy store fail; tests and package data do not", () => {
  const root = tree({
    "clossys/agents/designer/ia.json": "{}",
    "packages/a/src/read.ts": 'const t = readJson(root, "tree.json");\nconst c = join(base, "cells", id);\nconst l = "clossys/library/x";\n',
    "packages/a/src/catalog.ts": 'const ok = join("src", "catalog", "cells", "strategy.json");\nimport data from "./tree.json";\n',
    "packages/a/src/read.test.ts": 'const t = readJson(root, "tree.json");\n',
    "packages/a/package.json": '{ "foundry": { "outputs": ["clossys/agents/director/cells/"] } }\n',
  });
  try {
    assert.deepEqual(kinds(codeFindings(root)), ["reader packages/a/src/read.ts:1", "reader packages/a/src/read.ts:2", "reader packages/a/src/read.ts:3", "shipped packages/a/package.json:1"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
