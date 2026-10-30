/** Validate Controller's shipped schema-v5 role contract and README pointer. */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluatePackageReadme } from "./check-readme-parity.mjs";

const START = "<!-- controller-role-contract:start -->";
const END = "<!-- controller-role-contract:end -->";
const ROLE = "@clossys/controller";
const REQUIRED_STAGES = ["sense", "judge", "act", "verify", "learn"];
const REQUIRED_BINDINGS = ["setpoint", "cadence"];

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} must be a nonempty string`);
  return value;
}

function requiredArray(value, name) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new Error(`${name} must be an array of nonempty strings`);
  }
  return value;
}

/** Render the README block from the canonical, shipped role charter. */
export function renderControllerRoleBlock(contract) {
  if (!Number.isInteger(contract?.schemaVersion) || contract.schemaVersion !== 5) {
    throw new Error("schemaVersion must be exactly 5");
  }
  const role = contract?.roles?.[ROLE];
  if (!role || typeof role !== "object") throw new Error(`${ROLE} is missing from roles`);
  const stages = requiredArray(contract.universalStages, "universalStages");
  const bindings = requiredArray(contract.consumerBindings, "consumerBindings");
  if (stages.join("\u0000") !== REQUIRED_STAGES.join("\u0000")) throw new Error(`universalStages must be exactly ${REQUIRED_STAGES.join(", ")}`);
  if (!REQUIRED_BINDINGS.every((binding) => bindings.includes(binding))) throw new Error(`consumerBindings must include ${REQUIRED_BINDINGS.join(" and ")}`);

  const job = requiredString(role.jobQuestion, "controller jobQuestion");
  const metric = role.metric;
  const metricName = requiredString(metric?.name, "controller metric.name");
  const formula = requiredString(metric?.formula, "controller metric.formula");
  const unit = requiredString(metric?.unit, "controller metric.unit");
  const direction = requiredString(metric?.direction, "controller metric.direction");
  const primaryMode = requiredString(role.primaryMode, "controller primaryMode");
  const secondaryModes = requiredArray(role.secondaryModes, "controller secondaryModes");
  const owns = requiredString(role.boundary?.owns, "controller boundary.owns");
  const excludes = requiredArray(role.boundary?.excludes, "controller boundary.excludes");
  const closeCondition = requiredString(role.closeCondition, "controller closeCondition");

  return `${START}
## Control-loop contract

This block is derived from the schema-v5 role contract shipped with this
package. The consumer (the client operating the loop) owns its concrete
setpoint and review cadence; Controller supplies neither.

**Job.** ${job}

**Metric.** ${metricName}: ${formula} (${unit}; ${direction}).

**Mode.** ${primaryMode}.

**Secondary modes.** ${secondaryModes.length === 0 ? "None." : `${secondaryModes.map((mode) => `\`${mode}\``).join(", ")}.`}

**Stages.** ${stages.map((stage) => `\`${stage}\``).join(" → ")}.

**Boundary.** Owns ${owns} It excludes ${excludes.map((item) => `\`${item}\``).join(", ")}.

**Close condition.** ${closeCondition}
${END}`;
}

export function checkControllerRoleReadme({ contract, readme, manifest, licenseExists, noticesExist = false }) {
  try {
    // Preserve the full canonical schema validation; the README no longer
    // duplicates this charter, so valid changes require no mirrored prose.
    renderControllerRoleBlock(contract);
  } catch (error) {
    return { ok: false, reason: `canonical role contract is unreadable: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (manifest?.name !== ROLE) return { ok: false, reason: "manifest must identify the canonical Controller role" };
  const findings = evaluatePackageReadme({ manifest, packageDir: "controller", readme, licenseExists, noticesExist });
  return findings.length === 0
    ? { ok: true }
    : { ok: false, reason: `README documentation pointer is invalid: ${findings.map((finding) => finding.rule).join(", ")}` };
}

function main() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  try {
    const contract = JSON.parse(readFileSync(join(repoRoot, "docs/contracts/role-loop-archetypes.json"), "utf8"));
    const readme = readFileSync(join(repoRoot, "packages/controller/README.md"), "utf8");
    const packageDir = join(repoRoot, "packages/controller");
    const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
    const result = checkControllerRoleReadme({
      contract, readme, manifest,
      licenseExists: existsSync(join(packageDir, "LICENSE")),
      noticesExist: existsSync(join(packageDir, "THIRD-PARTY-NOTICES.md")),
    });
    if (!result.ok) {
      console.error(`CONTROLLER README ROLE PARITY FAIL — ${result.reason}`);
      process.exitCode = 1;
      return;
    }
    console.log("CONTROLLER README ROLE PARITY OK — canonical schema-v5 role validates and the five-line README links its documentation, changelog, and license.");
  } catch (error) {
    console.error(`CONTROLLER README ROLE PARITY INDETERMINATE — ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
