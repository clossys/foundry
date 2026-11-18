/**
 * Page metadata and legal-document package defaults (foundry-build-0033): drafts that follow their slot contract,
 * each paired with a mutation that the check must fail.
 */
import { describe, expect, it } from "vitest";
import { checkPackageDefaults, loadPackageDefaults, type PackageDefault } from "./package-defaults.js";
import { loadWriterTrees } from "./target.js";

const trees = loadWriterTrees();
const defaults = loadPackageDefaults();
const text = (findings: readonly { message: string }[]) => findings.map(finding => finding.message).join("\n");
const swap = (slot: string, name: string, edit: (text: string) => string): PackageDefault[] =>
  defaults.map(entry => (entry.slot === slot && entry.name === name ? { ...entry, text: edit(entry.text) } : entry));

describe("Writer package defaults outside Voice", () => {
  it("every Page metadata slot and both legal types have a draft default that passes", () => {
    const meta = defaults.filter(entry => /\.meta$/.test(entry.slot));
    expect(meta).toHaveLength(32);
    expect(defaults.filter(entry => entry.slot === "narratives.legal-document").map(entry => entry.name)).toEqual(["privacy-v1.md", "terms-v1.md"]);
    expect(checkPackageDefaults(trees, defaults)).toEqual([]);
  });

  it("mutation: a page metadata slot with no default fails", () => {
    const findings = checkPackageDefaults(trees, defaults.filter(entry => entry.slot !== "page.pricing.meta"));
    expect(text(findings)).toContain("page.pricing.meta needs exactly one package default, found 0");
  });

  it("mutation: a title over its budget, a missing required field and a non-draft status fail", () => {
    const long = swap("page.home.meta", "home.meta-v1.json", source => source.replace('"en": "{brand}"', `"en": "${"x".repeat(61)}"`));
    expect(text(checkPackageDefaults(trees, long))).toContain("field title is 61 characters, over 60");
    const missing = swap("page.home.meta", "home.meta-v1.json", source => {
      const candidate = JSON.parse(source);
      delete candidate.content.fields.description;
      return JSON.stringify(candidate);
    });
    expect(text(checkPackageDefaults(trees, missing))).toContain("is missing required field description");
    const live = swap("page.home.meta", "home.meta-v1.json", source => source.replace('"status": "draft"', '"status": "submitted"'));
    expect(text(checkPackageDefaults(trees, live))).toContain("must be status draft");
  });

  it("mutation: a legal template that drops a purpose or binds an undeclared fact fails", () => {
    const dropped = swap("narratives.legal-document", "privacy-v1.md", source => source.replace("### keep\n", "### retain\n"));
    expect(text(checkPackageDefaults(trees, dropped))).toContain("has purposes [collect, use, share, retain, rights, contact, change]");
    const invented = swap("narratives.legal-document", "terms-v1.md", source => source.replace("{fact:governing.law}", "{fact:venue}"));
    const findings = text(checkPackageDefaults(trees, invented));
    expect(findings).toContain("binds {fact:venue}, which is neither {brand} nor a declared terms fact");
    expect(findings).toContain("never binds declared fact governing.law");
  });
});
