import { describe, expect, it } from "vitest";
import { AT, cleanSpec, contextOf, expectCatches, ledgerDoc, ledgerEvent, sha, slotDoc, validPin, type WorkspaceSpec } from "../__fixtures__/workspace.js";
import { R02, ledgerDecision, pinBasis, pinMatchesLedger, upstreamPinned } from "./R02-pins-order.js";

const clean = () => contextOf(cleanSpec());
const broken = (edit: (spec: WorkspaceSpec) => void) => { const spec = cleanSpec(); edit(spec); return contextOf(spec); };
const VOICE = "---\nsource:\n  kind: authored\n---\nCalm and plain.\n";
const reasons = (rows: { slot: string; reason: string }[]) => rows.map(row => `${row.slot}: ${row.reason}`).sort();

describe("R02.1 pin basis and decidedBy", () => {
  it("passes closed bases and real deciders", () => {
    expect(pinBasis(clean())).toEqual([]);
    const ok = broken(spec => {
      spec.director!["brand.voice"]!.pin = { ...validPin("voice-v1.md", VOICE), decidedBy: "agent:director", basis: "agent" };
      spec.writer!["home.hero"]!.pin = { ...validPin("hero-v1.md", "---\nsource:\n  kind: authored\n---\nWelcome.\n"), decidedBy: "owner:2026-11-13 chat", basis: "picked" };
    });
    expect(pinBasis(ok)).toEqual([]);
  });

  it("flags a basis outside PIN_BASES, a decidedBy outside DECIDED_BY and the migration forms", () => {
    const rows = expectCatches(pinBasis, clean(), broken(spec => {
      spec.director!["brand.voice"]!.pin = { ...validPin("voice-v1.md", VOICE), basis: "vibes" };
      spec.writer!["home.hero"]!.pin = { ...validPin("hero-v1.md", "---\nsource:\n  kind: authored\n---\nWelcome.\n"), decidedBy: "migrated" };
      spec.producer!["seat.director"]!.pin = { ...validPin("director-v1.json", `${JSON.stringify({ by: "owner", llm: null, human: null }, null, 2)}\n`), decidedBy: "migration:citations-to-slots" };
      spec.designer!["ui.button"]!.pin = { ...validPin("button-v1.json", "x"), decidedBy: "somebody" };
    }));
    expect(reasons(rows)).toEqual([
      "brand.voice: basis \"vibes\" is not one of picked, bulk, planner, agent",
      "home.hero: decidedBy migrated is a migration form; a pin names its decider (owner, planner or agent:<seat>)",
      "seat.director: decidedBy migration:citations-to-slots is a migration form; a pin names its decider (owner, planner or agent:<seat>)",
      "ui.button: decidedBy \"somebody\" does not match DECIDED_BY",
    ]);
  });
});

describe("R02.2 upstream pinned before downstream", () => {
  it("passes when every dependency is live and intactly pinned", () => {
    expect(upstreamPinned(clean())).toEqual([]);
  });

  it("flags an unpinned, a not-live, a missing and a drifted dependency", () => {
    const rows = expectCatches(upstreamPinned, clean(), broken(spec => {
      spec.designer!["ui.button"]!.pin = false;
      spec.director!["brand.voice"]!.live = false;
      spec.publisher!["site.home"]!.slot = slotDoc("publisher", "site.home", { inputs: ["ui.card", "home.hero", "ui.ghost"] });
      spec.designer!["ui.card"]!.pin = { ...validPin("card-v1.json", "not the bytes"), at: AT };
    }));
    expect(reasons(rows)).toEqual([
      "home.hero: dependency set not pinned upstream: brand.voice is not live",
      "site.home: dependency set not pinned upstream: ui.card pinned candidate card-v1.json bytes do not match the pin, ui.ghost is not live",
      "ui.card: dependency set not pinned upstream: ui.button unpinned",
    ]);
  });

  it("does not hold a not-live slot to its dependencies", () => {
    const ctx = broken(spec => { spec.designer!["ui.button"]!.pin = false; spec.designer!["ui.card"]!.live = false; spec.publisher!["site.home"]!.slot = slotDoc("publisher", "site.home", { inputs: ["home.hero"] }); });
    expect(upstreamPinned(ctx)).toEqual([]);
  });
});

