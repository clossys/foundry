/**
 * The public surface, asserted against the barrel itself.
 *
 * A README table and an `index.ts` are two independently-maintained lists of
 * the same thing, and this repository already has a gate for the drift
 * between them. This file guards the half that gate cannot see: that the
 * names it promises are actually reachable, and — the one that matters for
 * this package — that the root is genuinely DOM-free, so a consumer that only
 * wants the gates never drags React in behind them.
 */
import { describe, expect, it } from "vitest";
import * as root from "./index.js";

describe("the package root", () => {
  it("exports the three gates and the one decision function", () => {
    expect(typeof root.checkAttribution).toBe("function");
    expect(typeof root.checkVisibility).toBe("function");
    expect(typeof root.checkDisposal).toBe("function");
    expect(typeof root.decideHolding).toBe("function");
  });

  it("exports every validator and guard the README documents", () => {
    for (const name of [
      "validateHeldItem",
      "validateHeldItems",
      "validateSourceEvent",
      "validateSourceEvents",
      "validateDisclosureRecords",
      "validateRetentionRules",
      "validateDeletionRecords",
      "isHeldItem",
      "isSourceEvent",
    ] as const) {
      expect(typeof root[name]).toBe("function");
    }
  });

  it("exports the closed vocabularies the README names", () => {
    expect(root.HOLDING_KINDS).toEqual(["held", "forgotten", "unjustifiable"]);
    expect(root.PROVENANCE_KINDS).toEqual(["event", "none", "indeterminate"]);
    expect(root.INDETERMINATE_PROVENANCE_KINDS).toEqual(["indeterminate"]);
    expect(root.HOLDING_ORIGINS).toEqual(["authored", "saved", "observed", "inferred"]);
    expect(root.BELIEF_USE_MODES).toEqual(["informs", "constrains"]);
    expect(root.DISCLOSURE_REACHES).toEqual(["visible", "hidden", "unknown"]);
    expect(root.DELETION_EFFECTS).toEqual(["erased", "failed", "unknown"]);
    expect(root.INDETERMINATE_ATTRIBUTION_FINDING_KINDS).toEqual(["source-unverifiable"]);
    expect(root.INDETERMINATE_VISIBILITY_FINDING_KINDS).toEqual(["reach-unverifiable"]);
    expect(root.INDETERMINATE_DISPOSAL_FINDING_KINDS).toEqual(["retention-undeclared", "deletion-unobserved"]);
  });

  it("does not export the ./web surface from the root, so importing the gates never pulls React in", () => {
    expect((root as Record<string, unknown>).useHeldRecord).toBeUndefined();
    expect((root as Record<string, unknown>).REACT_DECLARED_RANGE).toBeUndefined();
  });

  it("ships no store implementation — only the ports, which are types and have no runtime shape", () => {
    // Git cannot delete and this role must, so there is nothing here to
    // construct: `HoldingStore` and `DisclosureDirectory` are host-implemented
    // interfaces and exist only at compile time.
    expect((root as Record<string, unknown>).HoldingStore).toBeUndefined();
    expect((root as Record<string, unknown>).DisclosureDirectory).toBeUndefined();
  });

  it("ships no default export, so there is nothing to import by accident", () => {
    expect((root as Record<string, unknown>).default).toBeUndefined();
  });
});
