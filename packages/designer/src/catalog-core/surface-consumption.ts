/** Joins authored slot contracts to source-derived lower bounds; never edits either. */
import { scanSurfaceReads, type ConsumptionReads, type ConsumptionToken, type SurfaceReadContract } from "./consumption.js";
import { dogfoodComposes, runDogfood, type DogfoodCode, type DogfoodInput } from "./dogfood.js";

export interface SurfaceConsumptionSlot {
  id: string;
  contract: { allowedReads: Partial<ConsumptionReads>; allowedComposes?: readonly string[]; composes?: readonly string[]; parts?: readonly string[] };
}
export interface SurfaceConsumptionScan {
  fill: string; files: { path: string; content: string }[];
  resolvedImports?: Readonly<Record<string, string>>;
  unresolved?: readonly { file: string; line: number; evidence: string; code?: DogfoodCode }[];
}
export interface SurfaceConsumptionInput {
  themes: readonly ConsumptionToken[]; assets: readonly { id: string }[]; components: readonly { id: string }[];
  sections: SurfaceConsumptionSlot[]; frames: SurfaceConsumptionSlot[];
  fills: { id: string; slot: string; source: string; pin?: unknown }[];
  sourceScans: SurfaceConsumptionScan[]; themeCss: string;
}
export interface SurfaceConsumptionFinding { code: DogfoodCode; fill: string; file: string; line: number; evidence: string }
/** Portable source-only lower bound, independent of a descriptor's declared fields. */
export interface PrivateInternalReadWitness {
  target: string; targetSha256: string;
  file: string; sourceSha256: string; specifier: string; line: number;
  rawAssets: readonly string[];
}
export interface SurfaceConsumptionMeasurement {
  scanStatus: "lower-bound" | "unavailable";
  /** Original source file byte hashes, before reachable-declaration selection. */
  sourceFiles: readonly { path: string; sha256: string }[];
  scannedReads: ConsumptionReads;
  /** Original lexical observations and proven runtime import evidence, supplied only by the Node producer. */
  rawScannedReads?: ConsumptionReads;
  privateInternalReads?: readonly PrivateInternalReadWitness[];
  scannedComposes: readonly string[];
  /** Retained unknown source edges; a lower bound does not qualify runtime behavior. */
  unresolved?: readonly { file: string; line: number; evidence: string; code?: DogfoodCode }[];
}
const sorted = (items: readonly string[]): string[] => [...new Set(items)].sort();
const reads = (value: Partial<ConsumptionReads>): ConsumptionReads => ({ themes: sorted(value.themes ?? []), assets: sorted(value.assets ?? []), components: sorted(value.components ?? []) });

