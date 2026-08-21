import { describe, expect, it } from "vitest";
import { appendEntry } from "./append.js";
import { citeFact } from "./fact.js";
import type { Ledger, PublicationEntry } from "./types.js";

function entry(id: string): PublicationEntry {
  return {
    id,
    publishedAt: "2026-08-07T14:03:00.000Z",
    channel: "web",
    strategyRevision: "strategy@1.4.0",
    factCitations: [citeFact("active-customers", 4200)],
  };
}

describe("appendEntry", () => {
  it("returns a new ledger with the entry appended, leaving the input untouched", () => {
    const empty: Ledger = [];
    const withOne = appendEntry(empty, entry("a"));
    expect(empty).toEqual([]);
    expect(withOne.map((e) => e.id)).toEqual(["a"]);

    const withTwo = appendEntry(withOne, entry("b"));
    expect(withOne.map((e) => e.id)).toEqual(["a"]); // still untouched
    expect(withTwo.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("throws, rather than silently overwriting, when the id already exists", () => {
    const ledger = appendEntry([], entry("dup"));
    expect(() => appendEntry(ledger, entry("dup"))).toThrow(/already exists/);
    // and the original ledger is provably unaffected
    expect(ledger.length).toBe(1);
  });

  it("throws on a malformed entry rather than appending it", () => {
    const malformed = { ...entry("bad"), channel: "" };
    expect(() => appendEntry([], malformed)).toThrow(/malformed entry/);
  });

  it("returns a deep-frozen ledger — mutating a returned entry throws", () => {
    const ledger = appendEntry([], entry("frozen"));
    expect(() => {
      (ledger[0] as unknown as Record<string, unknown>).channel = "email";
    }).toThrow(TypeError);
    expect(ledger[0]?.channel).toBe("web");
  });

  it("mutating the array returned by appendEntry itself throws (frozen array)", () => {
    const ledger = appendEntry([], entry("frozen-array"));
    expect(() => {
      (ledger as unknown as PublicationEntry[]).push(entry("intruder"));
    }).toThrow(TypeError);
    expect(ledger.length).toBe(1);
  });

  it("deep-freezes nested structures too — a citation's binding cannot be mutated", () => {
    const ledger = appendEntry([], entry("nested-frozen"));
    const citation = ledger[0]?.factCitations[0];
    expect(citation).toBeDefined();
    expect(() => {
      (citation as unknown as Record<string, unknown>).factRef = "different-fact";
    }).toThrow(TypeError);
  });
});
