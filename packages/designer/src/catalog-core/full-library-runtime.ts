import tokenSlots from "../catalog/slots/tokens.json" with { type: "json" };
import assetSlots from "../catalog/slots/assets.json" with { type: "json" };
import sectionSlots from "../catalog/slots/sections.json" with { type: "json" };
import frameSlots from "../catalog/slots/frames.json" with { type: "json" };
import componentSlots from "../catalog/slots/components.json" with { type: "json" };
import { runRuntimeAssemblyEvidence, type RuntimeEvidenceResult, type RuntimeMeasurementRunner } from "./runtime-assembly-evidence.js";
import { runtimeCellKey, type RuntimeAssemblyInput } from "./runtime-assembly.js";
import { runtimeHash, runtimeSnapshot, runtimeSourceFindings, type RuntimeCell, type RuntimeDigest, type RuntimeRendererDescriptor } from "./runtime-ports.js";

export const FULL_LIBRARY_RUNTIME_BUDGET_MS = 5_000;
export interface RuntimePageSerializer<Node> {
  readonly descriptor: RuntimeRendererDescriptor;
  /** Render actual nodes to page bytes; no representative tuple or placeholder markup. */
  render(node: Node, cell: RuntimeCell): string;
}
function selectedSurfaceClosure<Node>(input: RuntimeAssemblyInput<Node>) {
  return [input.binding.frame, ...Object.values(input.binding.sections).flat(), ...Object.values(input.binding.frameSlots).flat()];
}
export interface FullLibraryRuntimeResult {
  readonly status: "measured" | "pending" | "refused";
  readonly findings: readonly string[];
  readonly budgetMs: number;
  readonly serializer: RuntimeRendererDescriptor;
  readonly elapsedMs: number;
  readonly inventory: { readonly tokens: number; readonly assets: number; readonly components: number; readonly sections: number; readonly frames: number };
  readonly pages: readonly { readonly cell: RuntimeCell; readonly bytes: string; readonly hash: RuntimeDigest }[];
  readonly runtime?: RuntimeEvidenceResult;
  readonly hash: RuntimeDigest;
}
/** Validate the real registered inventory, never a caller's smaller contract tuple.
 * Missing qualifications remain findings; this harness creates no fills or evidence. */
export function fullLibraryRuntimeFindings<Node>(input: RuntimeAssemblyInput<Node>): string[] {
  const findings: string[] = [];
  const values = input.engine.library.values.fills.map(fill => fill.$extensions["com.clossys.fill"].slot);
  const components = input.engine.library.components.fills.flatMap(fill => Object.values(fill.components));
  for (const slot of [...tokenSlots, ...assetSlots]) if (values.filter(id => id === slot.id).length !== 1) findings.push(`whole-library value fill missing or duplicated: ${slot.id}`);
  for (const slot of componentSlots) {
    const fills = components.filter(fill => fill.slot === slot.id);
    if (fills.length !== 1) findings.push(`whole-library component fill missing or duplicated: ${slot.id}`);
    else if (fills[0]!.blockers?.length) findings.push(`whole-library component is blocked: ${slot.id}`);
    if (!input.engine.componentOptions?.evidence?.observations[slot.id]) findings.push(`actual component qualification missing: ${slot.id}`);
  }
  const selected = selectedSurfaceClosure(input);
  if (!selected.some(fill => fill.leaf.startsWith("sections."))) findings.push("selected Sections closure missing");
  if (!input.engine.library.surfaces?.fills.length) findings.push("actual selected Sections/Frames library portion missing");
  const surfaces = input.engine.library.surfaces?.fills ?? [];
  for (const selection of selected) {
    if (surfaces.filter(fill => fill.$extensions["com.clossys.fill"].slot === selection.leaf && fill.$extensions["com.clossys.fill"].id === selection.fill).length !== 1) findings.push(`selected surface ownership missing or duplicated: ${selection.leaf}`);
    if (!input.ports.manifest.fills.some(fill => fill.leaf === selection.leaf && fill.fill === selection.fill && fill.config === selection.config && fill.surface)) findings.push(`selected surface runtime closure missing: ${selection.leaf}`);
  }
  // The consumer library may own other pages; only this binding must close here.
  for (const slot of [...tokenSlots, ...assetSlots, ...componentSlots, ...sectionSlots.filter(slot => selected.some(fill => fill.leaf === slot.id)), ...frameSlots.filter(slot => selected.some(fill => fill.leaf === slot.id))]) {
    const actual = input.contracts.slots.filter(contract => contract.id === slot.id);
    if (actual.length !== 1) findings.push(`full graph contract missing or duplicated: ${slot.id}`);
    else if (runtimeHash(actual[0]!.contract) !== runtimeHash(slot.contract)) findings.push(`full graph contract differs: ${slot.id}`);
  }
  return findings;
}
/** One timed full graph: strict resolution/qualification, selected surface chain,
 * every requested rendered page and fresh browser observations. The fixed budget
 * covers the entire invocation, including preparation and serialization. */
