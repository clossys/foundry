import { prepareRuntimeAssembly, runtimeCellKey } from "./runtime-assembly.js";
import { runtimeHash, runtimeSnapshot } from "./runtime-ports.js";
import type { RuntimeAssembly, RuntimeAssemblyInput, RuntimeAssemblySnapshot } from "./runtime-assembly.js";
import type { RuntimeCell, RuntimeDigest, RuntimeRendererDescriptor } from "./runtime-ports.js";

export interface RuntimeRect { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number; readonly width: number; readonly height: number }
/** Raw observations for every visible element and text run, including clipped descendants. */
export interface RuntimeElementGeometry {
  readonly path: string;
  readonly parent: string | null;
  readonly rect: RuntimeRect;
  readonly clientWidth: number;
  readonly scrollWidth: number;
  readonly display: string;
  readonly visibility: string;
  readonly opacity: number;
  readonly order: number;
  readonly flexDirection: string;
  readonly gridAutoFlow: string;
  readonly direction: string;
  readonly writingMode: string;
  /** Effective ancestor clipping rectangle, or null if no clipping ancestor. */
  readonly clip: RuntimeRect | null;
  readonly text: readonly RuntimeRect[];
}
export interface RuntimeCellMeasurement {
  readonly cell: RuntimeCell;
  readonly viewport: number;
  readonly documentScrollWidth: number;
  /** Independently resolved in the runner environment, including rem/em units. */
  readonly breakpoints: Readonly<Record<string, number>>;
  /** Actual Stage container measurement, distinct from viewport and tokens. */
  readonly stage?: { readonly width: number; readonly basisHash: RuntimeDigest };
  readonly elements: readonly RuntimeElementGeometry[];
}
export interface RuntimeMeasurementBatch {
  readonly bundle: { readonly identity: string; readonly bytes: string; readonly hash: RuntimeDigest };
  readonly cells: readonly RuntimeCellMeasurement[];
}
export interface RuntimeMeasurementRunner<Node> {
  readonly descriptor: RuntimeRendererDescriptor;
  /** A synthetic runner can exercise validation but can never produce measured LK12. */
  readonly kind: "browser" | "synthetic";
  run(request: { readonly snapshot: RuntimeAssemblySnapshot; readonly cells: readonly RuntimeCell[]; render: RuntimeAssembly<Node>["render"] }): Promise<RuntimeMeasurementBatch>;
}
export interface RuntimeAssemblyEvidence {
  readonly version: 1;
  readonly scope: "consumer-frame-layout-sections";
  readonly snapshot: RuntimeAssemblySnapshot;
  readonly runner: RuntimeRendererDescriptor;
  readonly kind: "browser" | "synthetic";
  readonly measurements: RuntimeMeasurementBatch;
  readonly hash: RuntimeDigest;
}
export interface RuntimeEvidenceResult {
  readonly status: "measured" | "pending" | "refused";
  readonly findings: readonly string[];
  readonly evidence?: RuntimeAssemblyEvidence;
  readonly limits: readonly string[];
}
const freshInvocations = new WeakSet<object>();
const invocation = (value: RuntimeEvidenceResult): RuntimeEvidenceResult => { freshInvocations.add(value); return value; };
const limits = ["A consumer callback is a trust boundary: this library binds its declared source bytes but cannot authenticate the browser, bundle execution, or completeness of DOM collection.", "Synthetic observations never clear LK12. A retained JSON record alone never clears LK12; repeat the bound runner and validate against its fresh result.", "Measured scope is this exact assembly and requested matrix; other static checks, packs, accessibility and deployment remain separate."];
const result = (status: RuntimeEvidenceResult["status"], findings: readonly string[], evidence?: RuntimeAssemblyEvidence): RuntimeEvidenceResult => Object.freeze({ status, findings: Object.freeze([...findings]), ...(evidence ? { evidence } : {}), limits: Object.freeze([...limits]) });
const finiteRect = (rect: RuntimeRect): boolean => !!rect && [rect.left, rect.right, rect.top, rect.bottom, rect.width, rect.height].every(Number.isFinite) && rect.width >= 0 && rect.height >= 0 && Math.abs(rect.right - rect.left - rect.width) <= 0.5 && Math.abs(rect.bottom - rect.top - rect.height) <= 0.5;
const outside = (rect: RuntimeRect, left: number, right: number): boolean => rect.left < left - 0.5 || rect.right > right + 0.5;

