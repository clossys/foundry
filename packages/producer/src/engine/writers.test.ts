import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jsonBytes, serializeFrontmatter, slotPositions, type IaDoc } from "../records/slot-model/index.js";
import { LEDGER_FILE } from "../records/ledger.js";
import { writeCandidate, writePin } from "../records/slot-write.js";
import { EVENTS_FILE, sha256, verifyChain } from "./chain.js";
import { runEngineCheck } from "./check.js";
import { recordEvent } from "./log.js";

const ID = "identity.brand.essence";
const at = "2026-11-13T00:00:00Z";
const body = "## Direction\n- Essence: x\n\n## Because\n- y\n\n## Watch\n- z\n";
const brief = (essence: string) => serializeFrontmatter({ slot: ID, source: { kind: "original", ref: [] }, feeds: [], functions: [] }, body.replace("Essence: x", `Essence: ${essence}`));
let root: string, consumer: string, dir: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "engine-writers-")));
  consumer = join(root, "clossys");
  const ia: IaDoc = { schema: "clossys.ia/1", source: "synthetic#fixture", extensions: [], nodes: [
    { id: "identity", label: "Identity", children: [{ id: "identity.brand", label: "Brand", slots: [ID] }] },
  ] };
  mkdirSync(join(consumer, "agents", "director"), { recursive: true });
  writeFileSync(join(consumer, "agents", "director", "ia.json"), jsonBytes(ia));
  dir = join(consumer, "agents", "director", ID);
  mkdirSync(join(dir, "candidates"), { recursive: true });
  writeFileSync(join(dir, "slot.json"), jsonBytes({ schema: "clossys.slot/1", id: ID, agent: "director", ia: slotPositions("director", ia).get(ID), kind: "brief", contract: {}, inputs: [], uses: [] }));
  writeFileSync(join(consumer, "clossys.config.ts"), "export default {};\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("wired writers emit engine events (records/slot-write.ts, records/pin.ts)", () => {
  it("logs one event per ledger write, naming the ledger's bytes, and keeps the ledger as it was", () => {
    writeCandidate(consumer, "director", ID, "essence", brief("one"), { at });
    writePin(consumer, "director", ID, "essence-v1.md", { decidedBy: "owner", basis: "picked", at });
    const report = verifyChain(root);
    expect(report.ok).toBe(true);
    const kinds = report.events.map(event => [event.kind, event.subject, event.actor]);
    expect(kinds).toContainEqual(["slot.submit", `director/${ID}`, expect.any(String)]);
    expect(kinds).toContainEqual(["slot.pin", `director/${ID}`, "owner"]);
    const last = report.events.filter(event => event.kind === "slot.pin").at(-1)!;
    const ledgerPath = `clossys/agents/director/${ID}/${LEDGER_FILE}`;
    expect(last.inputs).toContainEqual({ path: ledgerPath, sha256: sha256(readFileSync(join(root, ledgerPath))) });
    expect(last.inputs.map(input => input.path)).toContain(`clossys/agents/director/${ID}/pin.json`);
    expect(JSON.parse(readFileSync(join(dir, LEDGER_FILE), "utf8")).events.map((event: { op: string }) => event.op)).toEqual(expect.arrayContaining(["submit", "pin"]));
    expect(runEngineCheck(root)).toMatchObject({ ok: true, chain: [], index: [], drift: [] });
  });

  it("logs nothing for a record path outside any workspace", () => {
    const loose = realpathSync(mkdtempSync(join(tmpdir(), "engine-loose-")));
    try {
      mkdirSync(join(loose, "notes"), { recursive: true });
      writeFileSync(join(loose, "notes", "pin.json"), "{}");
      expect(recordEvent([join(loose, "notes", "pin.json")], { actor: "code:test", kind: "pin.write", subject: "x" })).toBeUndefined();
      expect(existsSync(join(loose, EVENTS_FILE))).toBe(false);
    } finally { rmSync(loose, { recursive: true, force: true }); }
  });

  it("makes a record edited outside the engine visible to check --engine", () => {
    writeCandidate(consumer, "director", ID, "essence", brief("one"), { at });
    writePin(consumer, "director", ID, "essence-v1.md", { decidedBy: "owner", basis: "picked", at });
    writeFileSync(join(dir, "pin.json"), readFileSync(join(dir, "pin.json"), "utf8").replace("owner", "planner"));
    const report = runEngineCheck(root);
    expect(report.ok).toBe(false);
    expect(report.drift).toEqual([expect.stringMatching(new RegExp(`^clossys/agents/director/${ID.replace(/\./g, "\\.")}/pin\\.json: last logged`))]);
  });
});
