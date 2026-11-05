import { createCopyResolver, type CopyRegistry } from "@clossys/writer";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { resolveSectionedViewDocument, type SectionedViewDocument } from "../../core/sectioned-view.js";
import { SectionedView } from "./SectionedView.js";
import { sectionedViewBlocks } from "./SectionedViewBlocks.js";
import { JSDOM } from "jsdom";
import type { ResolvedSectionedViewDocument } from "../../core/sectioned-view.js";

const document: ResolvedSectionedViewDocument = {
  id: "acme-home",
  resolutions: [{ ref: { id: "acme.home" }, text: "Welcome", recordId: "acme", revision: "1", locale: "en", servedLocale: "en", chain: ["en"], source: { kind: "consumer", reference: "fixture" }, entryId: "acme.home" }],
  sections: [
    { id: "hero", kind: "hero", ground: "base", heading: "Welcome" },
    { id: "features", kind: "feature-grid", ground: "sunken", heading: "Features", items: [{ id: "first", heading: "First" }] },
    { id: "faq", kind: "faq", ground: "inverse", heading: "Questions", items: ["one", "two", "three", "four"].map(id => ({ id, question: "Why?", answer: "Because." })) },
    { id: "steps", kind: "ordered-step-sequence", ground: "base", heading: "Steps", items: [{ id: "one", ordinal: "1", heading: "Start" }] },
    { id: "status", kind: "status-list", ground: "sunken", heading: "Readiness", labels: { available: "Available", partial: "Partial", planned: "Planned", dispositions: { "not-offered": "Not offered" } }, groups: [{ id: "core", heading: "Core", items: [{ id: "one", label: "Feature", state: "available" }, { id: "none", label: "No certifications", disposition: "not-offered" }] }, { id: "next", heading: "Next", items: [{ id: "partial", label: "Partial feature", state: "partial" }, { id: "planned", label: "Planned feature", state: "planned" }] }] },
  ],
};

