import { describe, expect, it } from "vitest";
import { loadCatalog } from "../catalog-core/index.js";
import { DEMO_CATALOG, DEMO_LIBRARY, DEMO_SELECTION } from "./demo-data.js";
import { studioEngine } from "./engine.js";
import { buildCandidates, changesFor, emptyChanges } from "./model.js";
import { matrixRows, matrixSummary, matrixSources, purePlacementTree } from "./matrix-model.js";

const input = { catalog: DEMO_CATALOG, library: DEMO_LIBRARY, working: DEMO_SELECTION, changes: emptyChanges(DEMO_SELECTION), expanded: new Set<string>() };

describe("Studio matrix model", () => {
  it("keeps library order global and puts placement groups before their leaves", () => {
    expect(matrixSources(input)).toEqual(["example", "foundry", "reference-kit", "tailwind-default"]);
    const rows = matrixRows(input);
    expect(rows.find(row => row.id === "tokens.accent-color")?.scope).toBe("slot");
    expect(rows.find(row => row.id === "tokens.accent-color")?.tier).toBe("role");
    expect(rows.find(row => row.id === "tokens/role-color")?.scope).toBe("node");
    expect(rows.findIndex(row => row.id === "tokens/role-color")).toBeLessThan(rows.findIndex(row => row.id === "tokens.accent-color"));
    expect(rows.some(row => row.scope === "member")).toBe(false);
    expect(new Set(rows.flatMap(row => row.candidates.map(candidate => candidate.index))).size).toBe(rows.flatMap(row => row.candidates).length);
  });

  it("reveals member rows only when their leaf is expanded and scopes by placement membership", () => {
    const rows = matrixRows({ ...input, expanded: new Set(["tokens.accent-color"]), nodeId: "tokens/role-color" });
    expect(rows.filter(row => row.scope === "member").map(row => row.id)).toEqual(["tokens.accent-color.default", "tokens.accent-color.hover"]);
    expect(rows.filter(row => row.scope === "slot").map(row => row.id)).toEqual(["tokens.surface-color", "tokens.accent-color"]);
    expect(rows.some(row => row.id === "tokens.spacing")).toBe(false);
  });

  it("omits only the layer wrapper, preserving placement ids and the shared model's semantics", () => {
    const nodes = purePlacementTree(DEMO_CATALOG.placements);
    expect(nodes.map(node => node.label)).toEqual(["Scale", "Role"]);
    expect(nodes.some(node => node.id === "tokens")).toBe(false);
    expect(nodes[0]?.id).toBe("tokens/scale");
  });

  it("counts explicit decisions separately from defaults and usable-fill coverage", () => {
    const catalog = loadCatalog();
    const summary = matrixSummary({ ...input, catalog });
    expect(summary.total).toBe(52);
    expect(summary.decided).toBe(0);
    expect(summary.resolved).toBe(49);
    const working = { ...DEMO_SELECTION, picks: [{ scope: "member" as const, target: "tokens.accent-color.default", source: "foundry" }] };
    expect(matrixSummary({ ...input, catalog, working }).decided).toBe(1);
    expect(matrixSummary({ ...input, catalog, working }).percent).toBeCloseTo(100 / 52);
    expect(summary.categories.find(row => row.id === "accessibility")?.supported).toBe(false);
    expect(summary.categories.find(row => row.id === "coherence")?.supported).toBe(false);
    expect(summary.categories.find(row => row.id === "modes")?.supported).toBe(false);
    expect(summary.categories.find(row => row.id === "contract")?.supported).toBe(true);
  });

  it("blocks every real error, leaves notices usable and refuses reference fills independently", () => {
    const checked = (severity: "notice" | "error") => ({ ...studioEngine, check: () => ({ ok: severity === "notice", findings: [{ code: "C7" as const, rule: "selection", severity, subject: "foundry/tokens.accent-color", message: "actual finding" }] }) });
    const candidates = (severity: "notice" | "error") => buildCandidates({ ...input, slotId: "tokens.accent-color", scope: "slot", target: "tokens.accent-color", engine: checked(severity) });
    expect(candidates("notice").find(candidate => candidate.source === "foundry")?.usable).toBe(true);
    expect(candidates("notice").find(candidate => candidate.source === "reference-kit")?.usable).toBe(false);
    expect(candidates("error").find(candidate => candidate.source === "foundry")?.usable).toBe(false);
  });

  it("maps actual issues to their leaf and never invents counts for unsupported categories", () => {
    const engine = { ...studioEngine, check: () => ({ ok: false, findings: [{ code: "C1" as const, rule: "contract", severity: "error" as const, subject: "foundry/tokens.accent-color", message: "unsafe value" }] }) };
    const summary = matrixSummary({ ...input, engine });
    expect(summary.errors).toBe(1);
    expect(summary.notices).toBe(0);
    expect(summary.issues[0]?.slotId).toBe("tokens.accent-color");
    expect(summary.categories.find(row => row.id === "contract")).toMatchObject({ errors: 1, notices: 0 });
    expect(summary.categories.find(row => row.id === "accessibility")?.errors).toBeUndefined();
  });

  it("keeps disabled layers out of the Tokens tree, matrix and library columns", () => {
    const catalog = { ...DEMO_CATALOG, placements: [...DEMO_CATALOG.placements, { layer: "components" as const, nodes: [{ id: "other", label: "Other layer", leaves: ["components.other"] }] }] };
    expect(purePlacementTree(catalog.placements).some(node => node.label === "Other layer")).toBe(false);
    expect(matrixRows({ ...input, catalog }).some(row => row.id === "components.other")).toBe(false);
    expect(matrixSummary({ ...input, catalog }).categories.find(row => row.id === "provenance")?.supported).toBe(false);
  });


  it("retains full-node findings when the bad fill is not the representative leaf", () => {
    const engine = { ...studioEngine, check: () => ({ ok: false, findings: [{ code: "C1" as const, rule: "contract", severity: "error" as const, subject: "foundry/tokens.surface-color", message: "nonrepresentative unsafe value" }] }) };
    const group = matrixRows({ ...input, engine }).find(row => row.id === "tokens/role-color");
    expect(group?.candidates.find(candidate => candidate.source === "foundry")?.fill.slot).toBe("tokens.accent-color");
    expect(group?.candidates.find(candidate => candidate.source === "foundry")?.usable).toBe(false);
    expect(group?.candidates.find(candidate => candidate.source === "foundry")?.errors).toBe(1);
  });

  it("keeps declared and empty consumer columns present without inventing fills", () => {
    const library = { ...DEMO_LIBRARY, source: { ...DEMO_LIBRARY.source, id: "empty-consumer" }, fills: [] };
    expect(matrixSources({ ...input, library })[0]).toBe("empty-consumer");
    expect(matrixRows({ ...input, library }).find(row => row.id === "tokens.accent-color")?.candidates.some(candidate => candidate.source === "empty-consumer")).toBe(false);
  });

  it("sets a whole group with only leaf picks and never changes the persisted shape", () => {
    const changes = changesFor({ ...input, scope: "node", target: "tokens/role-color", source: "foundry" });
    expect(changes).toEqual([{ op: "set", pick: { scope: "slot", target: "tokens.surface-color", source: "foundry" } }, { op: "set", pick: { scope: "slot", target: "tokens.accent-color", source: "foundry" } }]);
  });
});
