import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { skillFile } from "../../records/ledger.js";
import { buildContext } from "../context.js";
import { cleanSpec, contextOf, expectCatches, FIXTURE_SKILL_SHA, ledgerDoc, ledgerEvent, NO_FOUNDRY_LEAVES, NO_HISTORY, sha, validPin, writeWorkspace, type FixtureExtras, type WorkspaceSpec } from "../__fixtures__/workspace.js";
import { R14, eventsNameSkill, llmNamesModel, recordsMatchLedger } from "./R14-provenance.js";

const clean = () => contextOf(cleanSpec());
const broken = (edit: (spec: WorkspaceSpec) => void, extras: FixtureExtras = {}) => { const spec = cleanSpec(); edit(spec); return contextOf(spec, extras); };
const reasons = (rows: { agent: string; slot: string; reason: string; candidate?: string }[]) => rows.map(row => `${row.agent}:${row.slot}${row.candidate ? `/${row.candidate}` : ""}: ${row.reason}`).sort();
const HERO = "---\nsource:\n  kind: authored\n---\nWelcome.\n";
const heroSubmit = (fields: Record<string, unknown> = {}) => ledgerEvent("submit", "submit", "packages/writer/actions/writer.candidates/skill.md", { name: "hero-v1.md", sha256: sha(HERO), ...fields });

describe("R14.1 every record byte state matches a ledger event", () => {
  it("passes the fixture, whose ledgers record every candidate, pin, slot.json and ia.json", () => {
    expect(recordsMatchLedger(clean())).toEqual([]);
  });

  it("flags every record of a slot without a ledger, one row per record", () => {
    const rows = expectCatches(recordsMatchLedger, clean(), broken(spec => { spec.designer!["ui.button"]!.ledger = false; }));
    expect(reasons(rows)).toEqual([
      "designer:ui.button/button-v1.json: candidate button-v1.json has no provenance: slot has no ledger.json",
      "designer:ui.button: pin.json has no provenance: slot has no ledger.json",
      "designer:ui.button: slot.json has no provenance: slot has no ledger.json",
    ]);
  });

  it("flags drifted bytes, an unsubmitted candidate, an unrecorded pin, a removed record and a drifted ia.json", () => {
    const rows = expectCatches(recordsMatchLedger, clean(), broken(spec => {
      const hero = spec.writer!["home.hero"]!;
      hero.candidates = { "hero-v1.md": HERO, "hero-v2.md": "---\nsource:\n  kind: authored\n---\nHi.\n" };
      hero.ledger = ledgerDoc([heroSubmit({ sha256: sha("other bytes") })]);
      spec.director!["brand.voice"]!.pin = false;
      spec.director!["brand.voice"]!.ledger = ledgerDoc([
        ledgerEvent("submit", "submit", "packages/director/actions/director.candidates/skill.md", { name: "voice-v1.md", sha256: sha("---\nsource:\n  kind: authored\n---\nCalm and plain.\n") }),
        ledgerEvent("pin", "pin", "packages/producer/actions/pin.director/skill.md", { candidate: "voice-v1.md", sha256: "a".repeat(64), decidedBy: "planner", basis: "planner" }, [{ file: "pin.json", sha256: "b".repeat(64) }]),
        ledgerEvent("slot", "ia", "packages/producer/actions/ia/skill.md", {}, [{ file: "slot.json", sha256: null }]),
      ]);
    }, { agentLedger: { publisher: ledgerDoc([ledgerEvent("ia", "ia", "packages/producer/actions/ia/skill.md", {}, [{ file: "ia.json", sha256: "c".repeat(64) }])]) } }));
    expect(reasons(rows)).toEqual([
      expect.stringMatching(/^director:brand\.voice: pin\.json is absent but its last ledger event recorded bbbbbbbbbbbb$/),
      expect.stringMatching(/^director:brand\.voice: slot\.json exists but its last ledger event removed it$/),
      expect.stringMatching(/^publisher:\*: ia\.json bytes \([0-9a-f]{12}\) differ from its last ledger event \(cccccccccccc\)$/),
      expect.stringMatching(/^writer:home\.hero\/hero-v1\.md: candidate hero-v1\.md bytes \([0-9a-f]{12}\) differ from its submit event/),
      "writer:home.hero/hero-v2.md: candidate hero-v2.md has no submit event",
      "writer:home.hero: pin.json has no ledger event that wrote it",
      "writer:home.hero: slot.json has no ledger event that wrote it",
    ]);
  });

  it("proves nothing from an unreadable or malformed ledger, and flags an agent without one", () => {
    const rows = expectCatches(recordsMatchLedger, clean(), broken(spec => {
      spec.writer!["home.hero"]!.ledger = "{not json";
      spec.director!["brand.voice"]!.ledger = ledgerDoc([{ ...heroSubmit(), op: "dance" }]);
    }, { agentLedger: { producer: false } }));
    expect(reasons(rows)).toEqual([
      expect.stringMatching(/^director:brand\.voice\/voice-v1\.md: candidate voice-v1\.md has no provenance: slot ledger\.json is malformed: events\[0\]: op dance is not a slot ledger op$/),
      expect.stringMatching(/^director:brand\.voice: pin\.json has no provenance/),
      expect.stringMatching(/^director:brand\.voice: slot ledger\.json is malformed.*no record of this slot has provenance$/),
      expect.stringMatching(/^director:brand\.voice: slot\.json has no provenance/),
      "producer:*: ia.json has no provenance: agent has no ledger.json",
      expect.stringMatching(/^writer:home\.hero\/hero-v1\.md: candidate hero-v1\.md has no provenance: slot ledger\.json is unreadable/),
      expect.stringMatching(/^writer:home\.hero: pin\.json has no provenance/),
      expect.stringMatching(/^writer:home\.hero: slot ledger\.json is unreadable/),
      expect.stringMatching(/^writer:home\.hero: slot\.json has no provenance/),
    ]);
  });

  it("carries a candidate's submit sha through a migrate event that rewrote it", () => {
    const rewritten = "---\nsource:\n  kind: authored\n---\nWelcome!\n";
    const ctx = broken(spec => {
      const hero = spec.writer!["home.hero"]!;
      hero.candidates = { "hero-v1.md": rewritten };
      hero.pin = false;
      hero.slot = false;
      hero.ledger = ledgerDoc([heroSubmit(), ledgerEvent("migrate", "migrate", "packages/producer/actions/migrate/action.json", { migration: "citations-to-slots", files: [{ name: "hero-v1.md", from: sha(HERO), to: sha(rewritten) }] })]);
    });
    expect(recordsMatchLedger(ctx)).toEqual([]);
  });
});

