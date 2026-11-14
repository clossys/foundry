import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../records/hash.js";
import { jsonBytes, slotPositions, type IaDoc } from "../records/slot-model/index.js";
import { checkSlotModel } from "../records/slot-check.js";
// Load the CLI first, as every caller does: owner.ts sits in an import cycle with the pipeline handlers.
import "./main.js";
import { RETIRE_SCHEMA, runRetireCli } from "./owner.js";
import { candidateRetires, RETIRE_REASON } from "../constitution/checks/R10-retire.js";
import { buildContext } from "../constitution/context.js";

let workspace: string;
let agents: string;
const ID = "components.synthetic";
const OTHER = "components.other";
const USER = "components.user";
const AT = "2026-11-13T12:00:00.000Z";
const load = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const source = { kind: "original", ref: [] };
const v1 = jsonBytes({ name: "example", type: "registry:item", files: [], meta: { source } });
const v2 = jsonBytes({ name: "example", type: "registry:item", files: [], meta: { source, note: "second" } });

function slot(id: string, ia: IaDoc, refs: { inputs?: string[]; uses?: string[] } = {}) {
  const dir = join(agents, id);
  mkdirSync(join(dir, "candidates"), { recursive: true });
  writeFileSync(join(dir, "slot.json"), jsonBytes({ schema: "clossys.slot/1", id, agent: "designer", ia: slotPositions("designer", ia).get(id), kind: "element", contract: {}, inputs: refs.inputs ?? [], uses: refs.uses ?? [] }));
  writeFileSync(join(dir, "candidates", "example-v1.json"), v1);
  return dir;
}
const pinTo = (id: string, candidate: string, bytes: string) =>
  writeFileSync(join(agents, id, "pin.json"), jsonBytes({ candidate, sha256: sha256Hex(bytes), decidedBy: "owner", basis: "picked", at: AT }));

beforeEach(() => {
  workspace = realpathSync(mkdtempSync(join(tmpdir(), "clossys-retire-")));
  agents = join(workspace, "clossys", "agents", "designer");
  const ia: IaDoc = { schema: "clossys.ia/1", source: "synthetic#fixture", extensions: [], nodes: [{ id: "components", label: "Components", children: [{ id: "group", label: "Group", slots: [ID, OTHER, USER] }] }] };
  mkdirSync(agents, { recursive: true });
  writeFileSync(join(workspace, "clossys", "clossys.config.ts"), "export default {};\n");
  writeFileSync(join(agents, "ia.json"), jsonBytes(ia));
  slot(ID, ia);
  writeFileSync(join(agents, ID, "candidates", "example-v2.json"), v2);
  slot(OTHER, ia);
  slot(USER, ia, { uses: [OTHER] });
  pinTo(ID, "example-v2.json", v2);
});
afterEach(() => rmSync(workspace, { recursive: true, force: true }));

const retire = (...args: string[]) => runRetireCli([...args, "--by", "owner:2026-11-13 retire", "--reason", "superseded: by v2", "--at", AT], workspace);

