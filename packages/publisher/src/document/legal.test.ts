import { describe, expect, it } from "vitest";
import { LEGAL_SECTION_IDS, gateLegalDocument, validateLegalDocument } from "./legal.js";
import type { LegalDocument, LegalDocumentKind } from "./legal.js";

// Minimal, obviously-fictional fixtures ("acme" placeholders). No real legal
// wording appears anywhere: every leaf of text is an opaque CopyRef id.

const ref = (id: string) => ({ id });

const TERMS_IDS = [
  "about",
  "acceptance",
  "eligibility",
  "using-the-site",
  "acceptable-use",
  "intellectual-property",
  "your-submissions",
  "third-parties",
  "no-professional-advice",
  "disclaimers",
  "liability",
  "indemnity",
  "changes",
  "suspension",
  "governing-law",
  "general",
  "contact",
];

const PRIVACY_IDS = [
  "about",
  "scope",
  "what-we-collect",
  "how-we-use",
  "legal-bases",
  "cookies",
  "sharing",
  "international-transfers",
  "retention",
  "security",
  "your-rights",
  "children",
  "changes",
  "contact",
];

type Section = LegalDocument["sections"][number];

function section(docId: string, id: string, refId = `acme.${docId}.${id}.p1`): Section {
  return {
    kind: "section",
    id,
    level: 2,
    heading: ref(`acme.${docId}.${id}.heading`),
    blocks: [{ kind: "paragraph", content: [{ kind: "text", text: ref(refId) }] }],
  };
}

function legalDoc(kind: LegalDocumentKind, overrides: { legal?: Record<string, unknown>; sections?: Section[] } = {}): LegalDocument {
  const docId = `acme.${kind}`;
  const ids = kind === "terms" ? TERMS_IDS : PRIVACY_IDS;
  return {
    id: docId,
    title: ref(`${docId}.title`),
    sections: overrides.sections ?? ids.map((id) => section(docId, id)),
    legal: {
      kind,
      status: "counsel-reviewed",
      effectiveDate: "2026-01-15",
      lastUpdated: "2026-02-01",
      variables: { entity: "Acme Example Ltd", jurisdiction: "Exampleland", contact: "legal@acme.example" },
      ...overrides.legal,
    },
  } as LegalDocument;
}

function draftDoc(kind: LegalDocumentKind = "terms"): LegalDocument {
  return legalDoc(kind, { legal: { status: "draft", factsToConfirm: [ref("acme.fact.registered-address")] } });
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function rules(findings: { rule: string }[]): string[] {
  return findings.map((f) => f.rule);
}

/** Replace the top-level section list by editing a copy of a valid list. */
function sectionsOf(kind: LegalDocumentKind): Section[] {
  return [...legalDoc(kind).sections];
}

describe("LEGAL_SECTION_IDS", () => {
  it("lists exactly the terms ids, in order", () => {
    expect(LEGAL_SECTION_IDS.terms).toEqual(TERMS_IDS);
  });

  it("lists exactly the privacy ids, in order", () => {
    expect(LEGAL_SECTION_IDS.privacy).toEqual(PRIVACY_IDS);
  });
});

describe("validateLegalDocument — valid documents", () => {
  it("accepts a complete Terms document", () => {
    expect(validateLegalDocument(legalDoc("terms"))).toEqual([]);
  });

  it("accepts a complete Privacy document", () => {
    expect(validateLegalDocument(legalDoc("privacy"))).toEqual([]);
  });

  it("accepts a draft with facts to confirm", () => {
    expect(validateLegalDocument(draftDoc("terms"))).toEqual([]);
  });

  it("accepts facts to confirm on a counsel-reviewed document when well-formed", () => {
    expect(validateLegalDocument(legalDoc("terms", { legal: { factsToConfirm: [ref("acme.fact.one")] } }))).toEqual([]);
  });

  it("does not constrain nested section ids", () => {
    const sections = sectionsOf("terms");
    sections[1] = {
      ...sections[1]!,
      blocks: [
        ...sections[1]!.blocks,
        { kind: "section", id: "anything-goes", level: 3, heading: ref("acme.nested.heading"), blocks: [] },
      ],
    };
    expect(validateLegalDocument(legalDoc("terms", { sections }))).toEqual([]);
  });

  it("does not compare the two dates to each other", () => {
    expect(validateLegalDocument(legalDoc("terms", { legal: { effectiveDate: "2030-01-01", lastUpdated: "2020-01-01" } }))).toEqual([]);
  });
});

describe("validateLegalDocument — base validation and shape", () => {
  it("includes the base structured-document findings", () => {
    const doc = { ...legalDoc("terms"), title: "not-a-copy-ref" };
    expect(validateLegalDocument(doc)).toContainEqual(expect.objectContaining({ rule: "copy-ref-shape", path: "title" }));
  });

  it("refuses a non-object without throwing", () => {
    for (const bad of [null, undefined, "x", 3, [], () => 1]) {
      const findings = validateLegalDocument(bad);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0]!.rule).toBe("document-shape");
    }
  });

  it("reports a missing legal profile and stops legal checks", () => {
    const { legal: _legal, ...rest } = legalDoc("terms");
    const findings = validateLegalDocument(rest);
    expect(findings).toEqual([{ rule: "legal-profile-shape", severity: "error", message: expect.any(String), path: "legal" }]);
  });

  it("reports a non-object legal profile", () => {
    for (const bad of ["x", 1, null, []]) {
      const findings = validateLegalDocument({ ...legalDoc("terms"), legal: bad });
      expect(findings).toEqual([expect.objectContaining({ rule: "legal-profile-shape", path: "legal" })]);
    }
  });
});

