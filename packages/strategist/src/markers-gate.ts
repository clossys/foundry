/**
 * Claim and constraint marker checks for authored prose — same comment openers
 * as `facts-gate.ts`'s `fact:<key>` citations.
 */

import type { ScannedFile } from "./facts-gate.js";
import type { StrategistClaim, StrategyConstraint } from "./schema.js";

const MARKER_CITATION_RE = /(?:<!--|\/\*|\{\/\*|\/\/)\s*(claim|constraint):([a-z][a-z0-9-]*)/g;

export type MarkersGateRule =
  | "unknown-claim-citation"
  | "hypothesis-claim-citation"
  | "missing-constraint-citation";

export interface MarkersGateFinding {
  rule: MarkersGateRule;
  severity: "error";
  file: string;
  line: number;
  message: string;
  snippet: string;
}

export interface MarkersGateResult {
  findings: MarkersGateFinding[];
  filesScanned: number;
}

function snippetOf(text: string, max = 120): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function collectCitations(content: string): Array<{ kind: "claim" | "constraint"; id: string; line: number; snippet: string }> {
  const rows: Array<{ kind: "claim" | "constraint"; id: string; line: number; snippet: string }> = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    for (const match of line.matchAll(MARKER_CITATION_RE)) {
      rows.push({
        kind: match[1] as "claim" | "constraint",
        id: match[2] as string,
        line: i + 1,
        snippet: snippetOf(line),
      });
    }
  }
  return rows;
}

export function checkClaimMarkers(files: ScannedFile[], claims: StrategistClaim[]): MarkersGateResult {
  const byId = new Map(claims.map((claim) => [claim.id, claim]));
  const findings: MarkersGateFinding[] = [];

  for (const file of files) {
    for (const citation of collectCitations(file.content)) {
      if (citation.kind !== "claim") continue;
      const claim = byId.get(citation.id);
      if (claim === undefined) {
        findings.push({
          rule: "unknown-claim-citation",
          severity: "error",
          file: file.path,
          line: citation.line,
          message: `cites claim "${citation.id}", which does not exist in claims.json`,
          snippet: citation.snippet,
        });
        continue;
      }
      if (claim.status !== "approved") {
        findings.push({
          rule: "hypothesis-claim-citation",
          severity: "error",
          file: file.path,
          line: citation.line,
          message: `cites claim "${citation.id}", which is not approved for audience-facing use`,
          snippet: citation.snippet,
        });
      }
    }
  }

  return { findings, filesScanned: files.length };
}

export interface ConstraintApplyOptions {
  surfaceFiles?: ScannedFile[];
}

export function checkConstraintMarkers(
  files: ScannedFile[],
  constraints: StrategyConstraint[],
  options: ConstraintApplyOptions = {},
): MarkersGateResult {
  const findings: MarkersGateFinding[] = [];
  const copyCorpus = files.flatMap((file) => collectCitations(file.content).filter((row) => row.kind === "constraint"));
  const surfaceCorpus = (options.surfaceFiles ?? []).flatMap((file) =>
    collectCitations(file.content).filter((row) => row.kind === "constraint"),
  );

  const citedInCopy = new Set(copyCorpus.map((row) => row.id));
  const citedOnSurfaces = new Set(surfaceCorpus.map((row) => row.id));

  for (const constraint of constraints) {
    if (constraint.target === "copy" || constraint.target === "all") {
      if (!citedInCopy.has(constraint.id)) {
        findings.push({
          rule: "missing-constraint-citation",
          severity: "error",
          file: "(scan)",
          line: 0,
          message: `constraint "${constraint.id}" with target ${constraint.target} is not cited anywhere in the scan via constraint:${constraint.id}`,
          snippet: constraint.instruction,
        });
      }
    }
    if (constraint.target === "surface" || constraint.target === "all") {
      if (!citedOnSurfaces.has(constraint.id)) {
        findings.push({
          rule: "missing-constraint-citation",
          severity: "error",
          file: "(surfaces)",
          line: 0,
          message: `constraint "${constraint.id}" with target ${constraint.target} is not cited on a declared --surfaces file via constraint:${constraint.id}`,
          snippet: constraint.instruction,
        });
      }
    }
  }

  return { findings, filesScanned: files.length + (options.surfaceFiles?.length ?? 0) };
}

export function checkStrategyApply(
  scanFiles: ScannedFile[],
  claims: StrategistClaim[],
  constraints: StrategyConstraint[],
  options: ConstraintApplyOptions = {},
): MarkersGateResult {
  const claimResult = checkClaimMarkers(scanFiles, claims);
  const constraintResult = checkConstraintMarkers(scanFiles, constraints, options);
  return {
    findings: [...claimResult.findings, ...constraintResult.findings],
    filesScanned: claimResult.filesScanned + (options.surfaceFiles?.length ?? 0),
  };
}
