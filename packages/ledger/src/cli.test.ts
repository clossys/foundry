import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliInputError, main } from "./cli.js";
import { citeFact } from "./fact.js";
import type { PublicationEntry } from "./types.js";

// Hermetic: every test operates on its own `mkdtemp` directory, removed
// afterward, and calls the exported `main(argv)` directly rather than
// spawning the real CLI process — the same discipline
// @vespeneventures/strategy's cli.test.ts uses.

let dir: string;

function entry(id: string, factCitations: PublicationEntry["factCitations"]): PublicationEntry {
  return {
    id,
    publishedAt: "2026-08-07T14:03:00.000Z",
    channel: "web",
    strategyRevision: "strategy@1.4.0",
    factCitations,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ledger-cli-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function writeLedger(name: string, entries: PublicationEntry[]): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(entries));
  return path;
}

function writeCurrentValues(name: string, values: Record<string, unknown>): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(values));
  return path;
}

describe("main — argument handling", () => {
  it("--help returns 0 without touching either file", () => {
    expect(main(["--help"])).toBe(0);
  });

  it("throws CliInputError when ledger-file is missing", () => {
    expect(() => main([])).toThrow(CliInputError);
  });

  it("throws CliInputError when current-values-file is missing", () => {
    const ledgerPath = writeLedger("ledger.json", [entry("a", [citeFact("active-customers", 4200)])]);
    expect(() => main([ledgerPath])).toThrow(CliInputError);
  });

  it("throws CliInputError on an unknown flag", () => {
    expect(() => main(["--bogus"])).toThrow(CliInputError);
  });

  it("throws CliInputError when ledger-file does not exist", () => {
    const valuesPath = writeCurrentValues("values.json", {});
    expect(() => main([join(dir, "missing.json"), valuesPath])).toThrow(CliInputError);
  });
});

describe("main — the third state: could not run", () => {
  it("returns 2 when ledger-file is not valid JSON", () => {
    const ledgerPath = join(dir, "ledger.json");
    writeFileSync(ledgerPath, "{ not json");
    const valuesPath = writeCurrentValues("values.json", {});
    expect(main([ledgerPath, valuesPath])).toBe(2);
  });

  it("returns 2 when current-values-file is not a JSON object", () => {
    const ledgerPath = writeLedger("ledger.json", [entry("a", [citeFact("active-customers", 4200)])]);
    const valuesPath = join(dir, "values.json");
    writeFileSync(valuesPath, "[1, 2, 3]");
    expect(main([ledgerPath, valuesPath])).toBe(2);
  });

  it("returns 2 on an empty ledger (never a silent clean pass)", () => {
    const ledgerPath = writeLedger("ledger.json", []);
    const valuesPath = writeCurrentValues("values.json", {});
    expect(main([ledgerPath, valuesPath])).toBe(2);
  });

  it("returns 2 when nothing could be checked (no current values supplied)", () => {
    const ledgerPath = writeLedger("ledger.json", [entry("a", [citeFact("active-customers", 4200)])]);
    const valuesPath = writeCurrentValues("values.json", {});
    expect(main([ledgerPath, valuesPath])).toBe(2);
  });
});

describe("main — real runs", () => {
  it("returns 0 when a cited fact's current value matches (clean)", () => {
    const ledgerPath = writeLedger("ledger.json", [entry("a", [citeFact("active-customers", 4200)])]);
    const valuesPath = writeCurrentValues("values.json", { "active-customers": 4200 });
    expect(main([ledgerPath, valuesPath])).toBe(0);
  });

  it("returns 1 when a cited fact has drifted", () => {
    const ledgerPath = writeLedger("ledger.json", [entry("a", [citeFact("active-customers", 4200)])]);
    const valuesPath = writeCurrentValues("values.json", { "active-customers": 5000 });
    expect(main([ledgerPath, valuesPath])).toBe(1);
  });
});
