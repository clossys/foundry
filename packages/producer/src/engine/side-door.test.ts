import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseArgs } from "../cli/args.js";
import { runCheck } from "../cli/check.js";
import { formatSideDoor, isEnginePathString, sideDoorFiles, sideDoorFindings } from "./side-door.js";

let root: string;
const put = (rel: string, text: string) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const found = () => sideDoorFindings(root).map(finding => `${finding.file}:${finding.line} ${finding.kind} ${finding.call}`);

beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), "engine-side-door-"))); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("engine.side-door (engine/side-door.ts)", () => {
  it("fires on a fixture write to the event log outside the engine API", () => {
    put("packages/writer/src/leak.mjs", [
      "import { appendFileSync } from \"node:fs\";",
      "import { join } from \"node:path\";",
      "export const leak = root => appendFileSync(join(root, \".clossys\", \"events.jsonl\"), \"{}\\n\");",
    ].join("\n"));
    expect(found()).toEqual(["packages/writer/src/leak.mjs:3 write appendFileSync"]);
  });

  it("fires on a slot-record write through a path helper, a derived local and a write wrapper", () => {
    put("packages/designer/src/wrap.ts", [
      "import { writeFileSync } from \"node:fs\";",
      "export function save(path: string, text: string) { writeFileSync(path, text); }",
    ].join("\n"));
    put("packages/designer/src/use.ts", [
      "import { writeFileSync } from \"node:fs\";",
      "import { join } from \"node:path\";",
      "import { slotDir } from \"@clossys/producer/records/slots\";",
      "import { save } from \"./wrap.js\";",
      "export function pinIt(consumer: string, id: string) {",
      "  const file = join(slotDir(consumer, \"designer\", id), \"pin.json\");",
      "  writeFileSync(file, \"{}\");",
      "  save(join(consumer, \"agents\", \"designer\", id, \"slot.json\"), \"{}\");",
      "}",
    ].join("\n"));
    expect(found()).toEqual(["packages/designer/src/use.ts:7 write writeFileSync", "packages/designer/src/use.ts:8 sink save"]);
  });

  it("fires on a script that calls a record writer directly, and on an unpaired slot-model primitive", () => {
    put("packages/writer/scripts/lift.mjs", "import { writeCandidate } from \"../../producer/src/records/slot-write.js\";\nwriteCandidate(\"c\", \"writer\", \"id\", \"n\", \"b\", {});\n");
    put("packages/producer/src/migrate/move.ts", "import { moveModelEntry } from \"../records/slot-write.js\";\nexport const move = (a: string, b: string) => moveModelEntry(a, b);\n");
    expect(found()).toEqual(["packages/producer/src/migrate/move.ts:2 unpaired moveModelEntry", "packages/writer/scripts/lift.mjs:2 script writeCandidate"]);
  });

  it("passes the engine surface, writes off engine paths, tests and fixtures", () => {
    put("packages/producer/src/engine/log.ts", "import { appendFileSync } from \"node:fs\";\nexport const log = (root: string) => appendFileSync(root + \"/.clossys/events.jsonl\", \"\");\n");
    put("packages/producer/src/records/slot-write.ts", [
      "import { writeFileSync } from \"node:fs\";",
      "const slotLocked = <T>(dir: string, action: () => T): T => action();",
      "export const w = (dir: string) => slotLocked(dir, () => writeFileSync(dir + \"/slot.json\", \"{}\"));",
    ].join("\n"));
    put("packages/writer/src/report.mjs", "import { writeFileSync } from \"node:fs\";\nexport const r = out => writeFileSync(out + \"/report.json\", \"{}\");\n");
    put("packages/writer/src/leak.test.mjs", "import { writeFileSync } from \"node:fs\";\nwriteFileSync(\".clossys/index.json\", \"{}\");\n");
    put("packages/writer/src/fixtures/leak.mjs", "import { writeFileSync } from \"node:fs\";\nwriteFileSync(\".clossys/index.json\", \"{}\");\n");
    put("packages/other/src/leak.mjs", "import { writeFileSync } from \"node:fs\";\nwriteFileSync(\".clossys/index.json\", \"{}\");\n");
    expect(found()).toEqual([]);
    expect(sideDoorFiles(root)).toEqual(["packages/producer/src/engine/log.ts", "packages/producer/src/records/slot-write.ts", "packages/writer/src/report.mjs"]);
  });

  it("fires on a .clossys write from a file under src/build/, and skips build output only at the package root", () => {
    const leak = "import { writeFileSync } from \"node:fs\";\nexport const d = (root: string) => writeFileSync(root + \"/.clossys/events.jsonl\", \"\");\n";
    put("packages/publisher/src/build/d.ts", leak);
    put("packages/designer/src/build/theme/d.ts", leak);
    put("packages/publisher/build/d.js", leak);
    put("packages/designer/dist/build/d.js", leak);
    expect(found()).toEqual(["packages/designer/src/build/theme/d.ts:2 write writeFileSync", "packages/publisher/src/build/d.ts:2 write writeFileSync"]);
    expect(sideDoorFiles(root)).toEqual(["packages/designer/src/build/theme/d.ts", "packages/publisher/src/build/d.ts"]);
  });

  it("fires on a child-process call whose arguments name .clossys: named, renamed, namespace, require and split forms", () => {
    put("packages/producer/src/shell.ts", [
      "import { execSync, spawnSync as run } from \"node:child_process\";",
      "import * as cp from \"child_process\";",
      "const { execFileSync } = require(\"node:child_process\");",
      "const LOG = \".clos\" + \"sys/events.jsonl\";",
      "export const a = () => execSync(\"echo x >> .clossys/events.jsonl\");",
      "export const b = () => run(\"sh\", [\"-c\", `echo x > ${\".clossys\"}/index.json`]);",
      "export const c = () => cp.exec(\"touch \" + LOG);",
      "export const d = () => execFileSync(\"rm\", [\"-f\", \".clossys/engine.lock\"]);",
      "export const e = () => require(\"child_process\").spawn(\"git\", [\"status\"]);",
      "export const f = () => execSync(\"git status\");",
    ].join("\n"));
    put("packages/producer/src/engine/shell.ts", "import { execSync } from \"node:child_process\";\nexport const ok = () => execSync(\"echo x >> .clossys/events.jsonl\");\n");
    expect(found()).toEqual([
      "packages/producer/src/shell.ts:5 exec execSync",
      "packages/producer/src/shell.ts:6 exec spawnSync",
      "packages/producer/src/shell.ts:7 exec exec",
      "packages/producer/src/shell.ts:8 exec execFileSync",
    ]);
  });

  it("fires on a shell or hook file in scope that names .clossys, and reads no other non-code file", () => {
    put("scripts/leak.sh", "#!/bin/sh\nset -e\necho x >> .clossys/events.jsonl\n");
    put("scripts/githooks/pre-push", "#!/bin/sh\n# guard\ncat .clossys/index.json > /dev/null\n");
    put("packages/writer/scripts/run", "echo x > .clossys/engine.lock\n");
    chmodSync(join(root, "packages/writer/scripts/run"), 0o755);
    put("packages/designer/src/vendor/LICENSE", "see .clossys/notes\n");
    put("packages/designer/src/notes.md", "write .clossys/events.jsonl\n");
    put("scripts/fixtures/leak.sh", "echo x >> .clossys/events.jsonl\n");
    put("scripts/clean.sh", "#!/bin/sh\nrm -rf dist\n");
    expect(found()).toEqual(["packages/writer/scripts/run:1 shell shell", "scripts/githooks/pre-push:3 shell shell", "scripts/leak.sh:3 shell shell"]);
  });

  it("fires on writes whose path comes from an imported engine constant: named, renamed, namespace, re-exported and derived", () => {
    put("packages/producer/src/engine/chain.ts", [
      "export const ENGINE_DIR = \".clossys\";",
      "export const EVENTS_FILE = `${ENGINE_DIR}/events.jsonl`;",
      "export const INDEX_FILE = `${ENGINE_DIR}/index.json`;",
      "export const CONSUMER_DIR = \"clossys\";",
      "import { join } from \"node:path\";",
      "export const EVENTS_PATH = join(process.cwd(), ENGINE_DIR, \"events.jsonl\");",
    ].join("\n"));
    put("packages/producer/src/engine/index.ts", "export * from \"./chain.js\";\n");
    put("packages/producer/src/records/ledger.ts", "export const LEDGER_FILE = \"ledger.json\";\nconst SLOT = \"slot.json\";\nexport { SLOT as SLOT_FILE };\n");
    put("packages/producer/src/records/barrel.ts", "export { LEDGER_FILE as LEDGER } from \"./ledger.js\";\n");
    put("packages/writer/src/leaks.ts", [
      "import { appendFileSync, writeFileSync } from \"node:fs\";",
      "import { join } from \"node:path\";",
      "import { EVENTS_FILE, EVENTS_PATH } from \"../../producer/src/engine/chain.js\";",
      "import { INDEX_FILE as INDEX, CONSUMER_DIR } from \"../../producer/src/engine/index.js\";",
      "import * as ledger from \"../../producer/src/records/ledger.js\";",
      "import { LEDGER, } from \"../../producer/src/records/barrel.js\";",
      "import { SLOT_FILE } from \"../../producer/src/records/ledger.js\";",
      "export function leaks(root: string, dir: string) {",
      "  appendFileSync(join(root, EVENTS_FILE), \"{}\\n\");",
      "  writeFileSync(join(root, INDEX), \"{}\");",
      "  writeFileSync(join(dir, ledger.LEDGER_FILE), \"{}\");",
      "  const file = join(dir, LEDGER);",
      "  writeFileSync(file, \"{}\");",
      "  writeFileSync(join(dir, SLOT_FILE), \"{}\");",
      "  writeFileSync(join(root, CONSUMER_DIR, \"agents\", \"writer\", \"x\"), \"{}\");",
      "  writeFileSync(join(root, CONSUMER_DIR, \"report.json\"), \"{}\");",
      "  writeFileSync(EVENTS_PATH, \"{}\");",
      "}",
    ].join("\n"));
    expect(found()).toEqual([9, 10, 11, 13, 14, 15, 17].map(line => `packages/writer/src/leaks.ts:${line} write ${line === 9 ? "appendFileSync" : "writeFileSync"}`));
  });

  it("fires on a path string split across concatenation, templates, join or resolve segments and array joins", () => {
    put("packages/designer/src/split.ts", [
      "import { writeFileSync, mkdirSync } from \"node:fs\";",
      "import { join, resolve } from \"node:path\";",
      "const DOT = \".clos\";",
      "const ENGINE = DOT + \"sys\";",
      "export function split(root: string, id: string) {",
      "  writeFileSync(root + \"/.clos\" + \"sys/index.json\", \"{}\");",
      "  writeFileSync(`${root}/${\".clos\"}sys/events.jsonl`, \"{}\");",
      "  mkdirSync(join(root, ENGINE, \"checks\"));",
      "  writeFileSync(join(root, \"agents\", \"designer\", id), \"{}\");",
      "  writeFileSync(resolve(root, \"clossys\", \"agents\", \"writer\"), \"{}\");",
      "  writeFileSync([root, \"agents\", \"director\", \"ia.js\" + \"on\"].join(\"/\"), \"{}\");",
      "  writeFileSync(join(root, \"agents\", id), \"{}\");",
      "  writeFileSync(join(root, \".clos\" + id), \"{}\");",
      "}",
    ].join("\n"));
    expect(found()).toEqual([6, 7, 8, 9, 10, 11].map(line => `packages/designer/src/split.ts:${line} write ${line === 8 ? "mkdirSync" : "writeFileSync"}`));
  });

  it("proves slot-write.ts per call: writes inside a record transaction pass, every other write is a finding", () => {
    put("packages/producer/src/records/slot-write.ts", [
      "import { writeFileSync, rmSync, openSync, unlinkSync } from \"node:fs\";",
      "import { join } from \"node:path\";",
      "import { deferEvents } from \"../engine/log.js\";",
      "function withDirLock<T>(lock: string, why: string, action: () => T): T { openSync(lock, \"wx\"); try { return deferEvents(action); } finally { unlinkSync(lock); } }",
      "const slotLocked = <T>(dir: string, action: () => T): T => withDirLock(join(dir, \".slot-write.lock\"), \"busy\", action);",
      "export function replaceModelFile(path: string, text: string) { writeFileSync(path, text); }",
      "function writeLedger(dir: string) { writeFileSync(join(dir, \"ledger.json\"), \"{}\"); }",
      "function helperOutside(dir: string) { writeFileSync(join(dir, \"pin.json\"), \"{}\"); }",
      "export function inTx(dir: string) { slotLocked(dir, () => { writeFileSync(join(dir, \"slot.json\"), \"{}\"); writeLedger(dir); }); }",
      "export function viaDefer(dir: string) { deferEvents(() => rmSync(join(dir, \"candidates\"), { recursive: true })); }",
      "export function outside(dir: string) { writeFileSync(join(dir, \"slot.json\"), \"{}\"); helperOutside(dir); }",
      "export function mixed(dir: string) { slotLocked(dir, () => helperOutside(dir)); }",
      "export function asValue(dir: string) { slotLocked(dir, writeLedger.bind(null, dir)); }",
    ].join("\n"));
    expect(found()).toEqual(["packages/producer/src/records/slot-write.ts:8 write writeFileSync", "packages/producer/src/records/slot-write.ts:11 write writeFileSync"]);
  });

  it("fires on a call to a same-file write wrapper that hands it an engine or slot-record path", () => {
    put("packages/writer/src/local.ts", [
      "import { writeFileSync, renameSync } from \"node:fs\";",
      "import { join } from \"node:path\";",
      "function writeAtomic(path: string, text: string) { writeFileSync(`${path}.tmp`, text); renameSync(`${path}.tmp`, path); }",
      "const writeJson = (file: string, value: unknown) => writeAtomic(file, JSON.stringify(value));",
      "export function save(root: string, id: string) {",
      "  writeAtomic(join(root, \"agents\", \"writer\", id, \"pin.json\"), \"{}\");",
      "  writeJson(join(root, \".clossys\", \"index.json\"), {});",
      "  writeJson(join(root, \"out\", id), {});",
      "}",
    ].join("\n"));
    expect(found()).toEqual(["packages/writer/src/local.ts:6 sink writeAtomic", "packages/writer/src/local.ts:7 sink writeJson"]);
  });

  // Each TypeScript wrapper around the fs binding: the cast must not hide the namespace.
  for (const [form, init] of [
    ["as", "require(\"node:fs\") as typeof import(\"node:fs\")"],
    ["satisfies", "require(\"node:fs\") satisfies object"],
    ["parentheses", "(require(\"node:fs\"))"],
    ["non-null", "require(\"node:fs\")!"],
    ["type assertion", "<typeof import(\"node:fs\")>require(\"node:fs\")"],
    ["nested", "((<any>require(\"node:fs\"))! as typeof import(\"node:fs\"))"],
  ] as const) {
    it(`fires on a write through an fs binding wrapped in ${form}`, () => {
      put("packages/producer/src/pipeline/cast.ts", [
        "import { join } from \"node:path\";",
        `const fs = ${init};`,
        "export const save = (root: string) => fs.writeFileSync(join(root, \".clossys\", \"runs\", \"a.jsonl\"), \"\");",
      ].join("\n"));
      expect(found()).toEqual(["packages/producer/src/pipeline/cast.ts:3 write writeFileSync"]);
    });
  }

  it("fires through wrappers around the callee, its receiver, the path and a wrapper call", () => {
    put("packages/writer/src/wrapped.ts", [
      "import * as fs from \"node:fs\";",
      "import { join } from \"node:path\";",
      "import { slotDir } from \"@clossys/producer/records/slots\";",
      "const save = (path: string) => fs.writeFileSync(path, \"\");",
      "export function go(root: string, id: string) {",
      "  (fs as any).writeFileSync(join(root, \".clossys\", \"a\"), \"\");",
      "  (fs.rmSync)(join(root, \".clossys\", \"b\") as string);",
      "  fs.mkdirSync!((<string>join(root, \".clossys\"))!);",
      "  (<typeof fs>fs).appendFileSync(<string>\".clos\" + \"sys/c\", \"\");",
      "  fs.writeFileSync(join((slotDir as any)(root, \"writer\", id), \"x\"), \"\");",
      "  (save satisfies (path: string) => void)(join(root, \"agents\", \"writer\", id, \"pin.json\"));",
      "  fs.writeFileSync(join(root, \"out\") as string, \"\");",
      "}",
    ].join("\n"));
    expect(found()).toEqual([
      "packages/writer/src/wrapped.ts:6 write writeFileSync",
      "packages/writer/src/wrapped.ts:7 write rmSync",
      "packages/writer/src/wrapped.ts:8 write mkdirSync",
      "packages/writer/src/wrapped.ts:9 write appendFileSync",
      "packages/writer/src/wrapped.ts:10 write writeFileSync",
      "packages/writer/src/wrapped.ts:11 sink save",
    ]);
  });

  it("fires through the other fs alias forms: import-equals, createRequire, inline require, re-binding, members and element access", () => {
    put("packages/producer/src/loop/alias.ts", [
      "import * as fs from \"node:fs\";",
      "import { createRequire } from \"node:module\";",
      "import fs1 = require(\"node:fs\");",
      "const load = createRequire(import.meta.url);",
      "const fs2 = load(\"node:fs\") as typeof fs;",
      "const fs3 = fs as any;",
      "const { writeFileSync: put, promises: fsp } = fs;",
      "const remove = (fs.rmSync)!;",
      "const P = \".clossys/x\";",
      "export async function go() {",
      "  fs1.writeFileSync(P, \"\");",
      "  fs2.writeFileSync(P, \"\");",
      "  fs3.writeFileSync(P, \"\");",
      "  put(P, \"\");",
      "  await fsp.writeFile(P, \"\");",
      "  remove(P);",
      "  fs[\"renameSync\"](P, P);",
      "  require(\"node:fs\").unlinkSync(P);",
      "  (await import(\"node:fs\")).default.writeFileSync(P, \"\");",
      "  fs.openSync(P, \"a\" as string);",
      "  fs.openSync(P, \"r\" as const);",
      "}",
    ].join("\n"));
    expect(found()).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map(line => `packages/producer/src/loop/alias.ts:${line} write ${
      ["writeFileSync", "writeFileSync", "writeFileSync", "writeFileSync", "writeFile", "rmSync", "renameSync", "unlinkSync", "writeFileSync", "openSync"][line - 11]}`));
  });

  it("fires through a choice between fs functions, a re-bound named import and an object-literal write wrapper", () => {
    put("packages/producer/src/pipeline/store.ts", [
      "import { createRequire } from \"node:module\";",
      "import { writeFileSync } from \"node:fs\";",
      "const require = createRequire(import.meta.url);",
      "const fs = require(\"node:fs\") as typeof import(\"node:fs\");",
      "const state: { originals?: Partial<typeof fs> } = {};",
      "const raw = {",
      "  rename: (from: string, to: string) => ((state.originals?.renameSync ?? fs.renameSync) as typeof fs.renameSync)(from, to),",
      "  write(path: string) { (path ? fs.writeFileSync : undefined)!(path, \"\"); },",
      "  remove: (<(path: string) => void>((path: string) => fs.rmSync(path))),",
      "};",
      "const w = writeFileSync;",
      "export function store(root: string) {",
      "  raw.rename(root + \"/.clossys/runs/a.tmp\", root + \"/.clossys/runs/a.jsonl\");",
      "  raw.write(`${root}/.clossys/runs/b`);",
      "  raw.remove(`${root}/.clossys/runs/c`);",
      "  w(`${root}/.clossys/x`, \"\");",
      "  raw.rename(root + \"/out/a\", root + \"/out/b\");",
      "}",
    ].join("\n"));
    expect(found()).toEqual([
      "packages/producer/src/pipeline/store.ts:13 sink rename",
      "packages/producer/src/pipeline/store.ts:14 sink write",
      "packages/producer/src/pipeline/store.ts:15 sink remove",
      "packages/producer/src/pipeline/store.ts:16 write writeFileSync",
    ]);
  });

  it("fires through write wrappers and path helpers whose function is wrapped in a cast: exported, local and imported", () => {
    put("packages/writer/src/cast-wrap.ts", [
      "import { writeFileSync } from \"node:fs\";",
      "import { join } from \"node:path\";",
      "export const save = ((path: string) => writeFileSync(path, \"\")) as (path: string) => void;",
      "export const runsDir = ((root: string) => join(root, \".clossys\", \"runs\")) satisfies (root: string) => string;",
      "const local = (<(path: string) => void>((path: string) => writeFileSync(path, \"\")));",
      "export const go = (root: string) => local(join(root, \".clossys\", \"y\"));",
    ].join("\n"));
    put("packages/writer/src/cast-use.ts", [
      "import { writeFileSync } from \"node:fs\";",
      "import { runsDir, save } from \"./cast-wrap.js\";",
      "export const go = (root: string) => save(root + \"/.clossys/x\");",
      "export const log = (root: string) => writeFileSync(runsDir(root) + \"/a.jsonl\", \"\");",
    ].join("\n"));
    expect(found()).toEqual(["packages/writer/src/cast-use.ts:3 sink save", "packages/writer/src/cast-use.ts:4 write writeFileSync", "packages/writer/src/cast-wrap.ts:6 sink local"]);
  });

  it("matches engine path strings", () => {
    for (const text of [".clossys/events.jsonl", "x/.clossys", "agents/designer/hero/pin.json", "clossys/agents/writer", "candidates/a.md", "ledger.json"]) expect(isEnginePathString(text), text).toBe(true);
    for (const text of ["dist/out.json", "clossys-site", "report.md", ".clossysrc"]) expect(isEnginePathString(text), text).toBe(false);
  });

  it("runs as clossys check --side-door: exit 1 with one line per finding, exit 0 on a clean tree", async () => {
    put("packages/writer/src/leak.mjs", "import { writeFileSync } from \"node:fs\";\nexport const leak = () => writeFileSync(\".clossys/index.json\", \"{}\");\n");
    const failed = await runCheck(parseArgs(["check", "--side-door", "--root", root]), root);
    expect(failed).toMatchObject({ exitCode: 1, output: { check: "engine.side-door", ok: false } });
    expect(failed.message).toBe(formatSideDoor(sideDoorFindings(root)));
    expect(failed.message).toMatch(/^engine\.side-door: fail \(1\)\n {2}packages\/writer\/src\/leak\.mjs:2 write writeFileSync: writes an engine or slot-record path outside the engine API/);
    rmSync(join(root, "packages"), { recursive: true });
    expect(await runCheck(parseArgs(["check", "--side-door", "--root", root]), root)).toMatchObject({ exitCode: 0, message: "engine.side-door: pass" });
  });

  it("fails the registered fixture through the built CLI (rule R-ENGINE-SIDE-DOOR)", () => {
    const repo = fileURLToPath(new URL("../../../../", import.meta.url));
    const fixture = join(repo, "scripts", "rules", "fixtures", "R-ENGINE-SIDE-DOOR");
    const cli = join(repo, "packages", "producer", "dist", "cli", "index.js");
    const result = spawnSync(process.execPath, [cli, "check", "--side-door", "--root", fixture], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/packages\/writer\/src\/side-door\.mjs:6 write appendFileSync: writes an engine or slot-record path outside the engine API/);
  }, 30_000);
});
