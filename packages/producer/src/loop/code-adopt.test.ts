/**
 * DET-STEPS round 2, planner D5 "Adopt = A": code authors a candidate (`code:adopt`) only in a slot whose contract
 * adopts byte-exact, and only the source-ladder stock item, unmodified; the normal certify gate judges it. The agent
 * creates whenever there is no stock item (or the slot is not code's to author).
 *
 * The world is test-fixtures/consumer: designer/components.checkbox is an empty adopt-first components slot whose
 * contract fixture ships as shadcn-aria/checkbox; components.chart-area has no stock fixture; components.button already
 * holds a candidate; sections.hero is a crafted (not byte-exact) slot.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { buildContext } from "../constitution/index.js";
import { R14 } from "../constitution/checks/R14-provenance.js";
import { r03_2, r03_4 } from "../constitution/rules/r03.js";
import { CODE_ADOPT, CODE_ADOPT_RUNG, codeAdoptRefusal, codeAdoptSlotRefusal, stockItemOf } from "../records/code-adopt.js";
import { writeCandidate } from "../records/slot-write.js";
import { readLedger } from "../records/slots.js";
import { startRun, type AgentPacket, type CodeCall, type RunHooks } from "./runner.js";

const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer/", import.meta.url));
const CHECKBOX = "components.checkbox";
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function world(): { root: string; consumer: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "code-adopt-")));
  roots.push(root);
  cpSync(FIXTURE, root, { recursive: true });
  return { root, consumer: join(root, "clossys") };
}

/** loop.create's hooks: `certify` exits as `certify` says; the agent seat's create is recorded and writes nothing. */
function hooks(certify: (call: CodeCall, count: number) => number = () => 0): RunHooks & { readonly agentSteps: string[]; readonly codeSteps: string[] } {
  const agentSteps: string[] = [];
  const codeSteps: string[] = [];
  let certified = 0;
  return {
    agentSteps, codeSteps,
    agent(packet: AgentPacket) { agentSteps.push(packet.step); return { exit: 0, model: "stub-model" }; },
    code(call: CodeCall) { codeSteps.push(call.step); return { exit: call.step === "certify" ? certify(call, certified++) : 0 }; },
  };
}
const settleOf = (root: string, runId: string) => JSON.parse(readFileSync(join(root, "clossys", ".state", "runs", "loops", `${runId}.settle`, "adopt.json"), "utf8"));
const clock = () => { let tick = 0; return () => new Date(Date.parse("2026-11-21T12:30:00Z") + 1000 * tick++); };
const candidatesOf = (consumer: string, slotId: string): string[] => {
  const dir = join(consumer, "agents", "designer", slotId, "candidates");
  return existsSync(dir) ? (readLedger(join(consumer, "agents", "designer", slotId), "slot")!.events.filter(event => event.verb === "submit").map(event => String(event.name))) : [];
};

describe("the code:adopt slot rule and stock item", () => {
  it("names the checkbox's stock item and refuses crafted, consumer-asset and non-Designer slots", () => {
    const { root } = world();
    expect(codeAdoptSlotRefusal(root, "designer", CHECKBOX)).toBeUndefined();
    const found = stockItemOf(root, CHECKBOX);
    expect("stock" in found && found.stock.ref).toMatch(/^shadcn-aria\/checkbox@/);
    expect(codeAdoptSlotRefusal(root, "designer", "sections.hero")).toMatch(/is not a byte-exact adopt slot: it is not of the components layer/);
    expect(codeAdoptSlotRefusal(root, "writer", "voice.tone")).toMatch(/only a Designer components slot adopts byte-exact/);
    expect(stockItemOf(root, "components.chart-area")).toMatchObject({ none: expect.stringMatching(/no shadcn-aria or diceui stock item ships|has no contract fixture file/) });
  });
});

