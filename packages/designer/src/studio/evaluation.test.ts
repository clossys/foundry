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
const grouped: CatalogData = { ...smallCatalog, placements: [{ layer: "themes", nodes: [{ id: "pair", label: "Pair", leaves: ["themes.background", "themes.spacing"] }] }] };
const counts = (engine: ReturnType<typeof countedEngine>) => [engine.applyLibraryChange.mock.calls.length, engine.resolve.mock.calls.length, engine.check.mock.calls.length];

it("bounds whole-library work by distinct operations across group representatives, leaves, members and summaries", () => {
  const working = adopt(); const engine = countedEngine();
  const originalSpacing = grouped.fills.find(fill => fill.$extensions["com.clossys.fill"].source === "tailwind-default" && fill.$extensions["com.clossys.fill"].slot === "themes.spacing")!;
  // SYNTHETIC: reuse the complete shipped member payload under fresh fixture provenance,
  // so the spacing leaf carries two usable sources beside the group representative.
  const spacing = structuredClone(originalSpacing);
  spacing.$extensions["com.clossys.fill"] = {
    id: "fixture-spacing/themes.spacing", slot: "themes.spacing", source: "fixture-spacing",
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
  const spacingRow = rows.find(row => row.scope === "slot" && row.target === "themes.spacing")!;
  expect(originalSpacing.$extensions["com.clossys.fill"]).toMatchObject({ mode: "implementation" });
  for (const source of ["tailwind-default", "fixture-spacing"]) {
    const complete = spacingRow.candidates.find(candidate => candidate.source === source)!;
    expect(complete, source).toMatchObject({ usable: true, errors: 0 });
    expect(complete.members.map(member => member.id).sort(), source).toEqual(scopeTargets({ catalog, library: working, slotId: "themes.spacing", scope: "member" }).sort());
  }
  // The group repeats the same source operations as these two leaves, despite using two representative slots.
  expect(counts(engine)).toEqual([3, 4, 4]);
  const calls = engine.applyLibraryChange.mock.calls.map(([, , change]) => JSON.stringify(change.changes));
  expect(new Set(calls).size).toBe(calls.length);
  matrixRows(input); matrixSummary(input); liveCss({ ...input, previous: "" });
  expect(counts(engine)).toEqual([3, 4, 4]);

  const expanded = matrixRows({ ...input, expanded: new Set(["themes.background"]) });
  const member = expanded.find(row => row.scope === "member")!;
  expect(member.candidates.every(candidate => candidate.members.every(value => value.id === member.target))).toBe(true);
  expect(engine.applyLibraryChange.mock.calls.some(([, , change]) => change.changes.some(change => change.op === "adopt" && change.members?.[0] === member.target))).toBe(true);
  const distinct = new Set(engine.applyLibraryChange.mock.calls.map(([, , change]) => JSON.stringify(change.changes))).size;
  const successful = engine.applyLibraryChange.mock.results.filter(result => result.type === "return").length;
  // Missing members can reject adoption; those operations reuse the unchanged evaluation plus a row failure.
  expect(counts(engine)).toEqual([distinct, successful + 1, successful + 1]);
  const afterExpansion = counts(engine);
  matrixRows({ ...input, expanded: new Set(["themes.background"]) });
  expect(counts(engine)).toEqual(afterExpansion);
  expect(engine.check.mock.calls.every(([input]) => input.resolved !== undefined)).toBe(true);
});

it("keeps operation order and member picks distinct while caching exact repeated operations", () => {
  const working = adopt(); const engine = countedEngine();
  const evaluation = createStudioEvaluation({ catalog: smallCatalog, working, engine });
  const pick: ChangeSet["changes"][number] = { op: "adopt", slot: "themes.background", source: "shadcn@aria", members: ["themes.background.default"] };
  const remove: ChangeSet["changes"][number] = { op: "remove", slot: "themes.background" };
  const removed = evaluation.evaluate([pick, remove]);
  const picked = evaluation.evaluate([remove, pick]);
  expect(removed.resolved.members["themes.background.default"]).toBeUndefined();
  expect(picked.resolved.members["themes.background.default"]).toBeDefined();
  expect(evaluation.evaluate([{ ...pick }, { ...remove }])).toBe(removed);
  evaluation.evaluate([{ ...pick, members: ["themes.card.default"] }]);
  expect(counts(engine)).toEqual([3, 3, 3]);
});

it("invalidates on working library, catalog and engine identity rather than source or base identity", () => {
  const working = adopt(); const engine = countedEngine();
  const evaluation = createStudioEvaluation({ catalog: smallCatalog, working, engine });
  evaluation.evaluate();
  expect(evaluationFor({ catalog: smallCatalog, working, engine, evaluation })).toBe(evaluation);
  const changed = applyLibraryChange(smallCatalog, working, { baseHash: libraryHash(working), changes: [{ op: "author", slot: "themes.background", tokens: { default: { $type: "color", $value: "#123456" } } }] });
  const next = evaluationFor({ catalog: smallCatalog, working: changed, engine, evaluation });
  expect(next).not.toBe(evaluation);
  expect(next.evaluate().resolved.members["themes.background.default"]?.css.light).toBe("#123456");
  expect(evaluationFor({ catalog: { ...smallCatalog }, working, engine, evaluation })).not.toBe(evaluation);
  const other = countedEngine();
  evaluationFor({ catalog: smallCatalog, working, engine: other, evaluation }).evaluate();
  expect(counts(other)).toEqual([0, 1, 1]);
  expect(counts(engine)).toEqual([0, 2, 2]);
});

it("preserves C1 findings and safe CSS fallback while reference candidates reuse the unchanged evaluation", () => {
  const working = applyLibraryChange(smallCatalog, emptyLibrary(), { baseHash: libraryHash(emptyLibrary()), changes: [{ op: "author", slot: "themes.background", tokens: { default: { $type: "color", $value: "red; color: blue" } } }] });
  const original = smallCatalog.fills.find(fill => fill.$extensions["com.clossys.fill"].slot === "themes.background")!;
  const reference = { ...original, $extensions: { "com.clossys.fill": { ...original.$extensions["com.clossys.fill"], mode: "reference" as const } } };
  const catalog = { ...smallCatalog, fills: [reference] }; const engine = countedEngine();
  const evaluation = createStudioEvaluation({ catalog, working, engine });
  const input = { catalog, library: working, working, engine, evaluation };
  const cards = buildCandidates({ ...input, slotId: "themes.background", scope: "slot", target: "themes.background" });
  expect(cards[0]?.findings.some(finding => finding.code === "C1" && finding.severity === "error")).toBe(true);
  expect(cards[0]?.previewable).toBe(false);
  expect(cards[1]).toMatchObject({ usable: false, reason: "reference", members: [] });
  expect(liveCss({ ...input, previous: "last-safe" })).toEqual({ css: "last-safe", safe: false });
  expect(matrixSummary(input).issues.some(issue => issue.finding.code === "C1")).toBe(true);
  expect(counts(engine)).toEqual([0, 1, 1]);
});

it("projects a shared adoption failure to each representative row without contaminating cached findings", () => {
  const working = { ...adopt(), adoptedAt: undefined }; const engine = countedEngine();
  // SYNTHETIC: one shared source offers both representative leaves, so one node adoption covers the pair.
  const shared = (["themes.background", "themes.spacing"] as const).map(slot => {
    const fill = grouped.fills.find(entry => entry.$extensions["com.clossys.fill"].slot === slot)!;
    return { ...fill, $extensions: { "com.clossys.fill": { ...fill.$extensions["com.clossys.fill"], source: "foundry", id: `foundry/${slot}` } } };
  });
  const catalog = { ...grouped, fills: [...grouped.fills, ...shared] };
  const evaluation = createStudioEvaluation({ catalog, working, engine });
  const input = { catalog, library: working, working, engine, evaluation, scope: "node" as const, target: "themes/pair" };
  const first = buildCandidates({ ...input, slotId: "themes.background" }).find(card => card.source === "foundry")!;
  const second = buildCandidates({ ...input, slotId: "themes.spacing" }).find(card => card.source === "foundry")!;
  expect(first.findings.some(finding => finding.code === "C7" && finding.subject === "themes.background")).toBe(true);
  expect(second.findings.some(finding => finding.code === "C7" && finding.subject === "themes.spacing")).toBe(true);
  expect(evaluation.evaluate().checked.findings.some(finding => finding.message.startsWith("adopt:"))).toBe(false);
  const before = counts(engine);
  buildCandidates({ ...input, slotId: "themes.background" }); buildCandidates({ ...input, slotId: "themes.spacing" });
  expect(counts(engine)).toEqual(before);
  expect(engine.resolve).toHaveBeenCalledTimes(1); expect(engine.check).toHaveBeenCalledTimes(1);
});
