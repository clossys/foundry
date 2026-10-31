import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkCoverage } from "./check.js";
import { loadCoverageInput } from "./load.js";
import { fixture, layers } from "./__fixtures__/catalog.js";
const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });
function setup() {
  const root = mkdtempSync(join(tmpdir(), "ia-adapters-")); temporary.push(root);
  const catalog = join(root, "designer"), writer = join(root, "writer"), publisher = join(root, "publisher.json"), checks = join(root, "checks.json");
  const write = (path: string, data: unknown) => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, JSON.stringify(data, null, 2)); };
  const base = fixture();
  for (const layer of layers) {
    const contract = layer === "sections" ? { passageSchema: "passages.example", parts: ["components.example"] } : layer === "frames" ? { composes: ["sections.example", "assets.example"] } : { allowedReads: { themes: ["tokens.example"] } };
    write(join(catalog, "slots", `${layer}.json`), [{ id: `${layer}.example`, layer, contract }]);
    write(join(catalog, "ia", `${layer}.json`), base.placements.find(row => row.layer === layer));
    write(join(catalog, "fills", "fixture", `${layer}.json`), { $extensions: { "com.clossys.fill": { id: `fixture/${layer}.example`, slot: `${layer}.example`, status: "stable" } } });
  }
  write(join(writer, "slots/passages.json"), [{ id: "passages.example", contract: { sectionId: "sections.example" } }]);
  write(join(writer, "records/en.json"), { records: [{ id: "st.example", text: "Fixture copy is not included in the audit report" }] });
  const routes = ["/agents/designer", "/agents/writer", "/agents/publisher", "/marketing"];
  write(publisher, { slots: routes.map((route, index) => ({ id: `slot-${index}`, route, activeCandidateId: `candidate-${index}` })), candidates: routes.map((_, index) => ({
    id: `candidate-${index}`, slotId: `slot-${index}`, composition: { frame: { frameId: "frames.example" }, sections: [{ sectionId: "sections.example", fields: [{ source: "writer", ref: { id: "st.example" } }] }] },
  })) });
  return { catalog, writer, publisher, checks, write };
}
describe("read-only catalog adapters", () => {
  it("joins real schema owners and CopyRefs while limiting Publisher to the three admin pages", () => {
    const { catalog, writer, publisher } = setup();
    const input = loadCoverageInput({ catalogRoot: catalog, writerCatalogRoot: writer, publisherInput: publisher });
    expect(input.edges).toContainEqual({ from: "sections.example", to: "writer:passages.example", evidence: "section-copy-schema" });
    expect(input.edges).toContainEqual({ from: "writer:passages.example", to: "sections.example", evidence: "writer-schema-owner", kind: "describes" });
    expect(input.edges).toContainEqual({ from: "publisher:content/candidate-0", to: "writer:st.example", evidence: "publisher-copy-ref" });
    expect(input.external?.some(node => node.id.includes("candidate-3") || node.id.includes("slot-3"))).toBe(false);
    expect(checkCoverage(input).summary.cycles).toEqual([]);
    expect(checkCoverage(input).summary.dangling).toEqual([]);
  });
  it("names a missing Writer passage as dangling rather than inventing a registration", () => {
    const { catalog, writer, write } = setup(); write(join(writer, "slots/passages.json"), []);
    const report = checkCoverage(loadCoverageInput({ catalogRoot: catalog, writerCatalogRoot: writer }));
    expect(report.findings.filter(row => row.code === "IA-DANGLING-REF")).toEqual([expect.objectContaining({ subject: "sections.example", target: "writer:passages.example", priority: "P0" })]);
  });
  it("reports unavailable cross-package input as unresolved, not a proven missing registration", () => {
    const { catalog, writer } = setup(); rmSync(writer, { recursive: true });
    const report = checkCoverage(loadCoverageInput({ catalogRoot: catalog, writerCatalogRoot: writer }));
    expect(report.summary.dangling).toEqual([]);
    expect(report.summary.unresolved).toContainEqual({ from: "sections.example", to: "writer:passages.example" });
    expect(report.basis.adminInputsComplete).toBe(false);
  });
  it("keeps permission declarations out of the usage graph", () => {
    const { catalog, writer } = setup();
    const input = loadCoverageInput({ catalogRoot: catalog, writerCatalogRoot: writer });
    expect(input.edges.some(edge => edge.from === "components.example" && edge.to === "tokens.example")).toBe(false);
  });
  it("only advances fill state using execution results bound to the actual file bytes", () => {
    const { catalog, writer, checks, write } = setup();
    const path = join(catalog, "fills/fixture/components.json"), hash = `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
    write(checks, [{ fillId: "fixture/components.example", sourceHash: hash, results: [{ code: "synthetic-schema-check", passed: true }] }]);
    const input = loadCoverageInput({ catalogRoot: catalog, writerCatalogRoot: writer, checksInput: checks });
    expect(checkCoverage(input).leaves.find(row => row.id === "components.example")!.state).toBe("checked");
    writeFileSync(path, readFileSync(path, "utf8") + "\n");
    expect(checkCoverage(loadCoverageInput({ catalogRoot: catalog, writerCatalogRoot: writer, checksInput: checks })).leaves.find(row => row.id === "components.example")!.state).toBe("draft");
  });
  it("refuses malformed results instead of dropping an invalid entry beside a passed check", () => {
    const { catalog, writer, checks, write } = setup();
    write(checks, [{ fillId: "fixture/components.example", sourceHash: "sha256:" + "0".repeat(64), results: [{ code: "fixture", passed: true }, false] }]);
    expect(() => loadCoverageInput({ catalogRoot: catalog, writerCatalogRoot: writer, checksInput: checks })).toThrow("Malformed check result");
  });

});
