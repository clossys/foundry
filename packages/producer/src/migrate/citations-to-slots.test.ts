/**
 * `clossys migrate citations-to-slots`: the one-time codemod from versioned citations and `pin.recited`
 * to slot-id citations. Deterministic, idempotent, and every rewritten pin still validates and clears.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { citationConsumer, HERO, HOME, NEED, writerBytes, type CitationConsumer } from "../records/__fixtures__/citation-consumer.js";
import { sha256Hex } from "../records/hash.js";
import { validatePin } from "../records/slot-model/validate.js";
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
    expect(plan.counts.director).toEqual({ candidates: 0, citations: 0, pins: 0, rehashed: 0 });
    // source.ref and the in-text citation; react@18.3.1 and npm/x@1.2.3 are not slot citations.
    expect(plan.counts.writer).toEqual({ candidates: 1, citations: 2, pins: 1, rehashed: 1 });
    expect(plan.counts.publisher).toEqual({ candidates: 1, citations: 1, pins: 0, rehashed: 1 });
    expect(plan.totals).toEqual({ candidates: 2, citations: 3, pins: 1, rehashed: 2 });
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
    expect([plan.changes, plan.findings, plan.totals]).toEqual([[], [], { candidates: 0, citations: 0, pins: 0, rehashed: 0 }]);
  });
});