export function buildSurfaceConsumption(input: SurfaceConsumptionInput) {
  const slots = [...input.sections, ...input.frames], scans = new Map(input.sourceScans.map(row => [row.fill, row]));
  const inventory = Object.fromEntries((["themes", "assets", "components", "sections", "frames"] as const).map(layer => [layer, sorted(input[layer].map(row => row.id))])) as Record<"themes" | "assets" | "components" | "sections" | "frames", string[]>;
  const findings: SurfaceConsumptionFinding[] = [];
  const fills = [...input.fills].sort((a, b) => a.id.localeCompare(b.id)).map(fill => {
    const slot = slots.find(row => row.id === fill.slot), scan = scans.get(fill.id);
    const declaredComposes = sorted([...(slot?.contract.allowedComposes ?? []), ...(slot?.contract.composes ?? []), ...(slot?.contract.parts ?? []), ...(slot?.contract.allowedReads.components ?? [])]);
    const declaredReads = reads({ ...slot?.contract.allowedReads, components: declaredComposes.filter(id => id.startsWith("components.")) });
    const contract: SurfaceReadContract = { id: fill.slot, allowedReads: declaredReads, allowedComposes: declaredComposes };
    const files = scan?.files ?? [];
    const dogfoodInput: DogfoodInput = { files: files.map(file => ({ file: file.path, content: file.content })), themes: input.themes, themeCss: input.themeCss,
      contracts: Object.fromEntries(files.map(file => [file.path, contract])), resolvedImports: scan?.resolvedImports };
    const observedComposes = dogfoodComposes(dogfoodInput), dogfood = runDogfood(dogfoodInput);
    const scannedComposes = sorted(observedComposes.map(row => row.slotId));
    const readScans = scanSurfaceReads(files, contract, input.themes, input.themeCss);
    const scannedReads = reads({ themes: readScans.flatMap(row => row.themes), assets: readScans.flatMap(row => row.assets), components: scannedComposes.filter(id => id.startsWith("components.")) });
    const missingDeclaredReads = reads(Object.fromEntries((["themes", "assets", "components"] as const).map(layer => [layer, scannedReads[layer].filter(id => !declaredReads[layer].includes(id))])));
    const effectiveReads = reads(Object.fromEntries((["themes", "assets", "components"] as const).map(layer => [layer, [...declaredReads[layer], ...scannedReads[layer]]])));
    findings.push(...dogfood.findings.map(row => ({ code: row.code, fill: fill.id, file: row.file, line: row.line, evidence: row.evidence })));
    // Whole reachable declarations include token-bound class constants and helper reads,
    // not just JSX attribute literals. This is the same consumption scanner as DF4.
    for (const row of readScans) for (const finding of row.findings) findings.push({ code: "DF4", fill: fill.id, file: row.file, line: 1, evidence: `${finding.code}: ${finding.reads.join(", ")}` });
    for (const row of scan?.unresolved ?? []) findings.push({ code: row.code ?? "DF2", fill: fill.id, file: row.file, line: row.line, evidence: row.evidence });
    if (!slot || !scan || !files.length) findings.push({ code: "DF2", fill: fill.id, file: "", line: 0, evidence: !slot ? "authored slot contract unavailable" : "source scan unavailable; not an empty measured scan" });
    return { ...fill, scanStatus: slot && files.length ? "lower-bound" : "unavailable", sourceFiles: sorted(files.map(file => file.path)),
      declaredReads, scannedReads, effectiveReads, missingDeclaredReads,
      declaredComposes, scannedComposes, effectiveComposes: sorted([...declaredComposes, ...scannedComposes]), missingDeclaredComposes: scannedComposes.filter(id => !declaredComposes.includes(id)),
      observedComposes, scannedTokenMembers: sorted(readScans.flatMap(row => row.tokenMembers)), scannedProperties: sorted(readScans.flatMap(row => row.properties)), expandedUtilities: sorted(readScans.flatMap(row => row.utilities)),
      unresolved: [...(scan?.unresolved ?? [])], structural: dogfood.structural, ignored: dogfood.ignored,
    };
  });
  const reverseComposes = Object.fromEntries([...inventory.components, ...inventory.sections, ...inventory.frames].sort().map(id => [id, {
    declared: fills.filter(row => row.declaredComposes.includes(id)).map(row => row.id), scanned: fills.filter(row => row.scannedComposes.includes(id)).map(row => row.id), effective: fills.filter(row => row.effectiveComposes.includes(id)).map(row => row.id),
  }]));
  const reverseReads = Object.fromEntries([...inventory.themes, ...inventory.assets].sort().map(id => [id, {
    declared: fills.filter(row => [...row.declaredReads.themes, ...row.declaredReads.assets].includes(id)).map(row => row.id), scanned: fills.filter(row => [...row.scannedReads.themes, ...row.scannedReads.assets].includes(id)).map(row => row.id), effective: fills.filter(row => [...row.effectiveReads.themes, ...row.effectiveReads.assets].includes(id)).map(row => row.id),
  }]));
  findings.sort((a, b) => a.fill.localeCompare(b.fill) || a.file.localeCompare(b.file) || a.line - b.line || a.code.localeCompare(b.code) || a.evidence.localeCompare(b.evidence));
  return { schemaVersion: 1, scope: "Authored section/frame contracts and reachable source observations; source-only lower bounds.", inventory,
    claims: { descriptorConformance: "unmeasured", consumerAdoption: "unmeasured", runtimeAccessibility: "unmeasured", reportFreshness: "Reproducibility only; not conformance clearance." },
    scanMethod: { reads: "Shared scanSurfaceReads utility/property expansion on comment-free reachable runtime declarations.", composition: "Shared dogfood JSX parser; imports resolved to exact descriptor export identities, stopping at registered slot boundaries.",
      limitations: ["Dynamic styling, imports and unregistered visual source remain findings; runtime behavior is unmeasured.", "Registered primitives own their internal reads; those are not attributed to a section or frame caller.", "Unfilled slots and unavailable source are unmeasured, never clean.", "Line numbers address selected comment-free source snippets; source files and original import provenance are retained."] },
    summary: { descriptors: fills.length, scanned: fills.filter(row => row.scanStatus === "lower-bound").length, findings: findings.length, undeclaredReads: fills.filter(row => Object.values(row.missingDeclaredReads).some(ids => ids.length)).length, undeclaredComposes: fills.filter(row => row.missingDeclaredComposes.length).length },
    slots: slots.map(slot => ({ id: slot.id, fills: fills.filter(fill => fill.slot === slot.id).map(fill => fill.id), measurement: fills.some(fill => fill.slot === slot.id && fill.scanStatus === "lower-bound") ? "lower-bound" : "unmeasured" })).sort((a, b) => a.id.localeCompare(b.id)),
    fills, findings, reverseReads, reverseComposes,
  };
}
