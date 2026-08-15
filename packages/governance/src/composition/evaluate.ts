import type {
  CompositionCapabilitySupply,
  CompositionConstraintResult,
  CompositionDeclaration,
  CompositionEvaluation,
  CompositionEvaluationInput,
  CompositionException,
  CompositionFinding,
  CompositionOperatorDecision,
  CompositionProvenanceEntry,
  CompositionResolution,
  CompositionResolutionStatus,
  CompositionScope,
} from "./types.js";
import { groupKey } from "./keys.js";
import { readCompositionEvaluationInput } from "./validate.js";

interface CompositionGroup {
  capability: string;
  scope: CompositionScope;
  declarations: CompositionDeclaration[];
  supplies: CompositionCapabilitySupply[];
  decision?: CompositionOperatorDecision;
  exceptions: CompositionException[];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

function groupsFrom(input: CompositionEvaluationInput): CompositionGroup[] {
  const groups = new Map<string, CompositionGroup>();
  for (const declaration of input.declarations) {
    const key = groupKey(declaration.capability, declaration.scope);
    const group = groups.get(key);
    if (group) group.declarations.push(declaration);
    else groups.set(key, {
      capability: declaration.capability,
      scope: declaration.scope,
      declarations: [declaration],
      supplies: [],
      exceptions: [],
    });
  }
  for (const supply of input.supplies) groups.get(groupKey(supply.capability, supply.scope))?.supplies.push(supply);
  for (const decision of input.decisions) {
    const group = groups.get(groupKey(decision.capability, decision.scope));
    if (group) group.decision = decision;
  }
  const declarationGroups = new Map(input.declarations.map((entry) => [entry.id, groupKey(entry.capability, entry.scope)]));
  for (const exception of input.exceptions) {
    const key = declarationGroups.get(exception.targetDeclarationIds[0] as string);
    if (key) groups.get(key)?.exceptions.push(exception);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      declarations: group.declarations.sort((left, right) => compareText(left.id, right.id)),
      supplies: group.supplies.sort((left, right) => compareText(left.id, right.id)),
      exceptions: group.exceptions.sort((left, right) => compareText(left.id, right.id)),
    }))
    .sort((left, right) => compareText(groupKey(left.capability, left.scope), groupKey(right.capability, right.scope)));
}

function hardAcceptedValues(declarations: readonly CompositionDeclaration[]): string[] | undefined {
  let accepted: string[] | undefined;
  for (const declaration of declarations) {
    if (declaration.kind === "preference" || declaration.constraint.kind === "present") continue;
    accepted = accepted === undefined
      ? uniqueSorted(declaration.constraint.values)
      : accepted.filter((value) => declaration.constraint.kind === "one-of" && declaration.constraint.values.includes(value));
  }
  return accepted;
}

function availableValues(supplies: readonly CompositionCapabilitySupply[]): string[] {
  return uniqueSorted(supplies.flatMap((supply) => supply.state === "available" ? supply.values : []));
}

function provenanceFor(group: CompositionGroup): CompositionProvenanceEntry[] {
  const entries: CompositionProvenanceEntry[] = [
    ...group.declarations.map((entry) => ({ role: entry.kind, id: entry.id, ...entry.provenance } as const)),
    ...group.supplies.map((entry) => ({ role: "supply" as const, id: entry.id, ...entry.provenance })),
    ...(group.decision ? [{ role: "decision" as const, id: group.decision.id, ...group.decision.provenance }] : []),
    ...group.exceptions.map((entry) => ({ role: "exception" as const, id: entry.id, ...entry.provenance })),
  ];
  return entries.sort((left, right) => compareText(`${left.role}\u0000${left.id}`, `${right.role}\u0000${right.id}`));
}

function activeExceptionIdsFor(
  declarationId: string,
  selectedValue: string,
  decision: CompositionOperatorDecision,
  exceptions: readonly CompositionException[],
  evaluatedAt: string,
): string[] {
  const referenced = new Set(decision.exceptionIds);
  const evaluatedTimestamp = Date.parse(evaluatedAt);
  return exceptions
    .filter((exception) => referenced.has(exception.id)
      && exception.targetDeclarationIds.includes(declarationId)
      && exception.allowedValues.includes(selectedValue)
      && (exception.reviewBy === undefined || Date.parse(exception.reviewBy) > evaluatedTimestamp)
      && (exception.expiresAt === undefined || Date.parse(exception.expiresAt) > evaluatedTimestamp))
    .map((exception) => exception.id)
    .sort(compareText);
}

