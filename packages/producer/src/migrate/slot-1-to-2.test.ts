import { cpSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runRecordsComputedMatch } from "../check/records-computed-match.js";
import { sha256Hex } from "../records/hash.js";
import { readSlot } from "../records/slot.js";
import { baseSlot, slot2Workspace } from "../records/__fixtures__/slot2-workspace.js";
import { migrateSlot1To2, planSlot1To2, targetIa } from "./slot-1-to-2.js";

const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer", import.meta.url));
const OPTIONS = { at: "2026-11-18T09:12:00Z", version: "0.0.0-test" };

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

function fixtureCopy(): string {
  const root = mkdtempSync(join(tmpdir(), "slot-1-to-2-"));
  cpSync(FIXTURE, root, { recursive: true });
  return root;
}

describe("migrate slot-1-to-2 on a copy of test-fixtures/consumer", () => {
  it("rewrites every slot/1 with a slot/2 kind, leaves seats, and never touches the fixture", () => {
    const original = tree(FIXTURE);
    const root = fixtureCopy();
    const result = migrateSlot1To2(root, OPTIONS);
    expect(result.findings).toEqual([]);
    expect(result.skipped).toHaveLength(24);
    expect(result.skipped.every(item => item.subject.startsWith("producer/seat."))).toBe(true);
    expect(result.written).toHaveLength(446);
    expect(tree(FIXTURE)).toEqual(original);

    const brief = readSlot(join(root, "clossys/agents/director/advantage.defensibility.differentiator/slot.json"));
    expect(brief).toMatchObject({
      schema: "clossys.slot/2", kind: "brief", status: "starter", base: null, tighten: [], options: 3, varyOn: "angle",
      ia: { l0: "strategy", l1: "strategy/advantage", l2: "strategy/advantage/defensibility", order: 26 },
      createdBy: { actor: "code", cli: "clossys migrate slot-1-to-2", version: "0.0.0-test" },
      refs: [{ to: "director/advantage.proposition.promise", rel: "input" }],
    });
    expect(brief.brief.purpose).toBe("What makes our way different, and why is it hard to copy?");
    expect(brief.brief.mustDo).toEqual(["Answer Difference: how we work differently", "Answer Versus: who we differ from", "Answer Why-hard: why it is hard to copy"]);
    expect(brief.brief.inputs).toEqual(brief.refs);

    const icon = readSlot(join(root, "clossys/agents/designer/assets.app-icon/slot.json"));
    expect(icon).toMatchObject({ kind: "element/asset", ia: { l0: "assets", l1: "assets/app-identity", l2: "assets/app-identity/app-identity-application" } });
    expect(icon.refs.map(item => item.to)).toContain("director/identity.brand.essence");
    const parked = readSlot(join(root, "clossys/agents/writer/lexicon.currency-format/slot.json"));
    expect(parked).toMatchObject({ kind: "voice", status: "parked", contract: { notNeeded: { decidedBy: "planner" } } });

    const computed = runRecordsComputedMatch(root);
    expect(computed.findings.filter(item => !item.subject.startsWith("producer/seat."))).toEqual([]);
  });

  it("is idempotent: a second run changes no byte", () => {
    const root = fixtureCopy();
    migrateSlot1To2(root, OPTIONS);
    const once = tree(root);
    const twice = migrateSlot1To2(root, { ...OPTIONS, at: "2026-12-01T00:00:00Z" });
    expect(twice.written).toEqual([]);
    expect(twice.migrations).toEqual([]);
    expect(twice.current).toHaveLength(446);
    expect(tree(root)).toEqual(once);
  });

  it("reports an input no folder holds and writes nothing for that slot", () => {
    const ws = slot2Workspace();
    const old = JSON.stringify({ schema: "clossys.slot/1", id: "strings.cta.label", agent: "writer", ia: { l0: "strings", l1: "strings.cta", l2: "cta-label", order: 1 }, kind: "strings", contract: { kind: "string" }, inputs: ["identity.missing.thing"], uses: [], standard: "string.label" });
    ws.consumer("writer", "strings.cta.label", old);
    const plan = planSlot1To2(ws.root, OPTIONS);
    expect(plan.findings).toEqual([{ subject: "writer/strings.cta.label", detail: "no consumer slot folder holds identity.missing.thing" }]);
    expect(migrateSlot1To2(ws.root, OPTIONS).written).toEqual([]);
    expect(ws.text("writer", "strings.cta.label")).toBe(old);
  });

  it("takes the installed package base when the package ships one", () => {
    const ws = slot2Workspace();
    ws.base(baseSlot("writer", "sections.hero.copy"));
    ws.consumer("writer", "sections.hero.copy", JSON.stringify({ schema: "clossys.slot/1", id: "sections.hero.copy", agent: "writer", ia: { l0: "passages", l1: "passages.hero", l2: "hero-copy", order: 4 }, kind: "strings", contract: { kind: "passage" }, inputs: [], uses: [], standard: "passage.hero" }));
    migrateSlot1To2(ws.root, OPTIONS);
    const slot = ws.read("writer", "sections.hero.copy");
    expect(slot.base).toMatchObject({ package: "@clossys/writer" });
    expect(slot.ia.order).toBe(4);
    expect(runRecordsComputedMatch(ws.root).status).toBe("pass");
  });

  it("maps ia to slash paths and fills a missing l0 from the id", () => {
    expect(targetIa({ schema: "clossys.slot/1", id: "themes.color.brand", agent: "designer", kind: "element", ia: { l1: "themes.color", l2: "themes.color.brand_main" } })).toEqual({ l0: "themes", l1: "themes/color", l2: "themes/color/brand-main", order: 0 });
  });
});
