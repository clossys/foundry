import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "./hash.js";
import { jsonBytes, slotPositions, type IaDoc } from "./slot-model/index.js";
import { checkSlotModel } from "./slot-check.js";
// Load the CLI first, as every caller does.
import "../cli/main.js";
import { runRetireCli } from "../cli/owner.js";

const ID = "components.synthetic";
const AT = "2026-11-14T12:00:00.000Z";
const source = { kind: "original", ref: [] };
const v1 = jsonBytes({ name: "example", type: "registry:item", files: [], meta: { source } });
const v2 = jsonBytes({ name: "example", type: "registry:item", files: [], meta: { source, note: "second" } });
let workspace: string, consumer: string, dir: string;

beforeEach(() => {
  workspace = realpathSync(mkdtempSync(join(tmpdir(), "clossys-slot-retired-")));
  consumer = join(workspace, "clossys");
  const agents = join(consumer, "agents", "designer");
  const ia: IaDoc = { schema: "clossys.ia/1", source: "synthetic#fixture", extensions: [], nodes: [{ id: "components", label: "Components", children: [{ id: "group", label: "Group", slots: [ID] }] }] };
  dir = join(agents, ID);
  mkdirSync(join(dir, "candidates"), { recursive: true });
  writeFileSync(join(consumer, "clossys.config.ts"), "export default {};\n");
  writeFileSync(join(agents, "ia.json"), jsonBytes(ia));
  writeFileSync(join(dir, "slot.json"), jsonBytes({ schema: "clossys.slot/1", id: ID, agent: "designer", ia: slotPositions("designer", ia).get(ID), kind: "element", contract: {}, inputs: [], uses: [] }));
  writeFileSync(join(dir, "candidates", "example-v1.json"), v1);
  writeFileSync(join(dir, "candidates", "example-v2.json"), v2);
  writeFileSync(join(dir, "pin.json"), jsonBytes({ candidate: "example-v2.json", sha256: sha256Hex(v2), decidedBy: "owner", basis: "picked", at: AT }));
});
afterEach(() => rmSync(workspace, { recursive: true, force: true }));

const rel = `agents/designer/${ID}`;
const issues = () => checkSlotModel(consumer);
async function retireV1() {
  const result = await runRetireCli([`designer/${ID}`, "example-v1", "--by", "agent:designer", "--reason", "superseded: by v2", "--at", AT], workspace);
  expect(result).toMatchObject({ exitCode: 0 });
}
const record = () => join(dir, "retired", "example-v1.json.json");
const edit = (change: (value: Record<string, unknown>) => void) => {
  const value = JSON.parse(readFileSync(record(), "utf8")) as Record<string, unknown>;
  change(value);
  writeFileSync(record(), jsonBytes(value));
};

describe("check --slots: a slot's retired/ folder", () => {
  it("accepts retired/ as clossys retire writes it", async () => {
    expect(issues()).toEqual([]);
    await retireV1();
    expect(issues()).toEqual([]);
  });

  it("still fails any other unexpected entry in a slot folder, a folder included", async () => {
    await retireV1();
    mkdirSync(join(dir, "drafts"));
    writeFileSync(join(dir, "notes.md"), "x\n");
    expect(issues()).toEqual([
      { code: "orphan", path: `${rel}/drafts`, message: `unexpected entry in slot folder ${ID}` },
      { code: "orphan", path: `${rel}/notes.md`, message: `unexpected entry in slot folder ${ID}` },
    ]);
  });

  it("fails a retired file that is not a folder", () => {
    writeFileSync(join(dir, "retired"), "x\n");
    expect(issues()).toEqual([{ code: "orphan", path: `${rel}/retired`, message: `unexpected entry in slot folder ${ID}` }]);
  });

  it("fails an unexpected entry inside retired/", async () => {
    await retireV1();
    writeFileSync(join(dir, "retired", "README.md"), "x\n");
    mkdirSync(join(dir, "retired", "old"));
    expect(issues().map(issue => [issue.code, issue.path])).toEqual([
      ["orphan", `${rel}/retired/README.md`],
      ["orphan", `${rel}/retired/old`],
    ]);
  });

  it("fails a malformed retire record", async () => {
    await retireV1();
    writeFileSync(record(), "not json\n");
    expect(issues()).toEqual([{ code: "retired-invalid", path: `${rel}/retired/example-v1.json.json`, message: "retire record is not a readable JSON file" }]);
  });

  it("fails a record outside the retire schema (reason code, extra key)", async () => {
    await retireV1();
    edit(value => { value.reason = "because"; value.extra = true; });
    expect(issues()).toEqual([expect.objectContaining({ code: "retired-invalid", path: `${rel}/retired/example-v1.json.json`, message: expect.stringMatching(/^retire record invalid: .*reason/) })]);
  });

  it("fails a record naming another slot or candidate", async () => {
    await retireV1();
    edit(value => { value.slot = "components.other"; });
    expect(issues()[0]).toMatchObject({ code: "retired-invalid", message: expect.stringContaining("is not this slot") });
    edit(value => { value.slot = ID; value.candidate = "example-v9.json"; });
    expect(issues()[0]).toMatchObject({ code: "retired-invalid", message: expect.stringContaining("the record's file name") });
  });

  it("fails retired bytes that do not match the record, and a record with no candidate beside it", async () => {
    await retireV1();
    writeFileSync(join(dir, "retired", "example-v1.json"), v2);
    expect(issues()).toEqual([expect.objectContaining({ code: "retired-invalid", message: expect.stringContaining("bytes do not match the record sha256") })]);
    rmSync(join(dir, "retired", "example-v1.json"));
    expect(issues()).toEqual([expect.objectContaining({ code: "retired-invalid", message: expect.stringContaining("is not beside its record") })]);
  });

  it("fails a retired candidate with no record, and one still in candidates/", async () => {
    await retireV1();
    writeFileSync(join(dir, "candidates", "example-v1.json"), v1);
    expect(issues()).toEqual([expect.objectContaining({ code: "retired-invalid", message: expect.stringContaining("is still in candidates/") })]);
    rmSync(join(dir, "candidates", "example-v1.json"));
    rmSync(record());
    expect(issues()).toEqual([{ code: "retired-invalid", path: `${rel}/retired/example-v1.json`, message: "retired candidate example-v1.json has no retire record example-v1.json.json" }]);
  });
});
