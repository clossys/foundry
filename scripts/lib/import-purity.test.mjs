// Tests for scripts/lib/import-purity.mjs on synthetic sources: every way a
// reviewer found to slip network, process, clock or randomness past a text
// search, plus the forms that must stay allowed.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";

import { checkImportPurity } from "./import-purity.mjs";

const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** Writes `files` into a fresh directory and checks `entry` (default `entry.ts`) against `allowedBuiltins`. */
function check(files, { entry = "entry.ts", allowedBuiltins = ["node:crypto"], allowedPackages = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "import-purity-"));
  roots.push(root);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  return checkImportPurity({ entries: [entry], allowedBuiltins, allowedPackages, root });
}
const rules = (result) => result.findings.map((finding) => `${finding.file}:${finding.line} ${finding.rule}`);
const refused = (source, expected, options) => assert.deepEqual(rules(check({ "entry.ts": source }, options)), expected, source);

describe("builtins are checked against the allowlist, however they are named", () => {
  it("refuses a side-effect import of node:fs", () => refused('import "node:fs";\n', ["entry.ts:1 builtin-not-allowed"]));
  it("refuses single-quoted specifiers", () => refused("import { readFileSync } from 'node:fs';\n", ["entry.ts:1 builtin-not-allowed"]));
  it("refuses bare fs and http", () => refused('import fs from "fs";\nimport * as http from "http";\n', ["entry.ts:1 builtin-not-allowed", "entry.ts:2 builtin-not-allowed"]));
  it("refuses node:http2, node:process, node:vm, node:module and node:worker_threads", () =>
    refused(
      ['import "node:http2";', 'import "node:process";', 'import "node:vm";', 'import "node:module";', 'import "node:worker_threads";'].join("\n"),
      [1, 2, 3, 4, 5].map((line) => `entry.ts:${line} builtin-not-allowed`),
    ));
  it("refuses fs/promises, a builtin of its own", () => refused('import { readFile } from "fs/promises";\n', ["entry.ts:1 builtin-not-allowed"]));
  it("refuses a builtin re-exported, or imported with import = require", () =>
    refused('export { createServer } from "node:net";\nimport dns = require("dns");\n', ["entry.ts:1 builtin-not-allowed", "entry.ts:2 builtin-not-allowed"]));
  it("allows node:crypto and its bare name when node:crypto is allowed", () => refused('import { createHash } from "node:crypto";\nimport c from "crypto";\n', []));
  it("refuses a package unless it is allowed", () => {
    refused('import ts from "typescript";\n', ["entry.ts:1 package-not-allowed"]);
    refused('import ts from "typescript";\n', [], { allowedPackages: ["typescript"] });
  });
});

describe("the import graph is followed", () => {
  it("finds a builtin imported by a module the entry imports, transitively", () => {
    const result = check({
      "entry.ts": 'import { a } from "./a.js";\nexport const x = a;\n',
      "a.ts": 'export { b as a } from "./nested/b.js";\n',
      "nested/b.ts": 'import "node:child_process";\nexport const b = 1;\n',
    });
    assert.deepEqual(rules(result), ["nested/b.ts:1 builtin-not-allowed"]);
    assert.deepEqual(result.visited, ["a.ts", "entry.ts", "nested/b.ts"]);
  });
  it("finds a forbidden global in a transitive module", () =>
    assert.deepEqual(rules(check({ "entry.ts": 'import "./a.js";\n', "a.ts": "export const now = Date.now();\n" })), ["a.ts:1 clock"]));
  it("refuses a relative import that resolves to no file", () => refused('import "./missing.js";\n', ["entry.ts:1 unresolved-import"]));
  it("does not follow a type-only import, which is erased at build time", () =>
    assert.deepEqual(rules(check({ "entry.ts": 'import type { T } from "./types.js";\nexport type U = T;\n', "types.ts": 'import "node:fs";\nexport type T = 1;\n' })), []));
  it("follows an import that is only partly type-only", () =>
    assert.deepEqual(rules(check({ "entry.ts": 'import { type T, v } from "./m.js";\nexport const w: T = v;\n', "m.ts": 'import "node:fs";\nexport type T = number;\nexport const v = 1;\n' })), ["m.ts:1 builtin-not-allowed"]));
});

