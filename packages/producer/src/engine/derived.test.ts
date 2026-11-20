import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseArgs } from "../cli/args.js";
import { runCheck } from "../cli/check.js";
import { runIndexCli } from "../cli/index-verb.js";
import { EVENTS_FILE, INDEX_FILE, sha256 } from "./chain.js";
import { runEngineCheck } from "./check.js";
import { compareIndex, computeIndex, indexAgreement, readIndex, recordDrift, type EngineIndex } from "./derived.js";
import { rebuildIndex, recordEvent } from "./log.js";

let root: string;
const slotDir = (n: number) => join(root, "clossys", "agents", "writer", `copy.slot-${n}`);
const record = (n: number, text: string) => {
  mkdirSync(slotDir(n), { recursive: true });
  const path = join(slotDir(n), "pin.json");
  writeFileSync(path, text);
  return recordEvent([path], { actor: "code:test", kind: "pin.write", subject: `writer/copy.slot-${n}` });
};
const stored = () => JSON.parse(readFileSync(join(root, INDEX_FILE), "utf8")) as EngineIndex;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "engine-index-")));
  mkdirSync(join(root, "clossys", "agents", "writer"), { recursive: true });
  writeFileSync(join(root, "clossys", "clossys.config.ts"), "export default {};\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("derived index (engine/derived.ts)", () => {
  it("keeps the index equal to a rebuild from the log plus the records", () => {
    record(1, "{\"v\":1}\n");
    record(2, "{\"v\":1}\n");
    record(1, "{\"v\":2}\n");
    const kept = stored();
    const rebuilt = rebuildIndex(root);
    expect(rebuilt).toEqual(kept);
    expect(stored()).toEqual(kept);
    expect(computeIndex(root)).toEqual(kept);
    expect(kept).toMatchObject({ events: 3, subjects: { "writer/copy.slot-1": { seq: 2, kind: "pin.write" }, "writer/copy.slot-2": { seq: 1 } } });
    expect(kept.records["clossys/agents/writer/copy.slot-1/pin.json"]).toEqual({ seq: 2, logged: sha256("{\"v\":2}\n"), disk: sha256("{\"v\":2}\n") });
    expect(indexAgreement(root)).toMatchObject({ present: true, agrees: true, diffs: [] });
    expect(runEngineCheck(root)).toMatchObject({ ok: true, events: 3, chain: [], index: [], drift: [] });
  });

  it("fails agreement when the stored index disagrees with a rebuild", () => {
    record(1, "a");
    record(2, "b");
    const doc = stored();
    writeFileSync(join(root, INDEX_FILE), JSON.stringify({ ...doc, subjects: { ...doc.subjects, "writer/copy.slot-2": { ...doc.subjects["writer/copy.slot-2"]!, actor: "owner" } } }));
    const agreement = indexAgreement(root);
    expect(agreement.agrees).toBe(false);
    expect(agreement.diffs).toEqual([expect.stringMatching(/^subjects\[writer\/copy\.slot-2\]: index .*"actor":"owner".*, rebuild .*"actor":"code:test"/)]);
    expect(compareIndex(readIndex(root).index!, computeIndex(root))).toHaveLength(1);
    expect(runEngineCheck(root).ok).toBe(false);
    rebuildIndex(root);
    expect(indexAgreement(root).agrees).toBe(true);
  });

  it("notices a removed tail event through the index head, and a missing index", () => {
    record(1, "a");
    record(2, "b");
    const text = readFileSync(join(root, EVENTS_FILE), "utf8").split("\n");
    writeFileSync(join(root, EVENTS_FILE), `${text[0]}\n`);
    const agreement = indexAgreement(root);
    expect(agreement.agrees).toBe(false);
    expect(agreement.diffs).toEqual(expect.arrayContaining([expect.stringMatching(/^events: index 2, rebuild 1/), expect.stringMatching(/^head: /)]));
    rmSync(join(root, INDEX_FILE));
    expect(indexAgreement(root)).toMatchObject({ present: false, agrees: false, diffs: [`${INDEX_FILE} is missing while the log holds 1 event(s)`] });
  });

  it("reports drift when a record's bytes change outside the engine", () => {
    record(1, "a");
    writeFileSync(join(slotDir(1), "pin.json"), "edited by hand");
    expect(indexAgreement(root).agrees).toBe(false);
    rebuildIndex(root);
    expect(indexAgreement(root).agrees).toBe(true);
    const drift = recordDrift(computeIndex(root));
    expect(drift).toEqual([`clossys/agents/writer/copy.slot-1/pin.json: last logged ${sha256("a")} at seq 0, on disk ${sha256("edited by hand")}`]);
    expect(runEngineCheck(root)).toMatchObject({ ok: false, drift });
  });

  it("refuses to rebuild from a broken chain", () => {
    record(1, "a");
    record(2, "b");
    const lines = readFileSync(join(root, EVENTS_FILE), "utf8").split("\n");
    writeFileSync(join(root, EVENTS_FILE), `${lines[1]}\n${lines[0]}\n`);
    const before = readFileSync(join(root, INDEX_FILE), "utf8");
    expect(() => rebuildIndex(root)).toThrow(/the event log does not verify/);
    expect(readFileSync(join(root, INDEX_FILE), "utf8")).toBe(before);
  });
});

describe("clossys index and clossys check --engine (cli)", () => {
  it("index compares, index --rebuild restores, check --engine passes and fails on the workspace", async () => {
    record(1, "a");
    writeFileSync(join(root, INDEX_FILE), "{}");
    expect(await runIndexCli(["--root", root], root)).toMatchObject({ exitCode: 1, message: expect.stringMatching(/^index: disagrees/) });
    expect((await runCheck(parseArgs(["check", "--engine", "--root", root]), root)).exitCode).toBe(1);
    expect(await runIndexCli(["--rebuild", "--root", join(root, "clossys")], root)).toMatchObject({ exitCode: 0, message: expect.stringMatching(/rebuilt .* from 1 event\(s\), 1 record\(s\)/) });
    expect(await runIndexCli([], join(root, "clossys"))).toMatchObject({ exitCode: 0 });
    const result = await runCheck(parseArgs(["check", "--engine", "--root", root]), root);
    expect(result).toMatchObject({ exitCode: 0, output: { check: "engine", ok: true, events: 1 } });
  });

  it("check --engine fails on a tampered log", async () => {
    record(1, "a");
    record(2, "b");
    const text = readFileSync(join(root, EVENTS_FILE), "utf8");
    writeFileSync(join(root, EVENTS_FILE), text.replace("copy.slot-1\"", "copy.slot-7\""));
    const result = await runCheck(parseArgs(["check", "--engine", "--root", root]), root);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/edit/);
  });

  it("parses the engine flags only with check, one at a time", () => {
    expect(parseArgs(["check", "--engine"]).engine).toBe(true);
    expect(parseArgs(["check", "--side-door"]).sideDoor).toBe(true);
    expect(() => parseArgs(["design", "--engine"])).toThrow(/--engine and --side-door require check/);
    expect(() => parseArgs(["check", "--engine", "--constitution"])).toThrow(/one of --engine, --side-door or --constitution/);
  });
});
