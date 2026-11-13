import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { generateDesignerFoundation } from "./generate-designer-foundation.mjs";
import { scanDesignerDogfood } from "./lib/designer-dogfood.mjs";

function fixture(run) {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), "foundation-source-")));
  const put = (path, value) => { const file = resolve(root, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, value); };
  const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  const commit = () => { git(["add", "."]); git(["-c", "user.name=Example Test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", "commit", "-qm", "Fixture source"]); return git(["rev-parse", "HEAD"]); };
  put("packages/designer/package.json", JSON.stringify({ name: "@fixture/designer", files: ["src", "!src/**/*.test.ts", "!src/**/*.test.tsx", "!src/**/*.test.json", "!src/**/__fixtures__/**"], exports: { "./components": { import: "./dist/components/index.js" } } }));
  put("packages/designer/src/components/index.ts", 'export { Button } from "./Button.js";');
  put("packages/designer/src/components/Button.tsx", 'import {Button} from "react-aria-components"; export {Button};');
  put("packages/designer/src/catalog/slots/components.json", '[{"id":"components.button"}]');
  put("packages/designer/src/catalog/aliases/components.json", "[]");
  put("packages/designer/src/catalog/fills/foundry/components.button.json", JSON.stringify({ $extensions: { "com.clossys.fill": { id: "foundry/components.button", slot: "components.button", source: "foundry", author: "foundry", mode: "implementation", pin: { package: "@fixture/designer" } } }, components: { button: { impl: { kind: "package", module: "@fixture/designer/components", export: "Button" }, pin: { package: "@fixture/designer" }, propMap: {} } } }));
  put("packages/designer/src/tokens/tokens.ts", "export const tokens = {};");
  put("packages/designer/src/tokens/guidance.ts", "export const guidance = {};");
  for (const path of ["src/components/Button.test.tsx", "src/catalog/example.test.json", "src/__fixtures__/example.ts", "src/components/__fixtures__/example.ts"]) put(`packages/designer/${path}`, "excluded fixture");
  put("consumer/Main.tsx", 'import {Button} from "@fixture/designer/components";export const Main=()=> <Button/>;');
  git(["init", "--quiet"]);
  try { run({ root, put, git, commit, source: commit() }); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("exact immutable source wins over both dirty worktree and a different current HEAD", () => fixture(({ root, put, commit, source }) => {
  const first = generateDesignerFoundation(root, source);
  assert.equal(Object.keys(first.files).length, 7);
  assert.ok(Object.keys(first.files).every(path => !path.includes("__fixtures__") && !path.includes(".test.")));
  put("packages/designer/src/components/index.ts", 'export { Button as Changed } from "./Button.js";');
  assert.deepEqual(generateDesignerFoundation(root, source), first);
  const current = commit();
  assert.notEqual(current, source);
  assert.deepEqual(generateDesignerFoundation(root, source), first);
  assert.notEqual(generateDesignerFoundation(root, current).files["src/components/index.ts"], first.files["src/components/index.ts"]);
}));

test("unknown source and missing required package blobs refuse", () => fixture(({ root, git, commit }) => {
  assert.throws(() => generateDesignerFoundation(root, "main"), /Exact immutable source/);
  assert.throws(() => generateDesignerFoundation(root, "0".repeat(40)));
  git(["rm", "packages/designer/src/catalog/aliases/components.json"]);
  assert.throws(() => generateDesignerFoundation(root, commit()), /Required Designer foundation blob missing/);
}));

test("the paired foundation passes and an intentional source mutation is still DG0", () => fixture(({ root, put, source }) => {
  const foundationReceipt = generateDesignerFoundation(root, source);
  const scan = () => scanDesignerDogfood({ designerRoot: resolve(root, "packages/designer"), foundationReceipt, roots: [resolve(root, "consumer/Main.tsx")] });
  assert.equal(scan().ok, true);
  const file = resolve(root, "packages/designer/src/components/index.ts"), original = readFileSync(file, "utf8");
  put("packages/designer/src/components/index.ts", original + "\n// unaccepted source change\n");
  const changed = scan();
  assert.equal(changed.ok, false);
  assert.ok(changed.findings.some(row => row.code === "DG0" && row.message === "foundation source identity differs: src/components/index.ts"));
  put("packages/designer/src/components/index.ts", original);
  assert.equal(scan().ok, true);
}));
