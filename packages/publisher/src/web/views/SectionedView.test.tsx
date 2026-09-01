import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SectionedView } from "./SectionedView.js";
import type { ResolvedSectionedViewDocument } from "../../core/sectioned-view.js";

const document: ResolvedSectionedViewDocument = {
  id: "acme-home",
  resolutions: [{ ref: { id: "acme.home" }, text: "Welcome", recordId: "acme", revision: "1", locale: "en", source: { kind: "consumer", reference: "fixture" }, entryId: "acme.home" }],
  sections: [
    { id: "hero", kind: "hero", ground: "base", heading: "Welcome" },
    { id: "features", kind: "feature-grid", ground: "sunken", heading: "Features", items: [{ id: "first", heading: "First" }] },
    { id: "faq", kind: "faq", ground: "inverse", heading: "Questions", items: [{ id: "one", question: "Why?", answer: "Because." }] },
    { id: "steps", kind: "ordered-step-sequence", ground: "base", heading: "Steps", items: [{ id: "one", ordinal: "1", heading: "Start" }] },
    { id: "status", kind: "status-list", ground: "sunken", heading: "Readiness", labels: { available: "Available", partial: "Partial", planned: "Planned", dispositions: { "not-offered": "Not offered" } }, groups: [{ id: "core", heading: "Core", items: [{ id: "one", label: "Feature", state: "available" }, { id: "none", label: "No certifications", disposition: "not-offered" }] }] },
  ],
};

describe("SectionedView", () => {
  it("renders the five closed Designer blocks in source order with one h1, h2 sections, h3 nested headings, one legend, and semantic steps", () => {
    const html = renderToStaticMarkup(<SectionedView document={document} />);
    expect(html).toMatch(/<h1[^>]*>Welcome<\/h1>[\s\S]*<h2[^>]*>Features<\/h2>[\s\S]*<h2[^>]*>Questions<\/h2>/);
    expect(html).toContain('id="hero"');
    expect(html).toContain('id="status"');
    expect(html).toContain("<ol");
    expect(html.match(/aria-label="Readiness"/g)).toHaveLength(1);
    expect(html).toContain("<h3");
  });

  it("fails closed before rendering malformed direct resolved models", () => {
    const malformed = { ...document, sections: [{ ...document.sections[1], items: [null] }] };
    expect(() => renderToStaticMarkup(<SectionedView document={malformed as unknown as ResolvedSectionedViewDocument} />)).toThrow(/invalid resolved document/);

    const unknownSection = { ...document, sections: [{ ...document.sections[0], extra: "nope" }] };
    const unknownItem = { ...document, sections: [{ ...document.sections[1], items: [{ ...document.sections[1].items[0], extra: "nope" }] }] };
    const unknownDocument = { ...document, extra: "nope" };
    for (const candidate of [unknownDocument, unknownSection, unknownItem]) {
      expect(() => renderToStaticMarkup(<SectionedView document={candidate as unknown as ResolvedSectionedViewDocument} />)).toThrow(/invalid resolved document/);
    }
  });

  it("requires every kind-specific resolved field and complete provenance before render", () => {
    const missingHero = { ...document, sections: [{ ...document.sections[0], heading: undefined }] };
    const missingFaq = { ...document, sections: [document.sections[0], { ...document.sections[2], items: [{ ...document.sections[2].items[0], answer: undefined }] }] };
    const badProvenance = { ...document, resolutions: [{ ...document.resolutions[0], ref: { id: "acme.home", extra: true } }] };
    const badValues = { ...document, resolutions: [{ ...document.resolutions[0], ref: { id: "acme.home", values: { count: {} } } }] };
    for (const candidate of [missingHero, missingFaq, badProvenance, badValues]) expect(() => renderToStaticMarkup(<SectionedView document={candidate as unknown as ResolvedSectionedViewDocument} />)).toThrow(/invalid resolved document/);
  });
});

