/**
 * Compare a declared deploy record against a provider observation (#1518).
 * Pure, read-only, and credential-free: the observation is caller-supplied
 * (fixture or adapter output) and must never include secret values.
 */
import { createGateReasons, gateSatisfied, gateViolated } from "@clossys/controller/gates";
import type { GateResult } from "@clossys/controller/gates";
import type {
  DeployRecordDefinition,
  DeployRecordEnvironmentNameDefinition,
  DeployRecordFindingRule,
  DeployRecordObservation,
  DeploymentFinding,
} from "./types.js";

export const DEPLOY_RECORD_INDETERMINATE_REASONS = createGateReasons(["observation-carries-secret-value"] as const);
export type DeployRecordIndeterminateReason = (typeof DEPLOY_RECORD_INDETERMINATE_REASONS.reasons)[number];

function finding(rule: DeployRecordFindingRule, message: string, path?: string): DeploymentFinding {
  return { rule, severity: "error", message, ...(path === undefined ? {} : { path }) };
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function observationCarriesSecretValue(observed: DeployRecordObservation): boolean {
  for (const entry of observed.environmentNames) {
    if (object(entry) && Object.prototype.hasOwnProperty.call(entry, "value")) return true;
  }
  return false;
}

function branchDeployEnabled(observed: DeployRecordObservation, branch: string): boolean {
  return observed.deployEnabledBranches?.includes(branch) ?? false;
}

function branchSetsMatch(
  declared: readonly string[],
  observed: readonly string[] | undefined,
): boolean {
  const enabled = observed ?? [];
  if (declared.length !== enabled.length) return false;
  const sortedDeclared = [...declared].sort();
  const sortedEnabled = [...enabled].sort();
  return sortedDeclared.every((branch, index) => branch === sortedEnabled[index]);
}

function observedEnvironment(
  observed: DeployRecordObservation,
  declared: DeployRecordEnvironmentNameDefinition,
): DeployRecordObservation["environmentNames"][number] | undefined {
  return observed.environmentNames.find((entry) => entry.name === declared.name && entry.target === declared.target);
}

function compareEnvironments(
  declared: DeployRecordDefinition,
  observed: DeployRecordObservation,
  findings: DeploymentFinding[],
): number {
  let evaluated = 0;
  for (const [index, env] of declared.environmentNames.entries()) {
    evaluated += 1;
    const live = observedEnvironment(observed, env);
    const path = `environmentNames[${index}]`;
    if (live === undefined) {
      findings.push(
        finding(
          "deploy-record-environment-missing",
          `Environment name ${env.name} is missing for target ${env.target}.`,
          path,
        ),
      );
      continue;
    }
    if (live.scope !== env.scope) {
      findings.push(
        finding(
          "deploy-record-environment-scope",
          `Environment name ${env.name} for target ${env.target} has scope ${live.scope}, not ${env.scope}.`,
          path,
        ),
      );
    }
    if (live.classification === undefined) {
      findings.push(
        finding(
          "deploy-record-environment-classification",
          `Environment name ${env.name} for target ${env.target} has no observed classification; declared ${env.classification}.`,
          path,
        ),
      );
    } else if (live.classification !== env.classification) {
      findings.push(
        finding(
          "deploy-record-environment-classification",
          `Environment name ${env.name} for target ${env.target} is classified ${live.classification}, not ${env.classification}.`,
          path,
        ),
      );
    }
  }
  return evaluated;
}

/**
 * Reconcile a declared deploy record with a provider observation. Returns
 * `indeterminate` when the observation carries a secret `value` field.
 */
export function verifyDeployRecord(
  declared: DeployRecordDefinition,
  observed: DeployRecordObservation,
): GateResult<DeploymentFinding, DeployRecordIndeterminateReason> {
  if (observationCarriesSecretValue(observed)) {
    return DEPLOY_RECORD_INDETERMINATE_REASONS.indeterminate(
      "observation-carries-secret-value",
      "An environment observation included a value field; secret values are not stored or compared.",
    );
  }

  const findings: DeploymentFinding[] = [];
  let evaluated = 0;

  evaluated += 1;
  if (observed.productionBranch !== declared.productionBranch) {
    findings.push(
      finding(
        "deploy-record-production-branch",
        `Production branch is ${observed.productionBranch}, not ${declared.productionBranch}.`,
      ),
    );
  }

  if (declared.releaseRef === true) {
    evaluated += 1;
    if (branchDeployEnabled(observed, "main") && observed.productionBranch !== "release") {
      findings.push(
        finding(
          "deploy-record-release-ref-main-deploy",
          "Branch main is enabled for deploys while production is not the release branch under the release-ref model.",
        ),
      );
    }
  }

  evaluated += 1;
  if (!branchSetsMatch(declared.previewBranches, observed.deployEnabledBranches)) {
    findings.push(
      finding(
        "deploy-record-preview-branches",
        `Deploy-enabled branches do not match declared preview branches.`,
      ),
    );
  }

  evaluated += 1;
  if (observed.previewUrl !== declared.previewUrl) {
    findings.push(
      finding(
        "deploy-record-preview-url",
        `Preview URL is ${observed.previewUrl}, not ${declared.previewUrl}.`,
      ),
    );
  }

  evaluated += compareEnvironments(declared, observed, findings);

  evaluated += 1;
  if (observed.protection !== declared.protection) {
    findings.push(
      finding(
        "deploy-record-protection",
        `Protection is ${observed.protection}, not ${declared.protection}.`,
      ),
    );
  }

  if (findings.length > 0) return gateViolated(findings);
  return gateSatisfied(evaluated);
}
