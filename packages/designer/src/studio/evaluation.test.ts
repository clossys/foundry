import { expect, it, vi } from "vitest";
import { applyLibraryChange, libraryHash, type CatalogData, type ChangeSet } from "../catalog-core/index.js";
import { studioEngine } from "./engine.js";
import { createStudioEvaluation, evaluationFor } from "./evaluation.js";
import { buildCandidates, emptyChanges, scopeTargets } from "./model.js";
import { matrixRows, matrixSummary } from "./matrix-model.js";
import { liveCss } from "./preview-css.js";
import { smallCatalog, emptyLibrary, adopt } from "./__fixtures__/studio.js";

const countedEngine = () => ({ ...studioEngine,
  applyLibraryChange: vi.fn(studioEngine.applyLibraryChange),
  resolve: vi.fn(studioEngine.resolve), check: vi.fn(studioEngine.check),
});
const grouped: CatalogData = { ...smallCatalog, placements: [{ layer: "tokens", nodes: [{ id: "pair", label: "Pair", leaves: ["tokens.surface-color", "tokens.spacing"] }] }] };
const counts = (engine: ReturnType<typeof countedEngine>) => [engine.applyLibraryChange.mock.calls.length, engine.resolve.mock.calls.length, engine.check.mock.calls.length];

it("bounds whole-library work by distinct operations across group representatives, leaves, members and summaries", () => {
  const working = adopt(); const engine = countedEngine();
  const originalSpacing = grouped.fills.find(fill => fill.$extensions["com.clossys.fill"].source === "tailwind-default" && fill.$extensions["com.clossys.fill"].slot === "tokens.spacing")!;
  // SYNTHETIC: reuse a complete member payload with fresh fixture provenance.
  // The real imported spacing recipe remains unregistered and unavailable.
  const spacing = structuredClone(originalSpacing);
  spacing.$extensions["com.clossys.fill"] = {
    id: "fixture-spacing/tokens.spacing", slot: "tokens.spacing", source: "fixture-spacing",
    mode: "implementation", sourceAddress: "test-fixture/complete-spacing", relation: "same-contract",
    builtOn: [], conforms: ["dtcg#format", "dtcg#alias"],
    evidence: [{ clause: "dtcg#format", check: "C1" }, { clause: "dtcg#alias", check: "C2" }],
    author: "consumer", trust: "consumer", license: "MIT", status: "draft",
  };
  const catalog: CatalogData = { ...grouped,
    sources: [...grouped.sources, { id: "fixture-spacing", kind: "consumer", author: "consumer", license: "MIT" }],
    fills: [...grouped.fills, spacing],
  };
  const evaluation = createStudioEvaluation({ catalog, working, engine });
  const input = { catalog, library: working, working, engine, evaluation, cache: new Map(), changes: emptyChanges(working), expanded: new Set<string>() };
  const rows = matrixRows(input);
  expect(rows.find(row => row.scope === "node")?.candidates.map(candidate => candidate.source)).toContain("tailwind-default");
  const spacingRow = rows.find(row => row.scope === "slot" && row.target === "tokens.spacing")!;
  const unregistered = spacingRow.candidates.find(candidate => candidate.source === "tailwind-default")!;
  expect(unregistered).toMatchObject({ usable: false, reason: "invalid", members: [] });
  expect(unregistered.findings.some(finding => finding.code === "C7" && /registered rule with declared inputs/.test(finding.message))).toBe(true);
  expect(originalSpacing.$extensions["com.clossys.fill"]).toMatchObject({ mode: "derived", derivation: { rule: "n x --spacing" } });
  const complete = spacingRow.candidates.find(candidate => candidate.source === "fixture-spacing")!;
  expect(complete).toMatchObject({ usable: true, errors: 0 });
  expect(complete.members.map(member => member.id).sort()).toEqual(scopeTargets({ catalog, library: working, slotId: "tokens.spacing", scope: "member" }).sort());
  // The group repeats the same source operations as these two leaves, despite using two representative slots.
  expect(counts(engine)).toEqual([3, 4, 4]);
  const calls = engine.applyLibraryChange.mock.calls.map(([, , change]) => JSON.stringify(change.changes));
  expect(new Set(calls).size).toBe(calls.length);
  matrixRows(input); matrixSummary(input); liveCss({ ...input, previous: "" });
  expect(counts(engine)).toEqual([3, 4, 4]);

  const expanded = matrixRows({ ...input, expanded: new Set(["tokens.surface-color"]) });
  const member = expanded.find(row => row.scope === "member")!;
  expect(member.candidates.every(candidate => candidate.members.every(value => value.id === member.target))).toBe(true);
  expect(engine.applyLibraryChange.mock.calls.some(([, , change]) => change.changes.some(change => change.op === "adopt" && change.members?.[0] === member.target))).toBe(true);
  const distinct = new Set(engine.applyLibraryChange.mock.calls.map(([, , change]) => JSON.stringify(change.changes))).size;
  const successful = engine.applyLibraryChange.mock.results.filter(result => result.type === "return").length;
  // Missing members can reject adoption; those operations reuse the unchanged evaluation plus a row failure.
  expect(counts(engine)).toEqual([distinct, successful + 1, successful + 1]);
  const afterExpansion = counts(engine);
  matrixRows({ ...input, expanded: new Set(["tokens.surface-color"]) });
  expect(counts(engine)).toEqual(afterExpansion);
  expect(engine.check.mock.calls.every(([input]) => input.resolved !== undefined)).toBe(true);
});