describe("R02.3 pin equals the last ledger decision", () => {
  const HERO = "---\nsource:\n  kind: authored\n---\nWelcome.\n";
  const submit = ledgerEvent("submit", "submit", "packages/writer/actions/writer.candidates/skill.md", { name: "hero-v1.md", sha256: sha(HERO) });
  const pinEvent = (fields: Record<string, unknown>) => ledgerEvent("pin", "pin", "packages/producer/actions/pin.writer/skill.md", { candidate: "hero-v1.md", sha256: sha(HERO), decidedBy: "planner", basis: "planner", ...fields });

  it("passes the fixture's mirrored pin events, and a pin whose bytes a later migrate event rewrote", () => {
    expect(pinMatchesLedger(clean())).toEqual([]);
    const migrated = "---\nsource:\n  kind: authored\n---\nWelcome!\n";
    const ctx = broken(spec => {
      const hero = spec.writer!["home.hero"]!;
      hero.candidates = { "hero-v1.md": migrated };
      hero.pin = { ...validPin("hero-v1.md", migrated) };
      hero.ledger = ledgerDoc([submit, pinEvent({}), ledgerEvent("migrate", "migrate", "packages/producer/actions/migrate/action.json", { migration: "citations-to-slots", files: [{ name: "hero-v1.md", from: sha(HERO), to: sha(migrated) }] })]);
    });
    expect(pinMatchesLedger(ctx)).toEqual([]);
  });

  it("flags a pin that differs from its last decision, a pin with no decision event and a pin with no ledger", () => {
    const rows = expectCatches(pinMatchesLedger, clean(), broken(spec => {
      spec.writer!["home.hero"]!.ledger = ledgerDoc([submit, pinEvent({}), pinEvent({ candidate: "hero-v2.md", decidedBy: "owner", at: "2026-11-14T00:00:00Z" })]);
      spec.director!["brand.voice"]!.ledger = ledgerDoc([ledgerEvent("submit", "submit", "packages/director/actions/director.candidates/skill.md", { name: "voice-v1.md", sha256: sha(VOICE) })]);
      spec.designer!["ui.button"]!.ledger = false;
    }));
    expect(reasons(rows)).toEqual([
      "brand.voice: the slot ledger has no pin, pick or verdict event for this pin",
      "home.hero: pin differs from the last pin event (2026-11-14T00:00:00Z) in candidate, decidedBy, at",
      "ui.button: the slot has no ledger.json; the pin has no decision event",
    ]);
  });

  it("takes the last decision event and carries its sha only through a matching migrate event", () => {
    const a = "a".repeat(64), b = "b".repeat(64), c = "c".repeat(64);
    const events = [
      { op: "pick", candidate: "x-v1.md", sha256: a },
      { op: "submit", name: "x-v2.md", sha256: b },
      { op: "verdict", candidate: "x-v2.md", sha256: b },
      { op: "migrate", files: [{ name: "x-v1.md", from: a, to: c }] },
      { op: "migrate", files: [{ name: "x-v2.md", from: a, to: c }] },
    ];
    expect(ledgerDecision(events)).toMatchObject({ op: "verdict", candidate: "x-v2.md", sha256: b });
    expect(ledgerDecision([...events, { op: "migrate", files: [{ name: "x-v2.md", from: b, to: c }] }])).toMatchObject({ sha256: c });
    expect(ledgerDecision([{ op: "submit" }])).toBeUndefined();
  });
});

it("registers R02.1-R02.3 as the rule's checks", () => {
  expect(Object.keys(R02.checks)).toEqual(["R02.1", "R02.2", "R02.3"]);
});
