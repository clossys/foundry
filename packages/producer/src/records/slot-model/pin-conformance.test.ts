/**
 * One pin schema (planner R9): the slot-model validator, Director's pin reader and the no-build decision
 * check give every conformance fixture the same verdict, and that verdict is the fixture's own.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSlotPin, pinIssues } from "@clossys/director";
// @ts-expect-error -- a plain ESM script without declarations; the no-build check every CI run uses.
import { pinShapeIssues } from "../../../../../scripts/check-decisions.mjs";
import { validatePin } from "./validate.js";

interface Fixture { readonly name: string; readonly valid: boolean; readonly pin: unknown }
const { fixtures } = JSON.parse(readFileSync(new URL("./pin-conformance.json", import.meta.url), "utf8")) as { fixtures: Fixture[] };
const checkDecisionsShape = pinShapeIssues as (pin: unknown) => string[];

describe("the one pin schema", () => {
  it("has fixtures on both sides of every rule", () => {
    expect(fixtures.filter(fixture => fixture.valid).length).toBeGreaterThan(3);
    expect(fixtures.filter(fixture => !fixture.valid).length).toBeGreaterThan(10);
  });
  for (const fixture of fixtures) {
    it(`${fixture.valid ? "accepts" : "refuses"}: ${fixture.name}`, () => {
      const verdicts = {
        validatePin: validatePin(fixture.pin).length === 0,
        parseSlotPin: parseSlotPin(fixture.pin).ok,
        pinIssues: pinIssues(fixture.pin).length === 0,
        checkDecisions: checkDecisionsShape(fixture.pin).length === 0,
      };
      expect(verdicts).toEqual({ validatePin: fixture.valid, parseSlotPin: fixture.valid, pinIssues: fixture.valid, checkDecisions: fixture.valid });
    });
  }
  it("names the same broken rules everywhere it reports messages", () => {
    for (const fixture of fixtures) {
      expect(validatePin(fixture.pin).map(issue => issue.message), fixture.name).toEqual(pinIssues(fixture.pin));
      expect(checkDecisionsShape(fixture.pin), fixture.name).toEqual(pinIssues(fixture.pin));
    }
  });
});