describe("writeCandidate --by code:adopt: code authors only the stock item of a byte-exact adopt slot", () => {
  it("refuses a code-authored candidate in a non-byte-exact slot (mutation 3), and writes nothing", () => {
    const { root, consumer } = world();
    const found = stockItemOf(root, CHECKBOX);
    if (!("stock" in found)) throw new Error(found.none);
    const { stock } = found;
    const fields = { basis: "code", rung: CODE_ADOPT_RUNG, seed: stock.seed, ladder: { rung: CODE_ADOPT_RUNG, seed: stock.seed } };
    const before = readFileSync(join(consumer, "agents", "designer", "sections.hero", "ledger.json"), "utf8");
    expect(() => writeCandidate(consumer, "designer", "sections.hero", "hero", { ...stock.item, meta: { ...stock.item.meta, slot: "sections.hero" } }, {
      at: "2026-11-21T12:00:00Z", provenance: { verb: "submit", by: CODE_ADOPT }, fields,
    })).toThrow(/--by code:adopt: designer\/sections\.hero is not a byte-exact adopt slot/);
    expect(readFileSync(join(consumer, "agents", "designer", "sections.hero", "ledger.json"), "utf8")).toBe(before);
  });

  it("refuses a code adopt whose bytes are not the stock item's, or whose rung or seed is not the stock rung's", () => {
    const { root, consumer } = world();
    const found = stockItemOf(root, CHECKBOX);
    if (!("stock" in found)) throw new Error(found.none);
    const { stock } = found;
    const fields = { basis: "code", rung: CODE_ADOPT_RUNG, seed: stock.seed };
    const edited = { ...stock.item, files: stock.item.files.map((file, index) => index === 0 ? { ...file, content: `${file.content}// edited\n` } : file) };
    expect(codeAdoptRefusal(root, "designer", CHECKBOX, edited, fields)).toMatch(/is not byte-exact/);
    expect(codeAdoptRefusal(root, "designer", CHECKBOX, stock.item, { ...fields, rung: "L2" })).toMatch(/submits rung L1/);
    expect(codeAdoptRefusal(root, "designer", CHECKBOX, stock.item, fields)).toBeUndefined();
    expect(() => writeCandidate(consumer, "designer", CHECKBOX, "checkbox", edited, { at: "2026-11-21T12:00:00Z", provenance: { verb: "submit", by: CODE_ADOPT }, fields })).toThrow(/is not byte-exact/);
    expect(candidatesOf(consumer, CHECKBOX)).toEqual([]);
  });

  it("R03.2 flags a ledger submit by code:adopt into a slot code may not author", () => {
    const { root, consumer } = world();
    const found = stockItemOf(root, CHECKBOX);
    if (!("stock" in found)) throw new Error(found.none);
    const codeRows = () => r03_2(buildContext(root, consumer)).filter(row => /submitted by code:adopt/.test(row.reason));
    expect(codeRows()).toEqual([]);
    // A planner-written candidate whose submit event names code:adopt as its author, in a crafted slot.
    writeCandidate(consumer, "designer", "sections.hero", "hero", { $schema: "https://ui.shadcn.com/schema/registry-item.json", name: "hero", type: "registry:block", files: [{ path: "hero.tsx", type: "registry:block", content: "export function Hero() { return <section />; }\n" }], meta: { slot: "sections.hero", source: { kind: "original", ref: [] } } }, { at: "2026-11-21T12:00:00Z", provenance: { verb: "submit", by: "planner" } });
    const ledgerFile = join(consumer, "agents", "designer", "sections.hero", "ledger.json");
    const ledger = JSON.parse(readFileSync(ledgerFile, "utf8"));
    ledger.events.at(-1).by = CODE_ADOPT;
    ledger.events.at(-1).rung = CODE_ADOPT_RUNG;
    ledger.events.at(-1).seed = found.stock.seed;
    writeFileSync(ledgerFile, `${JSON.stringify(ledger, null, 2)}\n`);
    const rows = codeRows();
    expect(rows.map(row => `${row.agent}/${row.slot}: ${row.reason}`).join("\n")).toMatch(/^designer\/sections\.hero: submitted by code:adopt where code may not author: designer\/sections\.hero is not a byte-exact adopt slot/);
  }, 60_000);
});

describe("loop.create's adopt step (clossys settle adopt): code installs the stock item, or the agent creates", () => {
  it("settles create in an empty adopt slot: the stock item is submitted by code:adopt at L1, certify judges it, the agent never creates", async () => {
    const { root, consumer } = world();
    const h = hooks();
    const run = await startRun(root, { loop: "loop.create", slot: `designer/${CHECKBOX}` }, h, { now: clock() });
    expect(run.state, run.message).toBeDefined();
    const settle = settleOf(root, run.state!.runId);
    expect(settle).toMatchObject({ schema: "clossys.settle/1", rule: "adopt", outcome: "settled", settles: ["create"], answer: expect.stringMatching(/^adopt shadcn-aria\/checkbox@/) });
    expect(h.agentSteps).not.toContain("create");
    expect(h.codeSteps).toContain("certify");
    const submits = readLedger(join(consumer, "agents", "designer", CHECKBOX), "slot")!.events.filter(event => event.verb === "submit");
    expect(submits).toEqual([expect.objectContaining({ by: CODE_ADOPT, model: "none", tier: "none", basis: "code", rung: CODE_ADOPT_RUNG, seed: "shadcn-aria/checkbox", name: "checkbox-v1.json" })]);
    // R03 (rung, byte-exact adopt) and R14 (provenance: verb, skill, model none for code) find nothing on the slot.
    const ctx = buildContext(root, consumer);
    expect([...r03_2(ctx), ...r03_4(ctx), ...Object.values(R14.checks).flatMap(check => check(ctx))].filter(row => row.slot === CHECKBOX)).toEqual([]);
  }, 60_000);

  it("a failed certify sends the run back to the agent's create: the settle is cleared and the agent creates", async () => {
    const { root } = world();
    const h = hooks((_call, count) => count === 0 ? 1 : 0);
    const run = await startRun(root, { loop: "loop.create", slot: `designer/${CHECKBOX}` }, h, { now: clock() });
    expect(run.state, run.message).toBeDefined();
    expect(h.codeSteps.filter(step => step === "certify").length).toBeGreaterThanOrEqual(1);
    // The adopt step settled create and code submitted the stock item; certify refused it, so the retry cleared the
    // settle and the agent's create ran (the agent seat, not code, makes the next candidate).
    expect(settleOf(root, run.state!.runId)).toMatchObject({ rule: "adopt", outcome: "settled", settles: ["create"] });
    expect(h.codeSteps.indexOf("certify")).toBeGreaterThan(-1);
    expect(h.agentSteps).toContain("create");
    expect(run.state!.settled?.create).toBeUndefined();
  }, 60_000);

  it("hands create to the agent with no stock item (chart-area) or a held candidate (button), and writes nothing", async () => {
    for (const slotId of ["components.chart-area", "components.button"]) {
      const { root, consumer } = world();
      const held = candidatesOf(consumer, slotId);
      const h = hooks();
      const run = await startRun(root, { loop: "loop.create", slot: `designer/${slotId}` }, h, { now: clock() });
      expect(run.state, run.message).toBeDefined();
      expect(settleOf(root, run.state!.runId), slotId).toMatchObject({ rule: "adopt", outcome: "agent", settles: [], why: expect.stringMatching(/the agent creates$/) });
      expect(h.agentSteps).toContain("create");
      expect(candidatesOf(consumer, slotId)).toEqual(held);
    }
  }, 60_000);
});
