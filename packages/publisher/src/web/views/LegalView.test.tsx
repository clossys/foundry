import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { Item, Items } from "@clossys/designer/blocks/server";
import { describe, expect, it, vi } from "vitest";
import type { CopyRegistry, CopyResolver } from "@clossys/writer";
import { createCopyResolver } from "@clossys/writer";
import { SiteFooter, SiteHeader } from "@clossys/designer/shell/server";
import { RenderError } from "../../internal/errors.js";
import { LEGAL_SECTION_IDS } from "../../document/legal.js";
import type { LegalDocument, LegalDocumentKind } from "../../document/legal.js";
import { LegalView } from "./LegalView.js";
import type { LegalViewLabels, LegalViewProps } from "./LegalView.js";

vi.mock("@clossys/designer/blocks/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clossys/designer/blocks/server")>();
  return { ...actual, Item: vi.fn(actual.Item), Items: vi.fn(actual.Items) };
});

vi.mock("../../document/render.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../document/render.js")>();
  return { ...actual, renderStructuredDocument: vi.fn(actual.renderStructuredDocument) };
});

// Placeholder copy only: every string below is an obviously-fake marker, never
// legal-sounding wording. Each id maps to a unique text so assertions can tell
// which reference rendered where.

const ref = (id: string) => ({ id });

const LABELS: LegalViewLabels = {
  effectiveDate: ref("acme.label.effective"),
  lastUpdated: ref("acme.label.updated"),
  draftHeading: ref("acme.label.draft"),
};

const FACT_A = "acme.fact.a";
const FACT_B = "acme.fact.b";

type Section = LegalDocument["sections"][number];

function sectionFor(docId: string, id: string, refId = `${docId}.${id}.p1`): Section {
  return {
    kind: "section",
    id,
    level: 2,
    heading: ref(`${docId}.${id}.heading`),
    blocks: [{ kind: "paragraph", content: [{ kind: "text", text: ref(refId) }] }],
  };
}

function legalDoc(kind: LegalDocumentKind, overrides: { legal?: Record<string, unknown>; sections?: Section[] } = {}): LegalDocument {
  const docId = `acme.${kind}`;
  return {
    id: docId,
    title: ref(`${docId}.title`),
    sections: overrides.sections ?? LEGAL_SECTION_IDS[kind].map((id) => sectionFor(docId, id)),
    legal: {
      kind,
      status: "counsel-reviewed",
      effectiveDate: "2026-01-15",
      lastUpdated: "2026-02-01",
      variables: { entity: "Placeholder Entity Marker", jurisdiction: "Placeholder Jurisdiction Marker", contact: "placeholder-contact-marker" },
      ...overrides.legal,
    },
  } as LegalDocument;
}

function draftDoc(kind: LegalDocumentKind = "terms"): LegalDocument {
  return legalDoc(kind, { legal: { status: "draft", factsToConfirm: [ref(FACT_A), ref(FACT_B)] } });
}

const NA_ID = "acme.privacy.children.notapplicable";

function notApplicableDoc(): LegalDocument {
  const sections = LEGAL_SECTION_IDS.privacy.map((id) => (id === "children" ? sectionFor("acme.privacy", id, NA_ID) : sectionFor("acme.privacy", id)));
  return legalDoc("privacy", { sections, legal: { notApplicable: { children: ref(NA_ID) } } });
}

function buildRegistry(): CopyRegistry {
  const entries: { id: string; text: string }[] = [
    { id: LABELS.effectiveDate.id, text: "Placeholder label effective" },
    { id: LABELS.lastUpdated.id, text: "Placeholder label updated" },
    { id: LABELS.draftHeading.id, text: "Placeholder label draft" },
    { id: FACT_A, text: "Placeholder fact A" },
    { id: FACT_B, text: "Placeholder fact B" },
    { id: NA_ID, text: "Placeholder statement not applicable" },
  ];
  for (const kind of ["terms", "privacy"] as const) {
    const docId = `acme.${kind}`;
    entries.push({ id: `${docId}.title`, text: `Placeholder title ${kind}` });
    for (const id of LEGAL_SECTION_IDS[kind]) {
      entries.push({ id: `${docId}.${id}.heading`, text: `Placeholder heading ${kind} ${id}` });
      entries.push({ id: `${docId}.${id}.p1`, text: `Placeholder paragraph ${kind} ${id}` });
    }
  }
  return {
    id: "acme-legal-view",
    locale: "en",
    revision: "1",
    source: { kind: "consumer", reference: "fixtures/acme-legal-view" },
    entries: entries.map((entry) => ({ ...entry, context: "fixture", status: "approved" as const })),
  };
}