describe("validateLegalDocument — kind and status", () => {
  it("refuses a missing kind and skips section checks", () => {
    const doc = legalDoc("terms", { sections: [section("acme.terms", "about")] });
    const { kind: _kind, ...legalNoKind } = doc.legal as unknown as Record<string, unknown>;
    const findings = validateLegalDocument({ ...doc, legal: legalNoKind });
    expect(rules(findings)).toEqual(["legal-kind-unknown"]);
    expect(findings[0]!.path).toBe("legal.kind");
  });

  it("refuses an unknown kind and skips section checks", () => {
    const findings = validateLegalDocument(legalDoc("terms", { legal: { kind: "cookies" }, sections: [] }));
    expect(rules(findings)).toEqual(["legal-kind-unknown"]);
  });

  it("refuses a missing status", () => {
    const doc = legalDoc("terms");
    const { status: _status, ...legalNoStatus } = doc.legal as unknown as Record<string, unknown>;
    expect(validateLegalDocument({ ...doc, legal: legalNoStatus })).toContainEqual(expect.objectContaining({ rule: "legal-status-unknown", path: "legal.status" }));
  });

  it("refuses an unknown status", () => {
    expect(validateLegalDocument(legalDoc("terms", { legal: { status: "approved" } }))).toContainEqual(
      expect.objectContaining({ rule: "legal-status-unknown", path: "legal.status" }),
    );
  });
});

describe("validateLegalDocument — facts to confirm", () => {
  it("refuses a draft with no facts", () => {
    const findings = validateLegalDocument(legalDoc("terms", { legal: { status: "draft" } }));
    expect(findings).toEqual([expect.objectContaining({ rule: "legal-draft-facts-missing", path: "legal.factsToConfirm" })]);
  });

  it("refuses a draft with an empty facts array", () => {
    expect(rules(validateLegalDocument(legalDoc("terms", { legal: { status: "draft", factsToConfirm: [] } })))).toEqual(["legal-draft-facts-missing"]);
  });

  it("refuses a draft whose facts are not an array (shape and missing)", () => {
    const findings = validateLegalDocument(legalDoc("terms", { legal: { status: "draft", factsToConfirm: "later" } }));
    expect(rules(findings).sort()).toEqual(["legal-draft-facts-missing", "legal-facts-shape"]);
  });

  it("refuses a non-array facts value on a counsel-reviewed document", () => {
    const findings = validateLegalDocument(legalDoc("terms", { legal: { factsToConfirm: {} } }));
    expect(findings).toEqual([expect.objectContaining({ rule: "legal-facts-shape", path: "legal.factsToConfirm" })]);
  });

  it("refuses a fact entry that is not a CopyRef with a non-empty id", () => {
    const findings = validateLegalDocument(legalDoc("terms", { legal: { factsToConfirm: [ref("acme.ok"), "bare", { id: "" }] } }));
    expect(findings.map((f) => [f.rule, f.path])).toEqual([
      ["legal-facts-shape", "legal.factsToConfirm.1"],
      ["legal-facts-shape", "legal.factsToConfirm.2"],
    ]);
  });
});

