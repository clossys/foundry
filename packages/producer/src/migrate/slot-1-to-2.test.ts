import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { runRecordsComputedMatch } from "../check/records-computed-match.js";
import { sha256Hex } from "../records/hash.js";
import type { Slot } from "../records/types.js";
import { CONSUMER, TALLYHOUSE, consumerCopy, packageBaseOf } from "../records/__fixtures__/slot2-workspace.js";
import { migrateSlot1To2, planSlot1To2, targetIa, type SlotV1 } from "./slot-1-to-2.js";

const OPTIONS = { at: "2026-11-18T09:12:00Z", version: "0.0.0-test" };
const agents = (root: string, ...path: string[]): string => join(root, "clossys", "agents", ...path);

/** sha256 of every file under `dir`, by relative path. */
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (at: string): void => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else out[relative(dir, path)] = sha256Hex(readFileSync(path));
    }
  };
  walk(dir);
  return out;
}

describe("migrate slot-1-to-2 on a copy of test-fixtures/consumer", () => {
  it("rewrites every slot/1 with a slot/2 kind, leaves seats, and never touches the fixture", () => {
    const original = tree(CONSUMER);
    const ws = consumerCopy();
    const result = migrateSlot1To2(ws.root, OPTIONS);
    expect(result.findings).toEqual([]);
    expect(result.skipped).toHaveLength(24);
    expect(result.skipped.every(item => item.subject.startsWith("producer/seat."))).toBe(true);
    expect(result.written).toHaveLength(444);
    expect(tree(CONSUMER)).toEqual(original);

    const brief = ws.read("director", "advantage.defensibility.differentiator");
    expect(brief).toMatchObject({
      schema: "clossys.slot/2", kind: "brief", status: "starter", base: null, tighten: [], options: 3, varyOn: "angle",
      ia: { l0: "strategy", l1: "strategy/advantage", l2: "strategy/advantage/defensibility", order: 26 },
      createdBy: { actor: "code", cli: "clossys migrate slot-1-to-2", version: "0.0.0-test" },
      refs: [{ to: "director/advantage.proposition.promise", rel: "input" }],
    });
    expect(brief.brief.purpose).toBe("What makes our way different, and why is it hard to copy?");
    expect(brief.brief.mustDo).toEqual(["Answer Difference: how we work differently", "Answer Versus: who we differ from", "Answer Why-hard: why it is hard to copy"]);
    expect(brief.brief.inputs).toEqual(brief.refs);

    const icon = ws.read("designer", "assets.app-icon");
    expect(icon).toMatchObject({ kind: "element/asset", ia: { l0: "assets", l1: "assets/app-identity", l2: "assets/app-identity/app-identity-application" } });
    expect(icon.refs.map(item => item.to)).toContain("director/identity.brand.essence");
    expect(ws.read("writer", "lexicon.currency-format")).toMatchObject({ kind: "voice", status: "parked", contract: { notNeeded: { decidedBy: "planner" } } });

    expect(runRecordsComputedMatch(ws.root).findings.filter(item => !item.subject.startsWith("producer/seat."))).toEqual([]);
  });

  it("is idempotent: a second run changes no byte", () => {
    const ws = consumerCopy();
    migrateSlot1To2(ws.root, OPTIONS);
    const once = tree(ws.root);
    const twice = migrateSlot1To2(ws.root, { ...OPTIONS, at: "2026-12-01T00:00:00Z" });
    expect(twice.written).toEqual([]);
    expect(twice.migrations).toEqual([]);
    expect(twice.current).toHaveLength(444);
    expect(tree(ws.root)).toEqual(once);
  });

  it("reports an input no folder holds and leaves those files as slot/1", () => {
    const ws = consumerCopy();
    rmSync(agents(ws.root, "director", "advantage.proposition.promise"), { recursive: true });
    const before = ws.text("director", "advantage.defensibility.differentiator");
    const plan = planSlot1To2(ws.root, OPTIONS);
    expect(plan.findings.length).toBeGreaterThan(0);
    expect(plan.findings.every(item => item.detail === "no consumer slot folder holds advantage.proposition.promise")).toBe(true);
    expect(plan.findings.map(item => item.subject)).toContain("director/advantage.defensibility.differentiator");
    migrateSlot1To2(ws.root, OPTIONS);
    expect(ws.text("director", "advantage.defensibility.differentiator")).toBe(before);
  });

  it("takes the installed package base when the package ships one", () => {
    const ws = consumerCopy();
    const tallyhouse = JSON.parse(readFileSync(join(TALLYHOUSE, "clossys/agents/writer/lexicon.sentence-length/slot.json"), "utf8")) as Slot;
    const pkg = join(ws.root, "packages", "writer");
    mkdirSync(dirname(join(pkg, tallyhouse.base!.path)), { recursive: true });
    writeFileSync(join(pkg, "package.json"), `${JSON.stringify({ name: "@clossys/writer", version: tallyhouse.base!.version })}\n`);
    writeFileSync(join(pkg, tallyhouse.base!.path), `${JSON.stringify(packageBaseOf(tallyhouse), null, 2)}\n`);
    const order = (JSON.parse(ws.text("writer", "lexicon.sentence-length")) as SlotV1).ia!.order;
    migrateSlot1To2(ws.root, OPTIONS);
    const slot = ws.read("writer", "lexicon.sentence-length");
    expect(slot.base).toMatchObject({ package: "@clossys/writer", version: "1.0.0" });
    expect(slot.ia.order).toBe(order);
    expect(runRecordsComputedMatch(ws.root).findings.find(item => item.subject === "writer/lexicon.sentence-length")).toBeUndefined();
  });

  it("maps ia to slash paths and fills a missing l0 from the id", () => {
    const seat = JSON.parse(readFileSync(agents(CONSUMER, "producer", "seat.critic", "slot.json"), "utf8")) as SlotV1;
    expect(targetIa(seat)).toEqual({ l0: "seat", l1: "seat/publish", l2: "seat/publish/assemble", order: 21 });
  });
});