const resolver: CopyResolver = createCopyResolver(buildRegistry());

type RenderOverrides = Partial<Pick<LegalViewProps,
  "labels" | "locale" | "resolveCopyId" | "related" | "footerSecondary" |
  "headerAction" | "secondaryAction" | "nav" | "ground"
>>;
function render(document: LegalDocument, overrides: RenderOverrides = {}): string {
  return renderToStaticMarkup(
    <LegalView brand="Acme" document={document} {...overrides}
      resolveCopyId={overrides.resolveCopyId ?? resolver}
      labels={overrides.labels ?? LABELS} locale={overrides.locale ?? "en"} />,
  );
}

function formatted(locale: string, y: number, m: number, d: number): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

describe("LegalView refuses an invalid document", () => {
  it("throws RenderError naming the rule and path for a missing section", () => {
    const doc = legalDoc("terms");
    const sections = doc.sections.filter((s) => s.id !== "liability");
    const invalid = { ...doc, sections } as LegalDocument;
    let thrown: unknown;
    let html = "";
    try {
      html = render(invalid);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RenderError);
    expect((thrown as RenderError).reason).toBe("resolution-failed");
    expect((thrown as Error).message).toContain("legal-section-missing");
    expect((thrown as Error).message).toContain("sections");
    expect(html).toBe("");
  });

  it("throws for an unknown status", () => {
    const invalid = legalDoc("terms", { legal: { status: "published" } });
    expect(() => render(invalid)).toThrow(RenderError);
    expect(() => render(invalid)).toThrow(/legal-status-unknown/);
  });

  it("throws for a calendar-invalid date", () => {
    const invalid = legalDoc("terms", { legal: { effectiveDate: "2026-02-30" } });
    expect(() => render(invalid)).toThrow(RenderError);
    expect(() => render(invalid)).toThrow(/legal-date-invalid/);
    expect(() => render(invalid)).toThrow(/legal\.effectiveDate/);
  });

  it("throws for a draft with no facts to confirm", () => {
    const invalid = legalDoc("terms", { legal: { status: "draft" } });
    expect(() => render(invalid)).toThrow(/legal-draft-facts-missing/);
  });

  it("names the fixed notApplicable path without echoing a caller-chosen key", () => {
    const invalid = legalDoc("terms", { legal: { notApplicable: { "sentinel-key-29": ref("acme.terms.sentinel") } } });
    let thrown: unknown;
    try {
      render(invalid);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RenderError);
    expect((thrown as Error).message).toBe("LegalView refused an invalid legal document: legal-not-applicable-unknown-section at legal.notApplicable.");
    expect((thrown as Error).message).not.toContain("sentinel-key-29");
  });

  it("does not echo the document id or an unresolved CopyRef id from the document renderer", () => {
    const invalid = { ...legalDoc("terms"), id: "sentinel-doc-id-29" };
    const missing: CopyResolver = (r) => (r.id === `acme.terms.${LEGAL_SECTION_IDS.terms[0]}.p1` ? undefined : resolver(r));
    let thrown: unknown;
    try {
      render(invalid, { resolveCopyId: missing });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RenderError);
    expect((thrown as Error).message).toContain("could not resolve a CopyRef at sections.0.blocks.0.content.0.text");
    expect((thrown as Error).message).not.toContain("sentinel-doc-id-29");
    expect((thrown as Error).message).not.toContain(`acme.terms.${LEGAL_SECTION_IDS.terms[0]}.p1`);
  });
});

