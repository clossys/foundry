import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveSlots, runSlotResolve, slotResolveSummary, type SlotCandidate, type SlotStore } from "./slot-resolve.js";
import { emptySelection, pin, unpin, writeSelection } from "../records/selection.js";
import { parseArgs } from "../cli/args.js";

const hash = `sha256:${"a".repeat(64)}`;
const candidate = (): SlotCandidate => ({ id: "synthetic/v1", hash, schemaIssues: [], copyKeys: ["site.synthetic.title"], source: { kind: "original", hash } });
const store = (agent: SlotStore["agent"] = "designer"): SlotStore => ({ agent, ia: ["sections.synthetic"], iaSource: "synthetic", candidates: { "sections.synthetic": [candidate()] }, pins: { "sections.synthetic": [{ id: "synthetic/v1", hash }] } });
const writer = () => new Map([["site.synthetic.title", ["A synthetic title"]]]);
const codes = (input: SlotStore, strings = writer()) => resolveSlots([input], strings, new Map())[0]!.findings.map(row => row.code);

describe("uniform slot resolution", () => {
  it.each(["director", "designer", "writer", "publisher"] as const)("applies the identical rule to %s", agent => {
    expect(codes(store(agent))).toEqual([]);
    const mutated = store(agent); mutated.pins = {};
    expect(codes(mutated)).toEqual(["no-pin"]);
  });
  it("reports missing candidates, missing files and multiple pins without collapsing slot rows", () => {
    const input = store(); input.candidates = {};
    expect(codes(input)).toEqual(["no-candidate", "pin-missing-file"]);
    input.pins["sections.synthetic"]!.push({ id: "missing" });
    expect(codes(input)).toContain("multi-pin");
    expect(resolveSlots([input], writer(), new Map())).toHaveLength(1);
  });
  it("checks real bytes, schemas and source evidence, without manufacturing legacy hashes", () => {
    const input = store(); const c = input.candidates["sections.synthetic"]![0]!;
    delete input.pins["sections.synthetic"]![0]!.hash;
    c.schemaIssues = ["Synthetic schema failure"]; c.source = { kind: "derived", ref: "synthetic:origin" };
    expect(codes(input)).toEqual(["hash-drift", "schema", "no-source", "source-ref-unknown"]);
    c.source = { kind: "registry", ref: "synthetic/item@1", hash };
    expect(codes(input)).toContain("source-ref-unknown");
    expect(resolveSlots([input], writer(), new Map([["synthetic/item@1", hash]]))[0]!.findings.map(row => row.code)).not.toContain("source-ref-unknown");
  });
  it("reports inverse orphan candidates and all named copy failures", () => {
    const input = store(); input.ia = [];
    expect(codes(input)).toEqual(["not-in-ia", "orphan-candidate"]);
    expect(codes(store(), new Map())).toEqual(["copy-missing-key"]);
    for (const value of ["", "TODO: fill", "lorem ipsum", "site.synthetic.title", "title"]) {
      expect(codes(store(), new Map([["site.synthetic.title", [value]]]))).toEqual(["copy-empty"]);
    }
  });
  it("mutation proof: unpinning one native fixture slot is reported", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "synthetic-slot-report-")));
    try {
      const slot = "components.button";
      const fixture = fileURLToPath(new URL("../specimen/__fixtures__/library/components.button/sample-button/v1/", import.meta.url));
      const dir = join(root, "library", slot, "sample-button", "v1");
      mkdirSync(dir, { recursive: true }); cpSync(fixture, dir, { recursive: true });
      const element = JSON.parse(readFileSync(join(dir, "element.json"), "utf8"));
      const selected = pin(emptySelection(), { element, at: "2026-10-30T00:00:00Z", by: "synthetic" });
      writeSelection(root, selected);
      const baseline = (await runSlotResolve(root)).rows.find(row => row.agent === "designer" && row.slot === slot)!;
      expect(baseline.status).toBe("satisfied");
      writeSelection(root, unpin(selected, slot, { at: "2026-10-31T00:00:00Z", by: "synthetic" }));
      const mutated = await runSlotResolve(root);
      const row = mutated.rows.find(row => row.agent === "designer" && row.slot === slot)!;
      expect(row.findings.map(finding => finding.code)).toEqual(["no-pin"]);
      expect(mutated.exitCode).toBe(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 20_000);
  it("keeps strict informational and unreadable inputs visible with exit zero", async () => {
    expect(parseArgs(["check", "--slots", "--strict"])).toMatchObject({ slots: true, strict: true });
    expect(() => parseArgs(["publish", "--slots"])).toThrow(/require check/);
    const report = await runSlotResolve("missing-synthetic-consumer");
    expect(report).toMatchObject({ reportOnly: true, exitCode: 0, verdict: "indeterminate" });
    expect(report.findings.length).toBeGreaterThan(0);
    expect(slotResolveSummary(report)).toContain("report only");
  });
});
