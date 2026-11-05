import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ResolvedSectionedViewDocument } from "../../core/sectioned-view.js";
import { planLandingViewGrounds } from "./landingViewGrounds.js";
import * as webEntry from "../index.js";
import * as webServerEntry from "../server.js";
import * as designerFrames from "@clossys/designer/frames";

const RESOLUTIONS: ResolvedSectionedViewDocument["resolutions"] = [
  { ref: { id: "example.home" }, text: "HERO-SENTINEL", recordId: "example", revision: "1", locale: "en", source: { kind: "consumer", reference: "fixture" }, entryId: "example.home" },
];
const PAGE: ResolvedSectionedViewDocument = {
  id: "example-page", resolutions: RESOLUTIONS, sections: [
    { id: "hero", kind: "hero", ground: "inverse", heading: "HERO-SENTINEL" },
    { id: "features", kind: "feature-grid", ground: "sunken", heading: "FEATURES-SENTINEL", items: [{ id: "one", heading: "ONE-SENTINEL" }] },
  ],
};
const SHARED: ResolvedSectionedViewDocument = {
  id: "example-shared", resolutions: RESOLUTIONS,
  sections: [{ id: "faq", kind: "faq", ground: "base", heading: "FAQ-SENTINEL", items: [{ id: "one", question: "QUESTION-SENTINEL", answer: "ANSWER-SENTINEL" }] }],
};
describe("LandingView", () => {
  it("retires the legacy landing value from both public web entries", () => {
    expect(webEntry).not.toHaveProperty("LandingView");
    expect(webServerEntry).not.toHaveProperty("LandingView");
    expect(webEntry.HeroView).toBeDefined();
    expect(designerFrames).not.toHaveProperty("LandingView");
    expect(designerFrames).not.toHaveProperty("ServerLandingView");
  });
});
function rhythmPage(count: number, explicit: Record<string, "base" | "sunken" | "inverse"> = {}) {
  const ids = Array.from({ length: count }, (_, index) => `band-${index}`);
  const section = (id: string) => ({ id, kind: "feature-grid" as const, ground: explicit[id] ?? ("base" as const), heading: `${id}-SENTINEL`, items: [{ id: "one", heading: "ONE-SENTINEL" }] });
  const pageIds = ids.slice(0, -1);
  const lastId = ids.at(-1);
  const page: ResolvedSectionedViewDocument = {
    id: "acme-rhythm",
    resolutions: RESOLUTIONS,
    sections: [PAGE.sections[0]!, ...pageIds.map(section)],
    viewGrounds: pageIds.filter((id) => explicit[id] === undefined),
  };
  const tail: ResolvedSectionedViewDocument[] = lastId === undefined ? [] : [{ id: "acme-tail", resolutions: RESOLUTIONS, sections: [section(lastId)], viewGrounds: explicit[lastId] === undefined ? [lastId] : [] }];
  return { page, tail };
}

describe("LandingView grounds", () => {
  it("keeps an explicit ground outside the closing pair, and reports the neighbours it repeats", () => {
    const { page, tail } = rhythmPage(4, { "band-1": "base" });
    const plan = planLandingViewGrounds(page, tail, { callToAction: true });
    expect(plan.bands.map((band) => band.ground)).toEqual(["inverse", "sunken", "base", "sunken", "base", "inverse"]);
    expect(plan.repeats).toEqual([]);

    const clash = rhythmPage(3, { "band-1": "base" });
    const clashPlan = planLandingViewGrounds(clash.page, clash.tail, { callToAction: true });
    expect(clashPlan.bands.map((band) => band.ground)).toEqual(["inverse", "sunken", "base", "base", "inverse"]);
    expect(clashPlan.repeats).toEqual([{ above: "band-1", below: "band-2", ground: "base" }]);
  });

  it("overrides an explicit ground on the closing band, and leaves documents without the view rhythm alone", () => {
    const { page, tail } = rhythmPage(2, { "band-1": "sunken" });
    expect(planLandingViewGrounds(page, tail, { callToAction: true }).bands.find((band) => band.id === "band-1")).toMatchObject({ role: "closing", ground: "base" });
    expect(planLandingViewGrounds(PAGE, [SHARED]).bands.map((band) => band.ground)).toEqual(["inverse", "sunken", "base"]);
  });


});


it("ships exact non-length measure fallbacks and full viewport geometry for the static view bindings", () => {
  const css = readFileSync("styles/preview.css", "utf8");
  for (const measure of ["form", "prose"]) {
    const className = `max-w-[var(--ui-width-${measure}-max,none)]`;
    const selector = "." + className.replace(/[^a-zA-Z0-9_-]/g, char => "\\" + char);
    const at = css.indexOf(selector + " {");
    expect(at, `missing utility ${className}`).toBeGreaterThanOrEqual(0);
    const declarations = css.slice(at, css.indexOf("}", at));
    expect(declarations.replace(/\s/g, "")).toContain(`max-width:var(--ui-width-${measure}-max,none);`);
  }
  expect(css).toMatch(/\.min-h-dvh\s*\{\s*min-height: 100dvh;/);
});
