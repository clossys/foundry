import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { DetailView, Item, Items } from "@clossys/designer/blocks/server";
import { describe, expect, it, vi } from "vitest";
import type { CopyRegistry, CopyResolver } from "@clossys/writer";
import { createCopyResolver } from "@clossys/writer";
import { Brandmark, SiteFooter, SiteHeader } from "@clossys/designer/shell/server";
import { RenderError } from "../../internal/errors.js";
import { LEGAL_SECTION_IDS } from "../../document/legal.js";
import type { LegalDocument, LegalDocumentKind } from "../../document/legal.js";
import { LegalView } from "./LegalView.js";
import { CaptureView } from "./CaptureView.js";
import { DocumentView } from "./DocumentView.js";
import { SITE_MAIN_ID, SiteFrame } from "../frame/index.js";
import type { SiteShellInput } from "../frame/index.js";
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

function formatted(locale: string, y: number, m: number, d: number): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

function dateDetails(locale: string): string {
  return renderToStaticMarkup(<DetailView fields={[
    { label: "Placeholder label effective", value: <time dateTime="2026-01-15">{formatted(locale, 2026, 1, 15)}</time> },
    { label: "Placeholder label updated", value: <time dateTime="2026-02-01">{formatted(locale, 2026, 2, 1)}</time> },
  ]} />);
}

