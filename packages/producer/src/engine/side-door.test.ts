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
    put("packages/producer/src/records/slot-write.ts", "import { writeFileSync } from \"node:fs\";\nexport const w = (dir: string) => writeFileSync(dir + \"/slot.json\", \"{}\");\n");
    put("packages/writer/src/report.mjs", "import { writeFileSync } from \"node:fs\";\nexport const r = out => writeFileSync(out + \"/report.json\", \"{}\");\n");
    put("packages/writer/src/leak.test.mjs", "import { writeFileSync } from \"node:fs\";\nwriteFileSync(\".clossys/index.json\", \"{}\");\n");
    put("packages/writer/src/fixtures/leak.mjs", "import { writeFileSync } from \"node:fs\";\nwriteFileSync(\".clossys/index.json\", \"{}\");\n");
    put("packages/other/src/leak.mjs", "import { writeFileSync } from \"node:fs\";\nwriteFileSync(\".clossys/index.json\", \"{}\");\n");
    expect(found()).toEqual([]);
    expect(sideDoorFiles(root)).toEqual(["packages/producer/src/engine/log.ts", "packages/producer/src/records/slot-write.ts", "packages/writer/src/report.mjs"]);
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
