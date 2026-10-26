/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { libraryFiles, readLibrary, writeCompositeLibrary } from "./fs-library.js";
import { runApplyDecisions } from "./library-apply-decisions.js";
import { componentIntegration } from "../catalog-core/__fixtures__/component-integration.js";
import { synthetic, syntheticSource } from "../catalog-core/__fixtures__/component-engine/synthetic.js";
import { isLibraryDecisions, type LibraryDecision } from "../catalog-core/library-decisions.js";
import { compositeLibraryHash, checkComposite } from "../catalog-core/library-components.js";
import { flatten } from "../catalog-core/model.js";
import { tokenContent } from "../catalog-core/library.js";
import { applyDecisions, decisionChangeSet, materializeDecisionBundles } from "./apply-decisions.js";
import type { CompositeCatalogData, CompositeLibraryData } from "../catalog-core/types.js";

/** Existing synthetic observations only; this corpus proves plumbing, never runtime conformance. */
function sixRows() {
  const input = componentIntegration();
  const valueRows = ["tokens.text-color", "tokens.surface-color", "tokens.focus-color"].map(slot => {
    const fill = input.library.values.fills.find(doc => doc.$extensions["com.clossys.fill"].slot === slot)!;
    return { slot, kind: "author" as const, value: Object.fromEntries(Object.entries(flatten(fill)).map(([id, token]) => [id.slice(slot.length + 1), tokenContent(token)])), note: "Synthetic fixture literal" };
  });
  input.catalog.values = { ...input.catalog.values, rules: [{ id: "synthetic-body@1", slot: "tokens.body-size", inputs: ["tokens.control-size.mark"], values: { default: tokenContent(flatten(input.library.values.fills.find(doc => doc.$extensions["com.clossys.fill"].slot === "tokens.body-size")!)["tokens.body-size.default"]!) } }] };
  const rows: LibraryDecision[] = [...valueRows,
    { slot: "tokens.control-size", kind: "adopt", source: "foundry", note: "Synthetic candidate" },
    { slot: "tokens.body-size", kind: "derive", rule: "synthetic-body@1", reads: ["tokens.control-size.mark"], note: "Synthetic registered rule" },
    { slot: "components.button", kind: "adopt", source: "test-kit", fill: "test-kit/components.button", note: "Synthetic package pointer" },
  ];
  return { ...input, rows };
}

function componentsOnly(source = false) {
  const fixture = source ? syntheticSource() : synthetic();
  const catalog: CompositeCatalogData = { values: { slots: [], fills: [], sources: [], standards: [], placements: [], retired: [] }, components: fixture.catalog };
  const { source: consumer, adoptedAt, ...components } = fixture.library;
  const library: CompositeLibraryData = { source: consumer, adoptedAt, values: { fills: [] }, components };
  return { fixture, catalog, library };
}