/**
 * The exact markup this view rendered for LEGACY_DOCUMENT at 0.2.1, captured
 * by rendering that release's own code before the optional eyebrow, hero
 * action, status detail, and landmark additions existed. It is frozen here so
 * "additive" is a measurement rather than a claim: a document that carries
 * none of the new fields must still produce these bytes exactly.
 */
const LEGACY_MARKUP = `<main aria-label="acme-home" class="flex flex-col gap-2xl py-2xl"><section id="hero" class="flex flex-col"><div class="flex flex-col items-start gap-md"><p class="text-caption uppercase tracking-label text-ink-muted">New</p><h1 class="text-display-l font-display text-ink-primary">Welcome</h1><p class="text-body-l text-ink-secondary">A fixture hero.</p></div></section><div id="features" class="flex flex-col gap-lg bg-surface-sunken"><div class="flex flex-col gap-xs"><h2 class="text-h2 font-display text-ink-primary">Features</h2><p class="text-body text-ink-secondary">A fixture grid.</p></div><div class="grid grid-cols-1 gap-lg tablet:grid-cols-2 desktop:grid-cols-3"><div class="flex flex-col items-start gap-sm"><p class="text-body font-body font-medium text-ink-primary">First</p><p class="text-body-s text-ink-secondary">First feature.</p></div><div class="flex flex-col items-start gap-sm"><p class="text-body font-body font-medium text-ink-primary">Second</p></div></div></div><div id="faq" class="flex flex-col gap-lg bg-surface-inverse"><div class="flex flex-col gap-xs"><h2 class="text-h2 font-display text-ink-on-inverse">Questions</h2><p class="text-body text-ink-on-inverse-muted">A fixture FAQ.</p></div><div class="flex flex-col"><div class="flex flex-col" data-rac=""><button id="react-aria-_R_1jH1_" class="flex w-full items-center gap-sm rounded-default py-sm text-left text-body text-ink-on-inverse outline-none disabled:cursor-not-allowed" data-rac="" type="button" tabindex="0" data-react-aria-pressable="true" aria-expanded="false" aria-controls="react-aria-_R_1jH2_" slot="trigger"><span aria-hidden="true" class="inline-block transition-transform motion-reduce:transition-none">▸</span>Why?</button><div class="pl-lg text-body-s text-ink-on-inverse-muted" data-rac="" id="react-aria-_R_1jH2_" role="group" aria-labelledby="react-aria-_R_1jH1_" aria-hidden="true" hidden="">Because.</div></div></div></div><section id="steps" class="flex flex-col gap-lg"><div class="flex flex-col gap-xs"><h2 class="text-h2 font-display text-ink-primary">Steps</h2></div><ol class="flex flex-col tablet:flex-row"><li class="flex min-w-0 flex-1 flex-col tablet:flex-row"><div class="flex min-w-0 flex-1 flex-row gap-md tablet:flex-col"><span class="flex size-xl shrink-0 items-center justify-center rounded-pill border text-body-s font-body font-medium border-line-base text-ink-primary">1</span><div class="flex min-w-0 flex-col gap-xs"><p class="text-caption uppercase tracking-label text-ink-secondary">First</p><h3 class="text-h3 font-display text-ink-primary">Start</h3><p class="text-body-s text-ink-secondary">Start here.</p></div></div><span aria-hidden="true" class="ms-lg my-sm block h-lg w-px shrink-0 tablet:mx-md tablet:my-xl tablet:h-px tablet:w-lg bg-line-base"></span></li><li class="flex min-w-0 flex-1 flex-col tablet:flex-row"><div class="flex min-w-0 flex-1 flex-row gap-md tablet:flex-col"><span class="flex size-xl shrink-0 items-center justify-center rounded-pill border text-body-s font-body font-medium border-line-base text-ink-primary">2</span><div class="flex min-w-0 flex-col gap-xs"><h3 class="text-h3 font-display text-ink-primary">Finish</h3></div></div></li></ol></section><section id="status" class="flex flex-col gap-lg bg-surface-sunken"><div class="flex flex-col gap-xs"><h2 class="text-h2 font-display text-ink-primary">Readiness</h2><p class="text-body text-ink-secondary">A fixture status list.</p></div><div class="flex flex-col gap-xs"><p class="text-caption font-body font-medium text-ink-primary">Readiness</p><ul aria-label="Readiness" class="flex flex-wrap gap-md"><li class="flex items-center gap-xs text-body-s text-ink-primary"><span aria-hidden="true" class="size-xs shrink-0 rounded-pill bg-status-success ring-2 ring-ink-primary"></span>Available</li><li class="flex items-center gap-xs text-body-s text-ink-primary"><span aria-hidden="true" class="size-xs shrink-0 rounded-pill bg-status-warning ring-2 ring-ink-primary"></span>Partial</li><li class="flex items-center gap-xs text-body-s text-ink-primary"><span aria-hidden="true" class="size-xs shrink-0 rounded-pill bg-status-info ring-2 ring-ink-primary"></span>Planned</li><li class="flex items-center gap-xs text-body-s text-ink-primary"><span aria-hidden="true" class="size-xs shrink-0 rounded-pill bg-ink-muted ring-2 ring-ink-primary"></span>Not offered</li></ul></div><div class="flex flex-col gap-lg"><section class="flex flex-col gap-sm"><h3 class="text-h3 font-display text-ink-primary">Core</h3><dl class="flex flex-col"><div class="flex items-center justify-between gap-md py-sm"><dt class="text-body text-ink-primary">Feature</dt><dd class="flex shrink-0 items-center gap-xs text-body-s text-ink-primary"><span aria-hidden="true" class="size-xs shrink-0 rounded-pill bg-status-success ring-2 ring-ink-primary"></span>Available</dd></div><div class="flex items-center justify-between gap-md py-sm border-t border-line-base"><dt class="text-body text-ink-primary">No certifications</dt><dd class="flex shrink-0 items-center gap-xs text-body-s text-ink-primary"><span aria-hidden="true" class="size-xs shrink-0 rounded-pill bg-ink-muted ring-2 ring-ink-primary"></span>Not offered</dd></div></dl></section></div></section></main>`;

