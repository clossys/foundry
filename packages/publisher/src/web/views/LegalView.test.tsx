import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CopyRegistry, CopyResolver } from "@clossys/writer";
import { createCopyResolver } from "@clossys/writer";
import { RenderError } from "../../internal/errors.js";
import { LEGAL_SECTION_IDS } from "../../document/legal.js";
import type { LegalDocument, LegalDocumentKind } from "../../document/legal.js";
import { LegalView } from "./LegalView.js";
import type { LegalViewLabels } from "./LegalView.js";

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

function render(document: LegalDocument, overrides: { labels?: LegalViewLabels; locale?: string; resolveCopyId?: CopyResolver } = {}): string {
  return renderToStaticMarkup(
    <LegalView brand="Acme" document={document} resolveCopyId={overrides.resolveCopyId ?? resolver} labels={overrides.labels ?? LABELS} locale={overrides.locale ?? "en"} />,
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