describe.each(["self-chromed", "framed"] as const)("LegalView %s path", (mode) => {
  const shell: SiteShellInput = {
    brand: { assetId: "placeholder-mark", label: LABELS.effectiveDate, size: "md", variant: "mark" },
    skipLink: LABELS.lastUpdated,
    footer: { legal: { entity: ref("fixture.entity"), links: [] } },
  };
  const asset = () => ({ type: "image", src: "/placeholder.svg", width: 48, height: 48, alt: "Placeholder mark" });
  function frame(content: React.ReactNode, footerSecondary?: React.ReactNode, chrome: Partial<SiteShellInput> = {}) {
    const framedShell = footerSecondary === undefined ? shell : { ...shell, footer: { legal: { entity: ref("fixture.footer"), links: [] } } };
    const words: Record<string, string> = { "fixture.footer": "FOOTER-SENTINEL", "fixture.entity": "Placeholder footer entity",
      "fixture.header": "HEADER-ACTION-SENTINEL", "fixture.secondary": "SECONDARY-ACTION-SENTINEL", "fixture.nav": "NAV-SENTINEL" };
    const copy: CopyResolver = (r) => words[r.id] === undefined ? resolver(r) : { ...resolver(LABELS.effectiveDate)!, text: words[r.id]! };
    return <SiteFrame shell={{ ...framedShell, ...chrome }} resolveCopy={copy} resolveAsset={asset}>{content}</SiteFrame>;
  }
  function render(document: LegalDocument, overrides: RenderOverrides = {}): string {
    const props = { document, resolveCopyId: overrides.resolveCopyId ?? resolver,
      labels: overrides.labels ?? LABELS, locale: overrides.locale ?? "en", related: overrides.related };
    return renderToStaticMarkup(mode === "self-chromed"
      ? <LegalView brand="Acme" {...overrides} {...props} />
      : frame(<LegalView framed {...props} />, overrides.footerSecondary));
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
  if (mode === "self-chromed") {
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
      // DetailView adds an earlier section; the draft note still precedes every document section.
      expect(html.indexOf('role="note"')).toBeLessThan(html.indexOf("<section id="));
    });

    it("throws when a fact does not resolve", () => {
      const doc = legalDoc("terms", { legal: { status: "draft", factsToConfirm: [ref("acme.fact.unknown")] } });
      expect(() => render(doc)).toThrow(RenderError);
      expect(() => render(doc)).toThrow(/legal\.factsToConfirm\.0/);
      expect(() => render(doc)).not.toThrow(/acme\.fact\.unknown/);
    });
  } else {
    it("renders no draft or status text for a draft document", () => {
      const html = render(draftDoc("terms"));
      expect(html).not.toContain("role=\"note\"");
      expect(html).not.toContain("data-callout-tone");
      expect(html).not.toContain("<aside");
      expect(html).not.toContain("Placeholder label draft");
      expect(html).not.toContain("Placeholder fact");
      expect(html).not.toMatch(/draft|counsel|reviewed|status/i);
    });

    it("renders a draft document and a counsel-reviewed one with the same markup", () => {
      expect(render(draftDoc("terms"))).toBe(render(legalDoc("terms")));
      expect(render(draftDoc("privacy"))).toBe(render(legalDoc("privacy")));
    });

    it("never resolves the facts to confirm, so an unresolved fact does not throw or leak", () => {
      const doc = legalDoc("terms", { legal: { status: "draft", factsToConfirm: [ref("acme.fact.unknown")] } });
      expect(() => render(doc)).not.toThrow();
      expect(render(doc)).not.toContain("acme.fact.unknown");
    });

    it("does not need a draft heading label", () => {
      const labels = { effectiveDate: LABELS.effectiveDate, lastUpdated: LABELS.lastUpdated };
      expect(render(draftDoc("terms"), { labels })).toBe(render(draftDoc("terms")));
    });

    it("still refuses a draft document with no facts to confirm", () => {
      expect(() => render(legalDoc("terms", { legal: { status: "draft" } }))).toThrow(/legal-draft-facts-missing/);
    });
  }

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
  it("retains zero-string date labels with both ordered time values", () => {
    const zeroLabels: CopyResolver = (r) => r.id === LABELS.effectiveDate.id || r.id === LABELS.lastUpdated.id
      ? { ...resolver(r)!, text: "0" } : resolver(r);
    const html = render(legalDoc("terms"), { resolveCopyId: zeroLabels });
    expect([...html.matchAll(/<dt\b[^>]*>([^<]*)<\/dt>/g)].map((match) => match[1])).toEqual(["0", "0"]);
    expect([...html.matchAll(/<time dateTime="([^"]+)"/g)].map((match) => match[1])).toEqual(["2026-01-15", "2026-02-01"]);
  });

  it("renders the real title-less DetailView with localized time values", () => {
    expect(render(legalDoc("terms"), { locale: "de" })).toContain(dateDetails("de"));
  });

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
    const start = mode === "self-chromed" ? html.indexOf("<main") : html.indexOf("<div", html.indexOf("<main"));
    const mainTag = html.slice(start, html.indexOf(">", start) + 1);
    if (mode === "self-chromed") {
      expect(mainTag).toContain("max-w-[var(--ui-width-prose-max,none)]");
      expect(mainTag).not.toContain("max-width:");
    } else {
      expect(mainTag).toContain("max-width:var(--ui-width-prose-max, none)");
    }
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
            <LegalView {...(mode === "self-chromed" ? { brand: "Acme" } : { framed: true as const })} document={legalDoc("terms")} resolveCopyId={resolver} labels={LABELS} locale={value as string} />,
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
  for (const key of (mode === "framed" ? ["effectiveDate", "lastUpdated"] : ["effectiveDate", "lastUpdated", "draftHeading"]) as Array<keyof LegalViewLabels>) {
    it(`throws RenderError naming the CopyRef when ${key} is unresolved, even for a reviewed document`, () => {
      const labels = { ...LABELS, [key]: ref("acme.label.missing") };
      expect(() => render(legalDoc("terms"), { labels })).toThrow(RenderError);
      expect(() => render(legalDoc("terms"), { labels })).not.toThrow(/acme\.label\.missing/);
      expect(() => render(legalDoc("terms"), { labels })).toThrow(new RegExp(`labels\\.${key}`));
    });
  }

  if (mode === "framed") it("ignores an unresolved draftHeading, which the framed page never renders", () => {
    const labels = { ...LABELS, draftHeading: ref("acme.label.missing") };
    expect(render(legalDoc("terms"), { labels })).toBe(render(legalDoc("terms")));
  });

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

if (mode === "self-chromed") describe("LegalView header slots", () => {
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
    expect(banner(html)).toBe(renderToStaticMarkup(<SiteHeader surface="transparent" brand="Acme" />));
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
  const labelId = /aria-labelledby="([^"]+)"/.exec(section![1])?.[1];
  expect(labelId).toBeTruthy();
  expect(section![2]).toContain(`id="${labelId}"`);
  expect(section![1]).not.toContain("aria-label=");
  return { markup: section![0], attributes: section![1], body: section![2] };
}

describe("LegalView related references", () => {
  it("preserves the pre-implementation omitted-view bytes", () => {
    // Recorded from unchanged pre-related source; this assertion never updates it.
    // readFileSync fails if absent; this test never creates/updates the baseline.
    const baseline = readFileSync(resolve(import.meta.dirname, "__fixtures__/legal-view-before-related-terms.html"), "utf8");
    expect(baseline.length).toBeGreaterThan(0);
    const html = render(legalDoc("terms"));
    // Only the dates migrate to DetailView; retain the historical fixture's complete remaining bytes.
    const migratedBaseline = baseline.replace(/<dl\b[\s\S]*?<\/dl>/, dateDetails("en"));
    if (mode === "self-chromed") {
      expect(html).toContain('data-surface="solid" data-tone="base"');
      // Only the new header opening is projected; all body/footer bytes retain the recorded fixture.
      const legacyHeaderProjection = html.replace(/<header\b[^>]*>/, '<header data-header-root="" class="bg-surface-raised py-sm border-b border-line-base site-header-contract" style="position:relative;z-index:var(--ui-z-shell, 20);border-bottom-width:var(--ui-border-hairline, 1px)">');
      expect(legacyHeaderProjection).toBe(migratedBaseline);
      return;
    }
    // The framed page moved to the shared page layout on purpose (see "shared page layout" below), so its bytes differ from the
    // pre-layout baseline; the title, dates and article body inside it are the same.
    const part = (value: string, pattern: RegExp) => pattern.exec(value)?.[0];
    expect(part(html, /<article\b[\s\S]*<\/article>/)).toBe(part(baseline, /<article\b[\s\S]*<\/article>/));
    expect(part(html, /<dl\b[\s\S]*<\/dl>/)).toBe(part(migratedBaseline, /<dl\b[\s\S]*<\/dl>/));
    expect(part(html, /<h1\b[^>]*>[^<]*<\/h1>/)?.replace(/<h1[^>]*>/, "")).toBe(part(baseline, /<h1\b[^>]*>[^<]*<\/h1>/)?.replace(/<h1[^>]*>/, ""));
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
        items, arrangement: "rows", columns: 1, scale: "item", ...RELATED_FRAME,
      });
      const section = relatedSection(html);
      expect([...section.body.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(match => match[1])).toEqual(items.map(item => item.href));
      expect((section.body.match(/<li\b/g) ?? []).length).toBe(count);
      expect(section.body).toMatch(/<h2\b[^>]*>Placeholder related heading<\/h2>/);
    });
  }
  it("names the region by its visible caller heading", () => {
    const section = relatedSection(render(legalDoc("terms"), { related: withRelated(relatedItems(2)) }));
    const heading = /<h2\b([^>]*)>Placeholder related heading<\/h2>/.exec(section.body);
    expect(heading).not.toBeNull();
    const headingId = /\bid="([^"]+)"/.exec(heading![1])?.[1];
    expect(headingId).toBeTruthy();
    expect(section.attributes).toContain(`aria-labelledby="${headingId}"`);
    expect(section.attributes).not.toMatch(/\bid=/);
  });
  it("renders the caller's label as both the region name and visible heading", () => {
    const label = "Caller supplied related label";
    const html = render(legalDoc("terms"), { related: { label, items: [relatedItem("a")] } });
    expect(html).toContain("aria-labelledby=");
    expect(html).not.toContain(`aria-label="${label}"`);
    expect(html).toMatch(/<h2\b[^>]*>Caller supplied related label<\/h2>/);
    expect(html).not.toContain(RELATED_LABEL);
  });
  if (mode === "self-chromed") it("preserves the current header and footer bytes with all chrome slots", () => {
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
  it("keeps legal dates (and, self-chromed, draft facts) ahead of the related region", () => {
    const html = render(draftDoc("terms"), { related: withRelated(relatedItems(2)), locale: "de" });
    const section = relatedSection(html);
    expect(html).toContain(`<time dateTime="2026-01-15">${formatted("de", 2026, 1, 15)}</time>`);
    expect(html).toContain(`<time dateTime="2026-02-01">${formatted("de", 2026, 2, 1)}</time>`);
    for (const marker of ["Placeholder label draft", "Placeholder fact A", "Placeholder fact B"]) {
      if (mode === "framed") {
        expect(html).not.toContain(marker);
        continue;
      }
      expect(html.indexOf(marker)).toBeGreaterThan(-1);
      expect(html.indexOf(marker)).toBeLessThan(html.indexOf(section.markup));
    }
    // DetailView is a section too; retain ordering against the document sections.
    if (mode === "self-chromed") expect(html.indexOf('role="note"')).toBeLessThan(html.indexOf("<section id="));
  });
  it("still refuses invalid legal content and unresolved labels with related present", () => {
    expect(() => render(legalDoc("terms", { legal: { effectiveDate: "2026-02-30" } }),
      { related: withRelated(relatedItems(2)) })).toThrow(/legal-date-invalid/);
    expect(() => render(legalDoc("terms"), { related: withRelated(relatedItems(2)),
      labels: { ...LABELS, effectiveDate: ref("acme.label.missing") } })).toThrow(/labels\.effectiveDate/);
  });
});