export async function runFullLibraryRuntime<Node>(input: RuntimeAssemblyInput<Node>, runner: RuntimeMeasurementRunner<Node>, page: RuntimePageSerializer<Node>): Promise<FullLibraryRuntimeResult> {
  const start = performance.now();
  const pages: { cell: RuntimeCell; bytes: string; hash: RuntimeDigest }[] = [];
  const selected = selectedSurfaceClosure(input);
  const selectedCount = (prefix: "sections." | "frames.") => new Set(selected.filter(fill => fill.leaf.startsWith(prefix)).map(fill => JSON.stringify([fill.leaf, fill.fill]))).size;
  const inventory = {
    tokens: input.engine.library.values.fills.filter(fill => fill.$extensions["com.clossys.fill"].slot.startsWith("tokens.")).length,
    assets: input.engine.library.values.fills.filter(fill => fill.$extensions["com.clossys.fill"].slot.startsWith("assets.")).length,
    components: input.engine.library.components.fills.reduce((sum, fill) => sum + Object.keys(fill.components).length, 0),
    sections: selectedCount("sections."),
    frames: selectedCount("frames."),
  };
  const finish = (status: FullLibraryRuntimeResult["status"], findings: readonly string[], runtime?: RuntimeEvidenceResult): FullLibraryRuntimeResult => {
    const elapsedMs = performance.now() - start;
    const overdue = elapsedMs > FULL_LIBRARY_RUNTIME_BUDGET_MS;
    const data = { status: overdue ? "refused" as const : status, findings: [...findings, ...(overdue ? ["full graph exceeded 5000 ms budget"] : [])], budgetMs: FULL_LIBRARY_RUNTIME_BUDGET_MS, elapsedMs, serializer: page.descriptor, inventory, pages, ...(runtime ? { runtime } : {}) };
    return runtimeSnapshot({ ...data, hash: runtimeHash(data) });
  };
  try {
    const missing = fullLibraryRuntimeFindings(input);
    if (missing.length) return finish("pending", missing);
    if (runner.kind !== "browser") return finish("pending", ["actual browser runner required; synthetic runtime tests are unit coverage only"]);
    if (runtimeSourceFindings(page.descriptor).length || typeof page.render !== "function") return finish("refused", ["source-bound actual page serializer required"]);
    const descriptorHash = runtimeHash(page.descriptor), runnerHash = runtimeHash(runner.descriptor);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    const measured = runRuntimeAssemblyEvidence(input, { ...runner, run: async request => {
      if (performance.now() - start >= FULL_LIBRARY_RUNTIME_BUDGET_MS) throw new Error("full graph exceeded 5000 ms budget");
      const seen = new Set<string>();
      const batch = await runner.run({ ...request, render(cell) {
        if (expired) throw new Error("full graph deadline expired");
        const node = request.render(cell), bytes = page.render(node, cell);
        if (typeof bytes !== "string" || !/<[A-Za-z][^>]*>/.test(bytes)) throw new Error("actual rendered page bytes missing");
        const key = runtimeCellKey(cell);
        if (!seen.has(key)) { pages.push({ cell, bytes, hash: runtimeHash(bytes) }); seen.add(key); }
        return node;
      } });
      if (request.cells.some(cell => !seen.has(runtimeCellKey(cell)))) throw new Error("full page matrix not rendered");
      return batch;
    } });
    const timeout = new Promise<RuntimeEvidenceResult>(resolve => { timer = setTimeout(() => { expired = true; resolve({ status: "refused", findings: ["full graph exceeded 5000 ms budget"], limits: ["Caller-owned runner must release its browser resources after deadline."] }); }, Math.max(0, FULL_LIBRARY_RUNTIME_BUDGET_MS - (performance.now() - start))); });
    let runtime: RuntimeEvidenceResult;
    try { runtime = await Promise.race([measured, timeout]); } finally { clearTimeout(timer); }
    if (runner.kind !== "browser" || runtimeHash(runner.descriptor) !== runnerHash) return finish("refused", ["browser runner identity changed during execution"], runtime);
    if (runtimeHash(page.descriptor) !== descriptorHash) return finish("refused", ["page serializer identity changed during execution"], runtime);
    return finish(runtime.status, runtime.findings, runtime);
  } catch (error) { return finish("refused", [error instanceof Error ? error.message : "invalid full-library runtime input"]); }
}