const LEGACY_DOCUMENT: ResolvedSectionedViewDocument = {
  id: "acme-home",
  resolutions: [{ ref: { id: "acme.home" }, text: "Welcome", recordId: "acme", revision: "1", locale: "en", source: { kind: "consumer", reference: "fixture" }, entryId: "acme.home" }],
  sections: [
    { id: "hero", kind: "hero", ground: "base", eyebrow: "New", heading: "Welcome", description: "A fixture hero." },
    { id: "features", kind: "feature-grid", ground: "sunken", heading: "Features", description: "A fixture grid.", items: [{ id: "first", heading: "First", description: "First feature." }, { id: "second", heading: "Second" }] },
    { id: "faq", kind: "faq", ground: "inverse", heading: "Questions", description: "A fixture FAQ.", items: [{ id: "one", question: "Why?", answer: "Because." }] },
    { id: "steps", kind: "ordered-step-sequence", ground: "base", heading: "Steps", items: [{ id: "one", ordinal: "1", label: "First", heading: "Start", description: "Start here." }, { id: "two", ordinal: "2", heading: "Finish" }] },
    { id: "status", kind: "status-list", ground: "sunken", heading: "Readiness", description: "A fixture status list.", labels: { available: "Available", partial: "Partial", planned: "Planned", dispositions: { "not-offered": "Not offered" } }, groups: [{ id: "core", heading: "Core", items: [{ id: "one", label: "Feature", state: "available" }, { id: "none", label: "No certifications", disposition: "not-offered" }] }] },
  ],
};

const expressive: ResolvedSectionedViewDocument = {
  ...document,
  sections: [
    { ...document.sections[0], actions: [{ id: "start", label: "Start now", href: "/start" }, { id: "docs", label: "Read the docs", href: "https://example.com/docs" }] },
    { ...document.sections[1], eyebrow: "Capabilities" },
    { ...document.sections[2], eyebrow: "Answers" },
    { ...document.sections[3], eyebrow: "Process" },
    {
      ...document.sections[4],
      eyebrow: "Posture",
      groups: [{ ...document.sections[4].groups[0], items: [{ id: "one", label: "Feature", detail: "Generally available in every region.", state: "available" }, { id: "none", label: "No certifications", detail: "Not offered because the audit is not ours to claim.", disposition: "not-offered" }] }],
    },
  ],
};