if (mode === "framed") describe("LegalView header slots owned by SiteFrame", () => {
  const content = <LegalView framed document={legalDoc("terms")} resolveCopyId={resolver} labels={LABELS} locale="en" />;
  const mark = <Brandmark variant="mark" size="md" label="Placeholder label effective" markSrc="/placeholder.svg" />;
  const banner = (html: string) => /(<header\b[\s\S]*?<\/header>)/.exec(html)?.[1] ?? "";
  const footer = (html: string) => /(<footer\b[\s\S]*<\/footer>)<\/div>$/.exec(html)?.[1] ?? "";
  const chrome: Partial<SiteShellInput> = {
    actions: [{ href: "/sign-in", label: ref("fixture.secondary"), emphasis: "ghost" }, { href: "/contact", label: ref("fixture.header"), emphasis: "secondary" }],
    nav: { label: LABELS.effectiveDate, links: [{ href: "/placeholder-nav", label: ref("fixture.nav") }] },
    ground: "transparent",
  };
  it("renders headerAction, secondaryAction and nav inside the banner landmark and nowhere else", () => {
    const html = renderToStaticMarkup(frame(content, undefined, chrome));
    const header = banner(html);
    for (const sentinel of ["HEADER-ACTION-SENTINEL", "SECONDARY-ACTION-SENTINEL", "NAV-SENTINEL"]) {
      expect(header).toContain(sentinel);
      expect(html.split(sentinel)).toHaveLength(2);
    }
    expect(header.indexOf("SECONDARY-ACTION-SENTINEL")).toBeLessThan(header.indexOf("HEADER-ACTION-SENTINEL"));
  });
  it("renders the same header and footer as bare chrome with an explicit reserved header", () => {
    const html = renderToStaticMarkup(frame(content, <span>FOOTER-SENTINEL</span>, { header: { surface: "solid" } }));
    expect(banner(html)).toBe(banner(renderToStaticMarkup(<SiteHeader brand={mark} />)));
    expect(footer(html)).toBe(renderToStaticMarkup(<SiteFooter secondary={<SiteFooter.Legal entity="FOOTER-SENTINEL" links={[]} home={{ label: "Placeholder label effective", href: "/", markSrc: "/placeholder.svg" }} />} />).replace(/^<link[^>]+>/, ""));
  });
  it("passes ground to both an explicit reserved header and the footer", () => {
    const html = renderToStaticMarkup(frame(content, undefined, { ground: "transparent", header: { surface: "transparent" } }));
    expect(banner(html)).toBe(banner(renderToStaticMarkup(<SiteHeader surface="transparent" brand={mark} />)));
    expect(footer(html)).toBe(renderToStaticMarkup(<SiteFooter ground="transparent" secondary={<SiteFooter.Legal entity="Placeholder footer entity" links={[]} home={{ label: "Placeholder label effective", href: "/", markSrc: "/placeholder.svg" }} />} />).replace(/^<link[^>]+>/, ""));
  });
  it("uses a solid header when the framed path omits header surface", () => {
    expect(banner(renderToStaticMarkup(frame(content)))).toContain('data-surface="solid"');
  });
  it("preserves the current header and footer bytes with all chrome slots", () => {
    const old = renderToStaticMarkup(frame(content, <span>FOOTER-SENTINEL</span>, chrome));
    const html = renderToStaticMarkup(frame(<LegalView framed document={legalDoc("terms")} resolveCopyId={resolver} labels={LABELS} locale="en" related={withRelated(relatedItems(2))} />, <span>FOOTER-SENTINEL</span>, chrome));
    expect(banner(html)).toBeTruthy(); expect(footer(html)).toBeTruthy();
    expect(banner(html)).toBe(banner(old)); expect(footer(html)).toBe(footer(old));
  });
});