describe("LegalView draft marker", () => {
  it("renders a warning note with the heading and every fact, before the first section", () => {
    const html = render(draftDoc("terms"));
    expect(html).toContain('role="note"');
    expect(html).toContain('data-callout-tone="warning"');
    const aside = /<aside[^>]*role="note"[^>]*>(.*?)<\/aside>/s.exec(html);
    expect(aside).not.toBeNull();
    expect(aside![1]).toMatch(/<h2[^>]*>Placeholder label draft<\/h2>/);
    expect(aside![1]).toContain("Placeholder fact A");
    expect(aside![1]).toContain("Placeholder fact B");
    expect((aside![1]!.match(/<li/g) ?? []).length).toBe(2);
    expect(html.indexOf('role="note"')).toBeLessThan(html.indexOf("<section"));
  });

  it("throws when a fact does not resolve", () => {
    const doc = legalDoc("terms", { legal: { status: "draft", factsToConfirm: [ref("acme.fact.unknown")] } });
    expect(() => render(doc)).toThrow(RenderError);
    expect(() => render(doc)).toThrow(/legal\.factsToConfirm\.0/);
    expect(() => render(doc)).not.toThrow(/acme\.fact\.unknown/);
  });

  it("renders no callout element for a counsel-reviewed document", () => {
    const html = render(legalDoc("terms"));
    expect(html).not.toContain("role=\"note\"");
    expect(html).not.toContain("data-callout-tone");
    expect(html).not.toContain("<aside");
    expect(html).not.toContain("Placeholder label draft");
    expect(html).not.toContain("Placeholder fact");
  });
});

describe("LegalView sections", () => {
  it("keeps a not-applicable section's heading and statement together", () => {
    const html = render(notApplicableDoc());
    const section = /<section id="children">(.*?)<\/section>/s.exec(html);
    expect(section).not.toBeNull();
    expect(section![1]).toMatch(/^<h2[^>]*>Placeholder heading privacy children<\/h2><p>Placeholder statement not applicable<\/p>$/);
  });

  for (const kind of ["terms", "privacy"] as const) {
    it(`renders ${kind} section ids in LEGAL_SECTION_IDS order`, () => {
      const html = render(legalDoc(kind));
      const ids = [...html.matchAll(/<section id="([^"]+)"/g)].map((match) => match[1]);
      expect(ids).toEqual([...LEGAL_SECTION_IDS[kind]]);
    });
  }

  it("renders the document title as the page heading", () => {
    const html = render(legalDoc("privacy"));
    expect(html).toContain("Placeholder title privacy");
    expect(html).toContain("<article");
  });
});

