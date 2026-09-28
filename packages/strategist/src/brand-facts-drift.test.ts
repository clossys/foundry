import { describe, expect, it } from "vitest";
import type { BrandFacts, CopyEntryLike } from "./brand-facts.js";
import { checkBrandFactsDrift, type BrandFactsDriftKind } from "./brand-facts-drift.js";

// Every value below is fictional; every domain is under the reserved
// `.example` TLD.

const facts: BrandFacts = {
  legalEntity: { name: "Lumenfold Labs Inc.", incorporated: true, jurisdiction: "Delaware" },
  brand: { name: "Lumenfold", wordmark: "LUMENFOLD" },
  domains: ["lumenfold.example", "www.lumenfold.example"],
  canonicalOrigin: "https://lumenfold.example",
  contactEmail: "hello@lumenfold.example",
  additionalEmails: ["privacy@lumenfold.example"],
  taglines: [{ copyId: "brand.tagline" }],
};

const copyEntries: CopyEntryLike[] = [
  { id: "brand.tagline", text: "Light work for heavy weeks.", status: "approved" },
  { id: "brand.draft", text: "Heavy work for light weeks.", status: "draft" },
];

function check(content: string, overrides: Partial<BrandFacts> = {}, entries: readonly CopyEntryLike[] | undefined = copyEntries) {
  return checkBrandFactsDrift([{ path: "page.md", content }], { ...facts, ...overrides }, entries === undefined ? {} : { copyEntries: entries });
}

function kinds(content: string, overrides: Partial<BrandFacts> = {}): BrandFactsDriftKind[] {
  return check(content, overrides).findings.map((f) => f.kind);
}

const cleanPage = [
  "---",
  "title: About Lumenfold",
  'tagline: "Light work for heavy weeks."',
  "---",
  "# LUMENFOLD",
  "Lumenfold is made by Lumenfold Labs Inc., incorporated in Delaware.",
  "Contact Lumenfold Labs Inc. at hello@lumenfold.example or privacy@lumenfold.example.",
  "Visit https://lumenfold.example/pricing or read https://docs.lumenfold.example/start.",
  "Payments are processed by Example Payments LLC, registered in England and Wales.",
  "This agreement is governed by the laws of the State of Delaware.",
  "Our site lives at lumenfold.example and www.lumenfold.example.",
].join("\n");

describe("checkBrandFactsDrift — clean", () => {
  it("reports clean for content that agrees with the record", () => {
    const result = check(cleanPage);
    expect(result.findings).toEqual([]);
    expect(result.state).toBe("clean");
    expect(result.indeterminateReasons).toEqual([]);
    expect(result.filesScanned).toBe(1);
  });

  it("does not flag third-party company names", () => {
    expect(kinds("Built with Example Payments LLC and Northwind Traders Ltd.")).toEqual([]);
  });

  it("does not flag subdomains of recorded domains", () => {
    expect(kinds("Docs at https://docs.lumenfold.example/ and status at http://status.lumenfold.example.")).toEqual([]);
  });

  it("does not flag unrelated URLs", () => {
    expect(kinds("See https://example.com/lumenfold and https://other.example/.")).toEqual([]);
  });

  it("does not flag hostnames containing the brand in lowercase", () => {
    expect(kinds("Point DNS at lumenfold.example; mail goes to mx.lumenfold.example.")).toEqual([]);
    expect(kinds("The package lumenfold-ui and the handle x@lumenfold and path /lumenfold/app are fine.")).toEqual([]);
  });

  it("does not flag month-shaped places after 'registered in'", () => {
    expect(kinds("Most users registered in March.")).toEqual([]);
  });
});

