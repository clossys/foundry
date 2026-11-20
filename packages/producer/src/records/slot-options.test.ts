import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "./hash.js";
import { jsonBytes, serializeFrontmatter, slotPositions, validatePin, validateSlotDoc, type IaDoc, type OptionTable } from "./slot-model/index.js";
import { checkSlotOptions, slotOptions } from "./slot-options.js";
import { readSlotEntry } from "./slots.js";
import { writeCandidate, writePin, writeSlotOptions } from "./slot-write.js";
import { runOptionsCli, runPickCli } from "../cli/options.js";

const ID = "identity.brand.essence";
const TABLE: OptionTable = {
  classes: {
    choice: { id: "choice", options: 3, varyOn: "angle", values: ["grounded", "ambitious", "human"], summary: "" },
    single: { id: "single", options: 1, summary: "" },
  },
  groups: { director: { "identity/identity.brand": "choice", "context/context.market": "single" } },
  overrides: {},
};
const source = { kind: "original", ref: [] };
const body = "## Direction\n- Essence: x\n\n## Because\n- y\n\n## Watch\n- z\n";
let root: string, dir: string;

const brief = (vary?: Record<string, string>) => serializeFrontmatter({ slot: ID, source, feeds: [], functions: [], ...(vary ? { vary } : {}) }, body);
const add = (name: string, bytes: string) => writeFileSync(join(dir, "candidates", name), bytes);
const slotJson = () => JSON.parse(readFileSync(join(dir, "slot.json"), "utf8"));
/** The class fields on this slot/1 fixture, written as bytes: the writer (writeSlotOptions) refuses slot/1 (U13 one format). */
const setOptions = (fields: { options: number; varyOn: string }) => writeFileSync(join(dir, "slot.json"), jsonBytes({ ...slotJson(), ...fields }));

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "slot-options-")));
  // Workspace marker so the CLI discovers this root.
  const consumer = join(root, "clossys");
  const ia: IaDoc = { schema: "clossys.ia/1", source: "synthetic#fixture", extensions: [], nodes: [
    { id: "identity", label: "Identity", children: [{ id: "identity.brand", label: "Brand", slots: [ID] }] },
    { id: "context", label: "Context", children: [{ id: "context.market", label: "Market", slots: ["context.market.trend"] }] },
  ] };
  mkdirSync(join(consumer, "agents", "director"), { recursive: true });
  writeFileSync(join(consumer, "agents", "director", "ia.json"), jsonBytes(ia));
  for (const id of [ID, "context.market.trend"]) {
    const slot = join(consumer, "agents", "director", id);
    mkdirSync(join(slot, "candidates"), { recursive: true });
    writeFileSync(join(slot, "slot.json"), jsonBytes({ schema: "clossys.slot/1", id, agent: "director", ia: slotPositions("director", ia).get(id), kind: "brief", contract: {}, inputs: [], uses: [] }));
  }
  dir = join(consumer, "agents", "director", ID);
  const baseline = serializeFrontmatter({ slot: ID, source, feeds: [], functions: [] }, body);
  add("essence-v1.md", baseline);
  writeFileSync(join(dir, "pin.json"), jsonBytes({ candidate: "essence-v1.md", sha256: sha256Hex(baseline), decidedBy: "owner", basis: "picked", at: "2026-11-03T00:00:00Z" }));
  writeFileSync(join(consumer, "clossys.config.ts"), "export default {};\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const consumer = () => join(root, "clossys");
const codes = () => checkSlotOptions(consumer(), TABLE).findings.map(f => `${f.code}:${f.slot}`);

describe("slot.json options schema", () => {
  it("accepts options 1-3 with varyOn and refuses the rest", () => {
    const doc = slotJson();
    expect(validateSlotDoc({ ...doc, options: 3, varyOn: "angle" })).toEqual([]);
    expect(validateSlotDoc({ ...doc, options: 3 }).map(i => i.message)).toContain("varyOn is required when options > 1");
    expect(validateSlotDoc({ ...doc, options: 4, varyOn: "angle" }).map(i => i.message)).toContain("options must be 1, 2 or 3");
    expect(validateSlotDoc({ ...doc, options: 2, varyOn: "Bad Axis" }).map(i => i.message)).toContain("varyOn must be an axis id such as tone");
  });
  it("pins carry basis agent only with decidedBy agent:<seat>", () => {
    const pin = { candidate: "a-v1.md", sha256: "a".repeat(64), at: "2026-11-03T00:00:00Z" };
    expect(validatePin({ ...pin, decidedBy: "agent:judge", basis: "agent" })).toEqual([]);
    expect(validatePin({ ...pin, decidedBy: "agent:judge" })).not.toEqual([]);
    // Basis is required on every pin (G15-GITCMS-HARDEN).
    expect(validatePin({ ...pin, decidedBy: "owner" })).not.toEqual([]);
    expect(validatePin({ ...pin, decidedBy: "owner", basis: "picked" })).toEqual([]);
    expect(validatePin({ ...pin, decidedBy: "owner", basis: "agent" })).not.toEqual([]);
    expect(validatePin({ ...pin, decidedBy: "owner", basis: "nope" })).not.toEqual([]);
  });
});

describe("checkSlotOptions", () => {
  it("fails a choice slot with drift and a single option (the base state)", () => {
    expect(codes()).toEqual([`options-drift:${ID}`, `options-short:${ID}`]);
  });

  it("passes once slot.json carries the class and two tagged alternatives join the baseline", () => {
    setOptions({ options: 3, varyOn: "angle" });
    add("essence-ambitious-v1.md", brief({ angle: "ambitious" }));
    add("essence-human-v1.md", brief({ angle: "human" }));
    expect(codes()).toEqual([]);
    const view = slotOptions(consumer(), readSlotEntry(consumer(), "director", ID)!, TABLE);
    expect(view.distinct).toBe(3);
    expect(view.missing).toEqual(["grounded"]);
    expect(view.pinStatus).toBe("pinned");
  });

  it("refuses duplicate, foreign-axis and unlisted values", () => {
    setOptions({ options: 3, varyOn: "angle" });
    add("essence-human-v1.md", brief({ angle: "human" }));
    add("essence-human2-v1.md", brief({ angle: "human" }));
    add("essence-tone-v1.md", brief({ tone: "bold" }));
    add("essence-odd-v1.md", brief({ angle: "odd" }));
    const found = codes();
    expect(found).toContain(`options-vary-duplicate:${ID}`);
    expect(found.filter(code => code.startsWith("options-vary-invalid"))).toHaveLength(2);
    expect(found).toContain(`options-short:${ID}`);
  });

  it("judges a slot by its own family (slot/2 data) before the table, and names a family the table's class disagrees with", () => {
    // family is slot/2 data: the slot is rewritten as the slot/1-to-2 migration writes it, plus its family.
    const setFamily = (slotId: string, family: Record<string, unknown>) => {
      const file = join(consumer(), "agents", "director", slotId, "slot.json");
      const { ia } = JSON.parse(readFileSync(file, "utf8"));
      writeFileSync(file, jsonBytes({
        schema: "clossys.slot/2", id: slotId, agent: "director", kind: "brief", status: "starter",
        ia: { l0: "strategy", l1: `strategy/${ia.l1}`, l2: `strategy/${ia.l1}/${ia.l2.split(".").pop()}`, order: ia.order },
        createdBy: { actor: "code", cli: "clossys migrate slot-1-to-2", version: "0.1.0" }, createdAt: "2026-11-17T00:00:00Z", refs: [],
        base: null, standard: "brief.statement", brief: { purpose: "p", mustDo: [], inputs: [], acceptance: [] }, contract: {}, tighten: [], family,
      }));
    };
    // The table's choice class seeded the family: no drift, and its three values are the options to hold.
    setFamily(ID, { options: 3, varyOn: "angle", values: ["grounded", "ambitious", "human"], class: "choice" });
    expect(codes()).toEqual([`options-short:${ID}`]);
    add("essence-ambitious-v1.md", brief({ angle: "ambitious" }));
    add("essence-human-v1.md", brief({ angle: "human" }));
    expect(codes()).toEqual([]);
    // A slot the table does not class is judged by its family alone, never options-unclassified.
    const unclassed: OptionTable = { ...TABLE, groups: { director: { "identity/identity.brand": "choice" } } };
    setFamily("context.market.trend", { options: 1, varyOn: null, values: [] });
    expect(checkSlotOptions(consumer(), unclassed).findings).toEqual([]);
    // Mutation: the family says 2 on tone while the table's class says 3 on angle, so the drift is named.
    setFamily(ID, { options: 2, varyOn: "tone", values: ["plain", "bold"], class: "choice" });
    const drift = checkSlotOptions(consumer(), TABLE).findings.find(f => f.code === "options-drift");
    expect(drift?.message).toBe("slot.json family 2/tone != class choice 3/angle; run clossys migrate contracts");
    expect(slotOptions(consumer(), readSlotEntry(consumer(), "director", ID)!, TABLE)).toMatchObject({ options: 2, varyOn: "tone", values: ["plain", "bold"] });
  });

  it("reports an L2 group the mapping does not class", () => {
    const table: OptionTable = { ...TABLE, groups: { director: { "identity/identity.brand": "choice" } } };
    expect(checkSlotOptions(consumer(), table).findings.map(f => f.code)).toContain("options-unclassified");
  });
});

describe("clossys options and pick", () => {
  it("--more prints a deterministic brief naming the missing values", async () => {
    const result = await runOptionsCli([`director/${ID}`, "--more", "--root", root], root);
    expect(result.exitCode).toBe(0);
    const brief = result.output as { write: { name: string }[]; reference: string };
    expect(brief.reference).toBe("essence-v1.md");
    expect(brief.write.length).toBeGreaterThanOrEqual(2);
    expect(brief.write.length).toBeLessThanOrEqual(3);
  });

  it("--redraft prints a one-candidate brief that may cite new evidence, and refuses --more beside it", async () => {
    const result = await runOptionsCli([`director/${ID}`, "--redraft", "--root", root], root);
    expect(result.exitCode).toBe(0);
    const brief = result.output as { mode: string; write: { name: string }[]; keep: { source: string }; how: string };
    expect(brief.mode).toBe("redraft");
    expect(brief.write).toHaveLength(1);
    expect(brief.keep.source).toContain("clossys evidence");
    expect(brief.how).toContain("--rung");
    await expect(runOptionsCli([`director/${ID}`, "--redraft", "--more", "--root", root], root)).rejects.toThrow(/two briefs/);
  });

  // One format (foundry-build-0048 U13): pick writes clossys.slot/2 and clossys.pin/2 only. On this clossys.slot/1
  // fixture every pick, over any pin, refuses with the migrate message and leaves the pin as it was; the slot/2 pick
  // (basis agent, refused over an owner pick) is proven in cli/one-format.test.ts.
  it("pick refuses a clossys.slot/1 slot over any pin and leaves it unchanged", async () => {
    const human = writeCandidate(consumer(), "director", ID, "essence-human", brief({ angle: "human" })).name;
    for (const [decidedBy, basis] of [["owner", "picked"], ["owner:2026-11-03 pin-if-agree", "bulk"], ["planner:UNIT", "planner"], ["agent:director.other", "agent"]] as const) {
      writePin(consumer(), "director", ID, "essence-v1.md", { decidedBy, basis, at: "2026-11-03T00:00:00Z" });
      const before = readFileSync(join(dir, "pin.json"), "utf8");
      const refused = await runPickCli([`director/${ID}`, human.replace(/\.md$/, ""), "--by", "agent:director", "--at", "2026-11-04T00:00:00Z", "--root", root], root);
      expect(refused.exitCode, basis).toBe(1);
      expect(refused.message, basis).toMatch(/clossys\.slot\/1 slot; this verb writes clossys\.slot\/2 and clossys\.pin\/2 only: run clossys migrate slots --apply first/);
      expect(readFileSync(join(dir, "pin.json"), "utf8"), basis).toBe(before);
    }
    await expect(runPickCli([`director/${ID}`, "essence-human-v1", "--by", "owner", "--root", root], root)).rejects.toThrow(/agent:<seat>/);
  });

  it("writePin writes the basis it is given", () => {
    expect(writePin(consumer(), "director", ID, "essence-v1.md", { decidedBy: "owner", basis: "picked", at: "2026-11-04T00:00:00Z" })).toMatchObject({ basis: "picked" });
  });
});
