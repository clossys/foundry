// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ResolvedSectionedViewDocument } from "../../core/sectioned-view.js";
import { LandingView } from "./LandingView.js";
import { planLandingViewGrounds } from "./landingViewGrounds.js";
import type { LandingViewProps } from "./LandingView.js";
import * as webEntry from "../index.js";
import * as webServerEntry from "../server.js";

// Placeholder markers only: every string is an obviously-fake sentinel.

const RESOLUTIONS: ResolvedSectionedViewDocument["resolutions"] = [
  { ref: { id: "acme.home" }, text: "HERO-SENTINEL", recordId: "acme", revision: "1", locale: "en", source: { kind: "consumer", reference: "fixture" }, entryId: "acme.home" },
];

const PAGE: ResolvedSectionedViewDocument = {
  id: "acme-page",
  resolutions: RESOLUTIONS,
  sections: [
    { id: "hero", kind: "hero", ground: "inverse", eyebrow: "EYEBROW-SENTINEL", heading: "HERO-SENTINEL", description: "LEDE-SENTINEL" },
    { id: "features", kind: "feature-grid", ground: "sunken", heading: "FEATURES-SENTINEL", items: [{ id: "one", heading: "ONE-SENTINEL" }] },
  ],
};

const SHARED: ResolvedSectionedViewDocument = {
  id: "acme-shared",
  resolutions: RESOLUTIONS,
  sections: [{ id: "faq", kind: "faq", ground: "base", heading: "FAQ-SENTINEL", items: [{ id: "q", question: "QUESTION-SENTINEL", answer: "ANSWER-SENTINEL" }] }],
};

const CALL_TO_ACTION: LandingViewProps["callToAction"] = {
  id: "close",
  heading: "CLOSE-SENTINEL",
  description: "CLOSE-LEDE-SENTINEL",
  action: <a href="/go">ACTION-SENTINEL</a>,
};

function dom(props: LandingViewProps): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<LandingView {...props} />);
  return host;
}