describe("checkBrandFactsDrift — one finding per conflict class", () => {
  it("legal-name: a brand phrase with a different company suffix", () => {
    const result = check("Copyright Lumenfold Labs LLC.");
    expect(result.findings).toEqual([
      expect.objectContaining({ kind: "legal-name", file: "page.md", line: 1, found: "Lumenfold Labs LLC", expected: "Lumenfold Labs Inc." }),
    ]);
    expect(result.state).toBe("drift");
  });

  it("legal-name: a key/value line", () => {
    const result = check('  "legalName": "Lumenfold Holdings",');
    expect(result.findings).toEqual([expect.objectContaining({ kind: "legal-name", found: "Lumenfold Holdings" })]);
  });

  it("incorporation: a brand phrase with a suffix when the record says not incorporated", () => {
    const overrides = { legalEntity: { name: "Lumenfold", incorporated: false, jurisdiction: "Delaware" } };
    expect(kinds("Made by Lumenfold Inc.", overrides)).toEqual(["incorporation"]);
    expect(kinds("Lumenfold is incorporated under Delaware law.", overrides)).toEqual(["incorporation"]);
    expect(kinds("Made by Lumenfold.", overrides)).toEqual([]);
  });

  it("jurisdiction: prose and key/value", () => {
    expect(kinds("Lumenfold Labs Inc. is incorporated in Nevada.")).toEqual(["jurisdiction"]);
    expect(kinds("Governed by the laws of the State of New York.")).toEqual(["jurisdiction"]);
    expect(kinds("jurisdiction: Nevada")).toEqual(["jurisdiction"]);
    expect(kinds("jurisdiction: delaware")).toEqual([]);
  });

  it("brand-casing: a miscased brand word", () => {
    const result = check("Welcome to LumenFold.");
    expect(result.findings).toEqual([expect.objectContaining({ kind: "brand-casing", found: "LumenFold", line: 1 })]);
  });

  it("brand-casing: a key/value brand name and og:site_name", () => {
    expect(kinds('siteName: "Lumenfold App"')).toEqual(["brand-casing"]);
    expect(kinds('<meta property="og:site_name" content="Lumen Fold">')).toEqual(["brand-casing"]);
    expect(kinds('<meta content="LUMENFOLD" property="og:site_name">')).toEqual([]);
  });

  it("domain: a URL on a non-recorded host carrying the brand label", () => {
    const result = check("Download at https://lumenfold.test/app.");
    expect(result.findings).toEqual([expect.objectContaining({ kind: "domain", found: "lumenfold.test" })]);
    expect(kinds('primaryDomain: "lumenfold.test"')).toEqual(["domain"]);
    expect(kinds('domain: "www.lumenfold.example"')).toEqual([]);
  });

  it("canonical-origin: http scheme or alias host", () => {
    expect(check("Go to http://lumenfold.example/start").findings).toEqual([
      expect.objectContaining({ kind: "canonical-origin", found: "http://lumenfold.example", expected: "https://lumenfold.example" }),
    ]);
    expect(kinds("Go to https://www.lumenfold.example/start")).toEqual(["canonical-origin"]);
  });

  it("contact-email: an unrecorded address on a brand domain", () => {
    const result = check("Write to support@lumenfold.example.");
    expect(result.findings).toEqual([
      expect.objectContaining({ kind: "contact-email", found: "support@lumenfold.example", expected: "hello@lumenfold.example" }),
    ]);
    expect(kinds("Write to hello@lumenfold.test.")).toEqual(["contact-email"]);
    expect(kinds('contactEmail: "team@other.example"')).toEqual(["contact-email"]);
    expect(kinds("Write to HELLO@lumenfold.example or someone@other.example.")).toEqual([]);
  });

  it("tagline: a tagline value that is not the approved text", () => {
    const result = check('tagline: "Heavy work for light weeks."');
    expect(result.findings).toEqual([expect.objectContaining({ kind: "tagline", found: "Heavy work for light weeks." })]);
    expect(kinds("slogan: Light work for heavy weeks.")).toEqual([]);
  });

  it("tagline: every tagline value is a finding when nothing resolved", () => {
    const result = check('tagline: "Light work for heavy weeks."', {}, [{ id: "brand.tagline", text: "Light work for heavy weeks.", status: "draft" }]);
    expect(result.findings.map((f) => f.kind).sort()).toEqual(["tagline", "tagline-unresolved"]);
  });

  it("tagline-unresolved: a record copyId with no approved entry", () => {
    const result = check("Plain prose.", { taglines: [{ copyId: "brand.missing" }] });
    expect(result.findings).toEqual([
      expect.objectContaining({ kind: "tagline-unresolved", file: "brand-facts.json", line: 0, found: "brand.missing" }),
    ]);
    expect(result.state).toBe("drift");
  });

  it("every finding carries a one-sentence message naming class, found, and expected", () => {
    const [finding] = check("Welcome to LumenFold.").findings;
    expect(finding?.message).toContain("LumenFold");
    expect(finding?.message).toContain("Lumenfold");
    expect(finding?.message).toMatch(/brand-casing|brand name/);
  });
});

