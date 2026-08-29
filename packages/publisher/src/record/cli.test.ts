import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliInputError, main } from "./cli.js";
import { citeFact } from "./fact.js";
import type { PublicationEntry } from "./types.js";

// Hermetic: every test operates on its own `mkdtemp` directory, removed
// afterward, and calls the exported `main(argv)` directly rather than
// spawning the real CLI process — the same discipline
// @example/strategy's cli.test.ts uses.

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

// ---------------------------------------------------------------------------
// `main(["append-only", ...])` — the `append-only` subcommand, wired to
// `checkAppendOnly`. Same hermetic-mkdtemp discipline as the drift-check
// tests above: every case calls the exported `main(argv)` directly.

describe("main — append-only subcommand — argument handling", () => {
  it("append-only --help returns 0 without touching either file", () => {
    expect(main(["append-only", "--help"])).toBe(0);
  });

  it("throws CliInputError when previous-ledger-file is missing", () => {
    expect(() => main(["append-only"])).toThrow(CliInputError);
  });

  it("throws CliInputError when next-ledger-file is missing", () => {
    const previousPath = writeLedger("previous.json", [entry("a", [citeFact("active-customers", 4200)])]);
    expect(() => main(["append-only", previousPath])).toThrow(CliInputError);
  });
});

describe("main — append-only subcommand — the three-state contract", () => {
  it("1. a clean append-only history over >=1 entry returns 0", () => {
    const previousPath = writeLedger("previous.json", [entry("a", [citeFact("active-customers", 4200)])]);
    const nextPath = writeLedger("next.json", [
      entry("a", [citeFact("active-customers", 4200)]),
      entry("b", [citeFact("active-customers", 4200)]),
    ]);
    expect(main(["append-only", previousPath, nextPath])).toBe(0);
  });

  it("2. a prior entry edited in place returns 1", () => {
    const previousPath = writeLedger("previous.json", [entry("a", [citeFact("active-customers", 4200)])]);
    const nextPath = writeLedger("next.json", [entry("a", [citeFact("active-customers", 9999)])]);
    expect(main(["append-only", previousPath, nextPath])).toBe(1);
  });

  it("3. a prior entry edited in place AND a new entry appended still returns 1 — " +
    "the case a naive 'the file grew' or 'entry count increased' check would pass", () => {
    const previousPath = writeLedger("previous.json", [
      entry("a", [citeFact("active-customers", 4200)]),
      entry("b", [citeFact("active-customers", 4200)]),
    ]);
    const nextPath = writeLedger("next.json", [
      // "a" mutated in place...
      entry("a", [citeFact("active-customers", 9999)]),
      entry("b", [citeFact("active-customers", 4200)]),
      // ...while a brand-new entry was also appended, so entry count grew
      // (2 -> 3) even though a prior entry was tampered with.
      entry("c", [citeFact("active-customers", 4200)]),
    ]);
    expect(main(["append-only", previousPath, nextPath])).toBe(1);
  });

  it("4. an empty/zero-entry previous ledger returns 2, never 0", () => {
    const previousPath = writeLedger("previous.json", []);
    const nextPath = writeLedger("next.json", [entry("a", [citeFact("active-customers", 4200)])]);
    expect(main(["append-only", previousPath, nextPath])).toBe(2);
  });

  it("4b. both previous and next empty also returns 2, never 0", () => {
    const previousPath = writeLedger("previous.json", []);
    const nextPath = writeLedger("next.json", []);
    expect(main(["append-only", previousPath, nextPath])).toBe(2);
  });

  it("5. a missing previous-ledger-file throws CliInputError (mapped to exit 2 by run())", () => {
    const nextPath = writeLedger("next.json", [entry("a", [citeFact("active-customers", 4200)])]);
    expect(() => main(["append-only", join(dir, "missing.json"), nextPath])).toThrow(CliInputError);
  });

  it("5b. an unreadable/missing next-ledger-file throws CliInputError", () => {
    const previousPath = writeLedger("previous.json", [entry("a", [citeFact("active-customers", 4200)])]);
    expect(() => main(["append-only", previousPath, join(dir, "missing.json")])).toThrow(CliInputError);
  });

  it("6. malformed JSON in previous-ledger-file returns 2", () => {
    const previousPath = join(dir, "previous.json");
    writeFileSync(previousPath, "{ not json");
    const nextPath = writeLedger("next.json", [entry("a", [citeFact("active-customers", 4200)])]);
    expect(main(["append-only", previousPath, nextPath])).toBe(2);
  });

  it("6b. malformed JSON in next-ledger-file returns 2", () => {
    const previousPath = writeLedger("previous.json", [entry("a", [citeFact("active-customers", 4200)])]);
    const nextPath = join(dir, "next.json");
    writeFileSync(nextPath, "[ not json");
    expect(main(["append-only", previousPath, nextPath])).toBe(2);
  });

  it("6c. invalid ledger shape (not an array) in previous-ledger-file returns 2", () => {
    const previousPath = join(dir, "previous.json");
    writeFileSync(previousPath, JSON.stringify({ not: "a ledger" }));
    const nextPath = writeLedger("next.json", [entry("a", [citeFact("active-customers", 4200)])]);
    expect(main(["append-only", previousPath, nextPath])).toBe(2);
  });

  it("6d. invalid ledger shape (not an array) in next-ledger-file returns 2, not 1", () => {
    const previousPath = writeLedger("previous.json", [entry("a", [citeFact("active-customers", 4200)])]);
    const nextPath = join(dir, "next.json");
    writeFileSync(nextPath, JSON.stringify({ not: "a ledger" }));
    expect(main(["append-only", previousPath, nextPath])).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// REGRESSION (defect of exactly this kind shipped once already): dispatch
// must key off the literal `argv[0]`, never off the invoked binary's path
// or filename (`basename(process.argv[1])`). This repository always invokes
// a gate by its compiled path (e.g. `node packages/controller/dist/cli.js`),
// so a basename-keyed dispatch would always see `cli.js` and silently run
// the wrong command — every other test in this file calls `main(argv)`
// in-process and would never have caught that, since it never exercises
// `process.argv[1]` at all. This is the one test that spawns the REAL
// compiled `dist/cli.js` as a real subprocess and asserts its real exit
// code.

describe("dist/cli.js — direct-path subprocess reachability", () => {
  // This test file lives at `src/record/cli.test.ts` (the record half moved
  // one directory deeper than the donor's `src/cli.test.ts` when it became a
  // publisher subpath), so the compiled sibling is two levels up plus back
  // down into `dist/record/`, not one level up into `dist/`.
  const cliPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "record", "cli.js");

  function runRealCli(args: string[]): { status: number; stdout: string; stderr: string } {
    try {
      const stdout = execFileSync("node", [cliPath, ...args], { encoding: "utf8" });
      return { status: 0, stdout, stderr: "" };
    } catch (error) {
      const err = error as { status?: number | null; stdout?: string; stderr?: string };
      return { status: typeof err.status === "number" ? err.status : Number.NaN, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
    }
  }

  it("`node dist/cli.js append-only <previous> <next>` exits 0 on a clean append-only history", () => {
    const previousPath = writeLedger("previous.json", [entry("a", [citeFact("active-customers", 4200)])]);
    const nextPath = writeLedger("next.json", [
      entry("a", [citeFact("active-customers", 4200)]),
      entry("b", [citeFact("active-customers", 4200)]),
    ]);
    const result = runRealCli(["append-only", previousPath, nextPath]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("No findings");
  });

  it("`node dist/cli.js append-only <previous> <next>` exits 1 on a real violation (entry mutated)", () => {
    const previousPath = writeLedger("previous.json", [entry("a", [citeFact("active-customers", 4200)])]);
    const nextPath = writeLedger("next.json", [entry("a", [citeFact("active-customers", 9999)])]);
    const result = runRealCli(["append-only", previousPath, nextPath]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("entry-mutated");
  });

  it("`node dist/cli.js append-only <previous> <next>` exits 2 on a zero-entry previous ledger", () => {
    const previousPath = writeLedger("previous.json", []);
    const nextPath = writeLedger("next.json", [entry("a", [citeFact("active-customers", 4200)])]);
    const result = runRealCli(["append-only", previousPath, nextPath]);
    expect(result.status).toBe(2);
  });

  it("`node dist/cli.js <ledger-file> <values-file>` with NO subcommand still runs the existing drift check, unchanged", () => {
    const ledgerPath = writeLedger("ledger.json", [entry("a", [citeFact("active-customers", 4200)])]);
    const valuesPath = writeCurrentValues("values.json", { "active-customers": 4200 });
    const result = runRealCli([ledgerPath, valuesPath]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("citation");
  });

  it("`node dist/cli.js <ledger-file> <values-file>` with NO subcommand still exits 1 on real drift, unchanged", () => {
    const ledgerPath = writeLedger("ledger.json", [entry("a", [citeFact("active-customers", 4200)])]);
    const valuesPath = writeCurrentValues("values.json", { "active-customers": 5000 });
    const result = runRealCli([ledgerPath, valuesPath]);
    expect(result.status).toBe(1);
  });
});