describe("offline library decisions", () => {
  it("validates closed rows, layer kinds, unique slots and safe member/file names", () => {
    const { rows } = sixRows();
    expect(isLibraryDecisions(rows)).toBe(true);
    for (const bad of [[...rows, rows[0]], [{ ...rows[0], typo: true }], [{ ...rows[0], note: "" }], [{ slot: "tokens.body-size", kind: "compose", rule: "x", reads: [], note: "x" }], [{ slot: "tokens.body-size", kind: "author", value: { constructor: { $type: "number", $value: 1 } }, note: "x" }]]) expect(isLibraryDecisions(bad)).toBe(false);
    expect(isLibraryDecisions([{ ...rows[0], kind: "remove" }])).toBe(false);
  });
  it("builds one six-operation changeset, checks the synthetic result, and reapplies with an identical hash", () => {
    const { catalog, library, rows, componentOptions } = sixRows();
    expect(rows).toHaveLength(6);
    expect(decisionChangeSet(catalog, library, rows).changes).toHaveLength(6);
    const result = applyDecisions(catalog, library, rows);
    expect(checkComposite({ catalog, library: result, componentOptions }).findings.filter(finding => finding.severity === "error")).toEqual([]);
    expect(checkComposite({ catalog, library: result, componentOptions }).ok).toBe(true);
    expect(compositeLibraryHash(applyDecisions(catalog, result, rows))).toBe(compositeLibraryHash(result));
    expect(result.components.fills[0]!.components.button!.origin.kind).toBe("adopted");
    expect(library.components.fills).toEqual([]);
  });
  it("authors a component and composes/derives using only registered rules with exact reads", () => {
    const { fixture, catalog, library } = componentsOnly();
    const author: LibraryDecision = { slot: "components.button", kind: "author", fill: fixture.candidate, files: [], note: "Synthetic author" };
    const authored = applyDecisions(catalog, library, [author]);
    expect(authored.components.fills[0]!.components.button!.origin.kind).toBe("authored");
    expect(authored.components.fills[0]!.$extensions["com.clossys.fill"].evidence).toEqual([]);
    for (const kind of ["compose", "derive"] as const) {
      const slot = "components.select";
      const extended = { ...catalog, components: { ...catalog.components, slots: [...catalog.components.slots, { ...catalog.components.slots[0]!, id: slot }], rules: [{ id: `synthetic-${kind}@1`, kind, slot, inputs: ["components.button"], template: { ...fixture.candidate, slot, reads: { ...fixture.candidate.reads, components: ["components.button"] }, composes: ["components.button"] }, files: [] }] } };
      const row = { slot, kind, rule: `synthetic-${kind}@1`, reads: ["components.button"], note: "Synthetic rule" };
      const result = applyDecisions(extended, authored, [row]);
      expect(result.components.fills.find(doc => doc.components.select)!.components.select!.origin.kind).toBe(kind === "compose" ? "composed" : "derived");
      expect(() => applyDecisions(extended, authored, [{ ...row, reads: [] }])).toThrow(/reads differ/);
      expect(() => applyDecisions(extended, authored, [{ ...row, rule: "missing" }])).toThrow(/rule/);
    }
  });
  it("materializes supplied offline bytes with the existing verifier, rejecting tampered upstream/output and missing transforms", async () => {
    const { fixture, catalog, library } = componentsOnly(true);
    if (!("upstream" in fixture)) throw new Error("source fixture expected");
    const rows = [{ slot: "components.button", kind: "adopt", source: "test-kit", note: "Synthetic offline source" }];
    const sources = [{ slot: "components.button", source: "test-kit", upstream: [fixture.upstream] }];
    const transforms = [{ id: "synthetic@1", run: () => ({ files: [fixture.file, fixture.notice], blockers: [] }) }];
    const bundles = await materializeDecisionBundles(catalog, rows, { sources, transforms });
    expect(applyDecisions(catalog, library, rows, { bundles }).components.files).toHaveLength(2);
    await expect(materializeDecisionBundles(catalog, rows)).rejects.toThrow(/offline source/);
    await expect(materializeDecisionBundles(catalog, rows, { sources })).rejects.toThrow(/transform/);
    await expect(materializeDecisionBundles(catalog, rows, { sources: [{ ...sources[0]!, upstream: [{ ...fixture.upstream, content: "tampered" }] }], transforms })).rejects.toThrow(/upstream hash/);
    bundles[0]!.files[0]!.content += "tampered";
    expect(() => applyDecisions(catalog, library, rows, { bundles })).toThrow(/output hash/);
  });
  it("rejects ambiguous/foreign candidate selection and keeps a failed batch pure", () => {
    const { catalog, library, rows } = sixRows();
    expect(() => applyDecisions(catalog, library, [...rows.slice(0, -1), { ...rows[5], fill: "other/components.button" }])).toThrow(/candidate/);
    const duplicate = { ...catalog, components: { ...catalog.components, fills: [...catalog.components.fills, ...catalog.components.fills] } };
    expect(() => applyDecisions(duplicate, library, rows)).toThrow(/candidate/);
    expect(library.components.fills).toEqual([]);
    expect(() => applyDecisions(catalog, library, [{ slot: "tokens.unknown", kind: "adopt", source: "foundry", note: "Missing slot" }])).toThrow(/unknown slot/);
  });
  it("persists via L-2, round trips six decisions, rejects stale CAS and invalid checks without writes", async () => {
    const { catalog, library, rows, componentOptions } = sixRows();
    const temporary = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "designer-decisions-"))), root = join(temporary, "library");
    try {
      await fs.mkdir(join(root, "fills"), { recursive: true });
      for (const [name, content] of libraryFiles(catalog, library, undefined, componentOptions)) {
        await fs.mkdir(dirname(join(root, name)), { recursive: true }); await fs.writeFile(join(root, name), content);
      }
      await fs.writeFile(join(root, "decisions.json"), JSON.stringify(rows));
      const before = await readLibrary(root, catalog), change = decisionChangeSet(catalog, before, rows);
      const result = await writeCompositeLibrary(root, catalog, change, componentOptions);
      expect(compositeLibraryHash(await readLibrary(root, catalog))).toBe(compositeLibraryHash(result));
      await expect(writeCompositeLibrary(root, catalog, change, componentOptions)).rejects.toThrow(/baseHash/);
      const invalid = decisionChangeSet(catalog, result, [{ slot: "tokens.text-color", kind: "author", value: { primary: { $type: "color", $value: "#ffffff" } }, note: "Synthetic failing contrast" }]);
      await expect(writeCompositeLibrary(root, catalog, invalid, componentOptions)).rejects.toThrow(/check failed/);
      expect(compositeLibraryHash(await readLibrary(root, catalog))).toBe(compositeLibraryHash(result));
      const inode = (await fs.stat(root)).ino;
      const again = await writeCompositeLibrary(root, catalog, decisionChangeSet(catalog, result, rows), componentOptions);
      expect(compositeLibraryHash(again)).toBe(compositeLibraryHash(result));
      expect((await fs.stat(root)).ino).toBe(inode);
      expect(JSON.parse(await fs.readFile(join(root, "decisions.json"), "utf8"))).toEqual(rows);
      expect(await fs.readdir(temporary)).toEqual(["library"]);
      await fs.symlink(root, join(temporary, "linked"));
      await expect(writeCompositeLibrary(join(temporary, "linked"), catalog, decisionChangeSet(catalog, result, rows), componentOptions)).rejects.toThrow(/directory/);
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
  });
  it("runs the standalone offline CLI and reports idempotence, usage and check failures", async () => {
    const { catalog, library, rows, componentOptions } = sixRows();
    const temporary = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "designer-decisions-cli-"))), root = join(temporary, "library");
    const output: string[] = [], errors: string[] = [], io = { out: (text: string) => output.push(text), error: (text: string) => errors.push(text) };
    try {
      await fs.mkdir(join(root, "fills"), { recursive: true });
      for (const [name, content] of libraryFiles(catalog, library, undefined, componentOptions)) { await fs.mkdir(dirname(join(root, name)), { recursive: true }); await fs.writeFile(join(root, name), content); }
      await fs.writeFile(join(root, "decisions.json"), JSON.stringify(rows));
      const catalogPath = join(temporary, "catalog.json"), observations = join(temporary, "observations.json");
      await fs.writeFile(catalogPath, JSON.stringify(catalog)); await fs.writeFile(observations, JSON.stringify(componentOptions));
      const args = [root, "--catalog", catalogPath, "--component-options", observations];
      expect(await runApplyDecisions(args, io)).toBe(0);
      expect(JSON.parse(output[0]!).changed).toBe(true);
      expect(await runApplyDecisions(args, io)).toBe(0);
      expect(JSON.parse(output[1]!).changed).toBe(false);
      expect(await runApplyDecisions([root], io)).toBe(2);
      expect(await runApplyDecisions([...args, "--catalog", catalogPath], io)).toBe(2);
      // Absent observations are runtime-pending, but emission still refuses undeclared package exports.
      expect(await runApplyDecisions([root, "--catalog", catalogPath], io)).toBe(2);
      expect(errors.at(-1)).toMatch(/unavailable package export Button/);
      // Supplied observations that fail are a check failure.
      const stale = structuredClone(componentOptions!); stale.evidence!.observations["components.button"]!.sourceHash = `sha256:${"0".repeat(64)}`;
      await fs.writeFile(observations, JSON.stringify(stale));
      expect(await runApplyDecisions(args, io)).toBe(1);
      expect(errors.at(-1)).toMatch(/check failed/);
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
  });

});
