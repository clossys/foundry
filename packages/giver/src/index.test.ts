/**
 * The public surface, asserted against the barrel itself.
 *
 * A README table and an `index.ts` are two independently-maintained lists
 * of the same thing, and this repository already has a gate for the drift
 * between them. This file guards the half that gate cannot see: that the
 * names it promises are actually reachable, that the `./record` subpath is
 * a genuinely separate entry point rather than a re-export of the root,
 * and that the root does not leak the seam's reader into the surface a
 * consumer imports for the gates.
 */
import { describe, expect, it } from "vitest";
import * as root from "./index.js";
import * as record from "./record.js";

describe("the package root", () => {
  it("exports the three gates and the two decision functions", () => {
    expect(typeof root.checkHandoffPlacement).toBe("function");
    expect(typeof root.checkGrounding).toBe("function");
    expect(typeof root.checkObligationDischarge).toBe("function");
    expect(typeof root.decideOutcome).toBe("function");
    expect(typeof root.evaluateObligation).toBe("function");
  });

  it("exports every validator and guard the README documents", () => {
    for (const name of [
      "validateHandoffRecord",
      "validateHandoffRecords",
      "validatePlacementRecords",
      "validateAnswerRecord",
      "validateAnswerRecords",
      "validateRetainedGrounds",
      "validateObligationRecord",
      "validateObligationRecords",
      "validateDeliveryProofs",
      "isHandoffRecord",
      "isAnswerRecord",
      "isObligationRecord",
    ] as const) {
      expect(typeof root[name]).toBe("function");
    }
  });

  it("exports the closed vocabularies as frozen-in-shape arrays", () => {
    expect(root.VERDICT_KINDS).toEqual(["delivered", "refused", "handed-off"]);
    expect(root.STANDING_READ_STATUSES).toEqual(["granted", "denied", "absent", "stale", "unreadable"]);
    expect(root.INDETERMINATE_STANDING_STATUSES).toEqual(["absent", "stale", "unreadable"]);
    expect(root.HANDOFF_REASONS).toEqual(["standing-indeterminate", "grounds-unavailable"]);
    expect(root.ANSWER_OUTCOME_KINDS).toEqual(["delivered", "refused", "handed-off"]);
    expect(root.DELIVERY_STATES).toEqual(["delivered", "failed", "unknown"]);
    expect(root.INDETERMINATE_DISCHARGE_FINDING_KINDS).toEqual(["delivery-unprovable"]);
  });

  it("ships no default export, so there is nothing to import by accident", () => {
    expect((root as Record<string, unknown>).default).toBeUndefined();
  });
});

describe("the ./record subpath", () => {
  it("is where the seam lives, and the root does not carry it", () => {
    expect(typeof record.validateStandingDecisionDocument).toBe("function");
    expect(typeof record.readStandingDecision).toBe("function");
    expect(typeof record.unreadableStandingDecision).toBe("function");
    expect((root as Record<string, unknown>).readStandingDecision).toBeUndefined();
    expect((root as Record<string, unknown>).validateStandingDecisionDocument).toBeUndefined();
  });

  it("exports the emitters that turn one verdict into the records the gates read back", () => {
    expect(typeof record.answerRecordFor).toBe("function");
    expect(typeof record.handoffRecordFor).toBe("function");
  });

  it("declares the seam's filename and version as values, not as prose in a comment", () => {
    expect(record.STANDING_DECISIONS_DOCUMENT_FILENAME).toBe("standing-decisions.json");
    expect(record.STANDING_DECISIONS_SCHEMA_VERSION).toBe(1);
  });
});
