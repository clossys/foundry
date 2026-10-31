import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCatalog } from "../catalog.js";
import { parseCell } from "../format/cell.js";
import { checkDirectorCell, checkDirectorCoverage, DIRECTOR_CHECKS, parseDownstream, runDirectorSuite } from "./checks.js";
import { runSlotCheckCli } from "./cli.js";
import { adaptDirectorContract, loadDirectorContracts } from "./format.js";

const contracts = loadDirectorContracts();
const catalog = loadCatalog();

function cellText(id: string, direction: string[], version = 1): string {
  return `---\nid: ${id}\nversion: ${version}\nstatus: draft\nupdated: 2026-10-30\ncites: []\nfeeds: []\nfunctions: []\n---\n\n## Direction\n${direction.map(b => `- ${b}`).join("\n")}\n\n## Because\n- Interviews with clinic owners in the launch regions.\n\n## Watch\n- If fewer than 5 trials start each month, then review.\n`;
}
function cell(id: string, direction: string[], version = 1) {
  const parsed = parseCell(cellText(id, direction, version), `cells/${id}/v${version}.md`);
  if (!parsed.ok) throw new Error(`${id}: ${parsed.issues.map(i => i.message).join("; ")}`);
  return parsed.value;
}

describe("Director slot contracts", () => {
  it("declares one contract per L3 strategy cell, keyed to the catalog's required keys", () => {
    expect(contracts.slots.map(s => s.id).sort()).toEqual(catalog.cells.map(c => c.id).sort());
    expect(contracts.slots).toHaveLength(57);
    for (const slot of contracts.slots) {
      const definition = catalog.cells.find(c => c.id === slot.id)!;
      expect(slot.limits.requiredKeys).toEqual(definition.mustContain.map(m => m.key));
      expect(slot.checkSuiteId).toBe("director.cell.v1");
      expect(slot.specimenKind).toBe("text");
      expect(slot.references.length).toBeGreaterThanOrEqual(1);
      for (const input of slot.inputs) expect(catalog.cells.some(c => `director:${c.id}` === input)).toBe(true);
    }
    expect(contracts.framework.layers).toEqual(catalog.ia.nodes.map(n => n.id));
  });

  it("rejects a contract missing a field from the shared list", () => {
    const { purpose: _purpose, ...rest } = contracts.slots[0]!;
    expect(() => adaptDirectorContract(rest)).toThrow(/purpose is required/);
    expect(() => adaptDirectorContract({ ...contracts.slots[0]!, references: [] })).toThrow(/reference/);
  });

  it("passes every good framework example and fails every bad one", () => {
    const goodFailures: string[] = []; const badPasses: string[] = [];
    for (const slot of contracts.slots) {
      const ref = slot.references[0]!;
      for (const f of checkDirectorCell(cell(slot.id, ref.good), slot)) goodFailures.push(`${slot.id}: ${f.check} ${f.message}`);
      if (checkDirectorCell(cell(slot.id, ref.bad), slot).length === 0) badPasses.push(slot.id);
    }
    expect(goodFailures).toEqual([]);
    expect(badPasses).toEqual([]);
  });

  it("mutation: an empty required field fails D-REQ", () => {
    const slot = contracts.slots.find(s => s.id === "context.market.size")!;
    const good = slot.references[0]!.good;
    expect(checkDirectorCell(cell(slot.id, good), slot)).toEqual([]);
    const mutated = good.map(b => b.startsWith("Method:") ? "Method: TBD" : b);
    const findings = checkDirectorCell(cell(slot.id, mutated), slot);
    expect(findings).toEqual([expect.objectContaining({ check: "D-REQ", key: "Method" })]);
    const dropped = checkDirectorCell(cell(slot.id, good.filter(b => !b.startsWith("Method:"))), slot);
    expect(dropped).toEqual([expect.objectContaining({ check: "D-REQ", key: "Method", message: expect.stringMatching(/missing/) })]);
  });

  it("flags generic filler under D-SPEC", () => {
    const slot = contracts.slots.find(s => s.id === "advantage.proposition.promise")!;
    const good = slot.references[0]!.good;
    const mutated = good.map((b, i) => i === 0 ? `${b} with a seamless, next-generation experience` : b);
    const findings = checkDirectorCell(cell(slot.id, mutated), slot);
    expect(findings.map(f => f.check)).toEqual(["D-SPEC", "D-SPEC"]);
  });

  it("computes D-COVER from downstream Writer and Designer citations", () => {
    const writer = (id: string, links: string[]) => `---\nid: ${id}\nversion: 1\nstatus: draft\nupdated: 2026-10-30\nlinks: [${links.join(", ")}]\nlocales: [en]\n---\n\n## en\n### ${id}.cta\n<!-- {"id":"ps.${id.replace(".", "-")}","leaf":"passages.call-to-action"} -->\n\`\`\`json\n{}\n\`\`\`\n`;
    const designer = `---\nid: sections.hero\nversion: 1\nstatus: draft\nupdated: 2026-10-30\nlinks: [director:advantage.proposition.promise@2]\noriginKinds: [authored]\nsources: []\n---\n`;
    const docs = [
      parseDownstream(writer("home.close", ["strategist:advantage.proposition.promise@2"]), "a.md"),
      parseDownstream(writer("pricing.close", ["advantage.proposition.promise@1"]), "b.md"),
      parseDownstream(writer("about.close", []), "c.md"),
      parseDownstream(designer, "d.md"),
    ];
    expect(docs.map(d => d.agent)).toEqual(["writer", "writer", "writer", "designer"]);
    const { findings, coverage } = checkDirectorCoverage([{ id: "advantage.proposition.promise", version: 2 }], docs);
    expect(coverage).toEqual([{ cell: "advantage.proposition.promise", version: 2, expected: 3, citing: 1, citers: 3, ratio: 1 / 3 }]);
    expect(findings.map(f => [f.check, f.path, /current is/.test(f.message) ? "stale" : "missing"])).toEqual([["D-COVER", "b.md", "stale"], ["D-COVER", "c.md", "missing"]]);
  });

  it("lists exactly three checks", () => {
    expect(DIRECTOR_CHECKS.map(c => c.id)).toEqual(["D-REQ", "D-SPEC", "D-COVER"]);
  });
});

describe("strategist-check slots", () => {
  it("reports findings as JSON, exits 0 by default and 1 with --strict", () => {
    const dir = mkdtempSync(join(tmpdir(), "director-slots-"));
    try {
      const slot = contracts.slots.find(s => s.id === "context.market.size")!;
      mkdirSync(join(dir, "cells", slot.id), { recursive: true });
      writeFileSync(join(dir, "cells", slot.id, "v1.md"), cellText(slot.id, slot.references[0]!.bad));
      const lines: string[] = [];
      expect(runSlotCheckCli([dir], l => lines.push(l))).toBe(0);
      const report = JSON.parse(lines[0]!);
      expect(report.suite).toBe("director.cell.v1");
      expect(report.counts.total).toBeGreaterThan(0);
      expect(runSlotCheckCli(["--strict", dir], () => {})).toBe(1);
      writeFileSync(join(dir, "cells", slot.id, "v1.md"), cellText(slot.id, slot.references[0]!.good));
      expect(runSlotCheckCli(["--strict", dir], () => {})).toBe(0);
      expect(runSlotCheckCli([], () => {})).toBe(2);
      const suite = runDirectorSuite({ cells: [{ path: "x.md", text: "not a cell" }] });
      expect(suite.findings[0]!.check).toBe("INPUT");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