describe("LandingView", () => {
  it("is exported from both web entries, distinct from HeroView", () => {
    expect(webEntry.LandingView).toBe(LandingView);
    expect(webServerEntry.LandingView).toBeTypeOf("function");
    expect(webEntry.HeroView).toBeDefined();
    expect(webEntry.HeroView).not.toBe(LandingView);
  });

  it("renders one h1 (the hero section's), bands at h2, and the call to action as a centred h2 band", () => {
    const root = dom({ document: PAGE, trailing: [SHARED], callToAction: CALL_TO_ACTION });
    const h1s = root.querySelectorAll("h1");
    expect(h1s).toHaveLength(1);
    expect(h1s[0]?.textContent).toBe("HERO-SENTINEL");
    const h2s = [...root.querySelectorAll("h2")].map((node) => node.textContent);
    expect(h2s).toEqual(["FEATURES-SENTINEL", "FAQ-SENTINEL", "CLOSE-SENTINEL"]);
    const close = root.querySelector("[data-landing-call-to-action]");
    expect(close?.id).toBe("close");
    expect(close?.querySelector(".text-center")).not.toBeNull();
    expect(close?.querySelectorAll("a")).toHaveLength(1);
  });

  it("renders a hero section in a trailing document as an h2, never a second h1", () => {
    const closing: ResolvedSectionedViewDocument = { ...SHARED, id: "acme-closing", sections: [{ id: "closing", kind: "hero", ground: "base", heading: "CLOSING-SENTINEL" }] };
    const root = dom({ document: PAGE, trailing: [closing] });
    expect(root.querySelectorAll("h1")).toHaveLength(1);
    expect([...root.querySelectorAll("h2")].map((node) => node.textContent)).toContain("CLOSING-SENTINEL");
  });

  it("puts every band in the same measure: one column, full-bleed grounds", () => {
    const root = dom({ document: PAGE, trailing: [SHARED], callToAction: CALL_TO_ACTION, measure: "content" });
    const frames = [...root.querySelectorAll("[data-landing-view] > section")];
    expect(frames).toHaveLength(4);
    const widths = new Set(frames.map((frame) => (frame.firstElementChild as HTMLElement | null)?.style.maxWidth));
    expect(widths.size).toBe(1);
    expect([...widths][0]).toBeTruthy();
    expect(frames[0]?.className).toContain("bg-surface-inverse");
    expect(frames[1]?.className).toContain("bg-surface-sunken");
  });

  it("gives every band one anatomy: a header group held to the prose measure, then the section's module and anything placed after it", () => {
    const root = dom({ document: PAGE, trailing: [SHARED], afterSection: { features: <figure data-after="">AFTER</figure> } });
    const features = root.querySelector("#features") as HTMLElement;
    expect(features.hasAttribute("data-content-section")).toBe(true);
    const header = features.querySelector("[data-content-section-header]") as HTMLElement;
    expect(header.style.maxWidth).toBe("var(--ui-width-prose-max, 48rem)");
    expect(header.querySelector("h2")?.textContent).toBe("FEATURES-SENTINEL");
    const modules = features.querySelector("[data-content-section-modules]") as HTMLElement;
    expect(modules.children).toHaveLength(2);
    expect(modules.querySelector("h2")).toBeNull();
    expect(modules.lastElementChild?.hasAttribute("data-after")).toBe(true);
    const faq = root.querySelector("#faq") as HTMLElement;
    expect(faq.querySelector("[data-content-section-header] h2")?.textContent).toBe("FAQ-SENTINEL");
    expect(faq.querySelector("[data-content-section-modules] details")).not.toBeNull();
  });

  it("renders a hero section in a band as a header group, not a second display heading", () => {
    const closing: ResolvedSectionedViewDocument = { ...SHARED, id: "acme-closing", sections: [{ id: "closing", kind: "hero", ground: "base", eyebrow: "E-SENTINEL", heading: "CLOSING-SENTINEL", description: "D-SENTINEL" }] };
    const band = dom({ document: PAGE, trailing: [closing] }).querySelector("#closing") as HTMLElement;
    const heading = band.querySelector("h2") as HTMLElement;
    // The band title is Designer ContentSection's section-title step (h1 ->
    // h0 -> display-m), never the opening hero's display-l.
    expect(heading.className).toContain("text-h1");
    expect(heading.className).not.toContain("text-display-l");
    expect(band.querySelectorAll("h1")).toHaveLength(0);
  });

  it("holds the centred hero and call to action copy to the same prose measure", () => {
    const root = dom({ document: PAGE, callToAction: CALL_TO_ACTION });
    const heroCopy = root.querySelector("[data-landing-hero] h1")?.parentElement as HTMLElement;
    const closeCopy = root.querySelector("[data-landing-call-to-action] h2")?.parentElement as HTMLElement;
    expect(heroCopy.style.maxWidth).toBe("var(--ui-width-prose-max, 48rem)");
    expect(closeCopy.style.maxWidth).toBe(heroCopy.style.maxWidth);
  });

  it("centres the hero copy by default and lines it up at the start on request", () => {
    expect(dom({ document: PAGE }).querySelector("[data-landing-hero] .text-center")).not.toBeNull();
    expect(dom({ document: PAGE, align: "start" }).querySelector("[data-landing-hero] .text-center")).toBeNull();
  });

  it("keeps the backdrop and the cue inert, and peeks only with content below an overlay header", () => {
    const root = dom({ document: PAGE, trailing: [SHARED], backdrop: <div data-backdrop="">BACKDROP</div> });
    const backdrop = root.querySelector("[data-landing-backdrop]");
    expect(backdrop?.getAttribute("aria-hidden")).toBe("true");
    expect(backdrop?.className).toContain("pointer-events-none");
    const cue = root.querySelector("[data-landing-cue]");
    expect(cue?.getAttribute("aria-hidden")).toBe("true");
    expect((root.querySelector("[data-landing-hero]") as HTMLElement).style.minHeight).toContain("calc(");

    const alone = dom({ document: { ...PAGE, sections: [PAGE.sections[0]!] } });
    expect(alone.querySelector("[data-landing-cue]")).toBeNull();
    expect((alone.querySelector("[data-landing-hero]") as HTMLElement).style.minHeight).toBe("100dvh");

    expect(dom({ document: PAGE, peek: false }).querySelector("[data-landing-cue]")).toBeNull();
    const reserved = dom({ document: PAGE, header: "reserved" });
    expect(reserved.querySelector("[data-landing-cue]")).toBeNull();
    expect((reserved.querySelector("[data-landing-hero]") as HTMLElement).style.minHeight).toBe("");
  });

  it("places afterSection content inside that section's band, and refuses an unknown key", () => {
    const root = dom({ document: PAGE, afterSection: { features: <figure data-after="">AFTER</figure> } });
    const band = root.querySelector("#features")?.closest("[data-landing-view] > section");
    expect(band?.querySelector("[data-after]")).not.toBeNull();
    expect(() => dom({ document: PAGE, afterSection: { missing: <span /> } })).toThrow(/afterSection\.missing/);
  });

  it("refuses a document that does not open with a hero, and a section id rendered twice", () => {
    expect(() => dom({ document: SHARED })).toThrow(/first section must be a hero/);
    expect(() => dom({ document: PAGE, trailing: [SHARED, { ...SHARED, id: "again" }] })).toThrow(/section faq/);
  });

  it("renders the main landmark by default, or a div inside a frame's own main", () => {
    expect(dom({ document: PAGE, id: "main-content" }).querySelector("main#main-content")).not.toBeNull();
    const nested = dom({ document: PAGE, landmark: "none" });
    expect(nested.querySelector("main")).toBeNull();
    expect(nested.querySelector("div[data-landing-view]")).not.toBeNull();
  });

  it("fixes the closing pair: the last band on base, the call to action on inverse with a hairline at its foot", () => {
    const root = dom({ document: PAGE, trailing: [{ ...SHARED, sections: [{ ...SHARED.sections[0]!, ground: "sunken" }] }], callToAction: CALL_TO_ACTION });
    const frames = [...root.querySelectorAll("[data-landing-view] > section")];
    expect(frames.map((frame) => frame.getAttribute("data-landing-ground"))).toEqual(["inverse", "sunken", "base", "inverse"]);
    expect(root.querySelector("[data-landing-view]")?.className).toContain("bg-surface-base");
    const close = root.querySelector("[data-landing-call-to-action]");
    expect(close?.className).toContain("bg-surface-inverse");
    expect(close?.className).toContain("border-b");
    expect(close?.className).toContain("border-line-on-inverse");
  });
});

