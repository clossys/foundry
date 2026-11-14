/**
 * The one citation resolver (planner D2): a citation names a slot id and means that slot's pinned
 * candidate when it is read. A re-pin re-addresses it; nothing about the citing candidate changes.
 */
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { citationConsumer, HERO, NEED, type CitationConsumer } from "./__fixtures__/citation-consumer.js";
import { citationResolver, isVersionedCitation, resolveCitation, sourceCitations } from "./citations.js";
import { writePin } from "./slot-write.js";
import { readCandidate } from "./slots.js";

let fixture: CitationConsumer | undefined;
afterEach(() => { if (fixture) rmSync(fixture.root, { recursive: true, force: true }); fixture = undefined; });

describe("resolveCitation", () => {
  it("resolves `<agent>:<slot>` and a bare slot id to the cited slot's pinned candidate", () => {
    fixture = citationConsumer();
    const pinned = { agent: "director", slot: NEED, candidate: "need-v1.md", version: 1 };
    expect(resolveCitation(fixture.consumer, `director:${NEED}`)).toMatchObject(pinned);
    expect(resolveCitation(fixture.consumer, NEED)).toMatchObject(pinned);
    expect(resolveCitation(fixture.consumer, NEED)?.sha256).toBe(JSON.parse(readFileSync(join(fixture.dir("director", NEED), "pin.json"), "utf8")).sha256);
  });

  it("resolves nothing for another agent's prefix, an unknown slot, the retired versioned form or a non-citation", () => {
    fixture = citationConsumer();
    expect(resolveCitation(fixture.consumer, `writer:${NEED}`)).toBeUndefined();
    expect(resolveCitation(fixture.consumer, "brief.missing")).toBeUndefined();
    expect(resolveCitation(fixture.consumer, `director:${NEED}@1`)).toBeUndefined();
    expect(resolveCitation(fixture.consumer, "https://example.com/x")).toBeUndefined();
    expect(isVersionedCitation(`director:${NEED}@1`)).toBe(true);
    expect(isVersionedCitation(`director:${NEED}`)).toBe(false);
  });

  it("resolves nothing for an unpinned slot, and follows a re-pin without touching the citing candidate", () => {
    fixture = citationConsumer();
    const citing = readCandidate(fixture.consumer, "writer", HERO, "hero-v1.md").bytes;
    writePin(fixture.consumer, "director", NEED, "need-v2.md", { decidedBy: "owner:fixture", basis: "picked", at: "2026-11-05T00:00:00Z" });
    const resolve = citationResolver(fixture.consumer);
    expect(resolve(`director:${NEED}`)).toMatchObject({ candidate: "need-v2.md", version: 2 });
    expect(readCandidate(fixture.consumer, "writer", HERO, "hero-v1.md").bytes).toBe(citing);
    rmSync(join(fixture.dir("director", NEED), "pin.json"));
    expect(resolveCitation(fixture.consumer, `director:${NEED}`)).toBeUndefined();
  });

  it("reads a candidate's `source.ref` citations of one agent, flagging the retired versioned form", () => {
    expect(sourceCitations({ source: { kind: "derived", ref: [`director:${NEED}`, `director:${NEED}@2`, `writer:${HERO}`, "https://example.com"] } }, "director")).toEqual([
      { slot: NEED, ref: `director:${NEED}`, versioned: false },
      { slot: NEED, ref: `director:${NEED}@2`, versioned: true },
    ]);
  });
});
