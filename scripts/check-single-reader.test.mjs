import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { READER, RESOLVER, WRITER, check, isModelString } from "./check-single-reader.mjs";

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

test("G21: a checks or fixtures folder inside shipped src is scanned", () => {
  const root = fixture({
    "packages/demo/src/checks/read.ts": direct,
    "packages/demo/src/fixtures/read.ts": direct,
    "packages/demo/src/__fixtures__/read.ts": direct,
  });
  assert.deepEqual(check(root).map(finding => finding.file).sort(), ["packages/demo/src/checks/read.ts", "packages/demo/src/fixtures/read.ts"]);
  assert.equal(run(root).status, 1);
});

test("G22: a ? or # does not make a path a URL; only scheme:// strings other than file:// are URLs", () => {
  for (const text of ["agents/designer/hero/pin.json?raw", "clossys/agents/writer?x", "./ia.json#top", "file:///repo/clossys/agents/designer/hero/pin.json", "file:///repo/agents/publisher?x"]) assert.equal(isModelString(text), true, text);
  for (const text of ["https://example.com/agents/designer/pin.json", "/agents/designer/hero?tab=pin", "/agents/writer#slot", "?agent=designer"]) assert.equal(isModelString(text), false, text);
  const root = fixture({ "packages/demo/src/query.ts": `import { readFileSync } from "node:fs";
export const pin = (root: string) => readFileSync(root + "/clossys/agents/designer/hero/pin.json?raw");
export const ia = (root: string) => readFileSync(\`\${root}/agents/writer/ia.json?v=1\`);
` });
  assert.deepEqual(check(root).map(finding => finding.line), [2, 3]);
});

test("W2-D (c): rmdir, truncate, link, chmod and mkdtemp on a slot-model path are findings", () => {
  const root = fixture({ "packages/demo/src/remove.ts": `import { rmdirSync, truncateSync, linkSync, chmodSync, mkdtempSync } from "node:fs";
import { rmdir } from "node:fs/promises";
import { join } from "node:path";
const slot = (root: string) => join(root, "clossys", "agents", "designer", "hero");
export const a = (root: string) => rmdirSync(slot(root));
export const b = (root: string) => rmdir(slot(root));
export const c = (root: string) => truncateSync(join(slot(root), "pin.json"));
export const d = (root: string, to: string) => linkSync(to, join(slot(root), "pin.json"));
export const e = (root: string) => chmodSync(slot(root), 0o755);
export const f = (root: string) => mkdtempSync(join(slot(root), "tmp-"));
` });
  assert.deepEqual(check(root).map(finding => [finding.line, finding.call, finding.kind]), [
    [5, "rmdirSync", "reader"], [6, "rmdir", "reader"], [7, "truncateSync", "reader"], [8, "linkSync", "reader"], [9, "chmodSync", "reader"], [10, "mkdtempSync", "reader"],
  ]);
});

test("W2-D writer scan (R11.1): the reader may read the model but never write it; the writer may", () => {
  const writes = `import { readFileSync, writeFileSync, rmdirSync } from "node:fs";
import { join } from "node:path";
export const read = (root: string) => readFileSync(join(root, "clossys", "agents", "writer", "ia.json"));
export const write = (root: string) => writeFileSync(join(root, "clossys", "agents", "writer", "ia.json"), "{}");
export const drop = (root: string) => rmdirSync(join(root, "clossys", "agents", "writer", "home.hero"));
`;
  const root = fixture({ [READER]: writes, [WRITER]: writes });
  const findings = check(root);
  assert.deepEqual(findings.map(finding => [finding.file, finding.line, finding.call, finding.kind]), [[READER, 4, "writeFileSync", "writer"], [READER, 5, "rmdirSync", "writer"]]);
  const result = run(root);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).findings.length, 2);
});

test("W2-D resolver scan (R11.2): a citation parser is imported only by the resolver, the parser's package and the one-time rewrite", () => {
  const parse = name => `import { ${name} } from "@clossys/director";\nexport const f = (text: string) => ${name}(text);\n`;
  const root = fixture({
    [RESOLVER]: parse("parseSlotCitation"),
    "packages/director/src/format/slot.ts": parse("versionedCitation"),
    "packages/producer/src/migrate/rewrite.ts": parse("slotCitationsInText"),
    "packages/writer/src/declarations.ts": parse("parseSlotCitation"),
    "packages/publisher/src/page.ts": `import { parseCitation as cite } from "../../producer/src/records/citations.js";\nexport const f = cite;\n`,
    "packages/producer/src/cli/pin.ts": `export const f = async (text: string) => (await import("@clossys/director")).versionedCitation(text);\n`,
    "packages/producer/src/cli/ok.ts": `import { resolveCitation } from "../records/citations.js";\nexport const f = resolveCitation;\n`,
  });
  assert.deepEqual(check(root).map(finding => [finding.file, finding.call, finding.kind]).sort(), [
    ["packages/producer/src/cli/pin.ts", "versionedCitation", "resolver"],
    ["packages/publisher/src/page.ts", "parseCitation", "resolver"],
    ["packages/writer/src/declarations.ts", "parseSlotCitation", "resolver"],
  ]);
});
