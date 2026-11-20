/**
 * foundry-build-0048 Unit A (B1 r5, owner decision 2026-11-20 "allow originals"): the component standard's source.ref
 * now admits `original`, so a consumer-supplied original passes the standard in any component slot; the provenance
 * rule still confines an original to the consumer-asset slots. Everything is read from the shipped files (the
 * component standard's requirements.json, catalog/rules/provenance.json and references/manifest.json), never a
 * stand-in, so widening the standard cannot quietly widen where an original may live: an original in
 * components.badge (not a consumer-asset slot) stays red under R03.2 lineage and ref-verbatim REF-NO-SOURCE.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkRegistryItem } from "@clossys/designer/ref-verbatim";
import { sourceRef } from "../criteria/designer/3s-des/source.js";
import { candidateLineage, lineageFindings, resolveProvenanceRule, type ProvenanceRule, type ReferenceManifest } from "./source.js";

const DESIGNER = new URL("../../../../designer/", import.meta.url);
const FIXTURE = fileURLToPath(new URL("../../../test-fixtures/consumer/", import.meta.url));
const json = <T = unknown>(rel: string): T => JSON.parse(readFileSync(new URL(rel, DESIGNER), "utf8")) as T;

const standard = json<{ requirements: { check: string; params: Record<string, unknown> }[] }>("standards/component/requirements.json");
const params = standard.requirements.find(requirement => requirement.check === "source.ref")!.params;
const rule = resolveProvenanceRule(json<ProvenanceRule>("src/catalog/rules/provenance.json"), rel => json(rel));
const manifest = json<ReferenceManifest>("references/manifest.json");

/** A consumer-supplied original component candidate for `slot`. */
const original = (slot: string) => {
  const leaf = slot.split(".").at(-1)!;
  return {
    name: leaf,
    type: "registry:ui",
    files: [{ path: `ui/${leaf}.tsx`, type: "registry:ui", content: `export const Original = () => null;\n` }],
    meta: { slot, source: { kind: "original", ref: [], license: "MIT" } },
  };
};
const subject = (slot: string) => ({ kind: "element/component", text: "", json: original(slot) });

describe("D1: the component standard admits an original, provenance keeps it to consumer-asset slots", () => {
  it("source.ref takes kind original (the owner-approved standard change)", () => {
    expect(params.kinds).toContain("original");
    expect(sourceRef(subject("components.badge"), params)).toEqual([]);
    expect(sourceRef(subject("components.logo"), params)).toEqual([]);
  });

  it("R03.2 lineage: an original passes in components.logo and components.semantic-content, and fails in components.badge", () => {
    expect(rule.consumerAssets?.slots).not.toContain("components.badge");
    for (const slot of ["components.logo", "components.semantic-content"]) {
      expect(lineageFindings(slot, candidateLineage(slot, original(slot))!, { rule, manifest })).toEqual([]);
    }
    expect(lineageFindings("badge", candidateLineage("components.badge", original("components.badge"))!, { rule, manifest })).toEqual([
      expect.stringMatching(/original item in components\.badge, which is not a consumer-asset slot/),
    ]);
  });

  it("ref-verbatim: an original in components.badge fails REF-NO-SOURCE; in components.logo it is exempt", () => {
    const badge = checkRegistryItem(FIXTURE, "components.badge", original("components.badge"), { strict: true });
    expect(badge.status).toBe("fail");
    expect(badge.findings).toContainEqual(expect.objectContaining({ code: "REF-NO-SOURCE", detail: "original code in components.badge, which is not a consumer-asset slot" }));
    const logo = checkRegistryItem(FIXTURE, "components.logo", original("components.logo"), { strict: true });
    expect(logo.findings ?? []).not.toContainEqual(expect.objectContaining({ code: "REF-NO-SOURCE" }));
    expect(logo.status).toBe("exempt");
  });
});
