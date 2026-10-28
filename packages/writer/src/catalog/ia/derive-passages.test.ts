import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
// @ts-expect-error — the generator deliberately uses dependency-free JavaScript.
import { derivePassages, run } from "../../../scripts/derive-passages.mjs";

const fixture = () => ({
  ia: { layer: "sections", nodes: [{ id: "explain", label: "Explain", children: [{ id: "explain-reading", label: "Reading", leaves: ["sections.article", "sections.band"] }] }] },
  slots: [
    { id: "sections.article", layer: "sections", contract: { kind: "section", passageSchema: "passages.article", slots: [{ name: "irrelevant", type: "media" }], copy: {
      sourceLocale: "en", fields: [
        { key: "items[].heading", kind: "rich", required: true, maxLength: { en: 100, de: 120 }, dir: "auto", perLocale: true, repeat: { min: 1, max: 8 }, fields: [{ key: "label", kind: "icu", required: false }] },
        { key: "states.empty.heading", kind: "plain", required: true, maxLength: { en: 80 }, dir: "ltr" },
      ], states: { empty: { fields: [{ key: "heading", required: true, kind: "plain", limits: { en: 80 } }] } },
    } } },
    { id: "sections.band", layer: "sections", contract: { kind: "section", passageSchema: "passages.band", copy: { sourceLocale: "en", fields: [] } } },
  ],
});
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));

describe("passage derivation", () => {
  it("keeps every placement, including zero-field sections, and snapshots the complete declared schema", () => {
    const source = fixture();
    const before = structuredClone(source);
    const result = derivePassages(source.ia, source.slots);
    expect(result.ia).toEqual({ ...source.ia, layer: "passages", nodes: [{ ...source.ia.nodes[0], children: [{ ...source.ia.nodes[0]!.children[0], leaves: ["passages.article", "passages.band"] }] }] });
    expect(result.slots).toEqual(source.slots.map(section => ({
      id: section.contract.passageSchema, layer: "passages", contract: { kind: "passage", source: "writer", sectionId: section.id, passageSchema: section.contract.passageSchema, copy: section.contract.copy }, requires: [], status: "draft",
    })));
    expect(source).toEqual(before);
    result.slots[0].contract.copy.fields[0].maxLength.en = 1;
    result.slots[0].contract.copy.states.empty.fields[0].limits.en = 1;
    result.ia.nodes[0].children[0].leaves.push("passages.extra");
    expect(source).toEqual(before);
  });

  it.each([
    ["unknown placement", (s: ReturnType<typeof fixture>) => { s.ia.nodes[0]!.children[0]!.leaves.push("sections.unknown"); }],
    ["duplicate placement", (s: ReturnType<typeof fixture>) => { s.ia.nodes[0]!.children[0]!.leaves.push("sections.band"); }],
    ["wrong leaf prefix", (s: ReturnType<typeof fixture>) => { s.ia.nodes[0]!.children[0]!.leaves[0] = "passages.article"; }],
    ["missing placement", (s: ReturnType<typeof fixture>) => { s.ia.nodes[0]!.children[0]!.leaves.pop(); }],
    ["missing slots", (s: ReturnType<typeof fixture>) => { s.slots.pop(); }],
    ["duplicate slot", (s: ReturnType<typeof fixture>) => { s.slots.push(s.slots[0]!); }],
    ["wrong slot prefix", (s: ReturnType<typeof fixture>) => { s.slots[0]!.id = "passages.article"; }],
    ["wrong schema pairing", (s: ReturnType<typeof fixture>) => { s.slots[0]!.contract.passageSchema = "passages.band"; }],
    ["missing schema", (s: ReturnType<typeof fixture>) => { delete (s.slots[0]!.contract as { passageSchema?: string }).passageSchema; }],
    ["missing copy", (s: ReturnType<typeof fixture>) => { delete (s.slots[0]!.contract as { copy?: unknown }).copy; }],
    ["wrong IA layer", (s: ReturnType<typeof fixture>) => { s.ia.layer = "passages"; }],
    ["missing L2", (s: ReturnType<typeof fixture>) => { s.ia.nodes[0]!.children = []; }],
  ])("rejects %s", (_name, change) => {
    const source = fixture(); change(source);
    expect(() => derivePassages(source.ia, source.slots)).toThrow();
  });
});

describe("generator check mode", () => {
  function setup() {
    const dir = mkdtempSync(join(tmpdir(), "writer-passages-")); directories.push(dir);
    const paths = { sourceIa: join(dir, "sections-ia.json"), sourceSlots: join(dir, "sections-slots.json"), outputIa: join(dir, "passages-ia.json"), outputSlots: join(dir, "passages-slots.json") };
    const source = fixture();
    writeFileSync(paths.sourceIa, JSON.stringify(source.ia)); writeFileSync(paths.sourceSlots, JSON.stringify(source.slots));
    const log: string[] = [];
    const invoke = (args: string[]) => run({ args, paths, stdout: (s: string) => log.push(s), stderr: (s: string) => log.push(s) });
    return { paths, source, invoke, log };
  }
  it("generates canonical JSON then checks exact bytes without writing", () => {
    const { paths, invoke } = setup();
    expect(invoke([])).toBe(0);
    const originalIa = readFileSync(paths.outputIa, "utf8"), originalSlots = readFileSync(paths.outputSlots, "utf8");
    expect(originalIa.endsWith("\n")).toBe(true);
    expect(invoke(["--check"])).toBe(0);
    expect(readFileSync(paths.outputIa, "utf8")).toBe(originalIa);
    expect(readFileSync(paths.outputSlots, "utf8")).toBe(originalSlots);
  });
  it.each(["outputIa", "outputSlots"] as const)("detects byte-only drift in %s without rewriting either file", key => {
    const { paths, invoke } = setup(); expect(invoke([])).toBe(0);
    writeFileSync(paths[key], JSON.stringify(JSON.parse(readFileSync(paths[key], "utf8"))));
    const before = [readFileSync(paths.outputIa, "utf8"), readFileSync(paths.outputSlots, "utf8")];
    expect(invoke(["--check"])).toBe(1);
    expect([readFileSync(paths.outputIa, "utf8"), readFileSync(paths.outputSlots, "utf8")]).toEqual(before);
  });
  it("reports absent generated files as stale", () => {
    const { invoke } = setup(); expect(invoke(["--check"])).toBe(1);
  });
  it("distinguishes invalid source and arguments from stale output without rewriting", () => {
    const { paths, source, invoke } = setup(); expect(invoke([])).toBe(0);
    const before = readFileSync(paths.outputSlots, "utf8");
    expect(invoke(["--unknown"])).toBe(2);
    expect(invoke(["--check", "--check"])).toBe(2);
    source.slots[0]!.contract.passageSchema = "passages.wrong";
    writeFileSync(paths.sourceSlots, JSON.stringify(source.slots));
    expect(invoke(["--check"])).toBe(2);
    expect(invoke([])).toBe(2);
    expect(readFileSync(paths.outputSlots, "utf8")).toBe(before);
  });
  it("checks the repository outputs through the guarded CLI", () => {
    const result = spawnSync(process.execPath, [new URL("../../../scripts/derive-passages.mjs", import.meta.url).pathname, "--check"], { encoding: "utf8" });
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });
});
