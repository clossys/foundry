import { describe, expect, it } from "vitest";
import { formatPercent, frameToPercentStrings } from "./geometry.js";

describe("formatPercent", () => {
  it("formats a round fraction with no decimal noise", () => {
    expect(formatPercent(50)).toBe("50");
    expect(formatPercent(0)).toBe("0");
    expect(formatPercent(100)).toBe("100");
  });

  it("rounds float noise to 4 decimal places — (1/3)*100 stays precise, not truncated", () => {
    expect(formatPercent((1 / 3) * 100)).toBe("33.3333");
  });

  it("never emits -0", () => {
    expect(formatPercent(-0)).toBe("0");
  });
});

describe("frameToPercentStrings — hand-computed geometry", () => {
  it("converts a quarter-page frame {x:0,y:0,w:0.5,h:0.5} to exactly 0%/0%/50%/50%", () => {
    // Hand computation: frameToPercent multiplies each fraction by 100.
    // x=0*100=0, y=0*100=0, w=0.5*100=50, h=0.5*100=50.
    expect(frameToPercentStrings({ x: 0, y: 0, w: 0.5, h: 0.5 })).toEqual({
      left: "0",
      top: "0",
      width: "50",
      height: "50",
    });
  });

  it("converts the opposite quarter {x:0.5,y:0.5,w:0.5,h:0.5} to exactly 50%/50%/50%/50%", () => {
    // Hand computation: x=0.5*100=50, y=0.5*100=50, w=0.5*100=50, h=0.5*100=50.
    expect(frameToPercentStrings({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 })).toEqual({
      left: "50",
      top: "50",
      width: "50",
      height: "50",
    });
  });

  it("converts an off-grid frame {x:0.125,y:0.0625,w:0.75,h:0.875} exactly (all binary fractions, no rounding involved)", () => {
    // Hand computation: 0.125*100=12.5, 0.0625*100=6.25, 0.75*100=75, 0.875*100=87.5.
    expect(frameToPercentStrings({ x: 0.125, y: 0.0625, w: 0.75, h: 0.875 })).toEqual({
      left: "12.5",
      top: "6.25",
      width: "75",
      height: "87.5",
    });
  });
});
