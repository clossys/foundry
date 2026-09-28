import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BRAND_FACTS_FILE,
  copyEntriesFromRegistry,
  readBrandFacts,
  resolveBrandTaglines,
  validateBrandFacts,
  type BrandFacts,
} from "./brand-facts.js";
import { readStrategy } from "./reader.js";

// Every value below is fictional; every domain is under the reserved
// `.example` TLD.

const validRecord: BrandFacts = {
  legalEntity: { name: "Lumenfold Labs Inc.", incorporated: true, jurisdiction: "Delaware" },
  brand: { name: "Lumenfold", wordmark: "LUMENFOLD" },
  domains: ["lumenfold.example", "www.lumenfold.example"],
  canonicalOrigin: "https://lumenfold.example",
  contactEmail: "hello@lumenfold.example",
  additionalEmails: ["privacy@lumenfold.example"],
  taglines: [{ copyId: "brand.tagline" }],
};

function withChange(mutate: (record: Record<string, unknown>) => void): unknown {
  const copy = JSON.parse(JSON.stringify(validRecord)) as Record<string, unknown>;
  mutate(copy);
  return copy;
}

function issuesOf(value: unknown): Array<{ path: string; message: string }> {
  const result = validateBrandFacts(value);
  if (result.ok) throw new Error("expected validation to fail");
  return result.issues;
}

