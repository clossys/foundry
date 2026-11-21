/**
 * The slot check reads back the `critiques/` folder `clossys critique` writes (foundry-build-0048 CHECK-FIX P1): a
 * record the writer itself wrote is accepted, and only that; a malformed record or any other entry under the folder
 * still fails. The record here is written by the real verb (cli/critique.ts), never by hand.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "../cli/main.js";
import { runCritiqueCli } from "../cli/critique.js";
import { checkSlotModel } from "./slot-check.js";
import { jsonBytes, slotPositions, type IaDoc } from "./slot-model/index.js";

const ID = "components.button";
const AT = "2026-11-14T12:00:00.000Z";
const STANDARD = "element.bold";
const REL = `agents/designer/${ID}/critiques`;
const DESIGNER = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "designer");
let workspace: string, consumer: string, slotDir: string;

beforeEach(() => {
  workspace = realpathSync(mkdtempSync(join(tmpdir(), "clossys-slot-critiques-")));
  consumer = join(workspace, "clossys");
  const agents = join(consumer, "agents", "designer");
  const ia: IaDoc = { schema: "clossys.ia/1", source: "synthetic#fixture", extensions: [], nodes: [{ id: "components", label: "Components", children: [{ id: "group", label: "Group", slots: [ID] }] }] };
  slotDir = join(agents, ID);
  mkdirSync(join(slotDir, "candidates"), { recursive: true });
  writeFileSync(join(consumer, "clossys.config.ts"), "export default {};\n");
  writeFileSync(join(agents, "ia.json"), jsonBytes(ia));
  writeFileSync(join(slotDir, "slot.json"), jsonBytes({ schema: "clossys.slot/1", id: ID, agent: "designer", ia: slotPositions("designer", ia).get(ID), kind: "element", standard: "component", contract: {}, inputs: [], uses: [] }));
  // The run is one recipe, the one code chooses for the slot's standard (R15.5): component and its create.component.
  for (const path of ["standards/component", "recipes/create.component"]) cpSync(join(DESIGNER, path), join(workspace, "packages", "designer", path), { recursive: true });
  mkdirSync(join(workspace, "packages", "designer", "standards", STANDARD), { recursive: true });
  writeFileSync(join(workspace, "packages", "designer", "standards", STANDARD, "taste.md"), "# Taste\n");
  mkdirSync(join(workspace, "renders"), { recursive: true });
  writeFileSync(join(workspace, "renders", "one.png"), "render one");
  // The craft run reached render, so critique is its next stage.
  writeFileSync(join(slotDir, "ledger.json"), jsonBytes({ schema: "clossys.ledger/1", events: ["brief", "diverge", "render"].map(stage => ({ op: `craft:${stage}`, at: AT, by: "agent:designer.candidates", verb: "submit", skill: { path: "packages/designer/actions/designer.candidates/skill.md", sha256: null }, model: "m", tier: "high" })) }));
});
afterEach(() => rmSync(workspace, { recursive: true, force: true }));

const MANIFEST = [
  { role: "taste", ref: `packages/designer/standards/${STANDARD}/taste.md` },
  { role: "contract", ref: `clossys/agents/designer/${ID}/slot.json#contract` },
  { role: "render", ref: "renders/one.png" },
];
const RECORD = { schema: "clossys.critique/1", slot: ID, candidate: "button-v1.json", standard: STANDARD, scores: { "taste.contrast": 4 }, packet: { manifest: MANIFEST } };
/** Records the critique through the real verb, as an agent's critic does. */
async function critique(): Promise<void> {
  writeFileSync(join(workspace, "critique.json"), JSON.stringify(RECORD));
  const result = await runCritiqueCli([`designer/${ID}`, "--record", "critique.json", "--model", "fixture-critic", "--tier", "high", "--at", AT], workspace);
  expect(result.exitCode, result.message).toBe(0);
}
const critiqueIssues = () => checkSlotModel(consumer).filter(issue => issue.path.includes("/critiques"));
const written = () => join(slotDir, "critiques", "button-v1.json");

describe("checkSlotModel on a slot's critiques/ folder (CHECK-FIX P1)", () => {
  it("accepts a valid critique: the folder and record clossys critique writes add no issue", async () => {
    const before = checkSlotModel(consumer);
    await critique();
    expect(critiqueIssues()).toEqual([]);
    expect(checkSlotModel(consumer)).toEqual(before);
  });

  it("rejects a malformed critique file: unreadable JSON, a schema break, another slot, a maker ref, a misnamed file", async () => {
    await critique();
    const bytes = readFileSync(written(), "utf8");
    const malformed = (doc: unknown) => writeFileSync(written(), typeof doc === "string" ? doc : jsonBytes(doc));
    const cases: [string, unknown, RegExp][] = [
      ["unreadable JSON", "{ not json", /not a readable JSON file/],
      ["score out of range", { ...RECORD, scores: { "taste.contrast": 9 } }, /critique record invalid: \/scores/],
      ["unknown key", { ...RECORD, maker: "designer" }, /critique record invalid/],
      ["another slot", { ...RECORD, slot: "components.card" }, /names slot components\.card, not components\.button/],
      ["maker ref", { ...RECORD, packet: { manifest: [...MANIFEST, { role: "render", ref: "packages/designer/recipes/button.json" }] } }, /never a recipe file/],
      ["no render", { ...RECORD, packet: { manifest: MANIFEST.slice(0, 2) } }, /lists no render/],
    ];
    for (const [label, doc, message] of cases) {
      malformed(doc);
      const issues = critiqueIssues();
      expect(issues.map(issue => issue.code), label).toEqual(["critique-invalid"]);
      expect(issues[0]!.path, label).toBe(`${REL}/button-v1.json`);
      expect(issues[0]!.message, label).toMatch(message);
    }
    // A valid record under another candidate's name is not the file the writer writes.
    writeFileSync(written(), bytes);
    renameSync(written(), join(slotDir, "critiques", "button-v2.json"));
    expect(critiqueIssues()).toEqual([{ code: "critique-invalid", path: `${REL}/button-v2.json`, message: "critique record invalid: critique file button-v2.json is not named for candidate button-v1.json" }]);
  });

  it("rejects an unexpected file or folder in critiques/, beside a valid critique", async () => {
    await critique();
    writeFileSync(join(slotDir, "critiques", "notes.md"), "maker notes\n");
    mkdirSync(join(slotDir, "critiques", "button-v2.json"));
    expect(critiqueIssues()).toEqual([
      { code: "orphan", path: `${REL}/button-v2.json`, message: `unexpected entry in critiques folder of ${ID}: not a regular file` },
      { code: "orphan", path: `${REL}/notes.md`, message: `unexpected entry in critiques folder of ${ID}` },
    ]);
  });

  it("still rejects a critiques entry that is not a folder", () => {
    writeFileSync(join(slotDir, "critiques"), "{}\n");
    expect(critiqueIssues()).toEqual([{ code: "orphan", path: `agents/designer/${ID}/critiques`, message: `unexpected entry in slot folder ${ID}` }]);
  });
});
