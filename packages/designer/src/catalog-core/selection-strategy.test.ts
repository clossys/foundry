// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { formatRef } from "@clossys/director";
import { evidenceDir, stagePassingSlot, strategyRoot } from "../../../director/src/__fixtures__/slot-model.js";
import { openStrategy } from "../../../director/src/api.js";
import { directorStoreReader } from "../../../producer/src/records/slots.js";
import { loadCatalog } from "../../../director/src/catalog.js";
import { validateBriefContract } from "../../../director/src/brief-contracts.js";
import { check } from "./check.js";
import { generateSelection } from "./library.js";
import { check as publicCheck, resolve as publicResolve } from "./api.js";
import { validateSelectionStrategy, type SelectionStrategyReader } from "./selection-strategy.js";
import { libraryFiles, readLibrary } from "../library-cli/fs-library.js";
import type { CatalogData, LibraryData } from "./types.js";

const required = ["identity.brand.essence", "identity.brand.personality", "identity.visual.style"];
const contract = { id: "designer.identity", schemaVersion: 1 as const, owner: "@clossys/designer", requires: required, optional: ["identity.visual.imagery"] };
const roots: string[] = [];
const source = { id: "fixture", kind: "consumer", author: "consumer", license: "MIT" } as const;
const catalog: CatalogData = { slots: [], fills: [], sources: [], standards: [], placements: [], retired: [] };
function put(root: string, path: string, value: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value);
}
// The Director reads the flat slot model (4ef830bf6): each cell is `<slot-id>/candidates/<name>-v<n>.md` and its
// pin.json names the active candidate; a candidate cites slot ids, resolved through the cited slot's pin.
function fixture() {
  const base = mkdtempSync(join(tmpdir(), "designer-brief-")); roots.push(base);
  const root = strategyRoot(base);
  const ids = [...required, "identity.verbal.voice"];
  const definitions = loadCatalog();
  function cell(id: string, version: number, options: { unpinned?: boolean } = {}) {
    const links = definitions.coherence.links.filter(link => link.downstream === id).map(link => link.upstream);
    stagePassingSlot(root, id, version, { refs: links, ...options });
  }
  ids.forEach(id => cell(id, 1));
  function reader() { return openStrategy(root, directorStoreReader, { contracts: [contract] }); }
  const assignable: SelectionStrategyReader = reader();
  expect(assignable.getBrief(contract.id).state).toBe("ready");
  const initial = reader(); const brief = initial.getBrief(contract.id);
  expect(brief.state).toBe("ready");
  expect(brief.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  const library: LibraryData = { source, fills: [], strategy: { contract: brief.contract, fingerprint: brief.fingerprint, refs: brief.cells.map(({ cell, version }) => ({ cell, version })) } };
  function findings(strategy = reader(), selected = library) {
    const input = { catalog, library: selected, strategy };
    return check(input).findings.filter(finding => finding.rule === "strategy");
  }
  return { base, root, reader, cell, library, brief, findings };
}
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });

