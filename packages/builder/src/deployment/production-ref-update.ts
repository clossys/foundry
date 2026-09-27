/**
 * Plan and verify how the production ref advances (#1518). Pure: no git I/O.
 */
import { createGateReasons, gateSatisfied, gateViolated } from "@clossys/controller/gates";
import type { GateResult } from "@clossys/controller/gates";
import type { DeploymentFinding } from "./types.js";

const SHA40 = /^[0-9a-f]{40}$/;

export type ProductionRefUpdatePlan =
  | { readonly method: "fast-forward" }
  | {
      readonly method: "merge";
      readonly firstParent: "production";
      readonly secondParent: "integration";
    };

export type ProductionRefUpdateObservation = {
  readonly method: "fast-forward" | "merge" | "force" | "admin-bypass";
  readonly productionCommit?: string;
  readonly integrationCommit?: string;
  /** Commit the production ref names after a fast-forward update. */
  readonly targetCommit?: string;
  /** Parent SHAs of the merge commit, production first. */
  readonly parents?: readonly string[];
};

export const PRODUCTION_REF_UPDATE_INDETERMINATE_REASONS = createGateReasons(
  ["production-ref-observation-incomplete"] as const,
);
export type ProductionRefUpdateIndeterminateReason =
  (typeof PRODUCTION_REF_UPDATE_INDETERMINATE_REASONS.reasons)[number];

export type ProductionRefUpdateFindingRule =
  | "production-ref-forced"
  | "production-ref-admin-bypass"
  | "production-ref-update-mismatch";

function finding(rule: ProductionRefUpdateFindingRule, message: string): DeploymentFinding {
  return { rule, severity: "error", message };
}

function validSha(value: string | undefined): value is string {
  return value !== undefined && value.length > 0 && SHA40.test(value);
}

/**
 * Returns the required production-ref update method from ancestry alone.
 */
export function planProductionRefUpdate(input: {
  readonly productionIsAncestor: boolean;
}): ProductionRefUpdatePlan {
  if (input.productionIsAncestor) {
    return { method: "fast-forward" };
  }
  return { method: "merge", firstParent: "production", secondParent: "integration" };
}

/**
 * Reconcile a planned ref update with an observed provider/git update.
 */
export function verifyProductionRefUpdate(
  planned: ProductionRefUpdatePlan,
  observed: ProductionRefUpdateObservation,
): GateResult<DeploymentFinding, ProductionRefUpdateIndeterminateReason> {
  if (observed.method === "force") {
    return gateViolated([
      finding("production-ref-forced", "Production ref was force-updated."),
    ]);
  }
  if (observed.method === "admin-bypass") {
    return gateViolated([
      finding("production-ref-admin-bypass", "Production ref was updated via admin bypass."),
    ]);
  }

  if (!validSha(observed.productionCommit) || !validSha(observed.integrationCommit)) {
    return PRODUCTION_REF_UPDATE_INDETERMINATE_REASONS.indeterminate(
      "production-ref-observation-incomplete",
      "Production or integration commit SHA is missing or invalid.",
    );
  }

  const productionCommit = observed.productionCommit;
  const integrationCommit = observed.integrationCommit;

  if (planned.method === "fast-forward") {
    if (observed.method !== "fast-forward") {
      return gateViolated([
        finding(
          "production-ref-update-mismatch",
          `Expected a fast-forward update, observed ${observed.method}.`,
        ),
      ]);
    }
    if (!validSha(observed.targetCommit) || observed.targetCommit !== integrationCommit) {
      return gateViolated([
        finding(
          "production-ref-update-mismatch",
          "Fast-forward did not land on the integration commit.",
        ),
      ]);
    }
    return gateSatisfied(1);
  }

  if (observed.method !== "merge") {
    return gateViolated([
      finding(
        "production-ref-update-mismatch",
        `Expected a merge update, observed ${observed.method}.`,
      ),
    ]);
  }

  const parents = observed.parents;
  if (
    parents === undefined ||
    parents.length !== 2 ||
    !validSha(parents[0]) ||
    !validSha(parents[1])
  ) {
    return gateViolated([
      finding(
        "production-ref-update-mismatch",
        "Merge update must be exactly one commit with two valid parent SHAs.",
      ),
    ]);
  }

  if (parents[0] === productionCommit && parents[1] === integrationCommit) {
    return gateSatisfied(1);
  }

  return gateViolated([
    finding(
      "production-ref-update-mismatch",
      "Merge commit parents do not match production then integration.",
    ),
  ]);
}