it("keeps operation order and member picks distinct while caching exact repeated operations", () => {
  const working = adopt(); const engine = countedEngine();
  const evaluation = createStudioEvaluation({ catalog: smallCatalog, working, engine });
  const pick: ChangeSet["changes"][number] = { op: "adopt", slot: "tokens.surface-color", source: "foundry", members: ["tokens.surface-color.base"] };
  const remove: ChangeSet["changes"][number] = { op: "remove", slot: "tokens.surface-color" };
  const removed = evaluation.evaluate([pick, remove]);
  const picked = evaluation.evaluate([remove, pick]);
  expect(removed.resolved.members["tokens.surface-color.base"]).toBeUndefined();
  expect(picked.resolved.members["tokens.surface-color.base"]).toBeDefined();
  expect(evaluation.evaluate([{ ...pick }, { ...remove }])).toBe(removed);
  evaluation.evaluate([{ ...pick, members: ["tokens.surface-color.raised"] }]);
  expect(counts(engine)).toEqual([3, 3, 3]);
});

it("invalidates on working library, catalog and engine identity rather than source or base identity", () => {
  const working = adopt(); const engine = countedEngine();
  const evaluation = createStudioEvaluation({ catalog: smallCatalog, working, engine });
  evaluation.evaluate();
  expect(evaluationFor({ catalog: smallCatalog, working, engine, evaluation })).toBe(evaluation);
  const changed = applyLibraryChange(smallCatalog, working, { baseHash: libraryHash(working), changes: [{ op: "author", slot: "tokens.surface-color", tokens: { base: { $type: "color", $value: "#123456" } } }] });
  const next = evaluationFor({ catalog: smallCatalog, working: changed, engine, evaluation });
  expect(next).not.toBe(evaluation);
  expect(next.evaluate().resolved.members["tokens.surface-color.base"]?.css.light).toBe("#123456");
  expect(evaluationFor({ catalog: { ...smallCatalog }, working, engine, evaluation })).not.toBe(evaluation);
  const other = countedEngine();
  evaluationFor({ catalog: smallCatalog, working, engine: other, evaluation }).evaluate();
  expect(counts(other)).toEqual([0, 1, 1]);
  expect(counts(engine)).toEqual([0, 2, 2]);
});

it("preserves C1 findings and safe CSS fallback while reference candidates reuse the unchanged evaluation", () => {
  const working = applyLibraryChange(smallCatalog, emptyLibrary(), { baseHash: libraryHash(emptyLibrary()), changes: [{ op: "author", slot: "tokens.surface-color", tokens: { base: { $type: "color", $value: "red; color: blue" } } }] });
  const original = smallCatalog.fills.find(fill => fill.$extensions["com.clossys.fill"].slot === "tokens.surface-color")!;
  const reference = { ...original, $extensions: { "com.clossys.fill": { ...original.$extensions["com.clossys.fill"], mode: "reference" as const } } };
  const catalog = { ...smallCatalog, fills: [reference] }; const engine = countedEngine();
  const evaluation = createStudioEvaluation({ catalog, working, engine });
  const input = { catalog, library: working, working, engine, evaluation };
  const cards = buildCandidates({ ...input, slotId: "tokens.surface-color", scope: "slot", target: "tokens.surface-color" });
  expect(cards[0]?.findings.some(finding => finding.code === "C1" && finding.severity === "error")).toBe(true);
  expect(cards[0]?.previewable).toBe(false);
  expect(cards[1]).toMatchObject({ usable: false, reason: "reference", members: [] });
  expect(liveCss({ ...input, previous: "last-safe" })).toEqual({ css: "last-safe", safe: false });
  expect(matrixSummary(input).issues.some(issue => issue.finding.code === "C1")).toBe(true);
  expect(counts(engine)).toEqual([0, 1, 1]);
});

it("projects a shared adoption failure to each representative row without contaminating cached findings", () => {
  const working = { ...adopt(), adoptedAt: undefined }; const engine = countedEngine();
  const spacing = grouped.fills.find(fill => fill.$extensions["com.clossys.fill"].slot === "tokens.spacing")!;
  const catalog = { ...grouped, fills: [...grouped.fills, { ...spacing, $extensions: { "com.clossys.fill": { ...spacing.$extensions["com.clossys.fill"], source: "foundry", id: "foundry/tokens.spacing" } } }] };
  const evaluation = createStudioEvaluation({ catalog, working, engine });
  const input = { catalog, library: working, working, engine, evaluation, scope: "node" as const, target: "tokens/pair" };
  const first = buildCandidates({ ...input, slotId: "tokens.surface-color" }).find(card => card.source === "foundry")!;
  const second = buildCandidates({ ...input, slotId: "tokens.spacing" }).find(card => card.source === "foundry")!;
  expect(first.findings.some(finding => finding.code === "C7" && finding.subject === "tokens.surface-color")).toBe(true);
  expect(second.findings.some(finding => finding.code === "C7" && finding.subject === "tokens.spacing")).toBe(true);
  expect(evaluation.evaluate().checked.findings.some(finding => finding.message.startsWith("adopt:"))).toBe(false);
  const before = counts(engine);
  buildCandidates({ ...input, slotId: "tokens.surface-color" }); buildCandidates({ ...input, slotId: "tokens.spacing" });
  expect(counts(engine)).toEqual(before);
  expect(engine.resolve).toHaveBeenCalledTimes(1); expect(engine.check).toHaveBeenCalledTimes(1);
});
