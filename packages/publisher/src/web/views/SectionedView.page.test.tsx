import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { SectionedView as ServerSectionedView } from "./SectionedView.server.js";
import { SectionedView } from "./SectionedView.js";
import { LANDING_VIEW_CALL_TO_ACTION_GROUND, planLandingViewGrounds } from "./landingViewGrounds.js";
import type { SectionedViewCallToAction } from "./SectionedViewContent.js";
import type { ResolvedSectionedViewDocument } from "../../core/sectioned-view.js";

const resolutions: ResolvedSectionedViewDocument["resolutions"] = [{ ref: { id: "acme.home" }, text: "Welcome", recordId: "acme", revision: "1", locale: "en", servedLocale: "en", chain: ["en"], source: { kind: "consumer", reference: "fixture" }, entryId: "acme.home" }];

const body: ResolvedSectionedViewDocument = {
  id: "acme-home",
  resolutions,
  sections: [
    { id: "hero", kind: "hero", ground: "base", heading: "Welcome", actions: [{ id: "start", label: "Start", href: "/start" }, { id: "learn", label: "Learn more", href: "#features" }] },
    { id: "features", kind: "feature-grid", ground: "sunken", heading: "Features", items: [{ id: "first", heading: "First" }] },
  ],
};

const faq: ResolvedSectionedViewDocument = {
  id: "acme-faq",
  resolutions,
  sections: [{ id: "faq", kind: "faq", ground: "base", heading: "Questions", items: ["one", "two", "three", "four"].map(id => ({ id, question: `Why ${id}?`, answer: "Because." })) }],
};

const close: SectionedViewCallToAction = { id: "close", eyebrow: "Ready", heading: "Start today", description: "One step.", actions: [{ id: "go", label: "Go", href: "/go" }] };

const dom = (html: string) => new JSDOM(html).window.document;

describe("SectionedView as a full page", () => {
  it("renders body, trailing documents and the closing call to action in order with one h1", () => {
    for (const View of [SectionedView, ServerSectionedView]) {
      const page = dom(renderToStaticMarkup(<View document={body} trailing={[faq]} callToAction={close} heroActions="button" header="reserved" peek={false} landmark="none" />));
      expect(page.querySelector("main")).toBeNull();
      expect([...page.querySelectorAll("h1")].map(node => node.textContent)).toEqual(["Welcome"]);
      expect([...page.querySelectorAll("h2")].map(node => node.textContent)).toEqual(["Features", "Questions", "Start today"]);
      const ids = [...page.querySelectorAll("[id]")].map(node => node.id).filter(id => ["hero", "features", "faq", "close"].includes(id));
      expect(ids).toEqual(["hero", "features", "faq", "close"]);
      const closing = page.getElementById("close")!;
      expect(closing.textContent).toContain("Ready");
      expect(closing.textContent).toContain("One step.");
      expect(closing.querySelector('a[href="/go"]')?.getAttribute("data-action-emphasis")).toBe("primary");
      expect(page.querySelector('#hero a[href="/start"]')?.getAttribute("data-action-emphasis")).toBe("primary");
    }
  });

  it("plans grounds across body, trailing and the close with the exported landing plan", () => {
    const plan = planLandingViewGrounds(body, [faq], { callToAction: { id: "close" } });
    expect(plan.bands.at(-1)).toMatchObject({ id: "close", role: "call-to-action", ground: LANDING_VIEW_CALL_TO_ACTION_GROUND });
    const page = dom(renderToStaticMarkup(<SectionedView document={body} trailing={[faq]} callToAction={close} />));
    expect(page.getElementById("close")?.outerHTML).toBe(dom(renderToStaticMarkup(<SectionedView document={{ ...body, sections: [body.sections[0]!] }} callToAction={close} />)).getElementById("close")?.outerHTML);
  });

  it("renders a trailing hero at h2 and keeps the default output unchanged without page props", () => {
    const trailingHero: ResolvedSectionedViewDocument = { id: "more", resolutions, sections: [{ id: "more-hero", kind: "hero", ground: "base", heading: "More" }] };
    const page = dom(renderToStaticMarkup(<SectionedView document={body} trailing={[trailingHero]} />));
    expect(page.querySelectorAll("h1")).toHaveLength(1);
    expect(page.querySelector("#more-hero h2")?.textContent).toBe("More");
    expect(renderToStaticMarkup(<SectionedView document={body} trailing={[]} heroActions="link" header="reserved" peek={false} />)).toBe(renderToStaticMarkup(<SectionedView document={body} />));
  });

  it("refuses duplicate ids, invalid trailing documents, invalid closes and frame-owned chrome", () => {
    const refuse = (node: JSX.Element) => expect(() => renderToStaticMarkup(node)).toThrow(/SectionedView refused/);
    refuse(<SectionedView document={body} trailing={[body]} />);
    refuse(<SectionedView document={body} trailing={[{ ...faq, extra: true } as unknown as ResolvedSectionedViewDocument]} />);
    refuse(<SectionedView document={body} callToAction={{ ...close, id: "features" }} />);
    refuse(<SectionedView document={body} callToAction={{ ...close, actions: [] }} />);
    refuse(<SectionedView document={body} callToAction={{ ...close, heading: " " }} />);
    refuse(<SectionedView document={body} callToAction={{ ...close, actions: [{ id: "go", label: "Go", href: "javascript:alert(1)" }] }} />);
    refuse(<SectionedView document={body} callToAction={{ ...close, actions: [{ id: "a", label: "A", href: "/a", emphasis: "secondary" }] }} />);
    refuse(<SectionedView document={body} callToAction={{ ...close, footnote: "x" } as unknown as SectionedViewCallToAction} />);
    refuse(<SectionedView document={body} header={"overlay" as "reserved"} />);
    refuse(<SectionedView document={body} peek={true as false} />);
  });
});
