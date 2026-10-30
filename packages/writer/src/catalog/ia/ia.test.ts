import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createWriterIAReport, loadWriterCatalog, writerIAFindings, type WriterCatalog } from "./index.js";
import { mainWriterIA } from "./cli.js";
import type { WriterLeafFreezeSnapshot } from "../../catalog-core/leaf-freeze.js";

const sample = (): WriterCatalog => ({
  placements: [{ layer: "strings", nodes: [{ id: "interface", label: "Interface", children: [{ id: "actions", label: "Actions", leaves: ["strings.actions"] }] }] }],
  slots: [{ id: "strings.actions", layer: "strings", status: "draft", requires: [], contract: { kind: "string", source: "writer", maxChars: 48, icu: true } }],
});
const snapshot: WriterLeafFreezeSnapshot = {
  schemaVersion: 1, layer: "strings", scope: "leaf-membership-only", signedHead: null,
  ownerSignoffComment: null, policy: "Proposed membership; not an owner signature.", leafIds: ["strings.actions"],
};

describe("Writer IA structure and reporting", () => {
  it("reports an unsigned candidate without claiming owner approval", () => {
    const report = createWriterIAReport(sample(), ["strings"], [snapshot]);
    expect(report.findings).toEqual([]);
    expect(report.leafCounts).toEqual({ strings: 1 });
    expect(report.layers[0]).toMatchObject({ layer: "strings", count: 1, freeze: { status: "proposed", signedHead: null, ownerSignoffComment: null } });
    expect(report.layers[0]!.contracts[0]).toMatchObject({ id: "strings.actions", contract: { source: "writer", maxChars: 48 } });
  });
  it("rejects duplicate slots, duplicate placement and unplaced slots", () => {
    const catalog = sample();
    catalog.slots.push(structuredClone(catalog.slots[0]!));
    const family = catalog.placements[0]!.nodes[0]!;
    if (!("children" in family)) throw new Error("expected group");
    family.children.push({ id: "duplicate", label: "Duplicate", leaves: ["strings.actions", "strings.missing"] });
    catalog.slots.push({ ...catalog.slots[0]!, id: "strings.unplaced" });
    const messages = writerIAFindings(catalog, ["strings"]).map(f => f.message).join("\n");
    expect(messages).toContain("duplicate slot strings.actions");
    expect(messages).toContain("strings.actions appears 2 times");
    expect(messages).toContain("unknown leaf strings.missing");
    expect(messages).toContain("unplaced slot strings.unplaced");
  });
  it("rejects empty layers, cross-layer ids and non-Writer sources", () => {
    expect(writerIAFindings({ placements: [], slots: [] }, ["strings"])).not.toEqual([]);
    const catalog = sample();
    catalog.slots[0]!.id = "patterns.actions";
    catalog.slots[0]!.contract.source = "handwritten";
    const messages = writerIAFindings(catalog, ["strings"]).map(f => f.message).join("\n");
    expect(messages).toContain("invalid strings slot patterns.actions");
    expect(messages).toContain("source must be writer");
  });
  it("rejects ambiguous IA nodes instead of ignoring their leaf branch", () => {
    const catalog = sample();
    Object.assign(catalog.placements[0]!.nodes[0]!, { leaves: ["strings.actions"] });
    expect(writerIAFindings(catalog, ["strings"]).some(f => f.message.includes("exactly one of children or leaves"))).toBe(true);
  });
  it("reports all five shipped layers, keeps layers 4/5 unfrozen, and never changes input", () => {
    const catalog = loadWriterCatalog();
    const before = JSON.stringify(catalog);
    const report = createWriterIAReport(catalog);
    expect(report.findings).toEqual([]);
    expect(report.layers.map(row => row.layer)).toEqual(["lexicon", "strings", "patterns", "passages", "narratives"]);
    expect(report.leafCounts).toMatchObject({ strings: 22, patterns: 24, narratives: 12 });
    expect(report.leafCounts.passages).toBeGreaterThan(0);
    expect(report.layers.slice(3).map(row => row.freeze.status)).toEqual(["unfrozen", "unfrozen"]);
    expect(JSON.stringify(catalog)).toBe(before);
  });
});

describe("writer-check ia", () => {
  const invoke = (args: string[], load = loadWriterCatalog) => {
    const stdout: string[] = [], stderr: string[] = [];
    const exit = mainWriterIA(args, { stdout: value => stdout.push(value), stderr: value => stderr.push(value) }, load);
    return { exit, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
  };
  it("accepts the exact checkpoint arguments and emits tree, contracts, counts and owner-signed status", () => {
    const result = invoke(["--layers", "lexicon,strings,patterns", "--format", "json"]);
    expect(result.exit).toBe(0);
    expect(result.stderr).toBe("");
    const report = JSON.parse(result.stdout);
    expect(report.layers.map((row: { layer: string }) => row.layer)).toEqual(["lexicon", "strings", "patterns"]);
    expect(report.layers.every((row: { tree: unknown[]; contracts: unknown[]; freeze: { status: string } }) => row.tree.length > 0 && row.contracts.length > 0 && row.freeze.status === "owner-signed")).toBe(true);
  });
  it("prints the complete tree and contracts by default", () => {
    const result = invoke([]);
    expect(result.exit).toBe(0);
    for (const id of ["lexicon.formality", "strings.actions", "patterns.error-message", "passages.band", "narratives.page-story"]) expect(result.stdout).toContain(id);
    expect(result.stdout).toContain("owner-signed");
    expect(result.stdout).toContain("unfrozen");
    expect(result.stdout).toContain('"source":"writer"');
  });
  it.each([["--layers", ""], ["--layers", "strings,strings"], ["--layers", "unknown"], ["--format", "yaml"], ["--format"], ["--unknown"]])("returns 2 for invalid arguments %j", (...args) => {
    expect(invoke(args).exit).toBe(2);
  });
  it("returns 1 for actual membership drift and 2 when inputs cannot load", () => {
    const catalog = loadWriterCatalog();
    catalog.slots = catalog.slots.filter(slot => slot.id !== "strings.actions");
    const drift = invoke(["--layers", "strings", "--format", "json"], () => catalog);
    expect(drift.exit).toBe(1);
    expect(JSON.parse(drift.stdout).findings.length).toBeGreaterThan(0);
    expect(invoke([], () => { throw new Error("unreadable input"); }).exit).toBe(2);
  });
  it("reaches IA through the shipped writer-check entry point", () => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("../../../dist/cli.js", import.meta.url)), "ia", "--layers", "lexicon,strings,patterns", "--format", "json"], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).leafCounts).toEqual({ lexicon: 27, strings: 22, patterns: 24 });
  });
});