describe("validateLegalDocument — dates", () => {
  const cases: Array<[string, unknown, string | undefined]> = [
    ["a plain date", "2026-02-27", undefined],
    ["a leap day in a leap year", "2028-02-29", undefined],
    ["a leap day in the 400-year leap year", "2000-02-29", undefined],
    ["a leap day in a non-leap year", "2026-02-29", "legal-date-invalid"],
    ["a leap day in a 100-year non-leap year", "1900-02-29", "legal-date-invalid"],
    ["an impossible February day", "2026-02-30", "legal-date-invalid"],
    ["day 31 in a 30-day month", "2026-04-31", "legal-date-invalid"],
    ["month 13", "2026-13-01", "legal-date-invalid"],
    ["month 0", "2026-00-10", "legal-date-invalid"],
    ["day 0", "2026-01-00", "legal-date-invalid"],
    ["unpadded month and day", "2026-2-3", "legal-date-invalid"],
    ["year zero", "0000-01-01", "legal-date-invalid"],
    ["a date-time", "2026-02-03T00:00:00Z", "legal-date-invalid"],
    ["surrounding whitespace", " 2026-02-03", "legal-date-invalid"],
    ["a non-string", 20260203, "legal-date-invalid"],
    ["an empty string", "", "legal-date-invalid"],
  ];

  for (const field of ["effectiveDate", "lastUpdated"] as const) {
    for (const [label, value, expected] of cases) {
      it(`${field}: ${label}`, () => {
        const findings = validateLegalDocument(legalDoc("terms", { legal: { [field]: value } }));
        if (expected === undefined) {
          expect(findings).toEqual([]);
        } else {
          expect(findings).toEqual([expect.objectContaining({ rule: expected, path: `legal.${field}` })]);
        }
      });
    }

    it(`${field}: missing`, () => {
      const doc = legalDoc("terms");
      const legal = { ...(doc.legal as unknown as Record<string, unknown>) };
      delete legal[field];
      expect(validateLegalDocument({ ...doc, legal })).toEqual([expect.objectContaining({ rule: "legal-date-missing", path: `legal.${field}` })]);
    });
  }
});

describe("validateLegalDocument — variables", () => {
  it("refuses a missing variables object", () => {
    const doc = legalDoc("terms");
    const legal = { ...(doc.legal as unknown as Record<string, unknown>) };
    delete legal.variables;
    expect(validateLegalDocument({ ...doc, legal })).toEqual([expect.objectContaining({ rule: "legal-profile-shape", path: "legal.variables" })]);
  });

  it("refuses a non-object variables value", () => {
    expect(validateLegalDocument(legalDoc("terms", { legal: { variables: "acme" } }))).toEqual([
      expect.objectContaining({ rule: "legal-profile-shape", path: "legal.variables" }),
    ]);
  });

  it("refuses an empty or whitespace-only variable and reports each independently", () => {
    const findings = validateLegalDocument(legalDoc("terms", { legal: { variables: { entity: "", jurisdiction: "   \t", contact: "legal@acme.example" } } }));
    expect(findings.map((f) => [f.rule, f.path])).toEqual([
      ["legal-variable-empty", "legal.variables.entity"],
      ["legal-variable-empty", "legal.variables.jurisdiction"],
    ]);
  });

  it("refuses a missing or non-string variable", () => {
    const findings = validateLegalDocument(legalDoc("terms", { legal: { variables: { entity: 7, jurisdiction: "Exampleland" } } }));
    expect(findings.map((f) => [f.rule, f.path])).toEqual([
      ["legal-variable-empty", "legal.variables.entity"],
      ["legal-variable-empty", "legal.variables.contact"],
    ]);
  });
});