describe("R14.2 every event names a verb and a known action skill", () => {
  it("passes events whose skill sha256 the context knows", () => {
    expect(eventsNameSkill(clean())).toEqual([]);
  });

  it("flags an unknown verb, a non-skill path, a missing skill file and an unknown skill state", () => {
    const rows = expectCatches(eventsNameSkill, clean(), broken(spec => {
      spec.writer!["home.hero"]!.ledger = ledgerDoc([
        heroSubmit({ verb: "dance" }),
        heroSubmit({ skill: { path: "docs/skill.md", sha256: FIXTURE_SKILL_SHA } }),
        heroSubmit({ skill: { path: "packages/producer/actions/retire/skill.md", sha256: null } }),
        heroSubmit({ skill: { path: "packages/writer/actions/writer.candidates/skill.md", sha256: "d".repeat(64) } }),
      ]);
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason.split(", events")).toEqual([
      "events[0] (submit) verb \"dance\" is not in the verb table",
      "[1] (submit) names no action skill (packages/<pkg>/actions/<step>/skill.md)",
      "[2] (submit) ran packages/producer/actions/retire/skill.md while that file was missing (skill.sha256 null)",
      "[3] (submit) skill packages/writer/actions/writer.candidates/skill.md sha256 dddddddddddd is neither the installed file's nor listed in skill-hashes.json",
    ]);
  });

  it("reads agent ledgers too, and the installed skills by default", () => {
    const rows = eventsNameSkill(broken(() => {}, { agentLedger: { writer: ledgerDoc([{ ...ledgerEvent("ia", "ia", "packages/producer/actions/ia/skill.md"), verb: "dance" }]), director: false } }));
    expect(rows).toEqual([expect.objectContaining({ agent: "writer", slot: "*", path: "clossys/agents/writer/ledger.json", reason: "events[0] (ia) verb \"dance\" is not in the verb table" })]);
    const { root, consumer } = writeWorkspace(cleanSpec());
    const installed = eventsNameSkill(buildContext(root, consumer, { history: () => NO_HISTORY, foundryLeaves: NO_FOUNDRY_LEAVES }));
    expect(installed.length).toBeGreaterThan(0);
    expect(installed[0]!.reason).toMatch(/is neither the installed file's nor listed in skill-hashes\.json/);
  });
});

describe("R14.2 a plumb action's events may cite its action.json instead of a skill", () => {
  const MIGRATE_ACTION = "packages/producer/actions/migrate/action.json";
  const migrateEvent = (skill: { path: string; sha256: string | null }) => ({ ...ledgerEvent("migrate", "migrate", MIGRATE_ACTION, { migration: "citations-to-slots", files: [] }), skill });
  const heroLedger = (...events: Record<string, unknown>[]) => (spec: WorkspaceSpec) => { spec.writer!["home.hero"]!.ledger = ledgerDoc([heroSubmit(), ...events]); };

  it("reads the step kinds from the installed actions registry", () => {
    const ctx = clean();
    expect(ctx.actionKind("producer", "migrate")).toBe("plumb");
    expect(ctx.actionKind("producer", "pin.writer")).toBe("decide:judgment");
    expect(ctx.actionKind("writer", "writer.candidates")).toBe("decide:creative");
    expect(ctx.actionKind("producer", "no-such-step")).toBeUndefined();
  });

  it("passes a plumb event that cites its action.json with a known sha256", () => {
    expect(eventsNameSkill(broken(heroLedger(migrateEvent({ path: MIGRATE_ACTION, sha256: FIXTURE_SKILL_SHA }))))).toEqual([]);
  });

  it("fails a decide event (or an unregistered step's) that cites action.json instead of its skill.md", () => {
    const rows = expectCatches(eventsNameSkill, clean(), broken(heroLedger(
      ledgerEvent("pin", "pin", "packages/producer/actions/pin.writer/action.json", { candidate: "hero-v1.md", sha256: sha(HERO), decidedBy: "planner", basis: "planner" }),
      heroSubmit({ skill: { path: "packages/writer/actions/writer.candidates/action.json", sha256: FIXTURE_SKILL_SHA } }),
      migrateEvent({ path: "packages/producer/actions/no-such-step/action.json", sha256: FIXTURE_SKILL_SHA }),
    )));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason.split(", events")).toEqual([
      "events[1] (pin) cites packages/producer/actions/pin.writer/action.json, but only a plumb action's events may cite its action.json; the registry has it as decide:judgment, whose events cite its skill.md",
      "[2] (submit) cites packages/writer/actions/writer.candidates/action.json, but only a plumb action's events may cite its action.json; the registry has it as decide:creative, whose events cite its skill.md",
      "[3] (migrate) cites packages/producer/actions/no-such-step/action.json, but only a plumb action's events may cite its action.json; the actions registry has no such step",
    ]);
  });

  it("fails a plumb event that cites its action.json with an unknown or a missing sha256", () => {
    const rows = expectCatches(eventsNameSkill, clean(), broken(heroLedger(
      migrateEvent({ path: MIGRATE_ACTION, sha256: "e".repeat(64) }),
      migrateEvent({ path: MIGRATE_ACTION, sha256: null }),
    )));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason.split(", events")).toEqual([
      `events[1] (migrate) skill ${MIGRATE_ACTION} sha256 eeeeeeeeeeee is neither the installed file's nor listed in skill-hashes.json`,
      `[2] (migrate) ran ${MIGRATE_ACTION} while that file was missing (skill.sha256 null)`,
    ]);
  });

  it("knows the installed action.json by default, and a registry that says decide refuses it", () => {
    const installed = createHash("sha256").update(readFileSync(skillFile(MIGRATE_ACTION))).digest("hex");
    const spec = cleanSpec();
    spec.writer!["home.hero"]!.ledger = ledgerDoc([migrateEvent({ path: MIGRATE_ACTION, sha256: installed })]);
    const { root, consumer } = writeWorkspace(spec);
    const own = (ctx: ReturnType<typeof buildContext>) => eventsNameSkill(ctx).filter(row => row.agent === "writer" && row.slot === "home.hero");
    expect(own(buildContext(root, consumer, { history: () => NO_HISTORY, foundryLeaves: NO_FOUNDRY_LEAVES }))).toEqual([]);
    const decide = own(buildContext(root, consumer, { history: () => NO_HISTORY, foundryLeaves: NO_FOUNDRY_LEAVES, actionKind: () => "decide:judgment" }));
    expect(decide.map(row => row.reason)).toEqual([expect.stringMatching(/^events\[0\] \(migrate\) cites .*the registry has it as decide:judgment/)]);
  });
});

describe("R14.3 LLM events name model and tier", () => {
  it("passes deterministic none/none events and an LLM verb with model and tier", () => {
    expect(llmNamesModel(clean())).toEqual([]);
    const ctx = broken(spec => { spec.writer!["home.hero"]!.ledger = ledgerDoc([heroSubmit({ model: "claude-opus-5-5", tier: "high" }), ledgerEvent("verdict", "verdict", "packages/writer/actions/verdict/skill.md", { model: "gpt-5.5", tier: "mid" })]); });
    expect(llmNamesModel(ctx)).toEqual([]);
  });

  it("flags an LLM verb without a model, a deterministic verb with one, a half pair and a missing pair", () => {
    const rows = expectCatches(llmNamesModel, clean(), broken(spec => {
      spec.writer!["home.hero"]!.ledger = ledgerDoc([
        ledgerEvent("verdict", "verdict", "packages/writer/actions/verdict/skill.md"),
        { ...ledgerEvent("pin", "pin", "packages/producer/actions/pin.writer/skill.md"), model: "claude-opus-5-5", tier: "high" },
        heroSubmit({ model: "claude-opus-5-5", tier: "none" }),
        (({ model: _model, tier: _tier, ...rest }) => rest)(heroSubmit()),
      ]);
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason.split(", events")).toEqual([
      "events[0] (verdict) verb verdict runs an LLM and must name its model and tier",
      "[1] (pin) verb pin is deterministic and records model none, tier none",
      "[2] (submit) model claude-opus-5-5 with tier none is neither none/none nor a model with tier low|mid|high",
      "[3] (submit) names no model and tier (deterministic verbs record model none, tier none)",
    ]);
  });
});

it("registers R14.1-R14.3 as the rule's checks", () => {
  expect(Object.keys(R14.checks)).toEqual(["R14.1", "R14.2", "R14.3"]);
  expect(validPin("a", "b").sha256).toBe(sha("b"));
});
