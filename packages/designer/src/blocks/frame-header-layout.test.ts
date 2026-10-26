import { describe, expect, it } from "vitest";
import { frameHeaderOverflow } from "./frame-header-layout.js";
describe("measured header capacity", () => {
  it("retains centered navigation when equal outer columns fit", () => expect(frameHeaderOverflow(1000, 44, 300, 200, 44, 8)).toEqual({ compactActions: false, compactNav: false }));
  it("collapses actions before navigation", () => expect(frameHeaderOverflow(650, 44, 300, 200, 44, 8)).toEqual({ compactActions: true, compactNav: false }));
  it("collapses navigation only after compact actions also cannot fit", () => expect(frameHeaderOverflow(240, 44, 300, 200, 44, 8)).toEqual({ compactActions: true, compactNav: true }));
});