describe("validateLegalDocument — section structure", () => {
  it("refuses a missing section, naming it", () => {
    const sections = sectionsOf("terms").filter((s) => s.id !== "liability");
    const findings = validateLegalDocument(legalDoc("terms", { sections }));
    expect(findings).toEqual([expect.objectContaining({ rule: "legal-section-missing", path: "sections", message: expect.stringContaining("liability") })]);
  });

  it("reports one finding per missing section", () => {
    const sections = sectionsOf("privacy").filter((s) => s.id !== "cookies" && s.id !== "children");
    const findings = validateLegalDocument(legalDoc("privacy", { sections }));
    expect(rules(findings)).toEqual(["legal-section-missing", "legal-section-missing"]);
  });

  it("refuses an extra section at its own path", () => {
    const sections = [...sectionsOf("terms"), section("acme.terms", "bonus-clause")];
    const findings = validateLegalDocument(legalDoc("terms", { sections }));
    expect(findings).toEqual([expect.objectContaining({ rule: "legal-section-unexpected", path: `sections.${TERMS_IDS.length}.id` })]);
  });

  it("refuses a repeated expected section after its first occurrence (plus the base duplicate finding)", () => {
    const sections = [...sectionsOf("terms"), section("acme.terms", "contact")];
    const findings = validateLegalDocument(legalDoc("terms", { sections }));
    expect(findings).toContainEqual(expect.objectContaining({ rule: "legal-section-unexpected", path: `sections.${TERMS_IDS.length}.id` }));
    expect(findings).toContainEqual(expect.objectContaining({ rule: "section-anchor-duplicate" }));
    expect(rules(findings)).not.toContain("legal-section-missing");
    expect(rules(findings)).not.toContain("legal-section-order");
  });

  it("refuses reordered sections with a single order finding", () => {
    const sections = sectionsOf("terms");
    [sections[2], sections[3]] = [sections[3]!, sections[2]!];
    const findings = validateLegalDocument(legalDoc("terms", { sections }));
    expect(findings).toEqual([expect.objectContaining({ rule: "legal-section-order", path: "sections" })]);
  });

  it("does not report order when a missing section is the only difference", () => {
    const sections = sectionsOf("privacy").filter((s) => s.id !== "retention");
    expect(rules(validateLegalDocument(legalDoc("privacy", { sections })))).toEqual(["legal-section-missing"]);
  });

  it("treats a renamed section as missing plus unexpected", () => {
    const sections = sectionsOf("terms").map((s) => (s.id === "governing-law" ? { ...s, id: "applicable-law" } : s));
    const findings = validateLegalDocument(legalDoc("terms", { sections }));
    expect(findings.map((f) => [f.rule, f.path])).toEqual([
      ["legal-section-missing", "sections"],
      ["legal-section-unexpected", `sections.${TERMS_IDS.indexOf("governing-law")}.id`],
    ]);
    expect(findings[0]!.message).toContain("governing-law");
  });

  it("checks a Terms document against the Terms list, not the Privacy list", () => {
    const findings = validateLegalDocument(legalDoc("terms", { sections: sectionsOf("privacy") }));
    expect(rules(findings)).toContain("legal-section-missing");
    expect(rules(findings)).toContain("legal-section-unexpected");
  });

  it("skips section checks when sections is not an array (base validator reports it)", () => {
    const findings = validateLegalDocument({ ...legalDoc("terms"), sections: "nope" });
    expect(rules(findings)).toEqual(["document-sections-shape"]);
  });
});

