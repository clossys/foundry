/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { standardM1FixtureEngine, standardM1Runtime } from "./__fixtures__/standard-m1-runtime.js";
import { prepareRuntimeAssembly } from "./runtime-assembly.js";
import { checkRuntimeMeasurements, runRuntimeAssemblyEvidence, validateRuntimeAssemblyEvidence } from "./runtime-assembly-evidence.js";
import { runtimeHash } from "./runtime-ports.js";
import type { RuntimeAssemblySnapshot } from "./runtime-assembly.js";
import type { RuntimeElementGeometry, RuntimeMeasurementBatch, RuntimeMeasurementRunner, RuntimeRect } from "./runtime-assembly-evidence.js";
import type { RuntimeRendererDescriptor } from "./runtime-ports.js";
const engine = standardM1FixtureEngine();
const source = { entry: "synthetic.tsx", files: { "synthetic.tsx": "// SYNTHETIC geometry corpus, never actual browser evidence" }, dependencies: {} };
const descriptor: RuntimeRendererDescriptor = { id: "synthetic-runner", source, sourceHash: runtimeHash(source) };
const fixture = () => ({ ...standardM1Runtime({ engine: structuredClone(engine), identity: { kind: "git" as const, head: "1".repeat(40), tree: "2".repeat(40) }, source, css: [{ id: "fixture.css", contents: "body{margin:0}" }] }), runner: descriptor });
const rect = (left: number, top: number, width: number, height: number): RuntimeRect => ({ left, right: left + width, top, bottom: top + height, width, height });
function observations(snapshot: RuntimeAssemblySnapshot): RuntimeMeasurementBatch {
  const bytes = "SYNTHETIC bundle bytes";
  return { bundle: { identity: "synthetic-bundle", bytes, hash: runtimeHash(bytes) }, cells: snapshot.cells.map(cell => ({ cell, viewport: cell.width, documentScrollWidth: cell.width, breakpoints: snapshot.breakpoints,
    elements: snapshot.measuredPaths.map((path, index): RuntimeElementGeometry => ({ path, parent: index ? "frame" : null, rect: rect(0, index ? index * 100 : 0, cell.width, index ? 90 : 1000), clientWidth: cell.width, scrollWidth: cell.width, display: "block", visibility: "visible", opacity: 1, order: 0, flexDirection: "column", gridAutoFlow: "row", direction: "ltr", writingMode: "horizontal-tb", clip: null, text: [] })) })) };
}
function snapshot() { const result = prepareRuntimeAssembly(fixture()); if (result.status !== "ready") throw new Error(JSON.stringify(result)); return result.assembly.snapshot; }
const runner: RuntimeMeasurementRunner<unknown> = { descriptor, kind: "synthetic", run: async request => { for (const cell of request.cells) request.render(cell); return observations(request.snapshot); } };
describe("SYNTHETIC runtime evidence schema and raw geometry corpus", () => {
  it("keeps actual Stage geometry separate from viewport cells and the source/environment basis", () => {
    const original = snapshot(), basisHash = runtimeHash({ kind: "SYNTHETIC Stage measurement basis" });
    const stageWidths = Object.fromEntries(original.cells.map(cell => [JSON.stringify([cell.theme, cell.state, cell.width]), cell.width - 80]));
    const snap = { ...original, stageWidths, stageBasisHash: basisHash, orderPending: [] };
    const batch = observations(snap);
    expect(checkRuntimeMeasurements(snap, batch).status).toBe("pending");
    const measured = { ...batch, cells: batch.cells.map(row => ({ ...row, stage: { width: row.cell.width - 80, basisHash } })) };
    expect(checkRuntimeMeasurements(snap, measured).status).toBe("consistent");
    for (const stage of [{ width: measured.cells[0]!.viewport, basisHash }, { width: measured.cells[0]!.stage.width, basisHash: runtimeHash("foreign basis") }]) {
      expect(checkRuntimeMeasurements(snap, { ...measured, cells: measured.cells.map((row, index) => index ? row : { ...row, stage }) }).status).toBe("pending");
    }
    expect(checkRuntimeMeasurements({ ...snap, stageBasisHash: undefined }, measured).status).toBe("pending");
    expect(checkRuntimeMeasurements({ ...snap, orderPending: [JSON.stringify([snap.cells[0]!.theme, snap.cells[0]!.state, snap.cells[0]!.width])] }, measured).status).toBe("pending");
  });
  it("checks a complete matrix while leaving synthetic LK12 pending", async () => {
    const input = fixture(); const snap = snapshot();
    expect(checkRuntimeMeasurements(snap, observations(snap))).toEqual({ status: "consistent", findings: [] });
    const result = await runRuntimeAssemblyEvidence(input, runner);
    expect(result.status, JSON.stringify(result.findings)).toBe("pending"); expect(result.evidence?.kind).toBe("synthetic");
    expect(result.findings).toContain("synthetic validation only; real browser invocation required");
    expect(validateRuntimeAssemblyEvidence(result.evidence!, input).status).toBe("pending");
    expect(validateRuntimeAssemblyEvidence(result.evidence!, input, await runRuntimeAssemblyEvidence(input, runner)).status).toBe("pending");
  });
  it("leaves missing runner/required inputs pending", async () => {
    expect((await runRuntimeAssemblyEvidence(fixture())).status).toBe("pending");
    expect((await runRuntimeAssemblyEvidence({ ...fixture(), runner: undefined }, runner)).status).toBe("pending");
    expect((await runRuntimeAssemblyEvidence(fixture(), { ...runner, run: async () => { throw new Error("unavailable"); } })).status).toBe("pending");
  });
  it.each(["missing-cell", "missing-frame", "missing-fill", "nonfinite", "invisible"])("keeps %s observations pending", mutation => {
    const snap = snapshot(); const batch = structuredClone(observations(snap));
    if (mutation === "missing-cell") batch.cells = batch.cells.slice(1);
    if (mutation === "missing-frame") batch.cells[0]!.elements = batch.cells[0]!.elements.slice(1).map(element => ({ ...element, parent: null }));
    if (mutation === "missing-fill") batch.cells[0]!.elements = batch.cells[0]!.elements.slice(0, -1);
    if (mutation === "nonfinite") batch.cells[0]!.elements[0]!.rect = { ...batch.cells[0]!.elements[0]!.rect, left: NaN };
    if (mutation === "invisible") batch.cells[0]!.elements[1]!.opacity = 0;
    expect(checkRuntimeMeasurements(snap, batch).status).toBe("pending");
  });
  it.each(["duplicate-cell", "extra-cell", "duplicate-path", "overflow", "clipped-text", "scroll-clip", "css-order", "visual-order", "dom-order", "overlap", "foreign-frame", "bundle"])("refuses observed %s", mutation => {
    const snap = snapshot(); const batch = structuredClone(observations(snap)); const cell = batch.cells[0]!; const first = cell.elements[1]!;
    if (mutation === "duplicate-cell") batch.cells = [...batch.cells, batch.cells[0]!];
    if (mutation === "extra-cell") batch.cells = [...batch.cells, { ...cell, cell: { ...cell.cell, width: 9999 } }];
    if (mutation === "duplicate-path") cell.elements = [...cell.elements, first];
    if (mutation === "overflow") cell.documentScrollWidth += 50;
    if (mutation === "clipped-text") cell.elements[1] = { ...first, text: [rect(10, 110, 200, 10)], clip: rect(0, 100, 100, 50) };
    if (mutation === "scroll-clip") cell.elements[1] = { ...first, scrollWidth: first.clientWidth + 50 };
    if (mutation === "css-order") cell.elements[1] = { ...first, order: 1 };
    if (mutation === "visual-order") cell.elements = [cell.elements[0]!, { ...first, rect: rect(0, 200, cell.viewport, 90) }, { ...cell.elements[2]!, rect: rect(0, 100, cell.viewport, 90) }];
    if (mutation === "dom-order") cell.elements = [cell.elements[0]!, cell.elements[2]!, first];
    if (mutation === "overlap") cell.elements[2] = { ...cell.elements[2]!, rect: first.rect };
    if (mutation === "foreign-frame") cell.elements[1] = { ...first, parent: null };
    if (mutation === "bundle") batch.bundle = { ...batch.bundle, bytes: "changed" };
    expect(checkRuntimeMeasurements(snap, batch).status).toBe("refused");
  });
  it("keeps an observed violation refused when another matrix cell is absent", () => {
    const snap = snapshot(); const batch = structuredClone(observations(snap)); batch.cells = batch.cells.slice(0, -1); batch.cells[0]!.documentScrollWidth += 100;
    expect(checkRuntimeMeasurements(snap, batch).status).toBe("refused");
  });
  it("validates hierarchy grouping rather than sorting all leaf rectangles globally", () => {
    const snap = snapshot(); const batch = structuredClone(observations(snap));
    for (const cell of batch.cells) {
      const frame = { ...cell.elements[0]!, display: "flex", flexDirection: "row" };
      const first = { ...cell.elements[1]!, rect: rect(0, 200, cell.viewport / 2, 90), clientWidth: cell.viewport / 2, scrollWidth: cell.viewport / 2 };
      const second = { ...cell.elements[2]!, rect: rect(cell.viewport / 2, 100, cell.viewport / 2, 90), clientWidth: cell.viewport / 2, scrollWidth: cell.viewport / 2 };
      cell.elements = [frame, first, second];
    }
    expect(checkRuntimeMeasurements(snap, batch).status).toBe("consistent");
  });
  it("refuses bindings changed during runner execution", async () => {
    const input = fixture();
    const result = await runRuntimeAssemblyEvidence(input, { ...runner, run: async request => { input.css = [{ id: "fixture.css", contents: "body{margin:1px}" }]; return observations(request.snapshot); } });
    expect(result.status).toBe("refused"); expect(result.findings).toContain("assembly changed during measurement");
  });
  it("rejects stale retained evidence and caller-authored fake fresh clearance", async () => {
    const input = fixture(); const retained = await runRuntimeAssemblyEvidence(input, runner); expect(retained.evidence).toBeDefined();
    expect(validateRuntimeAssemblyEvidence(retained.evidence!, { ...input, themes: ["light"] }).status).toBe("refused");
    expect(validateRuntimeAssemblyEvidence(retained.evidence!, { ...input, css: [{ id: "fixture.css", contents: "changed" }] }).status).toBe("refused");
    const changed = { ...retained.evidence!, kind: "browser" as const }; const { hash: _hash, ...data } = changed; const fake = { ...data, hash: runtimeHash(data) };
    expect(validateRuntimeAssemblyEvidence(fake, input, { status: "measured", findings: [], limits: [], evidence: fake }).status).toBe("pending");
  });
});

