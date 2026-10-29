// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { formatRef } from "@clossys/strategist";
import { openStrategy } from "../../../strategist/src/api.js";
import { loadCatalog } from "../../../strategist/src/catalog.js";
import { validateBriefContract } from "../../../strategist/src/brief-contracts.js";
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
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "designer-brief-")); roots.push(root);
  const ids = [...required, "identity.verbal.voice"];
  const active = Object.fromEntries(ids.map(id => [id, 1]));
  const tree = { schemaVersion: 1, catalog: "@clossys/strategist#strategy-v1", archetype: "default", core: "archetype", active };
  put(root, "tree.json", JSON.stringify(tree));
  put(root, "sessions/2026-10-29-1.md", `- U1: Choose the bounded fixture approach.\n- S2: Playback for confirm: ${ids.map(cell => formatRef({ kind: "cell", ref: { cell, version: 1 } })).join(", ")}\n- U3: Yes.\n`);
  const definitions = loadCatalog();
  function cell(id: string, version: number, status: "active" | "draft" | "retired" = "active") {
    const links = definitions.coherence.links.filter(link => link.downstream === id).map(link => formatRef({ kind: "cell", ref: { cell: link.upstream, version: 1 } }));
    const refs = ["msg:2026-10-29-1#U1", ...links];
    const keys = definitions.cells.find(cell => cell.id === id)!.mustContain;
    put(root, `cells/${id}/v${version}.md`, `---\nid: ${id}\nversion: ${version}\nstatus: ${status}\nupdated: 2026-10-29\ncites: [${refs.join(", ")}]\nfeeds: [designer.identity]\nfunctions: [brand]\n${status === "active" ? "confirmed: msg:2026-10-29-1#U3\n" : ""}---\n\n## Direction\n${keys.map(key => `- ${key.key}: Choose 1 bounded fixture approach over broader alternatives.`).join("\n")}\n\n## Because\n- The fixture user selected this approach (${refs.join(", ")})\n\n## Watch\n- If requests > 5 each month, then review.\n`);
  }
  ids.forEach(id => cell(id, 1));
  function reader() { return openStrategy(root, { contracts: [contract] }); }
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
  return { root, tree, reader, cell, library, brief, findings };
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
    f.cell(required[1]!, 2); f.tree.active[required[1]!] = 2; put(f.root, "tree.json", JSON.stringify(f.tree));
    input.strategy = f.reader();
    expect(publicCheck(input).findings.some(finding => finding.rule === "strategy" && finding.message.includes("stale"))).toBe(true);
    expect(publicResolve(input).check.findings.some(finding => finding.rule === "strategy" && finding.message.includes("stale"))).toBe(true);
  });
  it("rejects legacy direction in persisted metadata and selection instead of stripping it", async () => {
    const f = fixture(); const root = join(f.root, "library"); mkdirSync(join(root, "fills"), { recursive: true });
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
    f.cell(required[1]!, 2, "draft"); expect(f.findings()).toEqual([]);
    f.tree.active[required[1]!] = 2; put(f.root, "tree.json", JSON.stringify(f.tree));
    f.cell(required[1]!, 1, "retired"); f.cell(required[1]!, 2);
    expect(f.findings()).toEqual(expect.arrayContaining([expect.objectContaining({ severity: "notice", message: expect.stringContaining("stale") })]));
    expect(f.findings().some(finding => finding.message.includes(formatRef({ kind: "cell", ref: { cell: required[1]!, version: 1 } })))).toBe(true);
  });
  it("reports changed supporting bytes even when all pinned versions remain active", () => {
    const f = fixture(); put(f.root, "sessions/2026-10-29-1.md", readFileSync(join(f.root, "sessions/2026-10-29-1.md"), "utf8") + "- U4: Additional evidence.\n");
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
    delete f.tree.active[required[0]!]; put(f.root, "tree.json", JSON.stringify(f.tree));
    expect(f.findings().some(finding => finding.message.includes("missing") && finding.severity === "error")).toBe(true);
  });
});