describe("validateLegalDocument — notApplicable", () => {
  const statementRef = "acme.terms.indemnity.not-applicable";

  function withNotApplicable(id: string, blocks: Section["blocks"], declared: unknown = ref(statementRef)): LegalDocument {
    const sections = sectionsOf("terms").map((s) => (s.id === id ? { ...s, blocks } : s));
    return legalDoc("terms", { sections, legal: { notApplicable: { [id]: declared } } });
  }

  const statementBlocks: Section["blocks"] = [{ kind: "paragraph", content: [{ kind: "text", text: ref(statementRef) }] }];

  it("accepts a declared not-applicable section with exactly its statement paragraph", () => {
    expect(validateLegalDocument(withNotApplicable("indemnity", statementBlocks))).toEqual([]);
  });

  it("refuses a declared section whose statement paragraph is absent", () => {
    const findings = validateLegalDocument(withNotApplicable("indemnity", []));
    const index = TERMS_IDS.indexOf("indemnity");
    expect(findings).toEqual([expect.objectContaining({ rule: "legal-not-applicable-statement-missing", path: `sections.${index}.blocks` })]);
  });

  it("refuses a declared section whose paragraph cites a different ref", () => {
    const other: Section["blocks"] = [{ kind: "paragraph", content: [{ kind: "text", text: ref("acme.other") }] }];
    expect(rules(validateLegalDocument(withNotApplicable("indemnity", other)))).toEqual(["legal-not-applicable-statement-missing"]);
  });

  it("refuses a declared section with extra blocks", () => {
    const extra: Section["blocks"] = [...statementBlocks, { kind: "paragraph", content: [{ kind: "text", text: ref("acme.extra") }] }];
    expect(rules(validateLegalDocument(withNotApplicable("indemnity", extra)))).toEqual(["legal-not-applicable-statement-missing"]);
  });

  it("refuses a declared section whose paragraph has extra inline content", () => {
    const extra: Section["blocks"] = [{ kind: "paragraph", content: [{ kind: "text", text: ref(statementRef) }, { kind: "text", text: ref("acme.more") }] }];
    expect(rules(validateLegalDocument(withNotApplicable("indemnity", extra)))).toEqual(["legal-not-applicable-statement-missing"]);
  });

  it("refuses a declared section whose statement is a link, not text", () => {
    const link: Section["blocks"] = [{ kind: "paragraph", content: [{ kind: "link", text: ref(statementRef), href: "/acme" }] }];
    expect(rules(validateLegalDocument(withNotApplicable("indemnity", link)))).toEqual(["legal-not-applicable-statement-missing"]);
  });

  it("refuses a declared section whose only block is not a paragraph", () => {
    const callout: Section["blocks"] = [{ kind: "callout", tone: "info", content: [{ kind: "text", text: ref(statementRef) }] }];
    expect(rules(validateLegalDocument(withNotApplicable("indemnity", callout)))).toEqual(["legal-not-applicable-statement-missing"]);
  });

  it("refuses an empty section that is not declared not-applicable", () => {
    const sections = sectionsOf("terms").map((s) => (s.id === "suspension" ? { ...s, blocks: [] } : s));
    const findings = validateLegalDocument(legalDoc("terms", { sections }));
    const index = TERMS_IDS.indexOf("suspension");
    expect(findings).toEqual([expect.objectContaining({ rule: "legal-section-empty", path: `sections.${index}.blocks` })]);
  });

  it("refuses a notApplicable that is not a plain object", () => {
    for (const bad of ["x", [], null]) {
      const findings = validateLegalDocument(legalDoc("terms", { legal: { notApplicable: bad } }));
      expect(findings).toEqual([expect.objectContaining({ rule: "legal-not-applicable-shape", path: "legal.notApplicable" })]);
    }
  });

  it("refuses a declaration for a section id the kind does not have", () => {
    const findings = validateLegalDocument(legalDoc("terms", { legal: { notApplicable: { cookies: ref("acme.na") } } }));
    expect(findings).toEqual([expect.objectContaining({ rule: "legal-not-applicable-unknown-section", path: "legal.notApplicable.cookies" })]);
  });

  it("refuses a declaration value that is not a CopyRef", () => {
    for (const bad of ["acme.na", { id: "" }, 3]) {
      const findings = validateLegalDocument(withNotApplicable("indemnity", statementBlocks, bad));
      expect(findings).toEqual([expect.objectContaining({ rule: "legal-not-applicable-shape", path: "legal.notApplicable.indemnity" })]);
    }
  });

  it("does not require the statement for a declared section that is absent (it is reported missing instead)", () => {
    const sections = sectionsOf("terms").filter((s) => s.id !== "indemnity");
    const findings = validateLegalDocument(legalDoc("terms", { sections, legal: { notApplicable: { indemnity: ref(statementRef) } } }));
    expect(rules(findings)).toEqual(["legal-section-missing"]);
  });
});

