// @vitest-environment jsdom

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ResolvedSectionedViewDocument } from "../../core/sectioned-view.js";
import { LandingView } from "./LandingView.js";
import { RenderError } from "../../internal/errors.js";
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
  sections: [{ id: "faq", kind: "faq", ground: "base", heading: "FAQ-SENTINEL", items: ["one", "two", "three", "four"].map(id => ({ id, question: "QUESTION-SENTINEL", answer: "ANSWER-SENTINEL" })) }],
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

  it("gives every band one anatomy: a header group held to the prose measure, then the section's block and anything placed after it", () => {
    const root = dom({ document: PAGE, trailing: [SHARED], afterSection: { features: <figure data-after="">AFTER</figure> } });
    const features = root.querySelector("#features") as HTMLElement;
    expect(features.hasAttribute("data-content-section")).toBe(true);
    const header = features.querySelector("[data-content-section-header]") as HTMLElement;
    expect(header.style.maxWidth).toBe("var(--ui-width-prose-max, 48rem)");
    expect(header.querySelector("h2")?.textContent).toBe("FEATURES-SENTINEL");
    const blocks = features.querySelector("[data-content-section-modules]") as HTMLElement;
    expect(blocks.children).toHaveLength(2);
    expect(blocks.querySelector("h2")).toBeNull();
    expect(blocks.lastElementChild?.hasAttribute("data-after")).toBe(true);
    const faq = root.querySelector("#faq") as HTMLElement;
    expect(faq.querySelector("[data-content-section-header] h2")?.textContent).toBe("FAQ-SENTINEL");
    expect(faq.querySelector("[data-content-section-modules] [data-items] button")).not.toBeNull();
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

  it("keeps the backdrop inert, and peeks only with content below an overlay header", () => {
    const root = dom({ document: PAGE, trailing: [SHARED], backdrop: <div data-backdrop="">BACKDROP</div> });
    const backdrop = root.querySelector("[data-landing-backdrop]");
    expect(backdrop?.getAttribute("aria-hidden")).toBe("true");
    expect(backdrop?.className).toContain("pointer-events-none");
    expect(root.querySelector("[data-landing-cue]")).not.toBeNull();
    expect((root.querySelector("[data-landing-hero]") as HTMLElement).style.minHeight).toContain("calc(");

    const alone = dom({ document: { ...PAGE, sections: [PAGE.sections[0]!] } });
    expect(alone.querySelector("[data-landing-cue]")).toBeNull();
    expect((alone.querySelector("[data-landing-hero]") as HTMLElement).style.minHeight).toBe("100dvh");

    expect(dom({ document: PAGE, peek: false }).querySelector("[data-landing-cue]")).toBeNull();
    const reserved = dom({ document: PAGE, header: "reserved" });
    expect(reserved.querySelector("[data-landing-cue]")).toBeNull();
    expect((reserved.querySelector("[data-landing-hero]") as HTMLElement).style.minHeight).toBe("");
  });

  it("makes the cue a named link to the first band, drawn on that band's ground", () => {
    const root = dom({ document: PAGE, trailing: [SHARED], callToAction: CALL_TO_ACTION });
    const cue = root.querySelector("[data-landing-cue]") as HTMLAnchorElement;
    expect(cue.tagName).toBe("A");
    expect(cue.getAttribute("href")).toBe("#features");
    expect(root.querySelector(cue.getAttribute("href") as string)?.closest("[data-landing-ground]")?.getAttribute("data-landing-ground")).toBe("sunken");
    expect(cue.getAttribute("aria-label")).toBe("Scroll to next section");
    expect(cue.hasAttribute("aria-hidden")).toBe(false);
    expect(cue.className).toContain("rounded-pill");
    expect(cue.className).toContain("bg-surface-raised");
    expect(cue.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(dom({ document: PAGE, cueLabel: "NAME-SENTINEL" }).querySelector("[data-landing-cue]")?.getAttribute("aria-label")).toBe("NAME-SENTINEL");
    expect(() => dom({ document: PAGE, cueLabel: "  " })).toThrow(/cueLabel/);
  });

  it("holds the cue in a rail after the hero, stacked above the bands, as a fixed cue that fades on scroll", () => {
    const root = dom({ document: PAGE });
    const view = root.querySelector("[data-landing-view]") as HTMLElement;
    const rail = root.querySelector("[data-landing-cue-rail]") as HTMLElement;
    // A zero-height rail between the hero frame and the first band: the cue's
    // fallback anchor where the engine has no scroll-driven animations.
    expect(rail.previousElementSibling?.hasAttribute("data-landing-hero")).toBe(true);
    expect(rail.nextElementSibling?.querySelector("#features")).not.toBeNull();
    expect(rail.parentElement).toBe(view);
    expect(rail.className.split(/\s+/)).toEqual(["relative", "z-[var(--ui-z-sticky,10)]", "h-0"]);
    const cue = rail.querySelector("[data-landing-cue]") as HTMLElement;
    // Placement, fade and the fixed/fallback switch live in Designer's one `scroll-cue`
    // utility; the view adds no positioning of its own that could outlive the fade.
    expect(cue.className.split(/\s+/)).toEqual(expect.arrayContaining(["scroll-cue", "motion-safe:[html:has(&)]:scroll-smooth"]));
    expect(cue.className).not.toMatch(/(^|\s)(absolute|fixed|top-0|left-1\/2|-translate-[xy]-1\/2|scroll-fade-out)(\s|$)/);
    expect(root.querySelector("[data-landing-hero] [data-landing-cue]")).toBeNull();
  });

  it("gives every band's section a scroll margin equal to the band's top padding", () => {
    const root = dom({ document: PAGE, trailing: [SHARED] });
    for (const id of ["features", "faq"]) {
      const section = root.querySelector(`#${id}`) as HTMLElement;
      expect(section.className.split(/\s+/)).toEqual(expect.arrayContaining(["scroll-mt-4xl", "tablet-lg:scroll-mt-5xl"]));
    }
  });

  it("targets the call to action when no band follows the hero, and renders no cue without a target", () => {
    const heroOnly: ResolvedSectionedViewDocument = { ...PAGE, sections: [PAGE.sections[0]!] };
    const toClose = dom({ document: heroOnly, callToAction: CALL_TO_ACTION }).querySelector("[data-landing-cue]") as HTMLElement;
    expect(toClose.getAttribute("href")).toBe("#close");
    expect(toClose.className).toContain("bg-surface-inverse-raised");
    const { id: _id, ...unnamed } = CALL_TO_ACTION!;
    const unnamedClose = dom({ document: heroOnly, callToAction: unnamed });
    expect(unnamedClose.querySelector("[data-landing-cue]")).toBeNull();
    expect(unnamedClose.querySelector("[data-landing-cue-rail]")).toBeNull();
    expect(dom({ document: heroOnly }).querySelector("[data-landing-cue]")).toBeNull();
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

  it("fixes the closing pair: the last band on base, the call to action on inverse with no edge rule of its own", () => {
    const root = dom({ document: PAGE, trailing: [{ ...SHARED, sections: [{ ...SHARED.sections[0]!, ground: "sunken" }] }], callToAction: CALL_TO_ACTION });
    const frames = [...root.querySelectorAll("[data-landing-view] > section")];
    expect(frames.map((frame) => frame.getAttribute("data-landing-ground"))).toEqual(["inverse", "sunken", "base", "inverse"]);
    expect(root.querySelector("[data-landing-view]")?.className).toContain("bg-surface-base");
    const close = root.querySelector("[data-landing-call-to-action]");
    expect(close?.className).toContain("bg-surface-inverse");
    // The footer's own top hairline is the one seam; the ground change is the top edge.
    expect(close?.className).not.toMatch(/\bborder-/);
  });

  it("renders the call to action as a centred section-emphasis ContentSection one rhythm step above a body band, never the display step", () => {
    const root = dom({ document: PAGE, trailing: [SHARED], callToAction: CALL_TO_ACTION });
    const close = root.querySelector("[data-landing-call-to-action]") as HTMLElement;
    const band = root.querySelector("#features")?.closest("section") as HTMLElement;
    const padding = (element: HTMLElement) => element.className.split(/\s+/).filter((name) => /(^|:)py-/.test(name));
    expect(padding(band)).toEqual(["py-4xl", "tablet-lg:py-5xl"]);
    expect(padding(close)).toEqual(["py-5xl", "tablet-lg:py-6xl"]);
    const groundInk = /^text-ink-(primary|on-inverse)$/;
    const rest = (element: HTMLElement) => element.className.split(/\s+/).filter((name) => !/(^|:)py-/.test(name) && !name.startsWith("bg-surface-") && !groundInk.test(name));
    expect(rest(close)).toEqual(rest(band));
    expect(close.className.split(/\s+/)).toContain("text-ink-on-inverse");
    expect(band.className.split(/\s+/).filter((name) => groundInk.test(name))).toEqual(["text-ink-primary"]);
    const intro = close.querySelector("[data-section-intro]") as HTMLElement;
    expect(intro.getAttribute("data-section-intro")).toBe("section");
    const heading = close.querySelector("h2") as HTMLElement;
    expect(heading.className).toContain("leading-heading");
    expect(heading.className).not.toMatch(/(^|\s)text-display-l\b/);
    const hero = root.querySelector("[data-landing-hero] [data-section-intro]") as HTMLElement;
    expect(hero.getAttribute("data-section-intro")).toBe("display");
    expect(root.querySelector("[data-landing-hero] h1")?.className).toContain("leading-display");
  });

  it("renders the hero's document actions as Designer primary buttons, the call to action's treatment", () => {
    const withActions: ResolvedSectionedViewDocument = { ...PAGE, sections: [{ ...PAGE.sections[0]!, actions: [{ id: "demo", label: "DEMO-SENTINEL", href: "/demo" }] } as ResolvedSectionedViewDocument["sections"][number], ...PAGE.sections.slice(1)] };
    const link = dom({ document: withActions }).querySelector("[data-landing-hero] a") as HTMLElement;
    expect(link.textContent).toBe("DEMO-SENTINEL");
    expect(link.className).toContain("bg-accent");
    expect(link.className).toContain("text-ink-on-accent");
    expect(link.className).not.toContain("underline");
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


describe("LandingView close copy", () => {
  const action = <a href="/close-action">CLOSE-ACTION-SENTINEL</a>;

  it("reuses the first hero's heading and description only on opt-in, keeping the close's own action and eyebrow", () => {
    const trailingHero: ResolvedSectionedViewDocument = { ...SHARED, sections: [{ id: "tail-hero", kind: "hero", ground: "base", heading: "TAIL-SENTINEL", description: "TAIL-LEDE-SENTINEL" }] };
    const withHeroAction: ResolvedSectionedViewDocument = { ...PAGE, sections: [{ ...PAGE.sections[0]!, actions: [{ id: "hero-action", href: "/hero-action", label: "HERO-ACTION-SENTINEL" }] } as ResolvedSectionedViewDocument["sections"][number], ...PAGE.sections.slice(1)] };
    const close = dom({ document: withHeroAction, trailing: [trailingHero], callToAction: { copy: "hero", id: "close", eyebrow: "CLOSE-EYEBROW-SENTINEL", action } }).querySelector("[data-landing-call-to-action]")!;
    expect(close.id).toBe("close");
    expect(close.querySelector("h2")?.textContent).toBe("HERO-SENTINEL");
    expect(close.textContent).toContain("LEDE-SENTINEL");
    expect(close.textContent).toContain("CLOSE-EYEBROW-SENTINEL");
    expect(close.textContent).not.toContain("TAIL-SENTINEL");
    expect([...close.querySelectorAll("*")].map((node) => node.textContent)).not.toContain("EYEBROW-SENTINEL");
    expect(close.querySelectorAll("a")).toHaveLength(1);
    expect(close.textContent).not.toContain("HERO-ACTION-SENTINEL");
    expect(close.querySelector("a")?.getAttribute("href")).toBe("/close-action");
  });

  it("lets each own copy field override hero reuse independently", () => {
    const heading = dom({ document: PAGE, callToAction: { copy: "hero", heading: <em>OWN-HEADING-SENTINEL</em>, action } }).querySelector("[data-landing-call-to-action]")!;
    expect(heading.querySelector("h2 em")?.textContent).toBe("OWN-HEADING-SENTINEL");
    expect(heading.textContent).toContain("LEDE-SENTINEL");
    const description = dom({ document: PAGE, callToAction: { copy: "hero", description: <em>OWN-DESCRIPTION-SENTINEL</em>, action } }).querySelector("[data-landing-call-to-action]")!;
    expect(description.querySelector("h2")?.textContent).toBe("HERO-SENTINEL");
    expect(description.querySelector("em")?.textContent).toBe("OWN-DESCRIPTION-SENTINEL");
    expect(description.textContent).not.toContain("LEDE-SENTINEL");
  });

  it.each([null, false])("keeps explicit %s overrides rather than falling back to hero copy", (value) => {
    const close = dom({ document: PAGE, callToAction: { copy: "hero", heading: value, description: value, action } }).querySelector("[data-landing-call-to-action]")!;
    expect(close.querySelector("h2")).toBeNull();
    expect(close.textContent).not.toContain("HERO-SENTINEL");
    expect(close.textContent).not.toContain("LEDE-SENTINEL");
    expect(close.querySelector("a")?.textContent).toBe("CLOSE-ACTION-SENTINEL");
  });

  it("allows a hero without supporting copy", () => {
    const page: ResolvedSectionedViewDocument = { ...PAGE, sections: [{ id: "hero", kind: "hero", ground: "base", heading: "HERO-SENTINEL" }] };
    const close = dom({ document: page, callToAction: { copy: "hero", action } }).querySelector("[data-landing-call-to-action]")!;
    expect(close.querySelector("h2")?.textContent).toBe("HERO-SENTINEL");
    expect(close.textContent).toBe("HERO-SENTINELCLOSE-ACTION-SENTINEL");
  });

  it("renders closing markup with canonical FAQ rows when hero reuse is absent", () => {
    const html = renderToStaticMarkup(<LandingView document={PAGE} trailing={[SHARED]} callToAction={CALL_TO_ACTION} />);
    // Require the cue rail's token fallback; preserve every other pre-option byte.
    const cueRail = 'class="relative z-[var(--ui-z-sticky,10)] h-0"';
    expect(html.split(cueRail)).toHaveLength(2);
    const legacyHtml = withoutSectionFrameInk(html.replace(cueRail, cueRail.replace(",10", "")));
    expect(createHash("sha256").update(legacyHtml).digest("hex")).toBe(LEGACY_CLOSE_MARKUP_SHA256);
  });

  it("refuses a valid nonempty document without an opening hero using the dedicated reason, even with own copy or a trailing hero", () => {
    const page: ResolvedSectionedViewDocument = { ...PAGE, sections: SHARED.sections };
    const trailingHero: ResolvedSectionedViewDocument = { ...PAGE, id: "tail", sections: [{ id: "tail-hero", kind: "hero", ground: "base", heading: "TAIL-SENTINEL" }] };
    for (const heading of [undefined, "OWN-HEADING-SENTINEL"]) {
      try {
        dom({ document: page, trailing: [trailingHero], callToAction: { copy: "hero", heading, description: "OWN-LEDE-SENTINEL", action } });
        expect.fail("hero-copy request must be refused");
      } catch (error) {
        expect(error).toBeInstanceOf(RenderError);
        expect(error).toMatchObject({ reason: "missing-hero-copy" });
      }
    }
  });

  it("keeps malformed resolved input and an unknown copy option on the generic refusal path", () => {
    const malformed = { ...PAGE, resolutions: [] };
    const empty = { ...PAGE, sections: [] };
    for (const props of [
      { document: malformed, callToAction: { copy: "hero", action } },
      { document: empty, callToAction: { copy: "hero", action } },
      { document: empty, callToAction: CALL_TO_ACTION },
      { document: PAGE, callToAction: { copy: "unknown", heading: "OWN-SENTINEL", action } },
    ]) {
      try {
        dom(props as LandingViewProps);
        expect.fail("invalid request must be refused");
      } catch (error) {
        expect(error).toBeInstanceOf(RenderError);
        expect(error).toMatchObject({ reason: "resolution-failed" });
      }
    }
  });
});

const LEGACY_CLOSE_MARKUP_SHA256 = "84380478f6fa9f7b040b6e7a4780ee3389bbb1224d6b916df1489e28a8febd0d";

// Every SectionFrame root now carries its ground's primary ink; the pinned bytes predate it.
function withoutSectionFrameInk(html: string): string {
  const roots = html.match(/data-designer-section-frame="" class="[^"]*"/g) ?? [];
  expect(roots.length).toBeGreaterThan(0);
  for (const root of roots) expect(root).toMatch(/[" ]text-ink-(?:primary|on-inverse)[ "]/);
  return html.replace(/(data-designer-section-frame="" class="(?:[^" ]+ )*?)text-ink-(?:primary|on-inverse) ?/g, "$1");
}


describe("LandingView action ladder", () => {
  const first = { id: "first", label: "FIRST-SENTINEL", href: "/guide", emphasis: "quiet" as const };
  const primary = { id: "primary", label: "PRIMARY-SENTINEL", href: "/start", emphasis: "primary" as const };
  it("orders primary first, resolves before sorting, and owns the responsive hero wrapper", () => {
    const page: ResolvedSectionedViewDocument = { ...PAGE, sections: [{ ...PAGE.sections[0]!, actions: [first, primary] } as ResolvedSectionedViewDocument["sections"][number], ...PAGE.sections.slice(1)] };
    const hero = dom({ document: page, peek: false }).querySelector("[data-landing-hero]")!;
    const links = [...hero.querySelectorAll("a")];
    expect(links.map(link => link.getAttribute("href"))).toEqual(["/start", "/guide"]);
    expect(links.map(link => link.getAttribute("data-action-emphasis"))).toEqual(["primary", "quiet"]);
    expect(links[1]?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(links[1]?.className.split(" ")).not.toContain("w-full");
    const omitted: ResolvedSectionedViewDocument = { ...PAGE, sections: [{ ...PAGE.sections[0]!, actions: [{ ...primary, emphasis: undefined }, { ...first, emphasis: undefined }] } as ResolvedSectionedViewDocument["sections"][number], ...PAGE.sections.slice(1)] };
    const pair = [...dom({ document: omitted, peek: false }).querySelectorAll("[data-landing-hero] a")];
    expect(pair.map(link => link.getAttribute("data-action-emphasis"))).toEqual(["primary", "secondary"]);
    for (const link of pair) expect(link.className.split(" ")).toEqual(expect.arrayContaining(["w-full", "tablet:w-auto"]));
    expect(pair[0]?.parentElement?.className.split(" ")).toEqual(expect.arrayContaining(["flex-col", "tablet:flex-row", "w-full"]));
    const start = dom({ document: omitted, peek: false, align: "start" }).querySelector("[data-landing-actions]")!;
    expect(start.className.split(" ")).toEqual(expect.arrayContaining(["items-start", "tablet:justify-start"]));
  });
  it("renders view-owned close actions and footnote while keeping hero-copy overrides", () => {
    const close = dom({ document: PAGE, callToAction: { copy: "hero", heading: null, actions: [first, primary], footnote: { text: "NOTE-SENTINEL", link: { label: "LINK-SENTINEL", href: "/note" } } } }).querySelector("[data-landing-call-to-action]")!;
    expect(close.querySelector("h2")).toBeNull();
    expect(close.textContent).toContain("LEDE-SENTINEL");
    expect([...close.querySelectorAll("a")].map(link => link.getAttribute("href"))).toEqual(["/start", "/guide", "/note"]);
    expect(close.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(close.querySelector("[data-content-section-footnote]")?.textContent).toBe("NOTE-SENTINEL LINK-SENTINEL");
    const defaults = dom({ document: PAGE, callToAction: { copy: "hero", actions: [{ ...primary, emphasis: undefined }, { ...first, emphasis: undefined }] } }).querySelectorAll("[data-landing-call-to-action] a");
    expect([...defaults].map(link => link.getAttribute("data-action-emphasis"))).toEqual(["primary", "secondary"]);
    for (const link of defaults) expect(link.className.split(" ")).toEqual(expect.arrayContaining(["w-full", "tablet:w-auto"]));
  });
  it("refuses malformed close action lists and invalid hero resolved emphases", () => {
    for (const actions of [[], [first], [{ ...primary, emphasis: "tertiary" }], [{ ...primary, emphasis: undefined }, primary], [primary, primary, primary], [{ ...primary, href: "javascript:alert(1)" }]]) {
      expect(() => dom({ document: PAGE, callToAction: { heading: "Close", actions } } as LandingViewProps)).toThrow(RenderError);
      const page = { ...PAGE, sections: [{ ...PAGE.sections[0], actions }, ...PAGE.sections.slice(1)] };
      expect(() => dom({ document: page } as LandingViewProps)).toThrow(RenderError);
    }
    expect(() => dom({ document: PAGE, callToAction: { heading: "Close", action: <a href="/legacy">Legacy</a>, actions: [primary] } } as LandingViewProps)).toThrow(RenderError);
  });
});


it("renders all body tiers with authored emphasis, size and ground, including decorative quiet chevrons", () => {
  for (const ground of ["base", "sunken", "inverse"] as const) for (const emphasis of ["primary", "secondary", "tertiary", "quiet"] as const) {
    const band = { id: "frame", kind: "content-section" as const, size: "standard" as const, layout: "stacked" as const, ground, heading: "FRAME-SENTINEL", actions: [{ id: "go", label: "GO-SENTINEL", href: "/go", emphasis }] };
    const page: ResolvedSectionedViewDocument = { ...PAGE, sections: [PAGE.sections[0]!, band] };
    const link = dom({ document: page, peek: false }).querySelector('a[href="/go"]')!;
    expect(link.getAttribute("data-action-emphasis")).toBe(emphasis);
    expect(link.className.split(" ")).toContain("text-body");
    expect(link.className.split(" ")).not.toContain("text-body-l");
    if (emphasis !== "quiet") expect(link.className.split(" ")).toEqual(expect.arrayContaining(["px-md", "py-sm"]));
    if (emphasis === "tertiary") expect(link.className.split(" ")).toEqual(expect.arrayContaining(["px-md", "py-sm"]));
    if (emphasis === "secondary") expect(link.className.split(" ")).toEqual(expect.arrayContaining(["ring-current", "ring-inset"]));
    if (emphasis === "tertiary") expect(link.className.split(" ")).toContain(ground === "inverse" ? "bg-control-tonal-inverse" : "bg-control-tonal");
    if (emphasis === "quiet") {
      expect(link.className.split(" ")).toContain(ground === "inverse" ? "text-ink-on-inverse" : "text-control-quiet");
      expect(link.lastElementChild?.getAttribute("aria-hidden")).toBe("true");
      expect(link.querySelectorAll("svg")).toHaveLength(1);
      expect(link.textContent).toBe("GO-SENTINEL");
    } else expect(link.querySelector("svg")).toBeNull();
  }
});


describe("LandingView reviewed action-pair and resolved copy contracts", () => {
  const pair = [{ id: "start", label: "Go", href: "/start" }, { id: "read", label: "Read", href: "/guide" }];
  const composed = ["Start ", [null, false, <em key="now">now</em>]];
  const page: ResolvedSectionedViewDocument = { ...PAGE, sections: [{ ...PAGE.sections[0]!, actions: pair } as ResolvedSectionedViewDocument["sections"][number], ...PAGE.sections.slice(1)] };

  it.each(["center", "start"] as const)("stretches the actual SectionIntro action row for %s hero and close", align => {
    // Apply the real shipped structural utilities, without building CSS or pretending jsdom measures geometry.
    const css = readFileSync("styles/preview.css", "utf8");
    const foundation = document.createElement("style");
    foundation.textContent = ["flex", "flex-col", "items-center", "items-start", "w-full"].map(name => {
      const rule = [...css.matchAll(/\.[\w-]+\s*\{[^{}]+\}/g)].find(match => match[0].slice(0, match[0].indexOf("{")).trim() === `.${name}`);
      expect(rule, `${name} structural utility exists`).toBeDefined();
      return rule![0];
    }).join("\n");
    const host = dom({ document: page, align, peek: false, callToAction: { copy: "hero", actions: pair } });
    document.head.append(foundation);
    document.body.append(host);
    try {
      for (const band of ["hero", "call-to-action"]) {
        const row = host.querySelector(`[data-landing-${band}] [data-section-intro-actions]`)!;
        const intro = row.parentElement!;
        const emitted = host.querySelector<HTMLStyleElement>("style[data-landing-action-pair-style]")!;
        const rule = emitted.sheet?.cssRules[0] as CSSStyleRule;
        expect(row.matches(rule.selectorText)).toBe(true);
        expect(getComputedStyle(intro).display).toBe("flex");
        expect(getComputedStyle(intro).flexDirection).toBe("column");
        expect(getComputedStyle(intro).alignItems).toBe(band === "hero" && align === "start" ? "flex-start" : "center");
        // Stretch this auto-width flex item in the cross axis, so child 100% widths have the prose column to fill.
        expect(getComputedStyle(row).alignSelf).toBe("stretch");
        for (const link of row.querySelectorAll("a")) expect(getComputedStyle(link).width).toBe("100%");
      }
    } finally {
      host.remove();
      foundation.remove();
    }
  });

  it.each(["action", "note", "link"])("accepts visible nested ReactNode arrays in %s copy", field => {
    const close = { heading: "Close", actions: [{ ...pair[0]!, label: field === "action" ? composed : "Start" }], footnote: { text: field === "note" ? composed : "Note", link: { label: field === "link" ? composed : "Guide", href: "/guide" } } };
    const host = dom({ document: PAGE, callToAction: close });
    const target = field === "action" ? host.querySelector('[data-landing-call-to-action] a[href="/start"]') : field === "note" ? host.querySelector("[data-content-section-footnote]") : host.querySelector('[data-content-section-footnote] a');
    expect(target?.textContent).toContain("Start now");
    expect(target?.querySelector("em")?.textContent).toBe("now");
  });

  it("accepts a resolved iterable of visible ReactNode copy", () => {
    const label = new Set(["Read ", <em key="guide">guide</em>]);
    expect(dom({ document: PAGE, callToAction: { heading: "Close", actions: [{ ...pair[0]!, label }] } }).querySelector('[data-landing-call-to-action] a')?.textContent).toBe("Read guide");
  });

  it("refuses empty or malformed composed copy in every closing copy field", () => {
    for (const bad of [[], [null, false, "  "], [{ id: "unresolved" }], [<em key="visible">Visible</em>, { id: "unresolved" }]]) {
      for (const field of ["action", "note", "link"]) {
        const close = { heading: "Close", actions: [{ ...pair[0]!, label: field === "action" ? bad : "Start" }], footnote: { text: field === "note" ? bad : "Note", link: { label: field === "link" ? bad : "Guide", href: "/guide" } } };
        expect(() => dom({ document: PAGE, callToAction: close } as unknown as LandingViewProps)).toThrow(RenderError);
      }
    }
  });

  it("keeps sanctioned target refusals for visible composed copy", () => {
    for (const close of [
      { heading: "Close", actions: [{ ...pair[0]!, label: composed, href: "javascript:alert(1)" }] },
      { heading: "Close", actions: [{ ...pair[0]!, label: composed }], footnote: { text: composed, link: { label: composed, href: "javascript:alert(1)" } } },
    ]) expect(() => dom({ document: PAGE, callToAction: close })).toThrow(RenderError);
  });

  it("leaves the legacy action slot and ordinary SectionedView free of pair styling", () => {
    const legacy = dom({ document: PAGE, callToAction: CALL_TO_ACTION });
    expect(legacy.querySelector("style")).toBeNull();
    const single = dom({ document: PAGE, callToAction: { copy: "hero", actions: [pair[0]!] } });
    expect(single.querySelector("style")).toBeNull();
    const ordinary = renderToStaticMarkup(<webServerEntry.SectionedView document={page} />);
    expect(ordinary).not.toContain("data-landing-action-pair");
    expect(ordinary).not.toContain("<style");
  });
});


describe("LandingView frame fit", () => {
  const heroAlone: ResolvedSectionedViewDocument = { ...PAGE, sections: [PAGE.sections[0]!] };

  it("fit frame with the hero alone fills the frame instead of 100dvh", () => {
    const root = dom({ document: heroAlone, fit: "frame", landmark: "none" });
    const view = root.querySelector<HTMLElement>("[data-landing-view]")!;
    const hero = root.querySelector<HTMLElement>("[data-landing-hero]")!;
    expect(view.classList.contains("flex-1")).toBe(true);
    expect(hero.classList.contains("flex-1")).toBe(true);
    expect(hero.style.minHeight).toBe("");
    expect(view.hasAttribute("fit")).toBe(false);
    expect(root.querySelector("[data-landing-cue]")).toBeNull();
    const viewport = dom({ document: heroAlone });
    expect(viewport.querySelector<HTMLElement>("[data-landing-hero]")!.style.minHeight).toBe("100dvh");
  });

  it.each([
    { document: PAGE },
    { document: heroAlone, trailing: [SHARED] },
    { document: heroAlone, callToAction: CALL_TO_ACTION },
  ])("fit frame with content after the hero keeps the peek and cue: %j", (props) => {
    const root = dom({ ...props, fit: "frame" });
    const hero = root.querySelector<HTMLElement>("[data-landing-hero]")!;
    expect(hero.style.minHeight).toBe("calc(100dvh - var(--spacing-5xl, 6rem))");
    expect(hero.classList.contains("flex-1")).toBe(false);
    expect(root.querySelector("[data-landing-cue]")).not.toBeNull();
    expect(root.innerHTML).toBe(dom({ ...props, fit: "viewport" }).innerHTML);
  });

  it("fit is ignored under a reserved header or for a compact hero", () => {
    const compact: ResolvedSectionedViewDocument = { ...heroAlone, sections: [{ ...heroAlone.sections[0]!, size: "compact" }] };
    for (const props of [
      { document: heroAlone, header: "reserved" as const },
      { document: compact, header: "overlay" as const },
      { document: compact, header: "reserved" as const },
    ]) {
      expect(dom({ ...props, fit: "frame" }).innerHTML).toBe(dom({ ...props, fit: "viewport" }).innerHTML);
      const hero = dom({ ...props, fit: "frame" }).querySelector<HTMLElement>("[data-landing-hero]")!;
      expect(hero.style.minHeight).toBe("");
      expect(hero.classList.contains("flex-1")).toBe(false);
    }
  });
});
