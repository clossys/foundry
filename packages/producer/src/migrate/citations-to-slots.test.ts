/**
 * `clossys migrate citations-to-slots`: the one-time codemod from versioned citations and `pin.recited`
 * to slot-id citations. Deterministic, idempotent, and every rewritten pin still validates and clears.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { citationConsumer, HERO, HOME, NEED, pinBytes, writerBytes, type CitationConsumer } from "../records/__fixtures__/citation-consumer.js";
import { sha256Hex } from "../records/hash.js";
import { validatePin } from "../records/slot-model/validate.js";
import { gitBlobId, MIGRATIONS_FILE, MIGRATIONS_SCHEMA, validateMigrations } from "../records/migrations.js";
import { applyCitationsToSlots, planCitationsToSlots } from "./citations-to-slots.js";

let fixture: CitationConsumer | undefined;
afterEach(() => { if (fixture) rmSync(fixture.root, { recursive: true, force: true }); fixture = undefined; });
const read = (path: string) => readFileSync(path, "utf8");

describe("migrate citations-to-slots", () => {
  it("plans the versioned citations and recited pins per agent, and writes nothing", () => {
    fixture = citationConsumer("versioned");
    const hero = join(fixture.dir("writer", HERO), "candidates", "hero-v1.md");
    const before = read(hero);
    const plan = planCitationsToSlots(fixture.consumer);
    expect(plan.findings).toEqual([]);
    expect(plan.counts.director).toEqual({ candidates: 0, citations: 0, anchors: 0, pins: 0, rehashed: 0 });
    // source.ref and the in-text citation; react@18.3.1 and npm/x@1.2.3 are not slot citations.
    expect(plan.counts.writer).toEqual({ candidates: 1, citations: 2, anchors: 0, pins: 1, rehashed: 1 });
    expect(plan.counts.publisher).toEqual({ candidates: 1, citations: 1, anchors: 0, pins: 0, rehashed: 1 });
    expect(plan.totals).toEqual({ candidates: 2, citations: 3, anchors: 0, pins: 1, rehashed: 2 });
    expect(read(hero)).toBe(before);
  });

  it("applies to slot citations, carries each pin's sha256 and keeps its decision, and a second run plans nothing", () => {
    fixture = citationConsumer("versioned");
    const heroPin = join(fixture.dir("writer", HERO), "pin.json");
    const pinBefore = JSON.parse(read(heroPin));
    expect(applyCitationsToSlots(fixture.consumer, planCitationsToSlots(fixture.consumer))).toEqual([]);
    const hero = read(join(fixture.dir("writer", HERO), "candidates", "hero-v1.md"));
    expect(hero).toBe(writerBytes(`director:${NEED}`));
    expect(hero).toContain("react@18.3.1 and npm/x@1.2.3");
    expect(read(join(fixture.dir("publisher", HOME), "candidates", "home-v1.json"))).toContain(`"writer:${HERO}"`);
    const pin = JSON.parse(read(heroPin));
    expect(pin).toEqual({ candidate: pinBefore.candidate, sha256: sha256Hex(hero), decidedBy: pinBefore.decidedBy, basis: pinBefore.basis, at: pinBefore.at });
    expect(validatePin(pin)).toEqual([]);
    const again = planCitationsToSlots(fixture.consumer);
    expect([again.changes, again.findings]).toEqual([[], []]);
  });

  it("records one migrated event per rewritten file, with the bytes' ids before and after, and a re-run adds none", () => {
    fixture = citationConsumer("versioned");
    const files = {
      heroPin: join(fixture.dir("writer", HERO), "pin.json"),
      hero: join(fixture.dir("writer", HERO), "candidates", "hero-v1.md"),
      home: join(fixture.dir("publisher", HOME), "candidates", "home-v1.json"),
      homePin: join(fixture.dir("publisher", HOME), "pin.json"),
    };
    const before = Object.fromEntries(Object.entries(files).map(([key, path]) => [key, readFileSync(path)]));
    const manifest = join(fixture.consumer, MIGRATIONS_FILE);
    expect(existsSync(manifest)).toBe(false);
    const at = "2026-11-13T18:00:00.000Z";
    expect(applyCitationsToSlots(fixture.consumer, planCitationsToSlots(fixture.consumer), { by: "planner", at })).toEqual([]);
    const doc = JSON.parse(read(manifest));
    expect(validateMigrations(doc)).toEqual([]);
    expect(doc.schema).toBe(MIGRATIONS_SCHEMA);
    const rel = (path: string) => path.slice(fixture!.consumer.length + 1).split("\\").join("/");
    const state = (bytes: Buffer | string) => ({ sha256: sha256Hex(bytes), blob: gitBlobId(bytes) });
    const expected = Object.entries(files).map(([key, path]) => ({ type: "migrated", migration: "citations-to-slots", file: rel(path), from: state(before[key]!), to: state(readFileSync(path)), by: "planner", at }));
    expect([...doc.events].sort((a, b) => a.file.localeCompare(b.file))).toEqual(expected.sort((a, b) => a.file.localeCompare(b.file)));
    // Idempotent: the second run plans nothing, rewrites nothing and records nothing.
    const bytes = read(manifest);
    expect(applyCitationsToSlots(fixture.consumer, planCitationsToSlots(fixture.consumer), { by: "planner", at: "2026-11-14T00:00:00.000Z" })).toEqual([]);
    expect(read(manifest)).toBe(bytes);
  });

  it("re-addresses the pinned candidate's line anchors to its pin's recited version before dropping recited", () => {
    fixture = citationConsumer("versioned");
    const dir = fixture.dir("writer", HERO);
    const heroPin = join(dir, "pin.json"), heroPath = join(dir, "candidates", "hero-v1.md"), draftPath = join(dir, "candidates", "hero-v2.md");
    // A pointer-only recite to need-v2: the overlay read the record's `directorSources` anchor @1 as @2.
    const before = read(heroPath);
    writeFileSync(heroPin, pinBytes("hero-v1.md", before, "2026-11-02T00:00:00Z", { recited: { at: "2026-11-02T00:00:00Z", cites: { [`director:${NEED}`]: 2 } } }));
    // An unpinned candidate is no pin's overlay: its anchor keeps its version.
    writeFileSync(draftPath, before);
    const plan = planCitationsToSlots(fixture.consumer);
    expect(plan.findings).toEqual([]);
    expect(plan.counts.writer).toEqual({ candidates: 2, citations: 4, anchors: 1, pins: 1, rehashed: 1 });
    expect(applyCitationsToSlots(fixture.consumer, plan)).toEqual([]);
    const hero = read(heroPath);
    expect(hero).toBe(writerBytes(`director:${NEED}`).replace(`"ref":"director:${NEED}@1","line":3`, `"ref":"director:${NEED}@2","line":3`));
    expect(read(draftPath)).toBe(writerBytes(`director:${NEED}`));
    const pin = JSON.parse(read(heroPin));
    expect(pin).toEqual({ candidate: "hero-v1.md", sha256: sha256Hex(hero), decidedBy: "owner:fixture", basis: "picked", at: "2026-11-02T00:00:00Z" });
    const again = planCitationsToSlots(fixture.consumer);
    expect([again.changes, again.findings]).toEqual([[], []]);
  });

  it("refuses a slot whose records moved since the plan and leaves it as it is", () => {
    fixture = citationConsumer("versioned");
    const plan = planCitationsToSlots(fixture.consumer);
    const heroPath = join(fixture.dir("writer", HERO), "candidates", "hero-v1.md");
    const moved = `${read(heroPath)}\n`;
    // A concurrent edit after the plan: the writer's slot is refused alone, the publisher's applies.
    writeFileSync(heroPath, moved);
    const refused = applyCitationsToSlots(fixture.consumer, plan);
    expect(refused.map(row => row.slot)).toEqual([HERO]);
    expect(read(heroPath)).toBe(moved);
    expect(read(join(fixture.dir("publisher", HOME), "candidates", "home-v1.json"))).toContain(`"writer:${HERO}"`);
  });

  it("leaves a model already in slot citations unchanged", () => {
    fixture = citationConsumer("slot");
    const plan = planCitationsToSlots(fixture.consumer);
    expect([plan.changes, plan.findings, plan.totals]).toEqual([[], [], { candidates: 0, citations: 0, anchors: 0, pins: 0, rehashed: 0 }]);
  });
});