describe("checkBrandFactsDrift — escape hatch and dedupe", () => {
  it("records an ignored line and does not check it", () => {
    for (const marker of ["<!-- brand-facts:ignore -->", "/* brand-facts:ignore */", "{/* brand-facts:ignore */}", "// brand-facts:ignore"]) {
      const result = check(`Formerly LumenFold Ltd, at http://old.lumenfold.test ${marker}`);
      expect(result.findings, marker).toEqual([]);
      expect(result.ignored).toEqual([{ file: "page.md", line: 1, snippet: expect.stringContaining("LumenFold") }]);
      expect(result.state).toBe("clean");
    }
  });

  it("opens the marker with `#` only as the first non-blank character of the line", () => {
    const result = check("  # brand-facts:ignore Formerly LumenFold Ltd, at http://old.lumenfold.test");
    expect(result.findings).toEqual([]);
    expect(result.ignored).toHaveLength(1);
    expect(kinds("Formerly LumenFold Ltd, at http://old.lumenfold.test # brand-facts:ignore")).toContain("legal-name");
  });

  it("reports the same (kind, file, line, found) once", () => {
    const result = check("LumenFold and LumenFold again; http://lumenfold.example and http://lumenfold.example/b");
    expect(result.findings.map((f) => `${f.kind}:${f.found}`)).toEqual(["brand-casing:LumenFold", "canonical-origin:http://lumenfold.example"]);
  });

  it("reports the same finding on different lines separately", () => {
    const result = check("LumenFold\nLumenFold");
    expect(result.findings.map((f) => f.line)).toEqual([1, 2]);
  });
});

describe("checkBrandFactsDrift — fails closed", () => {
  it("is indeterminate, never clean, when zero files were scanned", () => {
    const result = checkBrandFactsDrift([], facts, { copyEntries });
    expect(result.state).toBe("indeterminate");
    expect(result.indeterminateReasons).toEqual(["no files scanned"]);
    expect(result.filesScanned).toBe(0);
  });

  it("is indeterminate when taglines are recorded but no copy entries were supplied", () => {
    const result = checkBrandFactsDrift([{ path: "page.md", content: cleanPage }], facts);
    expect(result.state).toBe("indeterminate");
    expect(result.indeterminateReasons).toHaveLength(1);
    expect(result.indeterminateReasons[0]).toMatch(/copy registry/);
  });

  it("indeterminate wins over drift, and findings are still returned", () => {
    const result = checkBrandFactsDrift([{ path: "page.md", content: "Welcome to LumenFold." }], facts);
    expect(result.state).toBe("indeterminate");
    expect(result.findings.map((f) => f.kind)).toEqual(["brand-casing"]);
  });

  it("is clean without copy entries when no taglines are recorded", () => {
    const result = checkBrandFactsDrift([{ path: "page.md", content: cleanPage }], { ...facts, taglines: [] });
    expect(result.state).toBe("clean");
  });
});
