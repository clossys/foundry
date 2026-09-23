import { describe, expect, it } from "vitest";
import { PITCH_DECK_DEFAULT_AUDIENCE_SELECTIONS, PITCH_DECK_SLIDE_ORDER } from "./deckTemplate.js";

describe("PITCH_DECK_SLIDE_ORDER", () => {
  it("starts with cover and ends with close", () => {
    expect(PITCH_DECK_SLIDE_ORDER[0]).toBe("cover");
    expect(PITCH_DECK_SLIDE_ORDER.at(-1)).toBe("close");
  });

  it("has no duplicate slide ids", () => {
    expect(new Set(PITCH_DECK_SLIDE_ORDER).size).toBe(PITCH_DECK_SLIDE_ORDER.length);
  });
});

describe("PITCH_DECK_DEFAULT_AUDIENCE_SELECTIONS", () => {
  it("every tagged slide is a real slide in the default order", () => {
    for (const slideId of Object.keys(PITCH_DECK_DEFAULT_AUDIENCE_SELECTIONS)) expect(PITCH_DECK_SLIDE_ORDER).toContain(slideId);
  });

  it("restricts the financials and ask slides to investor-facing audiences", () => {
    expect(PITCH_DECK_DEFAULT_AUDIENCE_SELECTIONS.financials).toContain("investor");
    expect(PITCH_DECK_DEFAULT_AUDIENCE_SELECTIONS.ask).toEqual(["investor"]);
  });

  it("leaves most slides untagged, so they default to every audience", () => {
    const taggedCount = Object.keys(PITCH_DECK_DEFAULT_AUDIENCE_SELECTIONS).length;
    expect(taggedCount).toBeLessThan(PITCH_DECK_SLIDE_ORDER.length);
  });
});
