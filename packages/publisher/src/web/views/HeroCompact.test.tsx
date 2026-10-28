// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { checkSectionVariety, resolveSectionedViewDocument, validateSectionedViewDocument } from "../../core/sectioned-view.js";
import type { SectionedViewDocument, SectionedViewHeroSection, ResolvedSectionedViewDocument } from "../../core/sectioned-view.js";
import { LandingView } from "@clossys/designer/frames";
import type { LandingViewProps } from "@clossys/designer/frames";

const hero: SectionedViewHeroSection = { id: "hero", kind: "hero", ground: "inverse", heading: { id: "sample.heading" }, description: { id: "sample.description" } };
const authored = (extra: Record<string, unknown> = {}): SectionedViewDocument => ({ id: "sample", sections: [{ ...hero, ...extra } as SectionedViewHeroSection] });
const resolved: ResolvedSectionedViewDocument = { id: "sample", resolutions: [{ ref: { id: "sample.heading" }, text: "Sample heading", recordId: "sample", revision: "1", locale: "en", source: { kind: "consumer", reference: "fixture" }, entryId: "sample.heading" }], sections: [{ id: "hero", kind: "hero", ground: "inverse", heading: "Sample heading", description: "Sample description", actions: [{ id: "one", label: "Continue", href: "/continue" }, { id: "two", label: "Details", href: "/details" }] }, { id: "body", kind: "feature-grid", ground: "base", heading: "Body", items: [{ id: "one", heading: "Item" }] }] };
const compact = { ...resolved, sections: [{ ...resolved.sections[0], size: "compact" }, ...resolved.sections.slice(1)] } as ResolvedSectionedViewDocument;
const markup = (props: LandingViewProps) => renderToStaticMarkup(<LandingView {...props} />);
const dom = (props: LandingViewProps) => { const host = document.createElement("div"); host.innerHTML = markup(props); return host; };

describe("hero compact contract", () => {
  it("accepts only canonical hero sizes while retaining closed hero keys", () => {
    expect(validateSectionedViewDocument(authored({ size: "compact" }))).toEqual([]);
    expect(validateSectionedViewDocument(authored({ size: "display" }))).toEqual([]);
    for (const value of ["standard", 1, null, {}]) expect(validateSectionedViewDocument(authored({ size: value })).map(f => f.rule)).toContain("sectioned-view-hero-shape");
    expect(validateSectionedViewDocument(authored({ size: "compact", compact: true })).map(f => f.rule)).toContain("sectioned-view-section-keys");
  });
  it("refuses compact hero media and retains display plus media", () => {
    const media = { assetId: "sample-still", alt: { id: "sample.alt" } };
    expect(validateSectionedViewDocument(authored({ size: "compact", media })).map(f => f.rule)).toContain("sectioned-view-hero-compact-media");
    expect(validateSectionedViewDocument(authored({ size: "display", media }))).toEqual([]);
  });
  it("explicitly carries canonical size into the resolved contract", () => {
    const resolver = (ref: { id: string }) => ({ ref, text: "Sample copy", recordId: "sample", revision: "1", locale: "en", source: { kind: "consumer" as const, reference: "fixture" }, entryId: ref.id });
    expect(resolveSectionedViewDocument(authored({ size: "compact" }), resolver).sections[0]).toHaveProperty("size", "compact");
    expect(resolveSectionedViewDocument(authored(), resolver).sections[0]).toHaveProperty("size", "display");
  });
  it("warns only for an isolated compact hero without known after content", () => {
    const alone = authored({ size: "compact" });
    expect(checkSectionVariety(alone)).toEqual([expect.objectContaining({ rule: "sectioned-view-hero-compact-content", severity: "warning", path: "sections.0" })]);
    expect(checkSectionVariety(alone, { hasAfterContent: true })).toEqual([]);
    expect(checkSectionVariety(authored())).toEqual([]);
    expect(checkSectionVariety(authored({ size: "display" }))).toEqual([]);
    const body: SectionedViewDocument = { id: "body", sections: [{ id: "body", kind: "feature-grid", heading: { id: "sample.body" }, items: [{ id: "one", heading: { id: "sample.one" } }] }] };
    expect(checkSectionVariety([alone, body])).toEqual([]);
    expect(checkSectionVariety({ ...alone, sections: [...alone.sections, ...body.sections] })).toEqual([]);
    expect(validateSectionedViewDocument(alone)).toEqual([]);
  });
});

describe("LandingView compact hero", () => {
  it.each(["overlay", "reserved"] as const)("uses compact %s padding without min-height, peek cue or rail", header => {
    const root = dom({ document: compact, header, peek: true, cueLabel: "Next section" });
    const band = root.querySelector("[data-landing-hero]") as HTMLElement;
    expect(band.getAttribute("data-hero-size")).toBe("compact");
    expect(band.style.minHeight).toBe("");
    expect(band.className).toContain(header === "overlay" ? "pt-6xl pb-3xl tablet-lg:pb-4xl" : "py-3xl tablet-lg:py-4xl");
    expect(root.querySelector("[data-landing-cue]")).toBeNull();
    expect(root.querySelector("[data-landing-cue-rail]")).toBeNull();
    expect(root.querySelector("h1")?.className).toContain("text-h1 tablet:text-h0 tablet-lg:text-display-m");
  });
  it("does not require an unused blank cue label", () => {
    expect(() => markup({ document: compact, peek: true, cueLabel: " " })).not.toThrow();
  });
  it("keeps actions, backdrop, alignment and hero copy reuse", () => {
    const root = dom({ document: compact, align: "start", backdrop: <span>Sample art</span>, callToAction: { copy: "hero", action: <a href="/continue">Continue</a> } });
    expect(root.querySelector("[data-landing-backdrop]")?.textContent).toBe("Sample art");
    expect(root.querySelector("h1")?.closest("[data-section-intro]")?.className).toContain("items-start");
    const links = root.querySelectorAll("[data-landing-hero] a");
    expect(links[0]?.className).toContain("bg-accent");
    expect(links[1]?.className).toContain("ring-inset ring-current ring-1");
    expect(root.querySelector("[data-landing-call-to-action] h2")?.textContent).toBe("Sample heading");
    expect(root.querySelector("[data-landing-call-to-action]")?.textContent).toContain("Sample description");
  });
  it("keeps omitted and display size output byte-identical", () => {
    const explicit = { ...resolved, sections: [{ ...resolved.sections[0], size: "display" }, ...resolved.sections.slice(1)] } as ResolvedSectionedViewDocument;
    for (const header of ["overlay", "reserved"] as const) expect(markup({ document: explicit, header })).toBe(markup({ document: resolved, header }));
  });
  it("refuses forged compact media and retired compact values", () => {
    for (const extra of [{ size: "compact", media: { assetId: "still", alt: "Sample" } }, { compact: true }]) expect(() => markup({ document: { ...resolved, sections: [{ ...resolved.sections[0], ...extra }] } as ResolvedSectionedViewDocument })).toThrow();
  });
});
