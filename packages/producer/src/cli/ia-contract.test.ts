import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
// Load the CLI first, as every caller does: owner.ts sits in an import cycle with the pipeline handlers.
import "./main.js";
import { runIaCli } from "./owner.js";

// `clossys ia --contract` validates a `clossys.slot-contract/1` contract against the slot contract
// schema (records/schemas.ts SLOT_CONTRACT_SCHEMA and its semantics) and refuses, writing nothing.
const SLOT = "sections.fixture";
const VALID = {
  schema: "clossys.slot-contract/1", kind: "section", slot: SLOT, package: "designer", layer: "sections", purpose: "A fixture section.",
  inputs: [{ name: "title", kind: "copy", required: true }], limits: {}, references: [], checkSuite: "section", specimenKind: "visual",
};
const put = (path: string, text: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
function tree(dir: string, base = dir, out: Record<string, string> = {}): Record<string, string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) tree(path, base, out); else out[relative(base, path)] = readFileSync(path, "latin1");
  }
  return out;
}

async function placed(): Promise<string> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ia-contract-")));
  put(join(root, "clossys", "clossys.config.ts"), "export default {};\n");
  expect((await runIaCli(["designer", "--start"], root)).exitCode).toBe(0);
  put(join(root, "contract.json"), JSON.stringify(VALID));
  const result = await runIaCli([`designer/${SLOT}`, "--contract", join(root, "contract.json"), "--under", "sections/fixture", "--kind", "element"], root);
  expect(result.exitCode, result.message).toBe(0);
  return root;
}

describe("clossys ia --contract with a clossys.slot-contract/1 contract", () => {
  it("writes a contract the slot contract schema accepts", async () => {
    const root = await placed();
    const slot = JSON.parse(readFileSync(join(root, "clossys", "agents", "designer", SLOT, "slot.json"), "utf8")) as { contract: unknown };
    expect(slot.contract).toEqual(VALID);
  });

  it.each([
    ["an unknown key", { ...VALID, colour: "red" }, /contract .*colour.*clossys\.slot-contract\/1/],
    ["a missing required field", (({ checkSuite: _c, ...rest }) => rest)(VALID), /checkSuite.*clossys\.slot-contract\/1/],
    ["an input kind outside the schema", { ...VALID, inputs: [{ name: "title", kind: "text", required: true }] }, /must be one of.*clossys\.slot-contract\/1/],
    ["a slot outside its layer", { ...VALID, layer: "frames" }, /is not in layer "frames"/],
    ["a contract naming another slot", { ...VALID, slot: "sections.other" }, /contract\.slot must be sections\.fixture/],
  ])("refuses %s and leaves every byte as it was", async (_what, contract, message) => {
    const root = await placed();
    const before = tree(join(root, "clossys"));
    put(join(root, "bad.json"), JSON.stringify(contract));
    const result = await runIaCli([`designer/${SLOT}`, "--contract", join(root, "bad.json")], root);
    expect(result.exitCode, result.message).toBe(1);
    expect(result.message).toMatch(message);
    expect(tree(join(root, "clossys"))).toEqual(before);
  });
});
