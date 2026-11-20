import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
