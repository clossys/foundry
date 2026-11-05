import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { check } from "../catalog-core/check.js";
import { smallCatalog, emptyLibrary } from "./__fixtures__/studio.js";
import { draftEnvelopes, repositoryRoot } from "./__fixtures__/copy-hand-roll.js";

it("attaches every registered check variant at its producer while preserving diagnostic messages", () => {
  const source = readFileSync(resolve(repositoryRoot, "packages/designer/src/catalog-core/check.ts"), "utf8");
  const variants = draftEnvelopes[1]!.bindings!.filter(binding => binding.kind === "finding");
  expect(variants).toHaveLength(62);
  for (const variant of variants) {
    const review = draftEnvelopes[1]!.reviews.find(row => row.recordId === variant.recordId)!;
    expect(source).toContain(`message: ${review.before}, copy: { id: "${variant.recordId}"`);
  }
  const actual = check({ catalog: smallCatalog, library: emptyLibrary() }).findings.filter(finding => finding.copy);
  expect(actual.length).toBeGreaterThan(0);
  for (const finding of actual) {
    const record = draftEnvelopes[1]!.records.find(row => row.id === finding.copy!.id)!;
    expect(record).toBeDefined();
    expect(Object.keys(finding.copy!.values ?? {}).sort()).toEqual((record.args ?? []).map(arg => arg.name).sort());
    expect(Object.values(finding.copy!.values ?? {}).every(value => ["string", "number", "boolean"].includes(typeof value))).toBe(true);
    expect(finding.message).not.toMatch(/^\[\[/);
  }
});
