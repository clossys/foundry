import { IntegratorValidationError } from "./errors.js";
import type { EntitlementDeclaration } from "./entitlement.js";
import type { ReachabilityVerdict } from "./reachability.js";
import { compareVersions } from "./semver.js";
import { isValidPackageName } from "./package-name.js";

/**
 * What a candidate package must satisfy before a plane admits it -- the last
 * of the five mechanisms this package ships. It composes with the other four
 * rather than inventing new external data: every rule here is answerable from
 * an `EntitlementDeclaration` and a `ReachabilityVerdict` map the caller has
 * already computed, so admission never needs anything this package does not
 * already model, and never needs a consumer registry to decide anything.
 */

export type AdmissionRule =
  | { readonly kind: "must-be-entitled" }
  | { readonly kind: "must-not-be-opted-out" }
  | { readonly kind: "requires-known-reachability" }
  | { readonly kind: "minimum-version"; readonly floor: string };

export interface AdmissionContract {
  readonly version: 1;
  readonly rules: readonly AdmissionRule[];
}

export interface AdmissionCandidate {
  readonly name: string;
  readonly version: string;
}

export interface AdmissionContext {
  readonly declaration: EntitlementDeclaration;
  readonly reachability: ReadonlyMap<string, ReachabilityVerdict>;
}

export interface AdmissionFinding {
  readonly rule: AdmissionRule["kind"];
  readonly message: string;
}

const RULE_KINDS = new Set<AdmissionRule["kind"]>(["must-be-entitled", "must-not-be-opted-out", "requires-known-reachability", "minimum-version"]);

function fail(message: string): never {
  throw new IntegratorValidationError("INVALID_ADMISSION_CONTRACT", message);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("Entry must be an object");
  return value as Record<string, unknown>;
}

/**
 * Validate a parsed admission contract and return it in normalized form.
 * Offline and pure, same convention as `loadEntitlementDeclaration`. Each
 * rule kind may appear at most once: a contract naming `minimum-version`
 * twice with two different floors cannot express which one governs, and that
 * is a defect in the contract, not a legitimate stricter-than-strict request.
 */
export function loadAdmissionContract(raw: unknown): AdmissionContract {
  const record = asRecord(raw);
  if (record["version"] !== 1) fail("Contract must set version: 1");

  const rawRules = record["rules"];
  if (!Array.isArray(rawRules)) fail("rules must be an array");

  const seenKinds = new Set<string>();
  const rules: AdmissionRule[] = [];
  for (const item of rawRules) {
    const entry = asRecord(item);
    const kind = entry["kind"];
    if (typeof kind !== "string" || !RULE_KINDS.has(kind as AdmissionRule["kind"])) {
      fail(`rules entry has an unknown kind: ${JSON.stringify(kind)}`);
    }
    if (seenKinds.has(kind)) fail(`rules declares ${kind} more than once`);
    seenKinds.add(kind);

    if (kind === "minimum-version") {
      const floor = entry["floor"];
      if (typeof floor !== "string") fail("minimum-version rule must declare a floor");
      try {
        compareVersions(floor, floor);
      } catch {
        fail(`minimum-version rule has an invalid floor: ${JSON.stringify(floor)}`);
      }
      rules.push({ kind: "minimum-version", floor });
    } else {
      rules.push({ kind: kind as Exclude<AdmissionRule["kind"], "minimum-version"> });
    }
  }

  return { version: 1, rules: Object.freeze(rules) };
}

function assertNeverRule(value: never): never {
  throw new Error(`Unhandled admission rule: ${JSON.stringify(value)}`);
}

/**
 * Evaluate a candidate against a contract. Pure and offline given the
 * already-computed context: no rule here calls the network itself. An empty
 * result means admitted; every rule is evaluated independently, so a
 * candidate failing two rules reports both rather than only the first.
 */
export function evaluateAdmission(contract: AdmissionContract, candidate: AdmissionCandidate, context: AdmissionContext): readonly AdmissionFinding[] {
  if (!isValidPackageName(candidate.name)) {
    return [{ rule: "must-be-entitled", message: `${JSON.stringify(candidate.name)} is not a valid package name` }];
  }

  const findings: AdmissionFinding[] = [];
  for (const rule of contract.rules) {
    switch (rule.kind) {
      case "must-be-entitled": {
        const entitled = context.declaration.entitlements.some((entry) => entry.name === candidate.name);
        if (!entitled) findings.push({ rule: rule.kind, message: `${candidate.name} is not in the entitlement declaration` });
        break;
      }
      case "must-not-be-opted-out": {
        const optedOut = context.declaration.optOuts.some((entry) => entry.name === candidate.name);
        if (optedOut) findings.push({ rule: rule.kind, message: `${candidate.name} has a recorded opt-out` });
        break;
      }
      case "requires-known-reachability": {
        const verdict = context.reachability.get(candidate.name);
        if (verdict === undefined || verdict.kind !== "known") {
          findings.push({ rule: rule.kind, message: `${candidate.name} has no confirmed reachable registry entry` });
        }
        break;
      }
      case "minimum-version": {
        try {
          if (compareVersions(candidate.version, rule.floor) < 0) {
            findings.push({ rule: rule.kind, message: `${candidate.name}@${candidate.version} is below the required floor ${rule.floor}` });
          }
        } catch {
          findings.push({ rule: rule.kind, message: `${candidate.name}@${candidate.version} could not be compared against floor ${rule.floor}` });
        }
        break;
      }
      default:
        assertNeverRule(rule);
    }
  }
  return findings;
}
