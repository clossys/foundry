/**
 * `checkStrategyHandoff` — whether a strategy directory is ready for downstream
 * skills. Separate from `StrategyBundle.complete`: complete means every present
 * file validates; handoff means the required handoff surface exists and refs resolve.
 */

import type { StrategyBundle, StrategyReadIssue } from "./reader.js";
import type { DirectionEntity, StrategistClaim } from "./schema.js";

export interface HandoffFinding {
  message: string;
}

export interface HandoffResult {
  ok: boolean;
  /** Present when the directory could not be loaded at all. */
  reason?: "unreadable";
  findings: HandoffFinding[];
}

function push(findings: HandoffFinding[], message: string): void {
  findings.push({ message });
}

function approvedClaims(claims: StrategistClaim[] | undefined): StrategistClaim[] {
  return (claims ?? []).filter((claim) => claim.status === "approved");
}

function resolveSubject(bundle: StrategyBundle, file: string, id: string): boolean {
  switch (file) {
    case "audiences.json":
      return (bundle.audiences ?? []).some((row) => row.id === id);
    case "markets.json":
      return (bundle.markets ?? []).some((row) => row.id === id);
    case "positioning.json":
      return bundle.positioning !== undefined && id === "positioning";
    case "claims.json":
      return (bundle.claims ?? []).some((row) => row.id === id);
    case "mission.json":
      return bundle.mission !== undefined && id === "mission";
    default:
      return false;
  }
}

/** Whether `readStrategy` failed closed on the strategy root (exit code 2). */
export function strategyDirectoryUnreadable(issues: StrategyReadIssue[]): boolean {
  return issues.some(
    (issue) =>
      issue.file === "facts.json" &&
      (issue.reason === "missing-required" || issue.reason === "unreadable" || issue.reason === "unparseable"),
  );
}

export function checkStrategyHandoff(bundle: StrategyBundle): HandoffResult {
  const findings: HandoffFinding[] = [];

  if (strategyDirectoryUnreadable(bundle.issues)) {
    return { ok: false, reason: "unreadable", findings: [{ message: "facts.json could not be loaded" }] };
  }

  const factKeys = new Set(bundle.facts.map((fact) => fact.key));
  const audienceIds = new Set((bundle.audiences ?? []).map((row) => row.id));
  const claimIds = new Set((bundle.claims ?? []).map((row) => row.id));
  const attributeIds = new Set((bundle.brand?.attributes ?? []).map((row) => row.id));
  const directionIds = new Set((bundle.directions ?? []).map((row) => row.id));

  if (bundle.audiences === undefined) push(findings, "audiences.json is required for handoff");
  if (bundle.positioning === undefined) push(findings, "positioning.json is required for handoff");
  if (approvedClaims(bundle.claims).length === 0) push(findings, "at least one approved claim is required for handoff");
  if (bundle.constraints === undefined) push(findings, "constraints.json is required for handoff (an empty array is valid)");
  if (bundle.brand === undefined) push(findings, "brand.json is required for handoff");
  if (bundle.directions === undefined || bundle.directions.length === 0) push(findings, "direction.json is required for handoff");

  for (const id of bundle.positioning?.audienceIds ?? []) {
    if (!audienceIds.has(id)) push(findings, `positioning.json references unknown audience id "${id}"`);
  }
  for (const id of bundle.positioning?.claimIds ?? []) {
    if (!claimIds.has(id)) push(findings, `positioning.json references unknown claim id "${id}"`);
  }

  for (const market of bundle.markets ?? []) {
    for (const id of market.audienceIds) {
      if (!audienceIds.has(id)) push(findings, `markets.json references unknown audience id "${id}"`);
    }
    for (const key of market.factRefs ?? []) {
      if (!factKeys.has(key)) push(findings, `markets.json references unknown fact key "${key}"`);
    }
  }

  for (const claim of bundle.claims ?? []) {
    for (const key of claim.factRefs ?? []) {
      if (!factKeys.has(key)) push(findings, `claims.json references unknown fact key "${key}"`);
    }
    for (const id of claim.audienceIds ?? []) {
      if (!audienceIds.has(id)) push(findings, `claims.json references unknown audience id "${id}"`);
    }
  }

  for (const attribute of bundle.brand?.attributes ?? []) {
    if (attribute.factRef !== undefined && !factKeys.has(attribute.factRef)) {
      push(findings, `brand.json references unknown fact key "${attribute.factRef}"`);
    }
  }

  for (const derivation of bundle.brand?.derivations ?? []) {
    if (!attributeIds.has(derivation.attributeId)) {
      push(findings, `brand.json references unknown attribute id "${derivation.attributeId}"`);
    }
  }

  for (const item of bundle.roadmap ?? []) {
    if (item.status === "shipped" && item.factRef === undefined && item.claimId === undefined) {
      push(findings, `roadmap item "${item.id}" with status shipped requires factRef or claimId`);
    }
    if (item.factRef !== undefined && !factKeys.has(item.factRef)) {
      push(findings, `roadmap.json references unknown fact key "${item.factRef}"`);
    }
    if (item.claimId !== undefined && !claimIds.has(item.claimId)) {
      push(findings, `roadmap.json references unknown claim id "${item.claimId}"`);
    }
  }

  for (const entity of bundle.directions ?? []) {
    if (entity.supersedes !== undefined && !directionIds.has(entity.supersedes)) {
      push(findings, `direction.json references unknown direction id "${entity.supersedes}"`);
    }
    for (const id of entity.derivesFrom) {
      if (!directionIds.has(id)) push(findings, `direction.json references unknown direction id "${id}"`);
    }
    if (!resolveSubject(bundle, entity.subject.file, entity.subject.id)) {
      push(findings, `direction subject ${entity.subject.file}#${entity.subject.id} does not resolve`);
    }
  }

  return { ok: findings.length === 0, findings };
}

export function currentDirectionId(entities: DirectionEntity[]): string | undefined {
  const superseded = new Set<string>();
  for (const entity of entities) {
    if (entity.supersedes !== undefined) superseded.add(entity.supersedes);
  }
  const current = entities.filter((entity) => !superseded.has(entity.id));
  if (current.length !== 1) return undefined;
  return current[0]?.id;
}