it("keeps missing or mismatched runner-resolved breakpoint edges pending", () => {
  const snap = snapshot(); const batch = structuredClone(observations(snap));
  batch.cells[0]!.breakpoints = { ...batch.cells[0]!.breakpoints, sm: 999 };
  expect(checkRuntimeMeasurements(snap, batch).status).toBe("pending");
});

// Controlled synthetic execution tests issuance mechanics only, never real browser LK12.
it("consumes a caller-trusted browser invocation proof once without authenticating browser execution", async () => {
  const input = fixture();
  const controlled = await runRuntimeAssemblyEvidence(input, { ...runner, kind: "browser" });
  expect(controlled.status).toBe("measured");
  expect(validateRuntimeAssemblyEvidence(controlled.evidence!, input, controlled).status).toBe("measured");
  expect(validateRuntimeAssemblyEvidence(controlled.evidence!, input, controlled).status).toBe("pending");
});

it("refuses a separately owned runner descriptor changed during execution", async () => {
  const separate = structuredClone(descriptor);
  const observed = await runRuntimeAssemblyEvidence(fixture(), { ...runner, descriptor: separate, run: async request => {
    separate.id = "changed-during-run";
    return observations(request.snapshot);
  } });
  expect(observed.status).toBe("refused");
  expect(observed.findings).toContain("runner identity changed during measurement");
});

it("preserves observed refusal and missing-cell pending from genuine fresh collection", async () => {
  const input = fixture();
  const retained = await runRuntimeAssemblyEvidence(input, runner);
  for (const status of ["refused", "pending"] as const) {
    const fresh = await runRuntimeAssemblyEvidence(input, { ...runner, run: async request => {
      const batch = structuredClone(observations(request.snapshot));
      if (status === "refused") batch.cells[0]!.documentScrollWidth += 50;
      else batch.cells = batch.cells.slice(1);
      return batch;
    } });
    expect(validateRuntimeAssemblyEvidence(retained.evidence!, input, fresh).status).toBe(status);
    expect(validateRuntimeAssemblyEvidence(retained.evidence!, input, fresh).status).toBe("pending");
  }
});