describe("forbidden globals, by syntax tree", () => {
  it("refuses fetch, even spaced before its parenthesis or reached through globalThis", () => {
    refused('export const r = fetch ("https://example.com");\n', ["entry.ts:1 forbidden-global"]);
    refused('export const r = globalThis.fetch.call(undefined, "https://example.com");\n', ["entry.ts:1 forbidden-global"]);
  });
  it("refuses process, global, window, self and performance", () =>
    refused(
      ["export const a = process.env;", "export const b = global.x;", "export const c = window.x;", "export const d = self.x;", "export const e = performance.now();"].join("\n"),
      [1, 2, 3, 4, 5].map((line) => `entry.ts:${line} forbidden-global`),
    ));
  it("refuses a dynamic import, however its name is built", () => {
    refused('const x = "fs";\nexport const m = import("node:" + x);\n', ["entry.ts:2 dynamic-import"]);
    refused('export const m = import("./a.js");\n', ["entry.ts:1 dynamic-import"]);
  });
  it("refuses require, eval, Function and import.meta", () =>
    refused(
      ['export const a = require("fs");', 'export const b = eval("1");', 'export const c = new Function("return 1");', "export const d = import.meta.url;"].join("\n"),
      ["entry.ts:1 forbidden-global", "entry.ts:2 forbidden-global", "entry.ts:3 forbidden-global", "entry.ts:4 forbidden-global"],
    ));
  it("refuses the timers", () =>
    refused(
      ["setTimeout(() => {}, 1);", "setInterval(() => {}, 1);", "setImmediate(() => {});", "queueMicrotask(() => {});"].join("\n"),
      [1, 2, 3, 4].map((line) => `entry.ts:${line} forbidden-global`),
    ));
  it("refuses the clock: Date.now, Date() and new Date() with no argument, but not new Date(value) or Date.parse", () =>
    refused(
      ["export const a = Date.now();", "export const b = Date();", "export const c = new Date();", "export const d = new Date;", 'export const e = new Date("2026-09-24T00:00:00Z");', 'export const f = Date.parse("2026-09-24");'].join("\n"),
      ["entry.ts:1 clock", "entry.ts:2 clock", "entry.ts:3 clock", "entry.ts:4 clock"],
    ));
  it("refuses randomness: Math.random, randomUUID and getRandomValues, however they are reached", () =>
    refused(
      ['import { randomUUID } from "node:crypto";', "export const a = Math.random();", "export const b = crypto.randomUUID();", "export const c = randomUUID();", "export const d = crypto.getRandomValues(new Uint8Array(1));"].join("\n"),
      ["entry.ts:1 randomness", "entry.ts:2 randomness", "entry.ts:3 randomness", "entry.ts:4 randomness", "entry.ts:5 randomness"],
    ));
  it("refuses a forbidden member read by a literal key", () =>
    refused(['export const a = globalThis["fetch"];', 'export const b = Date["now"]();', 'export const c = Math["random"]();', 'export const d = crypto["randomUUID"]();', 'export const e = o["process"];'].join("\n"),
      ["entry.ts:1 forbidden-global", "entry.ts:1 forbidden-global", "entry.ts:2 clock", "entry.ts:3 randomness", "entry.ts:4 randomness", "entry.ts:5 forbidden-global"]));
  it("refuses a local that shadows a forbidden name", () => refused("export function f(process: number) { return process; }\n", ["entry.ts:1 forbidden-global", "entry.ts:1 forbidden-global"]));
});

describe("what stays allowed", () => {
  it("ignores text that only looks like code: strings containing //, comments, and template text", () =>
    refused(
      ['export const url = "https://example.com//fetch(";', "// fetch(process.env)", "/* import('node:fs') */", "export const t = `setTimeout ${1}`;"].join("\n"),
      [],
    ));
  it("allows the same names as property names and keys", () =>
    refused(['export const o = { fetch: 1, process: 2 };', "export const p = o.fetch + o.process;", "export interface I { random(): number; now: number }", "export const { fetch: renamed } = o;"].join("\n"), []));
  it("reports the file and line of each finding", () => {
    const result = check({ "entry.ts": "\n\nexport const a = Math.random();\n" });
    assert.deepEqual(result.findings, [{ file: "entry.ts", line: 3, rule: "randomness", message: "calls Math.random" }]);
  });
  it("reports an entry that does not exist", () => assert.deepEqual(rules(check({ "other.ts": "" })), ["entry.ts:0 missing-entry"]));
});
