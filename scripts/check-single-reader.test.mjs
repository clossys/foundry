import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { READER, WRITER, check } from "./check-single-reader.mjs";

const script = fileURLToPath(new URL("./check-single-reader.mjs", import.meta.url));
const roots = [];
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

/** A throwaway repository holding the given repository-relative files. */
function fixture(files) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "check-single-reader-")));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}
const run = root => spawnSync(process.execPath, [script, "--root", root, "--json"], { encoding: "utf8" });

const direct = `import { readFileSync } from "node:fs";
import { join } from "node:path";
export const pin = (root: string) => JSON.parse(readFileSync(join(root, "clossys", "agents", "designer", "hero", "pin.json"), "utf8"));
`;

test("a package that opens a pin.json directly fails, naming file and line", () => {
  const root = fixture({ "packages/demo/src/read.ts": direct });
  const findings = check(root);
  assert.deepEqual(findings.map(finding => [finding.file, finding.line, finding.call]), [["packages/demo/src/read.ts", 3, "readFileSync"]]);
  const result = run(root);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).findings.length, 1);
});

test("taint follows locals, path helpers, promises and namespace imports", () => {
  const root = fixture({
    "packages/demo/src/walk.ts": `import * as fs from "node:fs/promises";
import { join } from "node:path";
const agents = (root: string) => join(root, "clossys", "agents");
export async function list(root: string) { const dir = join(agents(root), "writer"); return fs.readdir(dir); }
`,
    "packages/demo/src/helper.ts": `import { readdirSync } from "node:fs";
import { slotDir } from "./paths.js";
export const candidates = (root: string) => readdirSync(slotDir(root, "designer", "hero"));
`,
    "packages/demo/bin/cli.mjs": `import { writeFileSync } from "node:fs";
writeFileSync(process.argv[2] + "/agents/publisher/page.home/pin.json", "{}");
`,
  });
  assert.deepEqual(check(root).map(finding => finding.file).sort(), ["packages/demo/bin/cli.mjs", "packages/demo/src/helper.ts", "packages/demo/src/walk.ts"]);
});

test("the reader and the writer may open the model; tests, routes and other agents folders are not findings", () => {
  const root = fixture({
    [READER]: direct,
    [WRITER]: direct.replace("readFileSync", "writeFileSync").replace(/readFileSync\(([^)]*\)), "utf8"\)/, "writeFileSync($1, \"{}\")"),
    "packages/demo/src/read.test.ts": direct,
    "packages/demo/src/route.ts": `import { readFileSync } from "node:fs";
import { join } from "node:path";
export const route = "/agents/designer/hero";
export const other = (root: string) => readFileSync(join(root, "agents", "codex", "loop.json"));
export const own = (root: string) => readFileSync(root + "/package.json");
`,
  });
  assert.deepEqual(check(root), []);
  assert.equal(run(root).status, 0);
});

test("the Producer seat tree is the slot model: literal agents/producer path arguments are findings", () => {
  const root = fixture({
    "packages/demo/src/seats.ts": `import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
export const seats = (root: string) => readdirSync(join(root, "clossys", "agents", "producer"));
export const loop = (root: string) => readFileSync(join(root, "agents", "producer", "loop.json"));
`,
  });
  assert.deepEqual(check(root).map(finding => [finding.file, finding.line]), [["packages/demo/src/seats.ts", 3], ["packages/demo/src/seats.ts", 4]]);
  assert.equal(run(root).status, 1);
});

test("usage errors exit 2", () => {
  const result = spawnSync(process.execPath, [script, "--bogus"], { encoding: "utf8" });
  assert.equal(result.status, 2);
});