describe("validateBrandFacts", () => {
  it("accepts a complete record", () => {
    expect(validateBrandFacts(validRecord)).toEqual({ ok: true, value: validRecord });
  });

  it("accepts a record with no wordmark, no additionalEmails, and no taglines", () => {
    const minimal = withChange((r) => {
      delete (r.brand as Record<string, unknown>).wordmark;
      delete r.additionalEmails;
      r.taglines = [];
    });
    const result = validateBrandFacts(minimal);
    expect(result.ok).toBe(true);
  });

  it("refuses a non-object root", () => {
    expect(issuesOf([])).toEqual([{ path: "(root)", message: expect.any(String) }]);
    expect(issuesOf(null)[0]?.path).toBe("(root)");
  });

  it("refuses an unknown top-level key", () => {
    const issues = issuesOf(withChange((r) => (r.founder = "someone")));
    expect(issues.map((i) => i.path)).toEqual(["founder"]);
    expect(issues[0]?.message).toMatch(/unknown key/);
  });

  it("refuses unknown keys inside legalEntity and brand", () => {
    const issues = issuesOf(
      withChange((r) => {
        (r.legalEntity as Record<string, unknown>).registrationNumber = "123";
        (r.brand as Record<string, unknown>).color = "blue";
      }),
    );
    expect(issues.map((i) => i.path).sort()).toEqual(["brand.color", "legalEntity.registrationNumber"]);
  });

  it("requires legalEntity fields with their types", () => {
    const issues = issuesOf(withChange((r) => (r.legalEntity = { name: "", incorporated: "yes" })));
    expect(issues.map((i) => i.path).sort()).toEqual([
      "legalEntity.incorporated",
      "legalEntity.jurisdiction",
      "legalEntity.name",
    ]);
  });

  it("refuses a missing legalEntity or brand object", () => {
    const issues = issuesOf(
      withChange((r) => {
        delete r.legalEntity;
        r.brand = "Lumenfold";
      }),
    );
    expect(issues.map((i) => i.path).sort()).toEqual(["brand", "legalEntity"]);
  });

  it("refuses a wordmark that is not the brand name case-insensitively", () => {
    const issues = issuesOf(withChange((r) => ((r.brand as Record<string, unknown>).wordmark = "LUMENFIELD")));
    expect(issues.map((i) => i.path)).toEqual(["brand.wordmark"]);
  });

  it("refuses empty, non-lowercase, schemed, duplicate domains", () => {
    expect(issuesOf(withChange((r) => (r.domains = []))).map((i) => i.path)).toContain("domains");
    expect(issuesOf(withChange((r) => (r.domains = ["Lumenfold.example"]))).map((i) => i.path)).toContain("domains[0]");
    expect(issuesOf(withChange((r) => (r.domains = ["lumenfold.example", "https://www.lumenfold.example"]))).map((i) => i.path)).toContain(
      "domains[1]",
    );
    expect(issuesOf(withChange((r) => (r.domains = ["lumenfold.example", "lumenfold.example:8080"]))).map((i) => i.path)).toContain(
      "domains[1]",
    );
    expect(issuesOf(withChange((r) => (r.domains = ["lumenfold.example", "lumenfold.example/path"]))).map((i) => i.path)).toContain(
      "domains[1]",
    );
    const dup = issuesOf(withChange((r) => (r.domains = ["lumenfold.example", "lumenfold.example"])));
    expect(dup).toEqual([{ path: "domains[1]", message: expect.stringMatching(/duplicate/) }]);
  });

  it("refuses a canonicalOrigin with a path, trailing slash, port, other scheme, or host outside domains", () => {
    for (const origin of [
      "https://lumenfold.example/",
      "https://lumenfold.example/home",
      "https://lumenfold.example:443",
      "ftp://lumenfold.example",
      "lumenfold.example",
      "https://other.example",
    ]) {
      const issues = issuesOf(withChange((r) => (r.canonicalOrigin = origin)));
      expect(issues.map((i) => i.path), origin).toEqual(["canonicalOrigin"]);
    }
  });

  it("accepts an http canonicalOrigin on a recorded host", () => {
    expect(validateBrandFacts(withChange((r) => (r.canonicalOrigin = "http://www.lumenfold.example"))).ok).toBe(true);
  });

  it("refuses a contactEmail that is not email-shaped", () => {
    expect(issuesOf(withChange((r) => (r.contactEmail = "hello at lumenfold"))).map((i) => i.path)).toEqual(["contactEmail"]);
  });

  it("refuses bad, duplicate, or contact-equal additionalEmails", () => {
    expect(issuesOf(withChange((r) => (r.additionalEmails = ["nope"]))).map((i) => i.path)).toEqual(["additionalEmails[0]"]);
    expect(
      issuesOf(withChange((r) => (r.additionalEmails = ["privacy@lumenfold.example", "PRIVACY@lumenfold.example"]))).map((i) => i.path),
    ).toEqual(["additionalEmails[1]"]);
    expect(issuesOf(withChange((r) => (r.additionalEmails = ["Hello@lumenfold.example"]))).map((i) => i.path)).toEqual([
      "additionalEmails[0]",
    ]);
  });

  it("refuses a tagline that restates its text, pointing at copyId", () => {
    const issues = issuesOf(withChange((r) => (r.taglines = [{ copyId: "brand.tagline", text: "Light work for heavy weeks." }])));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe("taglines[0].text");
    expect(issues[0]?.message).toMatch(/copyId/);
    expect(issues[0]?.message).toMatch(/Writer/);
  });

  it("refuses any other key on a tagline with the same guidance", () => {
    const issues = issuesOf(withChange((r) => (r.taglines = [{ copyId: "brand.tagline", locale: "en" }])));
    expect(issues.map((i) => i.path)).toEqual(["taglines[0].locale"]);
    expect(issues[0]?.message).toMatch(/copyId/);
  });

  it("refuses a tagline with no copyId, and duplicate copyIds", () => {
    expect(issuesOf(withChange((r) => (r.taglines = [{}]))).map((i) => i.path)).toEqual(["taglines[0].copyId"]);
    expect(issuesOf(withChange((r) => (r.taglines = [{ copyId: "a" }, { copyId: "a" }]))).map((i) => i.path)).toEqual([
      "taglines[1].copyId",
    ]);
    expect(issuesOf(withChange((r) => (r.taglines = "brand.tagline"))).map((i) => i.path)).toEqual(["taglines"]);
  });
});

describe("resolveBrandTaglines", () => {
  const facts: BrandFacts = { ...validRecord, taglines: [{ copyId: "brand.tagline" }, { copyId: "brand.alt" }, { copyId: "brand.gone" }] };

  it("resolves only approved entries whose id matches", () => {
    const result = resolveBrandTaglines(facts, [
      { id: "brand.tagline", text: "Light work for heavy weeks.", status: "approved" },
      { id: "brand.alt", text: "Draft line.", status: "draft" },
      { id: "brand.other", text: "Unrelated.", status: "approved" },
    ]);
    expect(result).toEqual({
      resolved: [{ copyId: "brand.tagline", text: "Light work for heavy weeks." }],
      unresolved: ["brand.alt", "brand.gone"],
    });
  });

  it("treats an entry with no status as unapproved", () => {
    const result = resolveBrandTaglines(validRecord, [{ id: "brand.tagline", text: "Light work for heavy weeks." }]);
    expect(result).toEqual({ resolved: [], unresolved: ["brand.tagline"] });
  });
});

