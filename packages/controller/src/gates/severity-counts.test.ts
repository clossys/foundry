import { describe, expect, it } from "vitest";
import type { CatalogFinding } from "../catalog/index.js";
import { severityCounts } from "./cli.js";

// Direct import of cli.ts, not a subprocess: cli.ts guards its top-level
// `main()` invocation behind an "is this the actual entry script" check
// specifically so a named export like `severityCounts` can be imported and
// unit-tested here without re-running the whole CLI (parsing whatever
// process.argv this test runner happens to have) as a side effect of the
// import itself.

describe("severityCounts — exhaustiveness over CatalogFinding.severity (B3)", () => {
  it("counts error and warning findings correctly", () => {
    const findings: CatalogFinding[] = [
      { rule: "a", severity: "error", message: "m" },
      { rule: "b", severity: "warning", message: "m" },
      { rule: "c", severity: "error", message: "m" },
      { rule: "d", severity: "warning", message: "m" },
      { rule: "e", severity: "warning", message: "m" },
    ];

    expect(severityCounts(findings)).toEqual({ errors: 2, warnings: 3 });
  });

  it("returns zero counts for an empty findings list", () => {
    expect(severityCounts([])).toEqual({ errors: 0, warnings: 0 });
  });

  it("throws on an unrecognized severity rather than silently counting it as a warning", () => {
    // A finding shaped by something other than TypeScript's own checking —
    // e.g. CatalogFinding[] parsed from JSON, or a caller on a stale
    // @example/catalog version with a severity value this version
    // doesn't know about. Before this fix, severityCounts' `else` branch
    // treated ANY non-"error" severity as a warning: this exact input would
    // have silently returned `{ errors: 0, warnings: 1 }` with zero
    // indication anything was wrong, and a `check`-style gate built on top
    // of it would have exited 0.
    const bogus = [{ rule: "x", severity: "critical", message: "m" }] as unknown as CatalogFinding[];

    expect(() => severityCounts(bogus)).toThrow(/severity/i);
  });
});