describe("gateLegalDocument", () => {
  it("refuses a draft on production and accepts it on preview", () => {
    const production = gateLegalDocument(draftDoc(), "production");
    expect(production.ok).toBe(false);
    expect(production.findings).toContainEqual(expect.objectContaining({ rule: "legal-gate-not-counsel-reviewed", path: "legal.status" }));
    expect(gateLegalDocument(draftDoc(), "preview")).toEqual({ ok: true, findings: [] });
  });

  it("refuses a missing status on production", () => {
    const doc = legalDoc("terms");
    const legal = { ...(doc.legal as unknown as Record<string, unknown>) };
    delete legal.status;
    const result = gateLegalDocument({ ...doc, legal }, "production");
    expect(result.ok).toBe(false);
    expect(rules(result.findings)).toContain("legal-gate-not-counsel-reviewed");
    expect(rules(result.findings)).toContain("legal-status-unknown");
  });

  it("refuses an unknown status on production", () => {
    const result = gateLegalDocument(legalDoc("terms", { legal: { status: "approved" } }), "production");
    expect(result.ok).toBe(false);
    expect(rules(result.findings)).toContain("legal-gate-not-counsel-reviewed");
    expect(rules(result.findings)).toContain("legal-status-unknown");
  });

  it("accepts a valid counsel-reviewed document on both targets", () => {
    for (const kind of ["terms", "privacy"] as const) {
      expect(gateLegalDocument(legalDoc(kind), "production")).toEqual({ ok: true, findings: [] });
      expect(gateLegalDocument(legalDoc(kind), "preview")).toEqual({ ok: true, findings: [] });
    }
  });

  it("refuses an invalid counsel-reviewed document on both targets", () => {
    const invalid = legalDoc("terms", { sections: sectionsOf("terms").slice(1) });
    for (const target of ["preview", "production"] as const) {
      const result = gateLegalDocument(invalid, target);
      expect(result.ok).toBe(false);
      expect(rules(result.findings)).toContain("legal-section-missing");
    }
  });

  it("refuses an invalid draft on preview", () => {
    const result = gateLegalDocument(legalDoc("terms", { legal: { status: "draft" } }), "preview");
    expect(result.ok).toBe(false);
    expect(rules(result.findings)).toContain("legal-draft-facts-missing");
  });

  it("refuses an unknown target", () => {
    for (const bad of ["staging", "Production", "", undefined, null, 1, {}]) {
      const result = gateLegalDocument(legalDoc("terms"), bad);
      expect(result.ok).toBe(false);
      expect(result.findings).toContainEqual(expect.objectContaining({ rule: "legal-gate-target-unknown", path: "target" }));
    }
  });

  it("refuses non-object input without throwing", () => {
    for (const bad of [null, undefined, "x", 3, [], () => 1]) {
      for (const target of ["preview", "production"]) {
        expect(() => gateLegalDocument(bad, target)).not.toThrow();
        const result = gateLegalDocument(bad, target);
        expect(result.ok).toBe(false);
        expect(result.findings.length).toBeGreaterThan(0);
      }
    }
  });

  it("does not mutate its input", () => {
    const frozen = deepFreeze(draftDoc("privacy"));
    const snapshot = JSON.stringify(frozen);
    expect(() => gateLegalDocument(frozen, "production")).not.toThrow();
    expect(() => gateLegalDocument(frozen, "preview")).not.toThrow();
    expect(() => validateLegalDocument(frozen)).not.toThrow();
    expect(JSON.stringify(frozen)).toBe(snapshot);
  });
});