/** A page of `count` bands under the `"view"` rhythm, split across a page document and a trailing one. */
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
  it("alternates view-assigned bands upward from the closing band, for any section count, with no repeated neighbours", () => {
    for (let count = 1; count <= 7; count += 1) {
      const { page, tail } = rhythmPage(count);
      const plan = planLandingViewGrounds(page, tail, { callToAction: { id: "close" } });
      const body = plan.bands.filter((band) => band.role === "band" || band.role === "closing").map((band) => band.ground);
      expect(body.at(-1), `count ${count}`).toBe("base");
      expect(body.at(-2), `count ${count}`).toBe(count > 1 ? "sunken" : undefined);
      expect(plan.bands.at(-1)).toMatchObject({ id: "close", role: "call-to-action", ground: "inverse" });
      expect(plan.repeats, `count ${count}`).toEqual([]);

      const root = dom({ document: page, trailing: tail, callToAction: CALL_TO_ACTION });
      const rendered = [...root.querySelectorAll("[data-landing-view] > section")].map((frame) => frame.getAttribute("data-landing-ground"));
      expect(rendered).toEqual(plan.bands.map((band) => band.ground));
    }
  });

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

  it("refuses a viewGrounds entry that names no section of its document", () => {
    expect(() => dom({ document: { ...PAGE, viewGrounds: ["missing"] } })).toThrow(/viewGrounds\.0/);
  });
});

