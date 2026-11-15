import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { scanStudioImports } from "./check-no-studio-imports.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "check-no-studio-imports.mjs");
const repoRoot = resolve(here, "../../..");

async function put(root, file, text) {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), text);
}

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), "no-studio-imports-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await put(root, "packages/designer/package.json", JSON.stringify({ name: "@clossys/designer", exports: { "./catalog": { import: "./dist/catalog-core/index.js" }, "./studio": { import: "./dist/studio/index.js" }, "./build/theme": { import: "./dist/build/theme/index.js" } } }));
  await put(root, "packages/producer/package.json", JSON.stringify({ name: "@clossys/producer", exports: { ".": { import: "./dist/index.js" } } }));
  await put(root, "packages/publisher/package.json", JSON.stringify({ name: "@clossys/publisher", exports: {} }));
  await put(root, "packages/designer/src/studio/index.ts", "export const studio = 1;\n");
  await put(root, "packages/producer/src/server/cells.ts", "export const cells = 1;\n");
  await put(root, "packages/producer/src/read/cells.ts", "export const cells = 1;\n");
  await put(root, "packages/producer/src/cli/design.ts", 'import { cells } from "../read/cells.js";\nimport { projectTheme } from "@clossys/designer/build/theme";\nexport { cells, projectTheme };\n');
  // Studio code may import itself and the engine; tests may import the Studio.
  await put(root, "packages/producer/src/server/index.ts", 'import { cells } from "./cells.js";\nimport { studio } from "@clossys/designer/studio";\nexport { cells, studio };\n');
  await put(root, "packages/producer/studio/app/page.tsx", 'import { cells } from "../../src/server/cells.js";\nexport default cells;\n');
  await put(root, "packages/producer/src/cli/design.test.ts", 'import { cells } from "../server/cells.js";\n');
  await put(root, "packages/producer/src/cli/note.ts", '// import { cells } from "../server/cells.js";\nexport const note = "server";\n');
  return root;
}

const run = (root) => spawnSync(process.execPath, [script, "--root", root], { encoding: "utf8" });

test("a workspace whose engine files never import a Studio path passes", async (t) => {
  const root = await workspace(t);
  assert.deepEqual(scanStudioImports({ root }), []);
  assert.equal(run(root).status, 0);
});

test("relative, dynamic, re-export and package-subpath imports of a Studio path are each a finding", async (t) => {
  const root = await workspace(t);
  await put(root, "packages/producer/src/cli/a.ts", 'import { cells } from "../server/cells.js";\nexport { cells };\n');
  await put(root, "packages/producer/scripts/b.mjs", 'const m = await import("../studio/app/page.tsx");\n');
  await put(root, "packages/designer/src/blocks/c.ts", 'export * from "../studio/index.js";\n');
  await put(root, "packages/publisher/src/web/d.tsx", 'import type { X } from "@clossys/designer/studio";\n');
  const findings = scanStudioImports({ root }).map(f => `${f.file}:${f.line} ${f.target}`).sort();
  assert.deepEqual(findings, [
    "designer/src/blocks/c.ts:1 designer/src/studio/index.js",
    "producer/scripts/b.mjs:1 producer/studio/app/page.tsx",
    "producer/src/cli/a.ts:1 producer/src/server/cells.js",
    "publisher/src/web/d.tsx:1 designer/src/studio/index.js",
  ]);
});

test("mutation: one added engine import fails the check; removing it passes again", async (t) => {
  const root = await workspace(t);
  const temp = join(root, "packages/producer/src/specimen/temp-mutation.ts");
  await put(root, "packages/producer/src/specimen/temp-mutation.ts", 'import { cells } from "../server/cells.js";\nexport { cells };\n');
  const failed = run(root);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /temp-mutation\.ts:1 imports \.\.\/server\/cells\.js/);
  await unlink(temp);
  assert.equal(run(root).status, 0);
});

test("no engine file in this repository imports src/server, src/studio or studio/", () => {
  const findings = scanStudioImports({ root: repoRoot });
  assert.deepEqual(findings.map(f => `packages/${f.file}:${f.line} ${f.specifier}`), []);
});