/** Pure schema/geometry validation. It authenticates no externally authored observation. */
export function checkRuntimeMeasurements(snapshot: RuntimeAssemblySnapshot, batch: RuntimeMeasurementBatch): { readonly status: "consistent" | "pending" | "refused"; readonly findings: readonly string[] } {
  const missing: string[] = [], violations: string[] = [];
  try {
    batch = runtimeSnapshot(batch);
    if (!batch.bundle.identity?.trim() || !batch.bundle.bytes || batch.bundle.hash !== runtimeHash(batch.bundle.bytes)) violations.push("bundle identity or byte hash differs");
    const expectedKeys = snapshot.cells.map(runtimeCellKey), seen = new Set<string>();
    for (const measurement of batch.cells) {
      const key = runtimeCellKey(measurement.cell), at = key;
      if (!expectedKeys.includes(key)) { violations.push(`${at}: unexpected matrix cell`); continue; }
      if (seen.has(key)) { violations.push(`${at}: duplicate matrix cell`); continue; }
      seen.add(key);
      if (!Number.isFinite(measurement.viewport) || measurement.viewport !== measurement.cell.width || !Number.isFinite(measurement.documentScrollWidth) || measurement.documentScrollWidth <= 0) { missing.push(`${at}: invalid viewport measurement`); continue; }
      if (measurement.documentScrollWidth > measurement.viewport + 1) violations.push(`${at}: document horizontal overflow`);
      if (!measurement.breakpoints || runtimeHash(measurement.breakpoints) !== runtimeHash(snapshot.breakpoints)) missing.push(`${at}: runner breakpoint resolution missing or differs from bound pixels`);
      if (snapshot.stageWidths) {
        if (!snapshot.stageBasisHash || snapshot.stageWidths[key] === undefined || snapshot.orderPending?.includes(key)) missing.push(`${at}: independently measured Stage/order basis pending`);
        else if (!measurement.stage || !Number.isFinite(measurement.stage.width) || measurement.stage.width <= 0 || measurement.stage.width !== snapshot.stageWidths[key] || measurement.stage.basisHash !== snapshot.stageBasisHash) missing.push(`${at}: actual Stage width/source environment basis missing or differs`);
      }
      const elements = measurement.elements;
      const map = new Map<string, RuntimeElementGeometry>();
      for (const element of elements) {
        if (!element.path || map.has(element.path)) { violations.push(`${at}: duplicate or missing element path`); continue; }
        map.set(element.path, element);
      }
      if (snapshot.measuredPaths.some(path => !map.has(path))) missing.push(`${at}: frame or fill geometry missing`);
      const parentOrder = new Set<string>();
      for (const element of elements) {
        if (element.parent !== null && (!parentOrder.has(element.parent) || !map.has(element.parent))) violations.push(`${at}: invalid DOM ancestry or order`);
        parentOrder.add(element.path);
        if (!finiteRect(element.rect) || element.clip !== null && !finiteRect(element.clip) || !element.text.every(finiteRect) || ![element.clientWidth, element.scrollWidth, element.opacity, element.order].every(Number.isFinite) || element.clientWidth < 0 || element.scrollWidth < 0 || element.opacity < 0 || element.opacity > 1) { missing.push(`${at}: nonfinite or inconsistent element geometry`); continue; }
        const visible = (element.clip === null || Math.min(element.rect.right, element.clip.right) > Math.max(element.rect.left, element.clip.left) && Math.min(element.rect.bottom, element.clip.bottom) > Math.max(element.rect.top, element.clip.top)) && element.display !== "none" && element.visibility === "visible" && element.opacity > 0 && element.rect.width > 0 && element.rect.height > 0;
        if (snapshot.measuredPaths.includes(element.path) && !visible) missing.push(`${at}: invisible frame or fill`);
        if (!visible) continue;
        if (outside(element.rect, 0, measurement.viewport) || element.scrollWidth > element.clientWidth + 1 || element.text.some(rect => outside(rect, 0, measurement.viewport) || outside(rect, element.rect.left, element.rect.left + element.clientWidth)) || element.clip !== null && (outside(element.rect, element.clip.left, element.clip.right) || element.text.some(rect => outside(rect, element.clip!.left, element.clip!.right) || rect.top < element.clip!.top - 0.5 || rect.bottom > element.clip!.bottom + 0.5))) violations.push(`${at}: element or clipped text overflow ${element.path}`);
        if (element.order !== 0 || element.flexDirection.endsWith("reverse") || element.gridAutoFlow.includes("dense") || element.direction !== "ltr" || element.writingMode !== "horizontal-tb") violations.push(`${at}: CSS reading-order override ${element.path}`);
      }
      const frame = map.get("frame");
      if (frame && frame.parent !== null) violations.push(`${at}: frame must be the assembly root`);
      for (const path of snapshot.measuredPaths.filter(path => path !== "frame")) {
        let element = map.get(path); const ancestors = new Set<string>();
        while (element?.parent && !ancestors.has(element.parent)) { ancestors.add(element.parent); element = map.get(element.parent); }
        if (frame && map.has(path) && !ancestors.has("frame")) violations.push(`${at}: fill outside actual frame`);
      }
      const expected = snapshot.expectedOrder[key] ?? [];
      const dom = elements.filter(element => expected.includes(element.path)).map(element => element.path);
      if (dom.length === expected.length && dom.some((path, index) => path !== expected[index])) violations.push(`${at}: DOM order differs from bound layout order`);
      // Derive visual reading order recursively from sibling geometry, not an asserted order array.
      const contains = (element: RuntimeElementGeometry): boolean => expected.includes(element.path) || elements.some(child => child.parent === element.path && contains(child));
      const visual = (parent: string): string[] => {
        if (expected.includes(parent)) return [parent];
        const children = elements.filter(element => element.parent === parent && contains(element));
        const container = map.get(parent);
        for (let a = 0; a < children.length; a++) for (let b = a + 1; b < children.length; b++) {
          const first = children[a]!.rect, second = children[b]!.rect;
          if (Math.min(first.right, second.right) - Math.max(first.left, second.left) > 0.5 && Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) > 0.5) violations.push(`${at}: overlapping reading groups`);
        }
        children.sort((a, b) => container?.display.includes("flex") && container.flexDirection.startsWith("row") ? a.rect.left - b.rect.left : Math.abs(a.rect.top - b.rect.top) <= 1 ? a.rect.left - b.rect.left : a.rect.top - b.rect.top);
        return children.flatMap(child => visual(child.path));
      };
      if (frame) {
        const order = visual("frame");
        if (order.length === expected.length && order.some((path, index) => path !== dom[index])) violations.push(`${at}: visual order differs from DOM order`);
        else if (order.length !== expected.length) missing.push(`${at}: incomplete reading-order geometry`);
      }
    }
    if (expectedKeys.some(key => !seen.has(key))) missing.push("requested matrix cells missing");
  } catch { missing.push("plain finite measurement data required"); }
  return { status: violations.length ? "refused" : missing.length ? "pending" : "consistent", findings: [...violations, ...missing] };
}
/** Execute a caller-owned runner once against an immutable assembly; re-resolve after execution. */
export async function runRuntimeAssemblyEvidence<Node>(input: RuntimeAssemblyInput<Node>, runner?: RuntimeMeasurementRunner<Node>): Promise<RuntimeEvidenceResult> {
  const prepared = prepareRuntimeAssembly(input);
  if (prepared.status !== "ready") return result(prepared.status, prepared.findings);
  if (!runner || typeof runner.run !== "function" || !input.runner) return result("pending", ["bound measurement runner required"]);
  try {
    if (runtimeHash(runner.descriptor) !== runtimeHash(input.runner) || !(runner.kind === "browser" || runner.kind === "synthetic")) return result("refused", ["runner source identity differs"]);
    const kind = runner.kind, descriptor = runtimeSnapshot(runner.descriptor);
    const measurements = runtimeSnapshot(await runner.run({ snapshot: prepared.assembly.snapshot, cells: prepared.assembly.snapshot.cells, render: prepared.assembly.render }));
    if (runner.kind !== kind || runtimeHash(runner.descriptor) !== runtimeHash(descriptor)) return result("refused", ["runner identity changed during measurement"]);
    const fresh = prepareRuntimeAssembly(input);
    if (fresh.status !== "ready" || fresh.assembly.snapshot.hash !== prepared.assembly.snapshot.hash) return result("refused", ["assembly changed during measurement"]);
    const checked = checkRuntimeMeasurements(prepared.assembly.snapshot, measurements);
    const data = { version: 1 as const, scope: "consumer-frame-layout-sections" as const, snapshot: prepared.assembly.snapshot, runner: descriptor, kind, measurements };
    const evidence: RuntimeAssemblyEvidence = runtimeSnapshot({ ...data, hash: runtimeHash(data) });
    if (checked.status !== "consistent") return invocation(result(checked.status, checked.findings, evidence));
    return invocation(kind === "synthetic" ? result("pending", ["synthetic validation only; real browser invocation required"], evidence) : result("measured", [], evidence));
  } catch { return result("pending", ["runner execution or finite measurement collection unavailable"]); }
}
/** Retained data requires a fresh invocation; a caller-authored JSON record is never browser clearance. */
export function validateRuntimeAssemblyEvidence<Node>(record: RuntimeAssemblyEvidence, input: RuntimeAssemblyInput<Node>, fresh?: RuntimeEvidenceResult): RuntimeEvidenceResult {
  try {
    const prepared = prepareRuntimeAssembly(input);
    if (prepared.status !== "ready") return result(prepared.status, prepared.findings);
    const retained = runtimeSnapshot(record);
    const { hash, ...data } = retained;
    if (hash !== runtimeHash(data) || retained.snapshot.hash !== prepared.assembly.snapshot.hash || runtimeHash(retained.snapshot) !== runtimeHash(prepared.assembly.snapshot) || retained.scope !== "consumer-frame-layout-sections" || retained.version !== 1 || !input.runner || runtimeHash(retained.runner) !== runtimeHash(input.runner)) return result("refused", ["stale or changed evidence binding"]);
    const checked = checkRuntimeMeasurements(prepared.assembly.snapshot, retained.measurements);
    if (checked.status !== "consistent") return result(checked.status, checked.findings);
    if (!fresh?.evidence || !freshInvocations.delete(fresh)) return result("pending", ["fresh runner invocation required"]);
    if (fresh.status !== "measured") return result(fresh.status, fresh.findings);
    if (fresh.evidence.hash !== retained.hash || runtimeHash(fresh.evidence) !== runtimeHash(retained)) return result("refused", ["fresh evidence differs"]);
    if (retained.kind !== "browser" || fresh.status !== "measured") return result("pending", ["real browser invocation required"]);
    return result("measured", [], retained);
  } catch { return result("refused", ["invalid evidence data"]); }
}