describe("Designer selection brief provenance", () => {
  it("ships the exact validated identity contract and declares it for packing", () => {
    const path = new URL("../../strategy-brief.json", import.meta.url);
    const value: unknown = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
    expect(validateBriefContract(value)).toEqual({ ok: true, value: contract });
    const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    expect(manifest.files).toContain("strategy-brief.json");
  });
  it("generates refs from a real compiled brief and removes direction", () => {
    const { library } = fixture(); const selection = generateSelection(library);
    expect(selection.strategy).toEqual(library.strategy);
    expect(selection).not.toHaveProperty("direction");
    expect(() => generateSelection({ ...library, direction: null })).toThrow(/direction was removed/);
  });
  it("reports unavailable verification explicitly without an SDK reader", () => {
    const f = fixture();
    expect(validateSelectionStrategy(f.library.strategy)).toMatchObject({ state: "unavailable", findings: [expect.objectContaining({ message: expect.stringContaining("unavailable") })] });
    expect(validateSelectionStrategy(f.library.strategy, f.reader())).toMatchObject({ state: "ready", findings: [] });
  });
  it("rejects a ready SDK brief misrouted under another contract", () => {
    const f = fixture(); const actual = f.reader();
    const reader: SelectionStrategyReader = {
      getCell: actual.getCell, isStale: actual.isStale,
      getBrief: id => ({ ...actual.getBrief(id), contract: "writer.messaging" }),
    };
    expect(validateSelectionStrategy(f.library.strategy, reader)).toMatchObject({
      state: "invalid", findings: [expect.objectContaining({ severity: "error", message: expect.stringContaining("contract") })],
    });
  });
  it("checks composite selections and refreshes reader findings across cached resolutions", () => {
    const f = fixture();
    const input = { catalog: { values: catalog, components: { slots: [], fills: [] } }, library: { source, values: f.library, components: { fills: [], files: [] } }, strategy: f.reader() };
    expect(publicCheck(input).findings.filter(finding => finding.rule === "strategy")).toEqual([]);
    expect(publicResolve(input).check.findings.filter(finding => finding.rule === "strategy")).toEqual([]);
    f.cell(required[1]!, 2);
    input.strategy = f.reader();
    expect(publicCheck(input).findings.some(finding => finding.rule === "strategy" && finding.message.includes("stale"))).toBe(true);
    expect(publicResolve(input).check.findings.some(finding => finding.rule === "strategy" && finding.message.includes("stale"))).toBe(true);
  });
  it("rejects legacy direction in persisted metadata and selection instead of stripping it", async () => {
    const f = fixture(); const root = join(f.base, "library"); mkdirSync(join(root, "fills"), { recursive: true });
    const files = libraryFiles(catalog, f.library, []);
    for (const [path, content] of files) put(root, path, content);
    expect((await readLibrary(root, catalog)).selection).not.toHaveProperty("direction");
    put(root, "metadata.json", JSON.stringify({ strategy: f.library.strategy, direction: null }));
    await expect(readLibrary(root, catalog)).rejects.toThrow(/Invalid library metadata/);
    put(root, "metadata.json", files.get("metadata.json")!);
    put(root, "selection.json", JSON.stringify({ ...generateSelection(f.library), direction: null }));
    await expect(readLibrary(root, catalog)).rejects.toThrow(/selection drift/);
  });
  it("leaves current refs fresh when a newer draft exists, then reports activation stale", () => {
    const f = fixture(); expect(f.findings()).toEqual([]);
    // An unpinned newer candidate is an open decision; pinning it makes the selection's v1 ref stale.
    f.cell(required[1]!, 2, { unpinned: true }); expect(f.findings()).toEqual([]);
    f.cell(required[1]!, 2);
    expect(f.findings()).toEqual(expect.arrayContaining([expect.objectContaining({ severity: "notice", message: expect.stringContaining("stale") })]));
    expect(f.findings().some(finding => finding.message.includes(formatRef({ kind: "cell", ref: { cell: required[1]!, version: 1 } })))).toBe(true);
  });
  it("reports changed supporting bytes even when all pinned versions remain active", () => {
    // The cells' supporting evidence is the consumer's Director finding they cite.
    const f = fixture(); const finding = join(evidenceDir(f.root), "fixture-passing.md"); put(f.base, relative(f.base, finding), readFileSync(finding, "utf8") + "- Additional evidence.\n");
    expect(f.findings()).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining("fingerprint"), severity: "notice" })]));
  });
  it("rejects malformed provenance, legacy direction, dangling refs and missing required cells", () => {
    const f = fixture();
    for (const strategy of [{ fingerprint: f.brief.fingerprint, refs: [] }, { contract: contract.id, fingerprint: "invented", refs: [] }, { contract: contract.id, fingerprint: f.brief.fingerprint, refs: [{ cell: required[0], version: 0 }] }]) {
      expect(f.findings(f.reader(), { ...f.library, strategy }).some(finding => finding.severity === "error")).toBe(true);
    }
    const legacy = { ...f.library, direction: null };
    expect(f.findings(f.reader(), legacy).some(finding => finding.message.includes("direction"))).toBe(true);
    const dangling = { ...f.library, strategy: { contract: contract.id, fingerprint: f.brief.fingerprint, refs: [{ cell: required[0]!, version: 99 }] } };
    expect(f.findings(f.reader(), dangling).some(finding => finding.message.includes("dangling"))).toBe(true);
    unlinkSync(join(f.root, required[0]!, "pin.json"));
    expect(f.findings().some(finding => finding.message.includes("missing") && finding.severity === "error")).toBe(true);
  });
});