describe("clossys retire <agent>/<slot> <candidate>", () => {
  it("writes the clossys.retire/1 record and moves the candidate from candidates/ into retired/", async () => {
    const result = await retire(`designer/${ID}`, "example-v1");
    expect(result).toMatchObject({ exitCode: 0 });
    const dir = join(agents, ID);
    expect(existsSync(join(dir, "candidates", "example-v1.json"))).toBe(false);
    expect(readFileSync(join(dir, "retired", "example-v1.json"), "utf8")).toBe(v1);
    expect(load(join(dir, "retired", "example-v1.json.json"))).toEqual({
      schema: RETIRE_SCHEMA, slot: ID, candidate: "example-v1.json", sha256: sha256Hex(v1), by: "owner:2026-11-13 retire", reason: "superseded: by v2", at: AT,
    });
    // The record is one the constitution's R10.1 accepts.
    expect(candidateRetires(buildContext(workspace, join(workspace, "clossys"), { history: () => ({ available: true, changes: new Map(), dirty: new Set() }) }))).toEqual([]);
    // The pin is untouched and still resolves.
    expect(load(join(dir, "pin.json")).candidate).toBe("example-v2.json");
    expect(checkSlotModel(join(workspace, "clossys"))).toEqual([]);
  });

  it("refuses the pinned candidate and changes nothing", async () => {
    const result = await retire(`designer/${ID}`, "example-v2.json");
    expect(result).toMatchObject({ exitCode: 1, message: expect.stringMatching(/pinned candidate .*repin first/) });
    expect(existsSync(join(agents, ID, "candidates", "example-v2.json"))).toBe(true);
    expect(existsSync(join(agents, ID, "retired"))).toBe(false);
  });

  it("refuses the candidate a present but invalid pin.json names", async () => {
    writeFileSync(join(agents, ID, "pin.json"), jsonBytes({ candidate: "example-v1.json", sha256: "not-a-hash" }));
    expect(await retire(`designer/${ID}`, "example-v1")).toMatchObject({ exitCode: 1, message: expect.stringMatching(/pinned candidate/) });
    expect(existsSync(join(agents, ID, "candidates", "example-v1.json"))).toBe(true);
  });

  it("refuses an unknown candidate, an unknown slot and a second retirement", async () => {
    expect(await retire(`designer/${ID}`, "missing-v9")).toMatchObject({ exitCode: 1, message: expect.stringMatching(/has no candidate missing-v9/) });
    expect(await retire("designer/components.nowhere", "example-v1")).toMatchObject({ exitCode: 1, message: expect.stringMatching(/unknown slot/) });
    expect((await retire(`designer/${ID}`, "example-v1")).exitCode).toBe(0);
    expect((await retire(`designer/${ID}`, "example-v1")).exitCode).toBe(1);
  });

  it("requires --by and --reason", async () => {
    await expect(runRetireCli([`designer/${ID}`, "example-v1", "--reason", "x"], workspace)).rejects.toThrow(/--by is required/);
    await expect(runRetireCli([`designer/${ID}`, "example-v1", "--by", "owner"], workspace)).rejects.toThrow(/--reason is required/);
  });

  it("accepts only a closed retire code, optionally followed by \": <note>\" (R10)", async () => {
    for (const reason of ["uncertified", "superseded", "edited-in-place", "not-needed", "duplicate", "shared-split", "duplicate: same bytes as v2", "not-needed:  dropped"]) expect(RETIRE_REASON.test(reason), reason).toBe(true);
    for (const reason of ["superseded by v2", "obsolete", "Superseded", "superseded:", "superseded: ", " superseded", "superseded-ish", "uncertified;note", "x"]) {
      expect(RETIRE_REASON.test(reason), reason).toBe(false);
      await expect(runRetireCli([`designer/${ID}`, "example-v1", "--by", "owner", "--reason", reason, "--at", AT], workspace)).rejects.toThrow(/--reason must be a retire code/);
      await expect(runRetireCli([`designer/${OTHER}`, "--slot", "--by", "owner", "--reason", reason, "--at", AT], workspace)).rejects.toThrow(/--reason must be a retire code/);
    }
    // Nothing moved: the refused calls wrote no record and kept the candidate and the slot.
    expect(existsSync(join(agents, ID, "retired"))).toBe(false);
    expect(existsSync(join(agents, ID, "candidates", "example-v1.json"))).toBe(true);
    expect(load(join(agents, "ia.json")).nodes[0].children[0].slots).toEqual([ID, OTHER, USER]);
    const ok = await runRetireCli([`designer/${ID}`, "example-v1", "--by", "owner", "--reason", "duplicate: same bytes as v2", "--at", AT], workspace);
    expect(ok).toMatchObject({ exitCode: 0 });
    expect(load(join(agents, ID, "retired", "example-v1.json.json")).reason).toBe("duplicate: same bytes as v2");
  });

  it("writes reasons the constitution's retire schema accepts", () => {
    const schema = JSON.parse(readFileSync(new URL("../constitution/schemas/retire.schema.json", import.meta.url), "utf8")) as { properties: { reason: { pattern: string } } };
    const pattern = new RegExp(schema.properties.reason.pattern);
    for (const reason of ["superseded", "duplicate: same bytes", "superseded by v2", "superseded:", "obsolete"]) expect(RETIRE_REASON.test(reason), reason).toBe(pattern.test(reason));
  });
});

describe("clossys retire <agent>/<slot> --slot", () => {
  it("takes the slot out of ia.json, records it in ia.json retired, and moves its folder to _retired/", async () => {
    const before = readFileSync(join(agents, ID, "slot.json"));
    const result = await retire(`designer/${ID}`, "--slot");
    expect(result).toMatchObject({ exitCode: 0 });
    const ia = load(join(agents, "ia.json"));
    expect(ia.nodes[0].children[0].slots).toEqual([OTHER, USER]);
    expect(ia.retired).toEqual([{ schema: RETIRE_SCHEMA, slot: `designer/${ID}`, sha256: sha256Hex(before), by: "owner:2026-11-13 retire", reason: "superseded: by v2", at: AT }]);
    expect(existsSync(join(agents, ID))).toBe(false);
    expect(load(join(agents, "_retired", ID, "pin.json")).candidate).toBe("example-v2.json");
    // The slots after it move up one place, and their slot.json follows.
    expect([OTHER, USER].map(id => load(join(agents, id, "slot.json")).ia.order)).toEqual([0, 1]);
    expect(checkSlotModel(join(workspace, "clossys"))).toEqual([]);
  });

  it("refuses a slot another slot.json uses, and changes nothing", async () => {
    const ia = readFileSync(join(agents, "ia.json"), "utf8");
    const result = await retire(`designer/${OTHER}`, "--slot");
    expect(result).toMatchObject({ exitCode: 1, message: expect.stringMatching(new RegExp(`used by designer/${USER}`)) });
    expect(readFileSync(join(agents, "ia.json"), "utf8")).toBe(ia);
    expect(existsSync(join(agents, OTHER, "slot.json"))).toBe(true);
    expect(existsSync(join(agents, "_retired"))).toBe(false);
  });

  it("refuses a slot a pinned slot takes as an input", async () => {
    const ia = load(join(agents, "ia.json")) as IaDoc;
    const doc = load(join(agents, ID, "slot.json"));
    writeFileSync(join(agents, ID, "slot.json"), jsonBytes({ ...doc, ia: slotPositions("designer", ia).get(ID), inputs: [USER] }));
    const result = await retire(`designer/${USER}`, "--slot");
    expect(result).toMatchObject({ exitCode: 1, message: expect.stringMatching(new RegExp(`pinned slots take designer/${USER} as an input: designer/${ID}`)) });
    expect(existsSync(join(agents, USER, "slot.json"))).toBe(true);
  });

  it("refuses a slot not in ia.json and takes no candidate with --slot", async () => {
    expect(await retire("designer/components.nowhere", "--slot")).toMatchObject({ exitCode: 1, message: expect.stringMatching(/not in designer ia.json/) });
    await expect(runRetireCli([`designer/${ID}`, "example-v1", "--slot", "--by", "owner", "--reason", "x"], workspace)).rejects.toThrow(/retire takes/);
  });
});