if (mode === "framed") describe("frame ownership", () => {
  it("renders no view landmarks, and SiteFrame owns the only main", () => {
    const content = <LegalView framed document={draftDoc()} resolveCopyId={resolver} labels={LABELS} locale="en" />;
    const body = renderToStaticMarkup(content);
    expect(body).not.toMatch(/<(?:main|footer)\b/);
    expect(body).not.toMatch(/<(?:header|nav)\b/); // The title block is a div inside the content root, not a banner.
    const html = renderToStaticMarkup(frame(content));
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html).toContain(`<main id="${SITE_MAIN_ID}" tabindex="-1"`);
    expect(html.match(/<footer\b/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).not.toContain('role="note"');
    expect(html).toContain('<time dateTime="2026-01-15"');
    expect(html).toContain('<time dateTime="2026-02-01"');
  });
  for (const role of ["main", "banner", "contentinfo", "navigation", "region MAIN"]) {
    it(`refuses a frame landmark role ${role}`, () => {
      expect(() => renderToStaticMarkup(<LegalView framed role={role} document={draftDoc()} resolveCopyId={resolver} labels={LABELS} locale="en" />)).toThrow(/content root cannot take a landmark role/);
    });
  }
  it("refuses the frame main id", () => {
    expect(() => renderToStaticMarkup(<LegalView framed id={SITE_MAIN_ID} document={draftDoc()} resolveCopyId={resolver} labels={LABELS} locale="en" />)).toThrow(/content root cannot take the frame's main id/);
  });
  for (const key of ["brand", "headerAction", "secondaryAction", "nav", "ground", "footerSecondary"]) {
    it(`refuses legacy chrome ${key} past the types`, () => {
      const illegal = { [key]: "sentinel-chrome-value" };
      const attempt = () => renderToStaticMarkup(<LegalView framed document={draftDoc()} resolveCopyId={resolver} labels={LABELS} locale="en" {...illegal} />);
      expect(attempt).toThrow(/framed content cannot take chrome props/);
      expect(attempt).not.toThrow(/sentinel-chrome-value/);
    });
  }
  it("keeps frame chrome bytes with related content", () => {
    const bare = renderToStaticMarkup(frame(null));
    const html = render(legalDoc("terms"), { related: withRelated(relatedItems(2)) });
    const banner = (value: string) => /<header\b[\s\S]*?<\/header>/.exec(value)?.[0];
    const footer = (value: string) => /<footer\b[\s\S]*?<\/footer>/.exec(value)?.[0];
    expect(banner(html)).toBe(banner(bare));
    expect(footer(html)).toBe(footer(bare));
  });
  it("renders equivalent body markup through the ordinary and server entries", async () => {
    const ordinary = await import("../index.js");
    const server = await import("../server.js");
    const props = { framed: true as const, document: draftDoc(), resolveCopyId: resolver, labels: LABELS, locale: "de", related: withRelated(relatedItems(2)) };
    expect(renderToStaticMarkup(<ordinary.LegalView {...props} />)).toBe(renderToStaticMarkup(<server.LegalView {...props} />));
  });
});
});


