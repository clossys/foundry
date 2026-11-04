import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { selectionStoreFindings } from "./check-no-selection-store.mjs";

const repo = files => {
  const root = mkdtempSync(join(tmpdir(), "no-selection-store-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
};
const STORE = ["selection", "json"].join(".");
const rows = root => selectionStoreFindings(root).map(f => `${f.rule} ${f.file}${f.line ? `:${f.line}` : ""}`);

test("fails the store file and every reader of it", () => {
  const root = repo({
    [`clossys/${STORE}`]: "{}",
    "packages/designer/scripts/check-x.mjs": `const pins = json(join(root, "${STORE}")).pins;\n`,
    "packages/producer/src/pipeline/ports.ts": `export const P = { glob: "clossys/${STORE}" };\n`,
    "packages/producer/src/records/legacy.ts": `const SCHEMA = "clossys.${"selection"}/1";\n`,
    "scripts/tool.mjs": `\nreadFileSync(resolve(root, '${STORE}'));\n`,
  });
  assert.deepEqual(rows(root).sort(), [
    `reader packages/designer/scripts/check-x.mjs:1`,
    `reader packages/producer/src/pipeline/ports.ts:1`,
    `reader packages/producer/src/records/legacy.ts:1`,
    `reader scripts/tool.mjs:2`,
    `store clossys/${STORE}`,
  ]);
});

test("passes slot-model readers, tests, fixtures and a library package's own value file", () => {
  const root = repo({
    "packages/designer/scripts/check-x.mjs": `import { listSlots } from "../../producer/dist/records/slots.js";\n`,
    "packages/designer/src/library-cli/fs-library.ts": `files.set("${STORE}", text); const s = await parse("${STORE}");\nimport selection from "./${STORE}";\n`,
    "packages/designer/src/x.test.ts": `json(join(root, "${STORE}"));\n`,
    "packages/designer/src/__fixtures__/a.ts": `json(join(root, "${STORE}"));\n`,
    "packages/designer/README.md": `clossys/${STORE}\n`,
  });
  assert.deepEqual(rows(root), []);
});