describe("SectionedView", () => {
  it("renders the five closed Designer blocks in source order with one h1, h2 sections, h3 nested headings, localized status badges, and semantic steps", () => {
    const html = renderToStaticMarkup(<SectionedView document={document} />);
    expect(html).toMatch(/<h1[^>]*>Welcome<\/h1>[\s\S]*<h2[^>]*>Features<\/h2>[\s\S]*<h2[^>]*>Questions<\/h2>/);
    expect(html).toContain('id="hero"');
    expect(html).toContain('id="status"');
    expect(html).toContain("<ol");
    expect(statusRoot(html).querySelector("h2")?.textContent).toBe("Readiness");
    expect(statusRoot(html).querySelectorAll('[role="group"]')).toHaveLength(2);
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
 * none of the new fields retains the measured bytes outside the migrated FAQ and status. Designer
 * block restyles realign it (most recently the ordered steps: item-heading
 * type, a line-strong ordinal ring and a connector running from one ordinal
 * to the next); the view's own structure does not move.
 */
const LEGACY_MARKUP = `<main aria-label="acme-home" class="flex flex-col gap-2xl py-2xl"><section id="hero" class="flex flex-col gap-xl"><div data-section-intro="display" class="flex w-full flex-col items-start" style="max-width:var(--ui-width-prose-max, 48rem)"><p class="text-body-s font-medium uppercase tracking-label text-accent-text">New</p><h1 class="text-display-m tablet:text-display-l font-display leading-display text-balance text-ink-primary mt-sm">Welcome</h1><p class="text-body-l text-pretty text-ink-secondary mt-2xl">A fixture hero.</p></div></section><div id="features" class="flex flex-col gap-lg bg-surface-sunken"><div class="flex flex-col gap-xs"><h2 class="text-h2 font-display text-ink-primary">Features</h2><p class="text-body text-ink-secondary">A fixture grid.</p></div><div class="grid grid-cols-1 gap-lg tablet:grid-cols-2 desktop:grid-cols-3"><div class="flex flex-col items-start gap-sm"><p class="text-body font-body font-medium text-ink-primary">First</p><p class="text-body-s text-ink-secondary">First feature.</p></div><div class="flex flex-col items-start gap-sm"><p class="text-body font-body font-medium text-ink-primary">Second</p></div></div></div><div id="faq" class="flex flex-col gap-lg bg-surface-inverse"><div class="flex flex-col gap-xs"><h2 class="text-h2 font-display leading-heading text-ink-on-inverse">Questions</h2><p class="text-body text-ink-on-inverse-muted">A fixture FAQ.</p></div><div class="flex flex-col border-t border-line-on-inverse"><div class="group/faq block border-b border-line-on-inverse" data-rac=""><button id="react-aria-_R_1jH1_" class="flex w-full cursor-pointer items-center justify-between gap-lg rounded-default py-lg text-start text-body-l font-medium tablet:py-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent summary-marker-none text-ink-on-inverse" data-rac="" type="button" tabindex="0" data-react-aria-pressable="true" aria-expanded="false" aria-controls="react-aria-_R_1jH2_" slot="trigger"><span>Why?</span><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 disclosure-icon-motion" style="width:var(--ui-icon-md, var(--spacing-xl, 24px));height:var(--ui-icon-md, var(--spacing-xl, 24px));flex-shrink:0;stroke-width:var(--ui-icon-stroke, 2)" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></button><div class="disclosure-panel-motion" data-rac="" id="react-aria-_R_1jH2_" role="group" aria-labelledby="react-aria-_R_1jH1_" aria-hidden="true" hidden=""><div class="pb-lg pe-2xl text-body text-pretty tablet:pb-xl text-ink-on-inverse-muted" style="max-width:var(--ui-width-prose-max, 48rem)">Because.</div></div></div></div></div><section id="steps" class="flex flex-col gap-lg"><div class="flex flex-col gap-xs"><h2 class="text-h2 font-display text-ink-primary">Steps</h2></div><ol data-step-layout="plain" class="flex flex-col tablet:flex-row tablet:gap-x-xl"><li class="flex min-w-0 flex-1 flex-row gap-md tablet:flex-col tablet:gap-lg"><div class="flex shrink-0 flex-col items-center tablet:flex-row"><span class="flex size-2xl shrink-0 items-center justify-center rounded-pill text-body font-body font-medium tabular-nums bg-accent-tint text-accent-text">1</span><span aria-hidden="true" data-step-connector="" class="my-sm w-px flex-1 tablet:my-0 tablet:ms-md tablet:-me-md tablet:h-px tablet:w-auto bg-line-strong"></span></div><div data-step-text="" class="flex min-w-0 flex-col gap-sm pb-2xl tablet:pb-0"><p class="text-body-s font-medium uppercase tracking-label text-ink-secondary">First</p><h3 class="text-body-l font-body font-medium text-ink-primary">Start</h3><p class="text-body text-pretty text-ink-secondary">Start here.</p></div></li><li class="flex min-w-0 flex-1 flex-row gap-md tablet:flex-col tablet:gap-lg"><div class="flex shrink-0 flex-col items-center tablet:flex-row"><span class="flex size-2xl shrink-0 items-center justify-center rounded-pill text-body font-body font-medium tabular-nums bg-accent-tint text-accent-text">2</span></div><div data-step-text="" class="flex min-w-0 flex-col gap-sm"><h3 class="text-body-l font-body font-medium text-ink-primary">Finish</h3></div></li></ol></section><section id="status" class="flex flex-col gap-lg bg-surface-sunken"><div class="flex flex-col gap-xs"><h2 class="text-h2 font-display text-ink-primary">Readiness</h2><p class="text-body text-ink-secondary">A fixture status list.</p></div><div class="flex flex-col gap-xs"><p class="text-caption font-body font-medium text-ink-primary">Readiness</p><ul aria-label="Readiness" class="flex flex-wrap gap-md"><li class="flex items-center gap-xs text-body-s text-ink-primary"><span aria-hidden="true" class="size-xs shrink-0 rounded-pill bg-status-success ring-2 ring-ink-primary"></span>Available</li><li class="flex items-center gap-xs text-body-s text-ink-primary"><span aria-hidden="true" class="size-xs shrink-0 rounded-pill bg-status-warning ring-2 ring-ink-primary"></span>Partial</li><li class="flex items-center gap-xs text-body-s text-ink-primary"><span aria-hidden="true" class="size-xs shrink-0 rounded-pill bg-status-info ring-2 ring-ink-primary"></span>Planned</li><li class="flex items-center gap-xs text-body-s text-ink-primary"><span aria-hidden="true" class="size-xs shrink-0 rounded-pill bg-ink-muted ring-2 ring-ink-primary"></span>Not offered</li></ul></div><div class="flex flex-col gap-lg"><section class="flex flex-col gap-sm"><h3 class="text-h3 font-display text-ink-primary">Core</h3><dl class="flex flex-col"><div class="flex items-center justify-between gap-md py-sm"><dt class="text-body text-ink-primary">Feature</dt><dd class="flex shrink-0 items-center gap-xs text-body-s text-ink-primary"><span aria-hidden="true" class="size-xs shrink-0 rounded-pill bg-status-success ring-2 ring-ink-primary"></span>Available</dd></div><div class="flex items-center justify-between gap-md py-sm border-t border-line-base"><dt class="text-body text-ink-primary">No certifications</dt><dd class="flex shrink-0 items-center gap-xs text-body-s text-ink-primary"><span aria-hidden="true" class="size-xs shrink-0 rounded-pill bg-ink-muted ring-2 ring-ink-primary"></span>Not offered</dd></div></dl></section></div></section></main>`;

// FAQ and status now use canonical recipes; retain the frozen measurement for their siblings.
function withoutMigratedSections(markup: string): string {
  const start = markup.indexOf('id="faq"');
  const end = markup.indexOf('<section id="steps"', start);
  const open = markup.lastIndexOf("<", start);
  const withoutFaq = markup.slice(0, open) + markup.slice(end);
  const statusStart = withoutFaq.lastIndexOf("<", withoutFaq.indexOf('id="status"'));
  return withoutFaq.slice(0, statusStart) + withoutFaq.slice(withoutFaq.lastIndexOf("</main>"));
}

const LEGACY_DOCUMENT: ResolvedSectionedViewDocument = {
  id: "acme-home",
  resolutions: [{ ref: { id: "acme.home" }, text: "Welcome", recordId: "acme", revision: "1", locale: "en", servedLocale: "en", chain: ["en"], source: { kind: "consumer", reference: "fixture" }, entryId: "acme.home" }],
  sections: [
    { id: "hero", kind: "hero", ground: "base", eyebrow: "New", heading: "Welcome", description: "A fixture hero." },
    { id: "features", kind: "feature-grid", ground: "sunken", heading: "Features", description: "A fixture grid.", items: [{ id: "first", heading: "First", description: "First feature." }, { id: "second", heading: "Second" }] },
    { id: "faq", kind: "faq", ground: "inverse", heading: "Questions", description: "A fixture FAQ.", items: ["one", "two", "three", "four"].map(id => ({ id, question: "Why?", answer: "Because." })) },
    { id: "steps", kind: "ordered-step-sequence", ground: "base", heading: "Steps", items: [{ id: "one", ordinal: "1", label: "First", heading: "Start", description: "Start here." }, { id: "two", ordinal: "2", heading: "Finish" }] },
    { id: "status", kind: "status-list", ground: "sunken", heading: "Readiness", description: "A fixture status list.", labels: { available: "Available", partial: "Partial", planned: "Planned", dispositions: { "not-offered": "Not offered" } }, groups: [{ id: "core", heading: "Core", items: [{ id: "one", label: "Feature", state: "available" }, { id: "none", label: "No certifications", disposition: "not-offered" }] }, { id: "next", heading: "Next", items: [{ id: "partial", label: "Partial feature", state: "partial" }, { id: "planned", label: "Planned feature", state: "planned" }] }] },
  ],
};

const statusRoot = (html: string) => JSDOM.fragment(html).querySelector("#status")!;

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
      groups: [{ ...document.sections[4].groups[0], items: [{ id: "one", label: "Feature", detail: "Generally available in every region.", state: "available" }, { id: "none", label: "No certifications", detail: "Not offered because the audit is not ours to claim.", disposition: "not-offered" }] }, ...document.sections[4].groups.slice(1)],
    },
  ],
};

describe("SectionedView optional additive fields", () => {
  it("retains standalone StatusList definition-list markup byte for byte", () => {
    const status = LEGACY_DOCUMENT.sections[4];
    if (status.kind !== "status-list" || !status.groups) throw new Error("Expected grouped status fixture.");
    const { kind: _kind, ...props } = status;
    const html = renderToStaticMarkup(<sectionedViewBlocks.StatusList {...props} groups={status.groups.slice(0, 1)} legendLabel={status.heading} headingLevel={2} />);
    const start = LEGACY_MARKUP.lastIndexOf("<", LEGACY_MARKUP.indexOf('id="status"'));
    expect(html).toBe(LEGACY_MARKUP.slice(start, LEGACY_MARKUP.lastIndexOf("</main>")));
  });
  it("retains frozen sibling bytes outside the canonical FAQ and status sections", () => {
    expect(withoutMigratedSections(renderToStaticMarkup(<SectionedView document={LEGACY_DOCUMENT} />))).toBe(withoutMigratedSections(LEGACY_MARKUP));
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

  it("renders status details as Item descriptions alongside localized badges", () => {
    const html = renderToStaticMarkup(<SectionedView document={expressive} />);
    expect(html).toContain("Generally available in every region.");
    expect(html).toContain("Not offered because the audit is not ours to claim.");
    expect(statusRoot(html).querySelectorAll("[data-item-description]")).toHaveLength(2);
    expect(statusRoot(html).querySelectorAll("[data-item-heading]")).toHaveLength(4);
    expect(statusRoot(renderToStaticMarkup(<SectionedView document={document} />)).querySelectorAll("[data-item-description]")).toHaveLength(0);
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
    expect(withoutMigratedSections(renderToStaticMarkup(<SectionedView document={LEGACY_DOCUMENT} landmark="main" />))).toBe(withoutMigratedSections(LEGACY_MARKUP));
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

describe("SectionedView hero media and stat-grid (issue #1028)", () => {
  const heroStill = {
    type: "image" as const,
    src: "https://cdn.example/hero-still.png",
    width: 640,
    height: 480,
    alt: "Registry alt ignored when document alt wins",
  };

  it("renders hero media in a two-column Hero (tablet:grid-cols-2)", () => {
    const withMedia: ResolvedSectionedViewDocument = {
      ...document,
      sections: [{ ...document.sections[0], media: { assetId: "acme.hero.still", alt: "Placeholder product still" } }, ...document.sections.slice(1)],
    };
    const html = renderToStaticMarkup(
      <SectionedView
        document={withMedia}
        resolveAssetId={(id) => (id === "acme.hero.still" ? heroStill : undefined)}
      />,
    );
    expect(html).toContain('class="grid grid-cols-1 items-center gap-xl tablet:grid-cols-2"');
    expect(html).toContain('src="https://cdn.example/hero-still.png"');
    expect(html).toContain('alt="Placeholder product still"');
  });

  it("fails closed when hero media is present but resolveAssetId is missing", () => {
    const withMedia: ResolvedSectionedViewDocument = {
      ...document,
      sections: [{ ...document.sections[0], media: { assetId: "acme.hero.still", alt: "Placeholder product still" } }],
    };
    expect(() => renderToStaticMarkup(<SectionedView document={withMedia} />)).toThrow(/sections\.0\.media\.assetId/);
  });

  it("names only the fixed path when hero media cannot be resolved, never the asset id", () => {
    const withMedia: ResolvedSectionedViewDocument = {
      ...document,
      sections: [{ ...document.sections[0], media: { assetId: "sentinel.asset.id.33", alt: "Placeholder product still" } }],
    };
    const thrownMessage = (resolveAssetId: (id: string) => unknown): string => {
      try {
        renderToStaticMarkup(<SectionedView document={withMedia} resolveAssetId={resolveAssetId} />);
      } catch (error) {
        return (error as Error).message;
      }
      return expect.unreachable("expected the render to throw");
    };
    const unresolved = thrownMessage(() => undefined);
    expect(unresolved).toBe("SectionedView refused an invalid resolved document: sections.0.media.assetId did not resolve to a paintable asset.");
    expect(unresolved).not.toContain("sentinel.asset.id.33");
    const throwing = thrownMessage(() => {
      throw new Error("registry down");
    });
    expect(throwing).toBe("SectionedView refused an invalid resolved document: sections.0.media.assetId could not be resolved.");
    expect(throwing).not.toContain("sentinel.asset.id.33");
  });

  it("renders a stat-grid section through Designer Stat blocks", () => {
    const withStats: ResolvedSectionedViewDocument = {
      ...document,
      sections: [
        document.sections[0],
        {
          id: "stats",
          kind: "stat-grid",
          ground: "base",
          heading: "Metrics",
          items: [{ id: "one", label: "Active users", value: "2,481", delta: "+12%", trend: "up" }],
        },
        ...document.sections.slice(1),
      ],
    };
    const html = renderToStaticMarkup(<SectionedView document={withStats} />);
    expect(html).toContain("Active users");
    expect(html).toContain("2,481");
    expect(html).toContain("+12%");
    expect(html).toContain("▲");
  });
});

describe("SectionedView gap 2 and gap 7 relaxations", () => {
  it("retains the frozen sibling sections around canonical FAQ and status", () => {
    // Same proof technique as the LEGACY_MARKUP assertion above: this is the
    // exact shape gaps 2 and 7 relax around, not merely near it.
    expect(withoutMigratedSections(renderToStaticMarkup(<SectionedView document={LEGACY_DOCUMENT} />))).toBe(withoutMigratedSections(LEGACY_MARKUP));
  });

  it("renders a document with zero hero sections, with no h1 anywhere", () => {
    const noHero = { ...document, sections: document.sections.slice(1) };
    const html = renderToStaticMarkup(<SectionedView document={noHero as unknown as ResolvedSectionedViewDocument} />);
    expect(html).not.toContain("<h1");
    expect(html).toContain('id="features"');
  });

  it("renders a hero section anywhere in the document, not only first, at h2 when it is not", () => {
    const trailingHero = { ...document, sections: [...document.sections.slice(1), { ...document.sections[0], id: "closing-cta" }] };
    const html = renderToStaticMarkup(<SectionedView document={trailingHero as unknown as ResolvedSectionedViewDocument} />);
    expect(html).not.toContain("<h1");
    expect(html).toMatch(/id="closing-cta"[\s\S]*<h2[^>]*>Welcome<\/h2>/);
  });

  it("still refuses more than one hero section at render time", () => {
    const twoHeroes = { ...document, sections: [document.sections[0], { ...document.sections[0], id: "hero-two" }, ...document.sections.slice(1)] };
    expect(() => renderToStaticMarkup(<SectionedView document={twoHeroes as unknown as ResolvedSectionedViewDocument} />)).toThrow(/invalid resolved document/);
  });

  const flatStatusSection = { id: "status", kind: "status-list" as const, ground: "sunken" as const, heading: "Readiness", labels: document.sections[4].labels, items: [{ id: "one", label: "Feature", state: "available" as const }, { id: "none", label: "No certifications", disposition: "not-offered" as const }, { id: "partial", label: "Partial feature", state: "partial" as const }, { id: "planned", label: "Planned feature", state: "planned" as const }] };

  it("renders a flat status-list as one Items list without group labels", () => {
    const flat = { ...document, sections: [document.sections[0], flatStatusSection] };
    const html = renderToStaticMarkup(<SectionedView document={flat as unknown as ResolvedSectionedViewDocument} />);
    expect(statusRoot(html).querySelectorAll("[data-items]")).toHaveLength(1);
    expect(statusRoot(html).querySelectorAll('[role="group"]')).toHaveLength(0);
    expect(statusRoot(html).querySelector("dl")).toBeNull();
    expect(statusRoot(html).querySelectorAll("[data-item-heading]")).toHaveLength(4);
    expect(html).toContain("Feature");
    expect(html).toContain("No certifications");
  });

  it("renders a flat status row's detail exactly the way a grouped row's detail renders", () => {
    const flatWithDetail = { ...document, sections: [document.sections[0], { ...flatStatusSection, items: flatStatusSection.items.map((item, index) => index === 0 ? { ...item, detail: "Generally available." } : item) }] };
    const groupedWithDetail = { ...document, sections: [document.sections[0], { ...document.sections[4], groups: [{ ...document.sections[4].groups[0], items: document.sections[4].groups[0].items.map((item, index) => index === 0 ? { ...item, detail: "Generally available." } : item) }, ...document.sections[4].groups.slice(1)] }] };
    const flatHtml = renderToStaticMarkup(<SectionedView document={flatWithDetail as unknown as ResolvedSectionedViewDocument} />);
    const groupedHtml = renderToStaticMarkup(<SectionedView document={groupedWithDetail as unknown as ResolvedSectionedViewDocument} />);
    const rowOf = (html: string) => statusRoot(html).querySelector("[data-item]")!.outerHTML;
    expect(statusRoot(flatHtml).querySelector("[data-item-description]")?.textContent).toBe("Generally available.");
    expect(rowOf(flatHtml)).toBe(rowOf(groupedHtml));
  });

  it("fails closed on a status-list section carrying both groups and items, or neither", () => {
    const both = { ...document, sections: [document.sections[0], { ...flatStatusSection, groups: document.sections[4].groups }] };
    const neither = { ...document, sections: [document.sections[0], { id: "status", kind: "status-list", ground: "sunken", heading: "Readiness", labels: document.sections[4].labels }] };
    for (const candidate of [both, neither]) {
      expect(() => renderToStaticMarkup(<SectionedView document={candidate as unknown as ResolvedSectionedViewDocument} />)).toThrow(/invalid resolved document/);
    }
  });
});

describe("SectionedView pricing, testimonial, and stat (issue #1106)", () => {
  it("renders the new section kinds through Designer blocks", () => {
    const withBands: ResolvedSectionedViewDocument = {
      id: "acme-marketing",
      resolutions: document.resolutions,
      sections: [
        {
          id: "pricing",
          kind: "pricing",
          ground: "sunken",
          eyebrow: "Plans",
          heading: "Pricing",
          description: "Choose a tier.",
          items: [{
            id: "team",
            name: "Team",
            price: "$12",
            features: ["Unlimited seats"],
            cta: "Start trial",
          }],
        },
        {
          id: "proof",
          kind: "testimonial",
          ground: "base",
          heading: "Proof",
          items: [{
            id: "one",
            quote: "It just works.",
            attributorName: "Fixture Author",
            attributorRole: "Customer",
          }],
        },
        {
          id: "outcomes",
          kind: "stat",
          ground: "inverse",
          heading: "Outcomes",
          items: [{ id: "uptime", label: "Uptime", value: "99.9%", delta: "+0.1%" }],
        },
      ],
    };
    const html = renderToStaticMarkup(<SectionedView document={withBands} />);
    expect(html).toContain("Pricing");
    expect(html).toContain("Start trial");
    expect(html).toContain("It just works.");
    expect(html).toContain("Fixture Author");
    expect(html).toContain("99.9%");
    expect(html).toContain("bg-surface-sunken");
    expect(html).toContain("bg-surface-inverse");
  });
});

describe("SectionedView resolve-then-render contract", () => {
  const ref = (id: string) => ({ id });
  const statusCopy = {
    "acme.hero.heading": "Welcome",
    "acme.status.heading": "Readiness",
    "acme.status.available": "Available",
    "acme.status.partial": "Partial",
    "acme.status.planned": "Planned",
    "acme.status.not-offered": "Not offered",
    "acme.status.group.heading": "Core",
    "acme.status.item.label": "Fixture capability",
  };
  const registry: CopyRegistry = {
    id: "acme-status-resolve-render",
    locale: "en",
    revision: "1",
    source: { kind: "consumer", reference: "fixtures/acme-status-resolve-render" },
    entries: Object.entries(statusCopy).map(([id, text]) => ({ id, text, context: "fixture", status: "approved" })),
  };
  const resolver = createCopyResolver(registry);
  const heroSection = { id: "hero", kind: "hero" as const, ground: "base" as const, heading: ref("acme.hero.heading") };
  const statusLabels = {
    available: ref("acme.status.available"),
    partial: ref("acme.status.partial"),
    planned: ref("acme.status.planned"),
    dispositions: { "not-offered": ref("acme.status.not-offered") },
  };
  const groupedStatus: SectionedViewDocument = {
    id: "acme.status-grouped",
    sections: [
      heroSection,
      {
        id: "status",
        kind: "status-list",
        ground: "sunken",
        heading: ref("acme.status.heading"),
        labels: statusLabels,
        groups: [{ id: "core", heading: ref("acme.status.group.heading"), items: [{ id: "capability", label: ref("acme.status.item.label"), state: "available" }, { id: "unavailable", label: ref("acme.status.item.label"), disposition: "not-offered" }] }, { id: "next", heading: ref("acme.status.group.heading"), items: [{ id: "partial", label: ref("acme.status.item.label"), state: "partial" }, { id: "planned", label: ref("acme.status.item.label"), state: "planned" }] }],
      },
    ],
  };
  const { groups: _groups, ...statusWithoutGroups } = groupedStatus.sections[1];
  const flatStatus: SectionedViewDocument = {
    ...groupedStatus,
    id: "acme.status-flat",
    sections: [
      heroSection,
      {
        ...statusWithoutGroups,
        items: [{ id: "capability", label: ref("acme.status.item.label"), state: "available" }, { id: "unavailable", label: ref("acme.status.item.label"), disposition: "not-offered" }, { id: "partial", label: ref("acme.status.item.label"), state: "partial" }, { id: "planned", label: ref("acme.status.item.label"), state: "planned" }],
      } as SectionedViewDocument["sections"][1],
    ],
  };

  it("renders a grouped status-list after resolveSectionedViewDocument", () => {
    const resolved = resolveSectionedViewDocument(groupedStatus, resolver);
    const html = renderToStaticMarkup(<SectionedView document={resolved} />);
    expect(html).toContain("Core");
    expect(html).toContain("Fixture capability");
    expect(html).toContain("<h3");
  });

  it("renders a flat status-list after resolveSectionedViewDocument", () => {
    const resolved = resolveSectionedViewDocument(flatStatus, resolver);
    const html = renderToStaticMarkup(<SectionedView document={resolved} />);
    expect(statusRoot(html).querySelector("dl")).toBeNull();
    expect(statusRoot(html).querySelectorAll("[data-item-heading]")).toHaveLength(4);
    expect(statusRoot(html).querySelectorAll('[role="group"]')).toHaveLength(0);
    expect(html).toContain("Fixture capability");
  });
});

import { assertRenderableSectionedViewDocument } from "./SectionedViewContent.js";
import type { ResolvedSectionedViewContentSection } from "../../core/sectioned-view.js";

const contentRegistry = new Map<string, string>();
const contentRef = (id: string, text: string) => { const key = `render-content.${id}`; contentRegistry.set(key, text); return { id: key }; };
const canonicalInput: SectionedViewDocument = { id: "content", sections: [{ id: "band", kind: "content-section", heading: contentRef("heading", "Band"), block: { type: "items", arrangement: "rows", columns: 1, items: [{ id: "a", heading: contentRef("a", "A") }, { id: "b", heading: contentRef("b", "B") }] }, media: { type: "specimen", label: contentRef("media", "Placeholder specimen of one record"), panel: { id: "record", title: contentRef("title", "Placeholder record"), parts: [{ id: "fields", type: "fields", items: [{ id: "a", label: contentRef("field", "Field"), value: contentRef("value", "Value") }] }] } } }] };
const contentResolver = createCopyResolver({ id: "content", locale: "en", revision: "1", source: { kind: "consumer", reference: "fixture" }, entries: [...contentRegistry].map(([id,text])=>({ id,text,context:"Fixture",status:"approved" })) });
const canonicalDocument = resolveSectionedViewDocument(canonicalInput, contentResolver);
const canonicalSection = canonicalDocument.sections[0];
if (canonicalSection?.kind !== "content-section" || canonicalSection.block?.type !== "items" || canonicalSection.media?.type !== "specimen") throw new Error("Expected canonical content fixture");
const baseContent = canonicalSection;
const baseItems = canonicalSection.block;
const baseMedia = canonicalSection.media;
const basePanel = canonicalSection.media.panel;
const currentDocument = (section: Partial<ResolvedSectionedViewContentSection>) => ({ ...canonicalDocument, sections: [{ ...baseContent, ...section }] });
const currentHtml = (section: Partial<ResolvedSectionedViewContentSection>) => renderToStaticMarkup(<SectionedView document={currentDocument(section)} />);
const invalidDocument = (section: Record<string, unknown>) => ({ ...canonicalDocument, sections: [{ ...baseContent, ...section }] });

describe("SectionedView content-section", () => {
  it("renders canonical disclosure through the ordinary entry's React Aria controls", () => {
    const block = { ...baseItems, reveal: "disclose" as const, items: ["q1", "q2", "q3", "q4"].map(id=>({ id, heading: `Question ${id}?`, description: `Answer ${id}.` })) };
    const html=currentHtml({ layout: "split-end", media: undefined, block });
    expect(html).toContain('data-layout="split-end"'); expect(html).toContain("data-rac"); expect(html.match(/<button /g)).toHaveLength(4); expect(html).not.toContain("<summary");
  });

  it("renders text-only split items with real canonical axes and nested headings", () => {
    for (const arrangement of ["rows", "columns"] as const) {
      const html=currentHtml({ layout: "split-start", media: undefined, block: { ...baseItems, arrangement, columns: arrangement === "rows" ? 1 : 2 } });
      expect(html).toContain('data-layout="split-start"'); expect(html).toContain(`data-arrangement="${arrangement}"`); expect(html.match(/<h3 /g)).toHaveLength(2);
    }
  });

  it("renders an item eyebrow as a label above its real heading", () => {
    const html=currentHtml({ media: undefined, block: { ...baseItems, arrangement: "columns", columns: 2, items: [{ id:"a",eyebrow:"Records",heading:"A" },{ id:"b",heading:"B" }] } });
    expect(html).toMatch(/data-item-eyebrow=""[^>]*>Records<\/p>[\s\S]*<h3/); expect(html.match(/data-item-eyebrow/g)).toHaveLength(1);
  });

  it("renders the published FAQ through canonical frames and refuses its unknown layout", () => {
    const faqItems=["q1","q2","q3","q4"].map(id=>({ id,question:`Question ${id}?`,answer:`Answer ${id}.` }));
    const faqDocument = (layout: "split" | "stacked") => ({ ...document, sections: [{ id:"questions",kind:"faq" as const,ground:"sunken" as const,layout,eyebrow:"Questions",heading:"Before you start",items:faqItems }] });
    const split=renderToStaticMarkup(<SectionedView document={faqDocument("split")}/>);expect(split).toContain('data-layout="split-end"');expect(split).toContain("data-rac");expect(split).not.toContain("<summary");
    const stacked=renderToStaticMarkup(<SectionedView document={faqDocument("stacked")}/>);expect(stacked).toContain("data-items");expect(stacked).not.toContain("data-layout");
    expect(()=>assertRenderableSectionedViewDocument({ ...faqDocument("split"),sections:[{...faqDocument("split").sections[0],layout:"grid"}] })).toThrow(/sections\.0\.layout/);
  });

  it("keeps a specimen after its items and a linked footnote last, with the action ladder independent", () => {
    const html=currentHtml({ footnote:{text:"An aside.",link:{label:"Read the guide",href:"/guide"}} });
    expect(html).toMatch(/data-items[\s\S]*data-content-section-media[\s\S]*data-specimen[\s\S]*data-content-section-footnote/);expect(html).toContain('href="/guide"');expect(html).toContain("An aside.");expect(html).not.toContain("data-section-intro-actions");
    const header=currentHtml({ block:undefined,media:undefined,actions:[{id:"more",label:"More",href:"/more",emphasis:"primary"},{id:"faq",label:"FAQ",href:"/faq"}] });
    expect(header).toMatch(/href="\/more"[^>]*data-action-emphasis="primary"/);expect(header).toMatch(/href="\/faq"[^>]*data-action-emphasis="tertiary"/);expect(header).toContain("bg-accent");expect(header).toContain("bg-control-tonal");expect(header).not.toContain("text-ink-link");
    // Canonical rows support eyebrows; split frames keep actions in their text column.
    expect(()=>assertRenderableSectionedViewDocument(currentDocument({ layout:"split-end",actions:[{id:"go",label:"Go",href:"/go"}],footnote:{text:"Aside."} }))).not.toThrow();
  });

  it("refuses invalid blocks, specimen parts, actions and footnotes at their precise paths", () => {
    const { columns: unusedColumns, ...bentoAxes } = baseItems;
    const cards=(...spans:string[])=>({ ...bentoAxes,arrangement:"bento",items:spans.map((span,index)=>({id:`c${index}`,heading:`Card ${index}`,span})) });
    expect(()=>assertRenderableSectionedViewDocument(invalidDocument({block:cards("half","half")}))).not.toThrow();
    expect(()=>assertRenderableSectionedViewDocument(currentDocument({layout:"split-end",actions:[{id:"one",label:"One",href:"/one",emphasis:"primary"},{id:"two",label:"Two",href:"/two",emphasis:"secondary"}]}))).not.toThrow();
    const validMeter={id:"m",type:"meter",label:"M",value:1,scaleMax:4,limit:2,direction:"max",tone:"info",valueText:"1",limitText:"2"};
    const validTable={id:"t",type:"table",caption:"T",columns:[{id:"a",label:"A"},{id:"b",label:"B"}],rows:[{id:"r",cells:[{text:"x"},{text:"y"}]}]};
    for(const part of [validMeter,validTable])expect(()=>assertRenderableSectionedViewDocument(invalidDocument({media:{...baseMedia,panel:{...basePanel,parts:[part]}}}))).not.toThrow();
    const cases: Array<[Record<string,unknown>,RegExp]> = [
      [{block:cards("third","third")},/sections\.0\.block\.items/],
      [{block:cards("half","two-thirds")},/sections\.0\.block\.items\.1\.span/],
      [{block:{...baseItems,items:[{id:"a",heading:"A",icon:"rocket"},{id:"b",heading:"B"}]}},/sections\.0\.block\.items\.0\.icon/],
      [{block:{...baseItems,items:[{id:"a",heading:"A",extra:"Other"},{id:"b",heading:"B"}]}},/sections\.0\.block\.items\.0/],
      [{block:{...baseItems,items:[{id:"a",heading:"A",eyebrow:"x".repeat(33)},{id:"b",heading:"B"}]}},/sections\.0\.block\.items\.0\.eyebrow/],
      [{block:{type:"slider",items:[]}},/sections\.0\.block\.type/],
      [{media:{...baseMedia,panel:{...basePanel,parts:["a","b","c","d"].map(id=>({...basePanel.parts[0],id}))}}},/sections\.0\.media\.panel\.parts/],
      [{media:{...baseMedia,panel:{...basePanel,title:{id:"unresolved"}}}},/sections\.0\.media\.panel\.title/],
      [{media:{...baseMedia,arrangement:"row"}},/sections\.0\.media: sections\.0\.media must be a closed data object with type, label, panel/],
      [{media:{...baseMedia,panel:{...basePanel,parts:[{...validMeter,scaleMax:0}]}}},/sections\.0\.media\.panel\.parts\.0\.scaleMax/],
      [{media:{...baseMedia,panel:{...basePanel,parts:[{...validTable,rows:[{id:"r",cells:[{text:"x"}]}]}]}}},/sections\.0\.media\.panel\.parts\.0\.rows\.0\.cells/],
      [{layout:"split"},/sections\.0\.layout/],
      [{block:{...baseItems,columns:3}},/sections\.0\.block\.columns/],
      [{block:{...baseItems,reveal:"disclose",items:[{id:"a",heading:"A"},{id:"b",heading:"B"},{id:"c",heading:"C"},{id:"d",heading:"D"}]}},/sections\.0\.block\.items\.0/],
      [{mediaSide:"start"},/sections\.0: sections\.0 has keys not allowed for content-section/],
      [{items:[]},/sections\.0: sections\.0 has keys not allowed for content-section/],
      [{layout:"split-end",actions:[1,2,3].map(n=>({id:`a${n}`,label:"Go",href:`/go-${n}`}))},/sections\.0\.actions.*must hold 1-2 actions; it holds 3/],
      [{layout:"split-end",actions:[1,2].map(n=>({id:`a${n}`,label:"Go",href:`/go-${n}`,emphasis:"primary"}))},/sections\.0\.actions.*holds 2 primary actions; keep at most one/],
      [{actions:[{id:"a",label:"Go",href:"/go",emphasis:"link"}]},/sections\.0\.actions\.0\.emphasis/],
      [{block:{...baseItems,items:[{id:"a",heading:"A",href:"/a"},{id:"b",heading:"B"}]}},/sections\.0\.block\.items/],
      [{actions:[{id:"go",label:"Go",href:"/go"}]},/sections\.0\.actions.*stacked band whose intro is followed by a block or visual/],
      [{block:undefined,media:undefined,actions:[{id:"go",label:"Go",href:"/go"}],footnote:{text:"Aside."}},/sections\.0\.footnote.*header-only band with actions/],
      [{footnote:{text:" "}},/sections\.0\.footnote/],
      [{footnote:{text:"Aside.",links:[]}},/sections\.0\.footnote/],
      [{footnote:{text:"Aside.",link:{label:"Guide",href:"/guide",style:"button"}}},/sections\.0\.footnote\.link/],
      [{footnote:{text:"Aside.",link:{label:"Guide",href:"javascript:void(0)"}}},/sections\.0\.footnote\.link\.href/],
    ];
    for(const [section,path] of cases) expect(()=>assertRenderableSectionedViewDocument(invalidDocument(section))).toThrow(path);
  });
});