// ---------------------------------------------------------------------------
// Shared page layout: framed LegalView renders the same structure as CaptureView and DocumentView.

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/** The root element's open tag and each of its direct children as `{ open, inner }`, from static markup. */
function skeleton(html: string): { root: string; children: Array<{ open: string; inner: string }> } {
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g;
  const stack: string[] = [];
  const children: Array<{ open: string; inner: string; start: number }> = [];
  let root = "";
  for (let match = tag.exec(html); match !== null; match = tag.exec(html)) {
    const [whole, closing, name, selfClosing] = match as unknown as [string, string, string, string];
    const lower = name.toLowerCase();
    if (closing === "/") {
      stack.pop();
      if (stack.length === 1) {
        const child = children[children.length - 1]!;
        child.inner = html.slice(child.start, match.index);
      }
      continue;
    }
    if (stack.length === 0) root = whole;
    else if (stack.length === 1) children.push({ open: whole, inner: "", start: match.index + whole.length });
    if (selfClosing !== "/" && !VOID_TAGS.has(lower)) stack.push(lower);
    else if (stack.length === 1) children[children.length - 1]!.inner = "";
  }
  return { root, children: children.map(({ open, inner }) => ({ open, inner })) };
}

describe("LegalView shared page layout", () => {
  const TITLE = "Placeholder title terms";
  const SUMMARY = "Placeholder summary marker";
  const NOTE = "Placeholder note marker";
  const summaryRef = ref("acme.summary");
  const withSummary: CopyResolver = (r) => (r.id === summaryRef.id ? { ...resolver(LABELS.effectiveDate)!, text: SUMMARY } : resolver(r));
  const common = { document: legalDoc("terms"), resolveCopyId: withSummary, labels: LABELS, locale: "en" };
  const legal = (props: Record<string, unknown> = {}) => renderToStaticMarkup(<LegalView framed {...common} summary={summaryRef} {...props} />);
  const capture = () => renderToStaticMarkup(<CaptureView heading={TITLE} description={SUMMARY} form={<p>FORM</p>} notes={<a href="/n">{NOTE}</a>} />);
  const document = () => renderToStaticMarkup(<DocumentView document={legalDoc("terms")} resolveCopyId={withSummary} summary={summaryRef} action={<a href="/n">{NOTE}</a>} />);
  const related = { label: "Placeholder related heading", items: [{ id: "a", heading: "Placeholder related a", href: "/placeholder/a" }] };

  /** The card's own open tag: CaptureView puts the card in a labelled region, so look through that wrapper. */
  const cardOpen = (child: { open: string; inner: string }) => (child.open.startsWith("<section") ? /^<[^>]*>/.exec(child.inner)![0] : child.open);

  it("has the same root, header block, card and notes region as CaptureView, in the same order", () => {
    const l = skeleton(legal({ related }));
    const c = skeleton(capture());
    expect(l.root).toBe(c.root);
    expect([l.children[0]!.open, cardOpen(l.children[1]!), l.children[2]!.open]).toEqual([c.children[0]!.open, cardOpen(c.children[1]!), c.children[2]!.open]);
    expect(l.children).toHaveLength(3); // header, card, notes
    expect(l.children[0]!.inner).toBe(c.children[0]!.inner); // title, subtitle: byte-identical
    expect(l.children[0]!.inner).toBe(
      `<h1 class="text-h1 font-display text-ink-primary">${TITLE}</h1><p class="text-body text-ink-secondary">${SUMMARY}</p>`,
    );
  });

  it("has the same root, header block, card and notes region as DocumentView", () => {
    const l = skeleton(legal({ related }));
    const d = skeleton(document());
    expect(l.root).toBe(d.root);
    expect(l.children.map((child) => child.open)).toEqual(d.children.map((child) => child.open));
    expect(l.children[0]!.inner).toBe(d.children[0]!.inner);
  });

  it("holds the dates and the whole document body in the one card", () => {
    const { children } = skeleton(legal());
    expect(children).toHaveLength(2); // header, card: no notes region without related
    const card = children[1]!.inner;
    expect(card.match(/<h1\b/g)).toBeNull();
    expect((card.match(/<time\b/g) ?? []).length).toBe(2);
    expect((card.match(/<article\b/g) ?? []).length).toBe(1);
    expect(card.indexOf("<time")).toBeLessThan(card.indexOf("<article"));
    expect(children[0]!.inner).not.toContain("<time");
  });

  it("renders the subtitle only when a summary is given", () => {
    expect(legal()).toContain(SUMMARY);
    const without = renderToStaticMarkup(<LegalView framed {...common} />);
    expect(without).not.toContain(SUMMARY);
    expect(skeleton(without).children[0]!.inner).toBe(`<h1 class="text-h1 font-display text-ink-primary">${TITLE}</h1>`);
  });

  it("puts the related references in the notes region below the card and omits the region without them", () => {
    const { children } = skeleton(legal({ related }));
    expect(children[2]!.inner).toContain("Placeholder related heading");
    expect(children[2]!.inner).toContain('href="/placeholder/a"');
    expect(children[1]!.inner).not.toContain("Placeholder related heading");
    expect(skeleton(legal()).children).toHaveLength(2);
    expect(skeleton(legal({ related: { label: "Placeholder related heading", items: [] } })).children).toHaveLength(2);
  });

  it("keeps every section id and heading, in order, for both kinds", () => {
    for (const kind of ["terms", "privacy"] as const) {
      const html = renderToStaticMarkup(<LegalView framed document={legalDoc(kind)} resolveCopyId={resolver} labels={LABELS} locale="en" />);
      expect([...html.matchAll(/<section id="([^"]+)"/g)].map((match) => match[1])).toEqual([...LEGAL_SECTION_IDS[kind]]);
      const headings = [...html.matchAll(/<h2\b[^>]*>([^<]*)<\/h2>/g)].map((match) => match[1]);
      expect(headings).toEqual(LEGAL_SECTION_IDS[kind].map((id) => `Placeholder heading ${kind} ${id}`));
    }
  });

  it("refuses a summary on the self-chromed page", () => {
    expect(() => renderToStaticMarkup(<LegalView {...({ brand: "Acme", summary: summaryRef } as object)} {...common} />)).toThrow(/summary is only available on the framed page/);
  });

  it("refuses an unresolved or blank summary without echoing its id", () => {
    const missing = () => renderToStaticMarkup(<LegalView framed {...common} summary={ref("acme.summary.missing")} />);
    expect(missing).toThrow(RenderError);
    expect(missing).toThrow(/CopyRef at summary/);
    expect(missing).not.toThrow(/acme\.summary\.missing/);
  });
});
