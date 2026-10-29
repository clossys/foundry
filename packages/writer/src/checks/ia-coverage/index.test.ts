import { describe, expect, it } from "vitest";
import { checkIACoverage } from "./index.js";
import { fixture } from "./__fixtures__/catalog.js";
import { writerRecordFingerprint } from "../approval.js";
import { COPY_FINGERPRINT_ALGORITHM } from "../../fingerprint.js";
import type { StringRecord, WriterLibrary } from "../../model/types.js";

describe("bottom-up Writer IA coverage", () => {
  it("walks L3 to L0, derives absent despite a draft declaration, and tags actual incoming consumers", () => {
    const input = { ...fixture() }, before = structuredClone(input), report = checkIACoverage(input);
    expect(report.summary.levels).toEqual({ L0: 1, L1: 1, L2: 1, L3: 1 });
    expect(report.leaves[0]).toMatchObject({ id: "strings.labels", state: "absent", adminPage: true, priority: "P1", usedBy: ["publisher:example"] });
    expect(report.summary.states).toEqual({ absent: 1, draft: 0, checked: 0, approved: 0 });
    expect(input).toEqual(before);
  });
  it("emits one named missing-leaf P0 for a tree leaf without a registered slot", () => {
    const input = { ...fixture() }; input.catalog.slots = [];
    expect(checkIACoverage(input).findings.filter(row => row.code === "missing-leaf")).toEqual([expect.objectContaining({ subject: "strings.labels", priority: "P0" })]);
  });
  it("emits one named dangling-reference P0 for an unresolved dependency", () => {
    const input = { ...fixture() }; input.catalog.slots[0]!.requires = ["strings.missing"];
    expect(checkIACoverage(input).findings.filter(row => row.code === "dangling-reference")).toEqual([expect.objectContaining({ priority: "P0", subject: "strings.labels" })]);
  });
  it("emits one named orphan with no consumer, and never infers admin usage from a leaf's name", () => {
    const input = { ...fixture() }; input.connections = { nodes: [], adminRoots: [], completeAdminGraph: true };
    const report = checkIACoverage(input);
    expect(report.orphans).toEqual(["strings.labels"]);
    expect(report.findings.filter(row => row.code === "orphan")).toEqual([expect.objectContaining({ priority: "P2" })]);
    expect(report.leaves[0]!.adminPage).toBe(false);
    expect(checkIACoverage({ ...input, connections: undefined }).leaves[0]!.adminPage).toBeNull();
  });
  it("checks both schema peers without treating the reverse index as a consumption cycle", () => {
    const input = { ...fixture() };
    input.catalog.slots.push({ id: "passages.example", layer: "passages", status: "draft", requires: ["strings.labels"], contract: { kind: "passage", source: "writer", sectionId: "sections.example", passageSchema: "passages.example", copy: { sourceLocale: "en", fields: [] } } });
    input.catalog.placements.push({ layer: "passages", nodes: [{ id: "pages", label: "Pages", children: [{ id: "example", label: "Example", leaves: ["passages.example"] }] }] });
    input.designer = { slots: [{ id: "sections.example", contract: { kind: "section", passageSchema: "passages.example" } }] };
    const report = checkIACoverage(input);
    expect(report.pairs).toEqual([{ section: "sections.example", passage: "passages.example", resolved: true }]);
    expect(report.leaves.find(row => row.id === "passages.example")!.usedBy).toEqual(["sections.example"]);
    expect(report.cycles).toEqual([]);
    input.designer = { slots: [{ id: "sections.example", contract: { kind: "section", passageSchema: "passages.other" } }] };
    expect(checkIACoverage(input).findings.some(row => row.code === "schema-pair")).toBe(true);
  });
  it("flags cycles and registered leaves outside the tree", () => {
    const input = { ...fixture() };
    input.catalog.slots[0]!.requires = ["strings.labels"];
    input.catalog.slots.push({ ...input.catalog.slots[0]!, id: "strings.outside", requires: [] });
    const report = checkIACoverage(input);
    expect(report.cycles).toEqual([["strings.labels"]]);
    expect(report.findings.filter(row => row.code === "outside-tree")).toHaveLength(1);
  });
  it("observes shipped samples as draft without inferring checked or owner-approved state", () => {
    const input = fixture();
    const record: StringRecord = { id: "st.0000000001", leaf: "strings.labels", context: "Example", status: "approved", origin: "authored", text: "Example" };
    const report = checkIACoverage({ ...input, catalogRecords: [{ locale: "en", records: [record] }] });
    expect(report.leaves[0]!.state).toBe("draft");
    expect(report.leaves[0]!.records[0]!.reasons).toContain("Catalog sample only; no consumer manifest/validation/approval context");
  });
  it("flags ambiguous record identities instead of choosing a target", () => {
    const record: StringRecord = { id: "st.0000000001", leaf: "strings.labels", context: "Example", status: "draft", origin: "authored", text: "Example" };
    const report = checkIACoverage({ ...fixture(), catalogRecords: [{ locale: "en", records: [record, { ...record }] }] });
    expect(report.findings.filter(row => row.code === "duplicate-record")).toHaveLength(1);
  });
  it("resolves standards clauses from the published catalog and flags unknown clauses", () => {
    const input = { ...fixture(), designer: { slots: [{ id: "tokens.example", contract: {}, requires: ["dtcg#format", "dtcg#missing"] }], standards: [{ id: "dtcg", clauses: [{ id: "format" }] }] } };
    expect(checkIACoverage(input).dangling.map(row => row.to)).toEqual(["dtcg#missing"]);
  });
  it("derives checked/approved only from valid records and fresh owner fingerprints; mixed locales use the weakest state", () => {
    const input = { ...fixture() };
    const record: StringRecord = { id: "st.0000000001", leaf: "strings.labels", context: "Example", status: "draft", origin: "authored", text: "Example" };
    const library: WriterLibrary = { manifest: { consumer: "example", messageSyntax: "icu-mf1", defaultLocale: "en", locales: [{ tag: "en", dir: "ltr", state: "active" }], fallback: {}, strategy: { root: "strategy", contract: "writer.messaging" }, leafFreeze: { lexicon: "", strings: "", patterns: "", passages: "", narratives: "" } }, locales: { en: { records: [record], documents: [] } } };
    const row = () => checkIACoverage({ ...input, library }).leaves[0]!;
    expect(row().state).toBe("checked");
    record.status = "approved";
    expect(row().state).toBe("draft");
    record.approval = { approvedBy: "owner", approvedAt: "2026-09-01T00:00:00.000Z", textFingerprint: writerRecordFingerprint(record, [record]), fingerprintAlgorithm: COPY_FINGERPRINT_ALGORITHM };
    expect(row().state).toBe("approved");
    const translated: StringRecord = { ...record, status: "draft" };
    delete translated.approval;
    library.locales.fr = { records: [translated], documents: [] };
    library.manifest.locales.push({ tag: "fr", dir: "ltr", state: "active" });
    expect(row().state).toBe("checked");
    delete library.locales.fr;
    library.manifest.locales.pop();
    record.text = "Changed";
    expect(row().state).toBe("draft");
  });
});
