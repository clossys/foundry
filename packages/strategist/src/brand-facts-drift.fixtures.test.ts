import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { copyEntriesFromRegistry, validateBrandFacts, type BrandFacts, type CopyEntryLike } from "./brand-facts.js";
import { checkBrandFactsDrift, type BrandFactsDriftKind } from "./brand-facts-drift.js";
import { scanStrategyDirectory } from "./scan.js";

const FIXTURE_ROOT = fileURLToPath(new URL("../test-fixtures/brand-facts/", import.meta.url));
const SCAN_OPTIONS = {
  extensions: [".md", ".html", ".json", ".yml", ".yaml", ".txt"],
  excludeGlobs: ["**/_record/**", "brand-facts.json"],
};

function fixturePath(...parts: string[]): string {
  return join(FIXTURE_ROOT, ...parts);
}

function loadFacts(...parts: string[]): BrandFacts {
  const result = validateBrandFacts(JSON.parse(readFileSync(fixturePath(...parts), "utf8")));
  if (!result.ok) throw new Error(`fixture record invalid: ${JSON.stringify(result.issues)}`);
  return result.value;
}

function loadRegistry(): CopyEntryLike[] {
  const result = copyEntriesFromRegistry(JSON.parse(readFileSync(fixturePath("record", "copy-registry.json"), "utf8")));
  if (!result.ok) throw new Error(`fixture registry invalid: ${JSON.stringify(result.issues)}`);
  return result.value;
}

const facts = loadFacts("record", "brand-facts.json");
const copyEntries = loadRegistry();

function scan(dir: string) {
  return scanStrategyDirectory(fixturePath(dir), SCAN_OPTIONS);
}

describe("brand-facts fixtures", () => {
  it("loads the record and registry fixtures", () => {
    expect(facts.brand.name).toBe("Lumenfold");
    expect(copyEntries.map((entry) => entry.id)).toEqual(["brand.tagline", "brand.tagline-alt"]);
  });

  it("reports the clean site as clean, with its ignored line recorded", () => {
    const result = checkBrandFactsDrift(scan("clean"), facts, { copyEntries });
    expect(result.findings).toEqual([]);
    expect(result.indeterminateReasons).toEqual([]);
    expect(result.state).toBe("clean");
    expect(result.filesScanned).toBe(4);
    expect(result.ignored).toHaveLength(1);
    expect(result.ignored[0]?.file).toBe("copy/home.md");
  });

  const conflictCases: ReadonlyArray<readonly [string, BrandFactsDriftKind, string]> = [
    ["conflict-legal-name", "legal-name", "legal/terms.md"],
    ["conflict-jurisdiction", "jurisdiction", "legal/terms.md"],
    ["conflict-brand-casing", "brand-casing", "copy/home.md"],
    ["conflict-domain", "domain", "site.json"],
    ["conflict-canonical-origin", "canonical-origin", "footer.html"],
    ["conflict-contact-email", "contact-email", "legal/terms.md"],
    ["conflict-tagline", "tagline", "site.json"],
  ];

  for (const [dir, kind, file] of conflictCases) {
    it(`flags exactly one ${kind} finding in ${dir}`, () => {
      const result = checkBrandFactsDrift(scan(dir), facts, { copyEntries });
      expect(result.findings.map((finding) => finding.kind)).toEqual([kind]);
      expect(result.findings[0]?.file).toBe(file);
      expect(result.findings[0]?.line).toBeGreaterThan(0);
      expect(result.state).toBe("drift");
    });
  }

  it("flags exactly one incorporation finding when the record says not incorporated", () => {
    const notIncorporated = loadFacts("conflict-incorporation", "_record", "brand-facts.json");
    expect(notIncorporated.legalEntity.incorporated).toBe(false);
    const result = checkBrandFactsDrift(scan("conflict-incorporation"), notIncorporated, { copyEntries });
    expect(result.findings.map((finding) => finding.kind)).toEqual(["incorporation"]);
    expect(result.findings[0]?.file).toBe("footer.html");
    expect(result.state).toBe("drift");
  });

  it("flags exactly one tagline-unresolved finding when the record copyId is not in the registry", () => {
    const unresolved = loadFacts("tagline-unresolved", "brand-facts.json");
    const result = checkBrandFactsDrift(scan("tagline-unresolved"), unresolved, { copyEntries });
    expect(result.findings.map((finding) => finding.kind)).toEqual(["tagline-unresolved"]);
    expect(result.findings[0]?.file).toBe("brand-facts.json");
    expect(result.findings[0]?.line).toBe(0);
    expect(result.state).toBe("drift");
  });

  it("is indeterminate, never clean, for an empty directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "brand-facts-empty-"));
    try {
      const files = scanStrategyDirectory(dir, SCAN_OPTIONS);
      const result = checkBrandFactsDrift(files, facts, { copyEntries });
      expect(files).toEqual([]);
      expect(result.state).toBe("indeterminate");
      expect(result.indeterminateReasons.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is indeterminate when taglines are recorded but no copy entries are supplied", () => {
    const result = checkBrandFactsDrift(scan("clean"), facts);
    expect(result.state).toBe("indeterminate");
    expect(result.indeterminateReasons.length).toBeGreaterThan(0);
  });
});
