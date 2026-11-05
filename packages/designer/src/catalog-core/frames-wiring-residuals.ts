/**
 * The frame layer's wiring check: every WL2/WL3/WL4 error `checkWiring` reports over `src/frames`
 * and `src/shell` (registered component fills excluded, since a Component reads themes freely).
 * There is no committed report and no budget: `scripts/frames-wiring-residuals.mjs --check` and
 * `frames-wiring.test.ts` both fail on any finding at all.
 */
import type { WiringFinding, WiringInput, WiringResult } from "./wiring.js";

export const RESIDUAL_CODES = ["WL2", "WL3", "WL4"] as const;

export interface FramesWiringResidual { code: string; file: string; evidence: string }

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

/** The frame layer's WL2/WL3/WL4 errors; the layer is clean only when this is empty. */
export function framesWiringResiduals(input: FrameLayerReader & { checkWiring(input: WiringInput): WiringResult; exceptions: unknown }): FramesWiringResidual[] {
  return residualsOf(input.checkWiring(frameLayerWiringInput(input, input.exceptions)).findings);
}
