/**
 * The frame layer's wiring residuals, generated: every WL2/WL3/WL4 error `checkWiring` still reports
 * over `src/frames` and `src/shell` (registered component fills excluded, since a Component reads
 * themes freely). `scripts/frames-wiring-residuals.mjs` writes them to
 * `src/catalog/reports/frames-wiring-residuals.json`; `frames-wiring.test.ts` compares the live scan
 * with that report, and the generator refuses to write a report that grows (`residualGrowth`).
 */
import type { WiringFinding, WiringInput, WiringResult } from "./wiring.js";

export const FRAMES_WIRING_RESIDUALS_SCHEMA = "clossys.frames-wiring-residuals/1";
export const RESIDUAL_CODES = ["WL2", "WL3", "WL4"] as const;

export interface FramesWiringResidual { code: string; file: string; evidence: string }
export interface FramesWiringResidualReport { schema: string; generatedBy: string; residuals: FramesWiringResidual[] }

export interface FrameLayerReader {
  read(path: string): string;
  walk(dir: string): string[];
}

interface ConsumptionFill { slot: string; sourceFiles?: string[] }
const local = (file: string): string => file.replace(/^packages\/designer\//, "");
const isSource = (path: string): boolean => /\.(?:tsx?|css)$/.test(path) && !/\.test\.tsx?$|\.check\.tsx$/.test(path);

/** Registered `components.*` fills under src/frames or src/shell that back no `frames.*` fill. Derived from the generated consumption reports. */
export function frameLayerComponentFiles(reader: FrameLayerReader): Set<string> {
  const fills = (report: string): ConsumptionFill[] => (JSON.parse(reader.read(report)) as { fills: ConsumptionFill[] }).fills;
  const frameFiles = new Set(fills("src/catalog/reports/sections-frames-consumption.json").filter(fill => fill.slot.startsWith("frames.")).flatMap(fill => (fill.sourceFiles ?? []).map(local)));
  return new Set(fills("src/catalog/reports/components-consumption.json").flatMap(fill => (fill.sourceFiles ?? []).map(local)).filter(file => /^src\/(?:frames|shell)\//.test(file) && !frameFiles.has(file)));
}

/** Every frame-layer source `checkWiring` scans, in walk order. */
export function frameLayerSources(reader: FrameLayerReader): WiringInput["sources"] {
  const components = frameLayerComponentFiles(reader);
  return [...reader.walk("src/frames"), ...reader.walk("src/shell")]
    .filter(path => isSource(path) && !components.has(path))
    .map(path => ({ path, content: reader.read(path), layer: "frames" as const }));
}

/** The wiring input the frame layer is checked with: theme-keys.css `@theme inline` keys expand utilities into themes reads. */
export function frameLayerWiringInput(reader: FrameLayerReader, exceptions: unknown): WiringInput {
  return {
    sources: frameLayerSources(reader),
    themes: JSON.parse(reader.read("src/catalog/slots/themes.json")) as WiringInput["themes"],
    themeCss: reader.read("styles/theme-keys.css"),
    exceptions,
  };
}

const order = (a: FramesWiringResidual, b: FramesWiringResidual) => a.code.localeCompare(b.code) || a.file.localeCompare(b.file) || a.evidence.localeCompare(b.evidence);

export function residualsOf(findings: readonly WiringFinding[]): FramesWiringResidual[] {
  return findings
    .filter(row => row.severity === "error" && (RESIDUAL_CODES as readonly string[]).includes(row.code))
    .map(row => ({ code: row.code, file: row.file, evidence: row.evidence }))
    .sort(order);
}

export function framesWiringResiduals(input: FrameLayerReader & { checkWiring(input: WiringInput): WiringResult; exceptions: unknown }): FramesWiringResidualReport {
  return {
    schema: FRAMES_WIRING_RESIDUALS_SCHEMA,
    generatedBy: "packages/designer/scripts/frames-wiring-residuals.mjs",
    residuals: residualsOf(input.checkWiring(frameLayerWiringInput(input, input.exceptions)).findings),
  };
}

/** Findings in `next` beyond those in `committed`, counted as a multiset: what a regeneration may never add. */
export function residualGrowth(committed: readonly FramesWiringResidual[], next: readonly FramesWiringResidual[]): FramesWiringResidual[] {
  const key = (row: FramesWiringResidual) => `${row.code}\u0000${row.file}\u0000${row.evidence}`;
  const budget = new Map<string, number>();
  for (const row of committed) budget.set(key(row), (budget.get(key(row)) ?? 0) + 1);
  const added: FramesWiringResidual[] = [];
  for (const row of next) {
    const left = budget.get(key(row)) ?? 0;
    if (left > 0) budget.set(key(row), left - 1); else added.push(row);
  }
  return added;
}