describe("SectionedView optional additive fields", () => {
  it("renders a document carrying none of them exactly as 0.2.1 did, byte for byte", () => {
    expect(renderToStaticMarkup(<SectionedView document={LEGACY_DOCUMENT} />)).toBe(LEGACY_MARKUP);
  });

  it("renders every non-hero eyebrow instead of dropping it", () => {
    const html = renderToStaticMarkup(<SectionedView document={expressive} />);
    for (const eyebrow of ["Capabilities", "Answers", "Process", "Posture"]) expect(html).toContain(`>${eyebrow}</p>`);
  });

  it("renders hero actions as real anchors carrying their authored href", () => {
    const html = renderToStaticMarkup(<SectionedView document={expressive} />);
    expect(html).toContain('<a href="/start"');
    expect(html).toContain('<a href="https://example.com/docs"');
    expect(html).toContain("Start now");
    expect(html).toContain("Read the docs");
  });

  it("renders a status row detail as a second description of the same row", () => {
    const html = renderToStaticMarkup(<SectionedView document={expressive} />);
    expect(html).toContain("Generally available in every region.");
    expect(html).toContain("Not offered because the audit is not ours to claim.");
    expect(html.match(/<dd/g)).toHaveLength(4);
    expect(renderToStaticMarkup(<SectionedView document={document} />).match(/<dd/g)).toHaveLength(2);
  });

  it("keeps its own main landmark by default and drops it, without a second landmark or a stray name, on request", () => {
    const owned = renderToStaticMarkup(<SectionedView document={document} />);
    const composed = renderToStaticMarkup(<SectionedView document={document} landmark="none" />);
    expect(owned).toContain('<main aria-label="acme-home" class="flex flex-col gap-2xl py-2xl">');
    expect(composed).not.toContain("<main");
    expect(composed).not.toContain('aria-label="acme-home"');
    expect(composed).toContain('<div class="flex flex-col gap-2xl py-2xl">');
    expect(composed).toContain("Welcome");
    expect(composed).toContain("Readiness");
    expect(owned.replace(/^<main aria-label="acme-home" (class="[^"]*")>/, "<div $1>").replace(/<\/main>$/, "</div>")).toBe(composed);
  });

  it("keeps rendering the same document identically when landmark is passed explicitly", () => {
    expect(renderToStaticMarkup(<SectionedView document={LEGACY_DOCUMENT} landmark="main" />)).toBe(LEGACY_MARKUP);
  });

  it("fails closed on an unsanctioned action href, a malformed action, a blank detail, and an unsupported landmark", () => {
    const unsafeHref = { ...document, sections: [{ ...document.sections[0], actions: [{ id: "x", label: "Go", href: "javascript:alert(1)" }] }] };
    const openAction = { ...document, sections: [{ ...document.sections[0], actions: [{ id: "x", label: "Go", href: "/go", onClick: () => {} }] }] };
    const emptyActions = { ...document, sections: [{ ...document.sections[0], actions: [] }] };
    const blankDetail = { ...document, sections: [document.sections[0], { ...document.sections[4], groups: [{ ...document.sections[4].groups[0], items: [{ id: "one", label: "Feature", detail: "  ", state: "available" }] }] }] };
    for (const candidate of [unsafeHref, openAction, emptyActions, blankDetail]) {
      expect(() => renderToStaticMarkup(<SectionedView document={candidate as unknown as ResolvedSectionedViewDocument} />)).toThrow(/invalid resolved document/);
    }
    expect(() => renderToStaticMarkup(<SectionedView document={document} landmark={"aside" as "none"} />)).toThrow(/invalid resolved document/);
  });
});
