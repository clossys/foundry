import { describe, expect, it } from "vitest";
import type { SlidesDeckInput } from "../slides/index.js";
import { declaredAudiences, selectAudienceVariant } from "./audienceVariant.js";

function doc(id: string): SlidesDeckInput["slides"][number] {
  return { id, channel: "slides", template: "t", meta: { channel: "slides", aspect: "16:9" }, bindings: [] } as unknown as SlidesDeckInput["slides"][number];
}

const source: SlidesDeckInput = {
  id: "pitch",
  slides: [doc("cover"), doc("traction"), doc("investor-terms"), doc("customer-case-study"), doc("close")],
  notes: { cover: "Open warm.", "investor-terms": "Slow down here.", "customer-case-study": "Only for customers." },
};

describe("selectAudienceVariant", () => {
  it("shows a slide with no declared audience to every variant", () => {
    const investor = selectAudienceVariant(source, { "investor-terms": ["investor"], "customer-case-study": ["customer"] }, "investor");
    expect(investor.slides.map((slide) => slide.id)).toEqual(["cover", "traction", "investor-terms", "close"]);
  });

  it("excludes a slide declared for a different audience", () => {
    const customer = selectAudienceVariant(source, { "investor-terms": ["investor"], "customer-case-study": ["customer"] }, "customer");
    expect(customer.slides.map((slide) => slide.id)).toEqual(["cover", "traction", "customer-case-study", "close"]);
  });

  it("preserves source deck order for whatever remains", () => {
    const partner = selectAudienceVariant(source, { "investor-terms": ["investor"], "customer-case-study": ["customer"] }, "partner");
    expect(partner.slides.map((slide) => slide.id)).toEqual(["cover", "traction", "close"]);
  });

  it("drops notes for a filtered-out slide but keeps notes for a kept one", () => {
    const customer = selectAudienceVariant(source, { "investor-terms": ["investor"], "customer-case-study": ["customer"] }, "customer");
    expect(customer.notes).toEqual({ cover: "Open warm.", "customer-case-study": "Only for customers." });
  });

  it("gives each variant a distinct, stable id derived from the source", () => {
    const investor = selectAudienceVariant(source, {}, "investor");
    expect(investor.id).toBe("pitch-investor");
  });

  it("a slide tagged for multiple audiences appears in every one of them", () => {
    const shared = selectAudienceVariant(source, { "investor-terms": ["investor", "board"] }, "board");
    expect(shared.slides.map((slide) => slide.id)).toContain("investor-terms");
  });
});

describe("declaredAudiences", () => {
  it("collects every distinct audience named across all selections, sorted", () => {
    expect(declaredAudiences({ a: ["investor", "board"], b: ["customer"], c: ["board"] })).toEqual(["board", "customer", "investor"]);
  });

  it("is empty when nothing declares an audience", () => {
    expect(declaredAudiences({})).toEqual([]);
  });
});