describe("LegalView dates", () => {
  for (const locale of ["en", "de"]) {
    it(`renders both dates as <time> with UTC-safe ${locale} text and resolved labels`, () => {
      const html = render(legalDoc("terms"), { locale });
      expect(html).toContain('<time dateTime="2026-01-15"');
      expect(html).toContain('<time dateTime="2026-02-01"');
      expect(html).toMatch(new RegExp(`<time dateTime="2026-01-15"[^>]*>${formatted(locale, 2026, 1, 15)}</time>`));
      expect(html).toMatch(new RegExp(`<time dateTime="2026-02-01"[^>]*>${formatted(locale, 2026, 2, 1)}</time>`));
      expect(html).toContain("Placeholder label effective");
      expect(html).toContain("Placeholder label updated");
    });
  }

  it("does not shift a first-of-year date across a timezone boundary", () => {
    const html = render(legalDoc("terms", { legal: { effectiveDate: "2026-01-01", lastUpdated: "2026-12-31" } }), { locale: "en" });
    expect(html).toContain(`>${formatted("en", 2026, 1, 1)}</time>`);
    expect(html).toContain(`>${formatted("en", 2026, 12, 31)}</time>`);
    expect(formatted("en", 2026, 1, 1)).toContain("January 1, 2026");
  });

  it("keeps a year below 100 instead of mapping it to the 1900s", () => {
    const html = render(legalDoc("terms", { legal: { effectiveDate: "0050-06-01" } }), { locale: "en" });
    const match = /<time dateTime="0050-06-01"[^>]*>([^<]*)<\/time>/.exec(html);
    expect(match).not.toBeNull();
    expect(match?.[1]).toContain("50");
    expect(match?.[1]).not.toContain("1950");
  });

  it("places the dates between the page header and the article body", () => {
    const html = render(legalDoc("terms"));
    expect(html.indexOf("<time")).toBeLessThan(html.indexOf("<article"));
    expect(html.indexOf("<h1")).toBeLessThan(html.indexOf("<time"));
  });

  it("throws RenderError for an invalid locale", () => {
    expect(() => render(legalDoc("terms"), { locale: "!!" })).toThrow(RenderError);
  });

  it("throws a fixed-token RenderError for a malformed locale without echoing it", () => {
    const attempt = () => render(legalDoc("terms"), { locale: "!!sentinel-locale!!" });
    expect(attempt).toThrow(RenderError);
    expect(attempt).toThrow(/locale/);
    expect(attempt).not.toThrow(/sentinel-locale/);
  });

  it("caps the content width with the prose-max token and a non-length fallback", () => {
    const html = render(legalDoc("terms"));
    const mainTag = html.slice(html.indexOf("<main"), html.indexOf(">", html.indexOf("<main")) + 1);
    expect(mainTag).toContain("max-width:var(--ui-width-prose-max, none)");
  });

  const badLocales: Array<[string, unknown]> = [
    ["omitted", undefined],
    ["empty", ""],
    ["blank", "   "],
    ["non-string number", 424242],
    ["non-string object", { tag: "sentinel-locale-value" }],
  ];
  for (const [name, value] of badLocales) {
    it(`throws RenderError before any date formatting for an ${name} locale, without echoing the value`, () => {
      const spy = vi.spyOn(Intl, "DateTimeFormat");
      try {
        const attempt = () =>
          renderToStaticMarkup(
            <LegalView brand="Acme" document={legalDoc("terms")} resolveCopyId={resolver} labels={LABELS} locale={value as string} />,
          );
        expect(attempt).toThrow(RenderError);
        expect(attempt).toThrow(/locale/);
        expect(attempt).not.toThrow(/424242|sentinel-locale-value/);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });
  }
});

describe("LegalView labels", () => {
  for (const key of ["effectiveDate", "lastUpdated", "draftHeading"] as const) {
    it(`throws RenderError naming the CopyRef when ${key} is unresolved, even for a reviewed document`, () => {
      const labels = { ...LABELS, [key]: ref("acme.label.missing") };
      expect(() => render(legalDoc("terms"), { labels })).toThrow(RenderError);
      expect(() => render(legalDoc("terms"), { labels })).not.toThrow(/acme\.label\.missing/);
      expect(() => render(legalDoc("terms"), { labels })).toThrow(new RegExp(`labels\\.${key}`));
    });
  }

  it("throws when a label resolves to blank text", () => {
    const blank: CopyResolver = (r) => (r.id === LABELS.lastUpdated.id ? { ...resolver(ref(LABELS.lastUpdated.id))!, text: "  " } : resolver(r));
    expect(() => render(legalDoc("terms"), { resolveCopyId: blank })).toThrow(RenderError);
  });
});

describe("LegalView variables", () => {
  it("does not render entity, jurisdiction or contact", () => {
    for (const doc of [legalDoc("terms"), draftDoc("privacy")]) {
      const html = render(doc);
      expect(html).not.toContain("Placeholder Entity Marker");
      expect(html).not.toContain("Placeholder Jurisdiction Marker");
      expect(html).not.toContain("placeholder-contact-marker");
    }
  });
});

describe("LegalView title", () => {
  it("reports an unresolved title without echoing the document id", async () => {
    const { renderStructuredDocument } = await import("../../document/render.js");
    vi.mocked(renderStructuredDocument).mockReturnValueOnce({ element: null, resolutions: [] } as never);
    let thrown: unknown;
    try {
      render({ ...legalDoc("terms"), id: "sentinel-doc-id-42" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RenderError);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/title/);
    expect((thrown as Error).message).not.toContain("sentinel-doc-id-42");
  });
});

describe("LegalView header slots", () => {
  const doc = legalDoc("terms");
  const view = (props: Partial<Parameters<typeof LegalView>[0]> = {}) =>
    renderToStaticMarkup(<LegalView brand="Acme" document={doc} resolveCopyId={resolver} labels={LABELS} locale="en" {...props} />);
  const banner = (html: string) => /^<div[^>]*>(<header\b[\s\S]*?<\/header>)<main/.exec(html)?.[1] ?? "";
  const footer = (html: string) => /(<footer\b[\s\S]*<\/footer>)<\/div>$/.exec(html)?.[1] ?? "";

  it("renders headerAction, secondaryAction and nav inside the banner landmark and nowhere else", () => {
    const html = view({
      headerAction: <a href="/contact">HEADER-ACTION-SENTINEL</a>,
      secondaryAction: <a href="/sign-in">SECONDARY-ACTION-SENTINEL</a>,
      nav: <nav aria-label="Primary">NAV-SENTINEL</nav>,
    });
    const header = banner(html);
    for (const sentinel of ["HEADER-ACTION-SENTINEL", "SECONDARY-ACTION-SENTINEL", "NAV-SENTINEL"]) {
      expect(header).toContain(sentinel);
      expect(html.split(sentinel)).toHaveLength(2);
    }
    expect(header.indexOf("SECONDARY-ACTION-SENTINEL")).toBeLessThan(header.indexOf("HEADER-ACTION-SENTINEL"));
  });

  it("renders the same header and footer as a bare SiteHeader and SiteFooter when every slot is omitted", () => {
    const html = view({ footerSecondary: <span>FOOTER-SENTINEL</span> });
    expect(banner(html)).toBe(renderToStaticMarkup(<SiteHeader brand="Acme" />));
    expect(footer(html)).toBe(renderToStaticMarkup(<SiteFooter secondary={<span>FOOTER-SENTINEL</span>} />));
  });

  it("passes ground to both the header and the footer", () => {
    const html = view({ ground: "transparent" });
    expect(banner(html)).toBe(renderToStaticMarkup(<SiteHeader ground="transparent" brand="Acme" />));
    expect(footer(html)).toBe(renderToStaticMarkup(<SiteFooter ground="transparent" />));
  });
});

describe("LegalView exports", () => {
  it("is exported from the web entry", async () => {
    const web = await import("../index.js");
    expect(web.LegalView).toBe(LegalView);
  });

  it("is exported from the server entry", async () => {
    const server = await import("../server.js");
    expect(typeof server.LegalView).toBe("function");
  });
});


// Additive contract: preserve every existing legal/date/chrome assertion above.
type Related = NonNullable<LegalViewProps["related"]>;
type RelatedItem = Related["items"][number];
const RELATED_LABEL = "Placeholder related heading";
const relatedItem = (id: string): RelatedItem => ({
  id, heading: `Placeholder related ${id}`, description: `Placeholder description ${id}`,
  href: `/placeholder/${id}`,
});
const relatedItems = (count: number) => Array.from({ length: count }, (_, i) => relatedItem(`link-${i}`));
const withRelated = (items: readonly RelatedItem[]): Related => ({ label: RELATED_LABEL, items });
const RELATED_FRAME = { treatment: "plain", size: "standard", ground: "base", headingLevel: 3 } as const;
function relatedSection(html: string) {
  const articleEnd = html.indexOf("</article>");
  expect(articleEnd).toBeGreaterThan(-1);
  const section = /<section\b([^>]*)>([\s\S]*?)<\/section>/.exec(html.slice(articleEnd + "</article>".length));
  expect(section).not.toBeNull();
  expect(section![1]).toContain(`aria-label="${RELATED_LABEL}"`);
  expect(section![1]).not.toContain("aria-labelledby");
  return { markup: section![0], attributes: section![1], body: section![2] };
}

describe("LegalView related references", () => {
  it("preserves the pre-implementation omitted-view bytes", () => {
    // Recorded from unchanged pre-related source; this assertion never updates it.
    // readFileSync fails if absent; this test never creates/updates the baseline.
    const baseline = readFileSync(resolve(import.meta.dirname, "__fixtures__/legal-view-before-related-terms.html"), "utf8");
    expect(baseline.length).toBeGreaterThan(0);
    expect(render(legalDoc("terms"))).toBe(baseline);
  });
  it("omits the region for omitted, explicit undefined and empty related input", () => {
    const doc = legalDoc("terms");
    const omitted = render(doc);
    expect(render(doc, { related: undefined })).toBe(omitted);
    expect(render(doc, { related: withRelated([]) })).toBe(omitted);
    expect(omitted).not.toContain(RELATED_LABEL);
  });
  it("forwards one linked item to canonical Item after ArticleBody and before the footer", () => {
    vi.mocked(Item).mockClear(); vi.mocked(Items).mockClear();
    const item = Object.freeze({ ...relatedItem("single"), eyebrow: "Placeholder eyebrow", meta: "Placeholder meta",
      icon: <svg aria-hidden="true"><path d="M0 0h1" /></svg>, badge: { label: "Placeholder badge" } });
    const html = render(legalDoc("terms"), { related: withRelated(Object.freeze([item])), footerSecondary: <span>FOOTER-SENTINEL</span> });
    expect(vi.mocked(Item).mock.calls).toHaveLength(1);
    expect(vi.mocked(Item).mock.calls[0]![0]).toMatchObject({ ...item, ...RELATED_FRAME });
    expect(vi.mocked(Items).mock.calls).toHaveLength(0);
    const section = relatedSection(html);
    expect(section.body).toContain('href="/placeholder/single"');
    expect(section.body).toMatch(/<h2\b[^>]*>Placeholder related heading<\/h2>/);
    expect(html.indexOf(section.markup)).toBeGreaterThan(html.indexOf("</article>"));
    expect(html.indexOf(section.markup) + section.markup.length).toBeLessThanOrEqual(html.indexOf("</main>"));
    expect(html.indexOf(section.markup)).toBeLessThan(html.indexOf("<footer"));
    expect(section.body).not.toContain("FOOTER-SENTINEL");
  });
  for (const count of [2, 3, 4, 5, 6]) {
    it(`forwards ${count} linked references to canonical rows Items in authored order`, () => {
      vi.mocked(Item).mockClear(); vi.mocked(Items).mockClear();
      const items = Object.freeze(relatedItems(count).reverse().map(item => Object.freeze(item)));
      const html = render(legalDoc("privacy"), { related: withRelated(items) });
      expect(vi.mocked(Items).mock.calls).toHaveLength(1);
      expect(vi.mocked(Item).mock.calls).toHaveLength(0);
      expect(vi.mocked(Items).mock.calls[0]![0]).toMatchObject({
        items, arrangement: "rows", columns: 1, emphasis: "item", ...RELATED_FRAME,
      });
      const section = relatedSection(html);
      expect([...section.body.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(match => match[1])).toEqual(items.map(item => item.href));
      expect((section.body.match(/<li\b/g) ?? []).length).toBe(count);
      expect(section.body).toMatch(/<h2\b[^>]*>Placeholder related heading<\/h2>/);
    });
  }
  it("names the region directly from the caller without generated heading IDs", () => {
    const section = relatedSection(render(legalDoc("terms"), { related: withRelated(relatedItems(2)) }));
    const heading = /<h2\b([^>]*)>Placeholder related heading<\/h2>/.exec(section.body);
    expect(heading).not.toBeNull();
    expect(heading![1]).not.toMatch(/\bid=/);
    expect(section.attributes).not.toMatch(/\bid=/);
  });
  it("renders the caller's label as both the region name and visible heading", () => {
    const label = "Caller supplied related label";
    const html = render(legalDoc("terms"), { related: { label, items: [relatedItem("a")] } });
    expect(html).toContain(`aria-label="${label}"`);
    expect(html).toMatch(/<h2\b[^>]*>Caller supplied related label<\/h2>/);
    expect(html).not.toContain(RELATED_LABEL);
  });
  it("preserves the current header and footer bytes with all chrome slots", () => {
    const overrides = { headerAction: <a href="/contact">HEADER-SENTINEL</a>, secondaryAction: <a href="/sign-in">SECONDARY-SENTINEL</a>,
      nav: <nav aria-label="Primary">NAV-SENTINEL</nav>, ground: "transparent" as const, footerSecondary: <span>FOOTER-SENTINEL</span> };
    const old = render(legalDoc("terms"), overrides);
    const html = render(legalDoc("terms"), { ...overrides, related: withRelated(relatedItems(2)) });
    const banner = (value: string) => /^<div[^>]*>(<header\b[\s\S]*?<\/header>)<main/.exec(value)?.[1];
    const footer = (value: string) => /(<footer\b[\s\S]*<\/footer>)<\/div>$/.exec(value)?.[1];
    expect(banner(html)).toBeTruthy(); expect(footer(html)).toBeTruthy();
    expect(banner(html)).toBe(banner(old)); expect(footer(html)).toBe(footer(old));
  });
  it("refuses a seventh linked item", () => {
    expect(() => render(legalDoc("terms"), { related: withRelated(relatedItems(7)) })).toThrow();
  });
  for (const label of ["", " ", 42]) {
    it(`refuses invalid nonempty-region label ${JSON.stringify(label)}`, () => {
      expect(() => render(legalDoc("terms"), { related: { label: label as string, items: [relatedItem("a")] } })).toThrow();
    });
  }
  for (const count of [1, 2]) {
    it(`requires href on every related item, including the ${count}-item route`, () => {
      const items = relatedItems(count); items[0] = { ...items[0]!, href: undefined as unknown as string };
      expect(() => render(legalDoc("terms"), { related: withRelated(items) })).toThrow();
    });
    for (const href of ["", "//example.test/path", "javascript:alert(1)", " /placeholder/a "]) {
      it(`delegates malformed href ${JSON.stringify(href)} on the ${count}-item route`, () => {
        const items = relatedItems(count); items[0] = { ...items[0]!, href };
        expect(() => render(legalDoc("terms"), { related: withRelated(items) })).toThrow(/Item: href must be/);
      });
    }
    for (const slot of ["heading", "description", "eyebrow", "icon", "meta", "visual"] as const) {
      it(`delegates native nested-control refusal in ${slot} on the ${count}-item route`, () => {
        const items = relatedItems(count); items[0] = { ...items[0]!, [slot]: <button>CONTROL-SENTINEL</button> };
        expect(() => render(legalDoc("terms"), { related: withRelated(items) })).toThrow(/cannot contain another interactive target/);
      });
    }
    it(`delegates native nested-control refusal in the badge on the ${count}-item route`, () => {
      const items = relatedItems(count); items[0] = { ...items[0]!, badge: { label: <a href="/nested">CONTROL-SENTINEL</a> } };
      expect(() => render(legalDoc("terms"), { related: withRelated(items) })).toThrow(/cannot contain another interactive target/);
    });
  }
  it("delegates duplicate id and normalized destination refusals to Items", () => {
    expect(() => render(legalDoc("terms"), { related: withRelated([relatedItem("a"), relatedItem("a")]) })).toThrow(/item ids must be unique/);
    const items = [relatedItem("a"), { ...relatedItem("b"), href: "/placeholder/a/#part" }];
    expect(() => render(legalDoc("terms"), { related: withRelated(items) })).toThrow(/linked destinations must be unique/);
  });
  for (const href of ["#details", "/placeholder/a", "https://example.test/placeholder", "mailto:placeholder@example.test"]) {
    it(`retains canonical sanctioned href ${JSON.stringify(href)}`, () => {
      const html = render(legalDoc("terms"), { related: withRelated([{ ...relatedItem("a"), href }]) });
      expect(relatedSection(html).body).toContain(`href="${href}"`);
    });
  }
  it("keeps legal dates and draft facts ahead of the related region", () => {
    const html = render(draftDoc("terms"), { related: withRelated(relatedItems(2)), locale: "de" });
    const section = relatedSection(html);
    expect(html).toContain(`<time dateTime="2026-01-15">${formatted("de", 2026, 1, 15)}</time>`);
    expect(html).toContain(`<time dateTime="2026-02-01">${formatted("de", 2026, 2, 1)}</time>`);
    for (const marker of ["Placeholder label draft", "Placeholder fact A", "Placeholder fact B"]) {
      expect(html.indexOf(marker)).toBeGreaterThan(-1);
      expect(html.indexOf(marker)).toBeLessThan(html.indexOf(section.markup));
    }
    expect(html.indexOf('role="note"')).toBeLessThan(html.indexOf("<section"));
  });
  it("still refuses invalid legal content and unresolved labels with related present", () => {
    expect(() => render(legalDoc("terms", { legal: { effectiveDate: "2026-02-30" } }),
      { related: withRelated(relatedItems(2)) })).toThrow(/legal-date-invalid/);
    expect(() => render(legalDoc("terms"), { related: withRelated(relatedItems(2)),
      labels: { ...LABELS, effectiveDate: ref("acme.label.missing") } })).toThrow(/labels\.effectiveDate/);
  });
});