describe("copyEntriesFromRegistry", () => {
  it("reads a Writer-shaped registry, allowing extra keys", () => {
    const result = copyEntriesFromRegistry({
      version: 1,
      entries: [
        { id: "brand.tagline", text: "Light work for heavy weeks.", status: "approved", surface: "hero" },
        { id: "brand.draft", text: "Maybe.", status: "draft" },
        { id: "brand.bare", text: "No status." },
      ],
    });
    expect(result).toEqual({
      ok: true,
      value: [
        { id: "brand.tagline", text: "Light work for heavy weeks.", status: "approved" },
        { id: "brand.draft", text: "Maybe.", status: "draft" },
        { id: "brand.bare", text: "No status." },
      ],
    });
  });

  it("refuses a non-object, a missing entries array, and malformed entries", () => {
    expect(copyEntriesFromRegistry([]).ok).toBe(false);
    expect(copyEntriesFromRegistry({}).ok).toBe(false);
    const bad = copyEntriesFromRegistry({ entries: [{ id: "x" }, { id: 3, text: "t" }, { id: "y", text: "t", status: 1 }] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.issues.map((i) => i.path).sort()).toEqual(["entries[0].text", "entries[1].id", "entries[2].status"]);
    }
  });
});

describe("readBrandFacts", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "strategy-brand-facts-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("names the record file", () => {
    expect(BRAND_FACTS_FILE).toBe("brand-facts.json");
  });

  it("returns ok for a valid record", () => {
    writeFileSync(join(dir, BRAND_FACTS_FILE), JSON.stringify(validRecord));
    expect(readBrandFacts(dir)).toEqual({ status: "ok", facts: validRecord });
  });

  it("returns missing when the file is absent", () => {
    const read = readBrandFacts(dir);
    expect(read.status).toBe("missing");
    if (read.status === "missing") expect(read.detail).toContain(BRAND_FACTS_FILE);
  });

  it("returns invalid/unparseable for broken JSON", () => {
    writeFileSync(join(dir, BRAND_FACTS_FILE), "{ nope");
    const read = readBrandFacts(dir);
    expect(read.status).toBe("invalid");
    if (read.status === "invalid") expect(read.issue).toMatchObject({ file: BRAND_FACTS_FILE, reason: "unparseable" });
  });

  it("returns invalid/invalid-schema for a schema violation", () => {
    writeFileSync(join(dir, BRAND_FACTS_FILE), JSON.stringify({ ...validRecord, taglines: [{ copyId: "x", text: "y" }] }));
    const read = readBrandFacts(dir);
    expect(read.status).toBe("invalid");
    if (read.status === "invalid") {
      expect(read.issue.reason).toBe("invalid-schema");
      expect(read.issue.detail).toContain("taglines[0].text");
    }
  });

  it("returns invalid/unreadable when the record path cannot be read as a file", () => {
    mkdirSync(join(dir, BRAND_FACTS_FILE));
    const read = readBrandFacts(dir);
    expect(read.status).toBe("invalid");
    if (read.status === "invalid") expect(read.issue).toMatchObject({ file: BRAND_FACTS_FILE, reason: "unreadable" });
  });
});

describe("readStrategy picks up brand-facts.json", () => {
  let dir: string;
  const validFact = {
    key: "active-customers",
    label: "Active customers",
    value: 4200,
    unit: "customers",
    source: "billing-export-2026-06",
    lastUpdatedAt: "2026-06-30",
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "strategy-brand-facts-reader-test-"));
    writeFileSync(join(dir, "facts.json"), JSON.stringify([validFact]));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads a valid brand-facts.json into bundle.brandFacts", () => {
    writeFileSync(join(dir, BRAND_FACTS_FILE), JSON.stringify(validRecord));
    const bundle = readStrategy(dir);
    expect(bundle.brandFacts).toEqual(validRecord);
    expect(bundle.complete).toBe(true);
  });

  it("leaves brandFacts undefined with no issue when absent", () => {
    const bundle = readStrategy(dir);
    expect(bundle.brandFacts).toBeUndefined();
    expect(bundle.issues).toEqual([]);
  });

  it("records an invalid brand-facts.json as an issue and is not complete", () => {
    writeFileSync(join(dir, BRAND_FACTS_FILE), JSON.stringify({ brand: { name: "Lumenfold" } }));
    const bundle = readStrategy(dir);
    expect(bundle.brandFacts).toBeUndefined();
    expect(bundle.complete).toBe(false);
    expect(bundle.issues.find((i) => i.file === BRAND_FACTS_FILE)?.reason).toBe("invalid-schema");
  });
});