function constraintResults(
  group: CompositionGroup,
  selectedValue: string | undefined,
  supplied: boolean,
  evaluatedAt: string,
): CompositionConstraintResult[] {
  const results: CompositionConstraintResult[] = [];
  for (const declaration of group.declarations) {
    if (declaration.kind === "preference") continue;
    if (selectedValue === undefined) {
      results.push({
        declarationId: declaration.id,
        kind: declaration.kind,
        status: "unresolved",
        exceptionIds: [],
        provenance: declaration.provenance,
      });
      continue;
    }
    const satisfied = supplied && (declaration.constraint.kind === "present" || declaration.constraint.values.includes(selectedValue));
    const exceptionIds = satisfied || !group.decision
      ? []
      : activeExceptionIdsFor(declaration.id, selectedValue, group.decision, group.exceptions, evaluatedAt);
    results.push({
      declarationId: declaration.id,
      kind: declaration.kind,
      status: satisfied ? "satisfied" : exceptionIds.length > 0 ? "excepted" : "violated",
      exceptionIds,
      provenance: declaration.provenance,
    });
  }
  return results;
}

function resolveGroup(group: CompositionGroup, evaluatedAt: string): CompositionResolution {
  const suppliedValues = availableValues(group.supplies);
  const hardValues = hardAcceptedValues(group.declarations);
  const compatibleValues = hardValues === undefined
    ? suppliedValues
    : suppliedValues.filter((value) => hardValues.includes(value));
  let selectedValue: string | undefined;
  let status: CompositionResolutionStatus;

  if (group.decision) {
    selectedValue = group.decision.selectedValue;
    const supplied = suppliedValues.includes(selectedValue);
    const constraints = constraintResults(group, selectedValue, supplied, evaluatedAt);
    if (!supplied || constraints.some((constraint) => constraint.status === "violated")) status = "conflicting";
    else status = constraints.some((constraint) => constraint.status === "excepted") ? "exception-mediated" : "effective";
    return {
      capability: group.capability,
      scope: group.scope,
      status,
      ...(status === "effective" || status === "exception-mediated" ? { selectedValue } : {}),
      compatibleValues,
      constraints,
      provenance: provenanceFor(group),
    };
  }

  if (hardValues !== undefined && hardValues.length === 0) {
    status = "conflicting";
  } else if (suppliedValues.length === 0) {
    status = group.supplies.length > 0 && group.supplies.every((supply) => supply.state === "unavailable")
      ? "conflicting"
      : "unknown";
  } else if (compatibleValues.length === 0) {
    status = "conflicting";
  } else {
    const preferred = uniqueSorted(group.declarations.flatMap((declaration) =>
      declaration.kind === "preference" && compatibleValues.includes(declaration.value) ? [declaration.value] : []));
    if (preferred.length === 1) selectedValue = preferred[0];
    else if (preferred.length === 0 && compatibleValues.length === 1) selectedValue = compatibleValues[0];
    status = selectedValue === undefined ? "unknown" : "effective";
  }

  return {
    capability: group.capability,
    scope: group.scope,
    status,
    ...(selectedValue === undefined ? {} : { selectedValue }),
    compatibleValues,
    constraints: constraintResults(group, selectedValue, selectedValue !== undefined && suppliedValues.includes(selectedValue), evaluatedAt),
    provenance: provenanceFor(group),
  };
}

function resultFinding(result: CompositionResolution, index: number): CompositionFinding | undefined {
  if (result.status === "conflicting") return {
    rule: "composition-conflict",
    severity: "error",
    path: `resolutions[${index}]`,
    message: "Caller-supplied constraints, capability supply, decision, and active exceptions do not permit one effective value.",
  };
  if (result.status === "unknown") return {
    rule: "composition-unknown",
    severity: "error",
    path: `resolutions[${index}]`,
    message: "Caller-supplied evidence does not determine one effective value; an explicit decision or conclusive supply is required.",
  };
  return undefined;
}

function overallStatus(resolutions: readonly CompositionResolution[]): CompositionResolutionStatus {
  if (resolutions.some((entry) => entry.status === "conflicting")) return "conflicting";
  if (resolutions.some((entry) => entry.status === "unknown")) return "unknown";
  if (resolutions.some((entry) => entry.status === "exception-mediated")) return "exception-mediated";
  return "effective";
}

/**
 * Resolves only validated caller data. It performs no discovery, I/O, clock
 * read, precedence inference, installation, provisioning, or mutation.
 */
export function evaluateComposition(value: unknown): CompositionEvaluation {
  const read = readCompositionEvaluationInput(value);
  if (!read.input) return { ok: false, status: "invalid", resolutions: [], findings: [...read.findings] };
  const resolutions = groupsFrom(read.input).map((group) => resolveGroup(group, read.input!.evaluatedAt));
  const findings = resolutions.flatMap((result, index) => {
    const entry = resultFinding(result, index);
    return entry ? [entry] : [];
  });
  const status = overallStatus(resolutions);
  return {
    ok: status === "effective" || status === "exception-mediated",
    status,
    resolutions,
    findings,
  };
}
