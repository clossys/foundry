/**
 * The rule registry: rules.json (ids, statements, scope, status, module and test paths, check ids)
 * joined to the rule modules. The join is strict both ways: a rules.json check with no module
 * function, or a module check missing from rules.json, is an error at load, so the catalog can never
 * claim a check that does not run or run one it does not declare.
 */
import { readFileSync } from "node:fs";
import { R01 } from "./checks/R01-catalog.js";
import { R02 } from "./checks/R02-pins-order.js";
import { R03 } from "./checks/R03-adopt-create.js";
import { R04 } from "./checks/R04-cardinality.js";
import { R05 } from "./checks/R05-certification.js";
import { R06 } from "./checks/R06-dependencies.js";
import { R07 } from "./checks/R07-citations.js";
import { R08 } from "./checks/R08-immutability.js";
import { R09 } from "./checks/R09-pin-schema.js";
import { R10 } from "./checks/R10-retire.js";
import { R11 } from "./checks/R11-resolver.js";
import { R12 } from "./checks/R12-deterministic-build.js";
import { R13 } from "./checks/R13-strings-pages.js";
import { R14 } from "./checks/R14-provenance.js";
import type { Check, RuleId, RuleModule } from "./types.js";

export const RULE_MODULES: readonly RuleModule[] = [R01, R02, R03, R04, R05, R06, R07, R08, R09, R10, R11, R12, R13, R14];

/**
 * A check's status: `enforced` rows fail the run; `pending` checks are stubs whose one row fails it;
 * `building` checks are implemented and report their rows, which fail the run only under --strict
 * (the data units that make them pass run strict); `warn` rows are warnings and never fail it.
 */
export type CheckStatus = "enforced" | "pending" | "building" | "warn";
export interface RuleCheckEntry { readonly id: string; readonly status: CheckStatus; readonly owner?: string }
export interface RuleEntry {
  readonly id: RuleId;
  readonly statement: string;
  readonly scope: "all-records";
  readonly status: "enforced" | "pending";
  readonly owner?: string;
  /** Module path, package-relative. */
  readonly check: string;
  /** Test path, package-relative. */
  readonly test: string;
  readonly checks: readonly RuleCheckEntry[];
}

export interface RegisteredRule extends RuleEntry { readonly run: readonly { readonly id: string; readonly status: RuleCheckEntry["status"]; readonly fn: Check }[] }

let rulesCache: RuleEntry[] | undefined;
/** rules.json, read from the package source (src/ and dist/ both resolve to it). */
export function readRules(): RuleEntry[] {
  rulesCache ??= JSON.parse(readFileSync(new URL("../../src/constitution/rules.json", import.meta.url), "utf8")) as RuleEntry[];
  return rulesCache;
}

/** Joins rules.json to the modules; throws on any mismatch. */
export function registeredRules(rules: readonly RuleEntry[] = readRules(), modules: readonly RuleModule[] = RULE_MODULES): RegisteredRule[] {
  const byId = new Map(modules.map(module => [module.rule, module]));
  if (byId.size !== modules.length) throw new Error("constitution: two modules claim one rule id");
  const seen = new Set<string>();
  const registered = rules.map(rule => {
    const module = byId.get(rule.id);
    if (!module) throw new Error(`constitution: rules.json ${rule.id} has no module`);
    if (!rule.check.includes(`/checks/${rule.id}-`)) throw new Error(`constitution: rules.json ${rule.id} check path ${rule.check} is not a ${rule.id} module`);
    seen.add(rule.id);
    const declared = new Set(rule.checks.map(check => check.id));
    for (const id of Object.keys(module.checks)) if (!declared.has(id)) throw new Error(`constitution: module check ${id} is missing from rules.json`);
    const run = rule.checks.map(check => {
      const fn = module.checks[check.id];
      if (!fn) throw new Error(`constitution: rules.json check ${check.id} has no module function`);
      return { id: check.id, status: check.status, fn };
    });
    return { ...rule, run };
  });
  for (const module of modules) if (!seen.has(module.rule)) throw new Error(`constitution: module ${module.rule} is missing from rules.json`);
  return registered;
}
