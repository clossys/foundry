/**
 * The re-pin cascade (planner D2). Citations name slot ids and resolve through the cited pin, so an
 * upstream re-pin flags no downstream candidate as stale and opens no candidate or pick work; instead
 * every step that read the moved pin goes stale by its input digests (wiring.ts runState), and
 * `clossys run` re-derives and re-certifies downstream.
 */
import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { citationConsumer, HERO, NEED, type CitationConsumer } from "../records/__fixtures__/citation-consumer.js";
import { citationResolver } from "../records/citations.js";
import { writePin } from "../records/slot-write.js";
import { readCandidate } from "../records/slots.js";
import { contextOf, openItems } from "./chain.js";
import { gapsOf } from "./interview.js";
import { STEPS } from "./steps/index.js";
import { buildRecord, observe } from "./trace.js";
import { runState } from "./wiring.js";
import type { Step } from "./define.js";

let fixture: CitationConsumer | undefined;
afterEach(() => { if (fixture) rmSync(fixture.root, { recursive: true, force: true }); fixture = undefined; });

const pinWriter = STEPS.find(step => step.id === "pin.writer")!;
/** The decide counters a downstream re-draft or re-pick would open: candidate work and the pick. */
const downstreamSteps: Step[] = [
  pinWriter,
  { ...pinWriter, id: "writer.candidates", open: "slots-without-candidates:writer" },
  { ...pinWriter, id: "pin.publisher", open: "slots-undecided:publisher" },
  { ...pinWriter, id: "publisher.candidates", open: "slots-without-candidates:publisher" },
];
const opened = (root: string) => {
  const context = contextOf(root, STEPS);
  return downstreamSteps.flatMap(step => openItems(step, context));
};
const repin = (consumer: string) => writePin(consumer, "director", NEED, "need-v2.md", { decidedBy: "owner:fixture", basis: "picked", at: "2026-11-05T00:00:00Z" });

describe("an upstream re-pin", () => {
  it("opens no downstream candidate or pick work and raises no stale-citation gap", () => {
    fixture = citationConsumer();
    expect(opened(fixture.root)).toEqual([]);
    const hero = readCandidate(fixture.consumer, "writer", HERO, "hero-v1.md").bytes;
    repin(fixture.consumer);
    expect(opened(fixture.root)).toEqual([]);
    expect(gapsOf(fixture.root).gaps.filter(gap => gap.code === "citation.stale")).toEqual([]);
    // No new downstream candidate; the citing candidate's bytes are as they were.
    expect(readCandidate(fixture.consumer, "writer", HERO, "hero-v1.md").bytes).toBe(hero);
  }, 60_000);

  it("re-addresses the downstream citation and makes a run that resolved it stale on the moved pin", () => {
    fixture = citationConsumer();
    const root = fixture.root;
    const start = new Date("2026-11-04T00:00:00Z");
    // A derive/check run that resolves the Writer candidate's citation, as compile and derive do.
    const watch = observe();
    const before = citationResolver(fixture.consumer)(`director:${NEED}`);
    const observation = watch.stop();
    expect(before?.version).toBe(1);
    const record = buildRecord({ root, step: "derive.uses", invocation: "derive.uses", argv: [], start, end: start, exit: 0, observation });
    expect(record.reads.map(entry => entry.path)).toContain(`clossys/agents/director/${NEED}/pin.json`);
    expect(runState(root, record)).toEqual({ state: "passed", changed: [] });
    repin(fixture.consumer);
    expect(citationResolver(fixture.consumer)(`director:${NEED}`)?.version).toBe(2);
    expect(runState(root, record)).toEqual({ state: "stale", changed: [`clossys/agents/director/${NEED}/pin.json`] });
  });

  it("is a plumb-step input wherever downstream derives and checks read pins", () => {
    for (const id of ["derive.uses", "compile"]) {
      const step = STEPS.find(each => each.id === id)!;
      expect(step.inputs.map(port => port.glob), id).toContain("clossys/agents/*/*/pin.json");
    }
  });
});
