#!/usr/bin/env node
// check-loop-matrix — validates each active role's own loop matrix
// (docs/contracts/loop-matrix.json, issue #1197: packages/<pkg>/loop-matrix.json)
// and, when that role's skill/SKILL.md carries a generated
// `## Run the feedback loop` section, fails when the committed section has
// drifted from what scripts/generate-loop-section.mjs would produce today.
//
// Every package under packages/ is first classified
// (scripts/package-classification.mjs) against
// docs/contracts/role-loop-archetypes.json's own `roles` map and
// docs/contracts/package-evidence.json's own `category: "executable-tooling"`
// field (issue #1187 comment 5800189482, Decision 1). A ROLE package is
// evaluated in full, exactly as below. A TOOLING package (e.g. launcher,
// starter) has no capability × stage loop by design -- Decision 1's own
// table marks this item "Not applicable" for both -- so it is reported as
// an "excluded: executable-tooling" row with loopMatrix/generatedSection
// both "n/a", never a finding. A package in NEITHER set, or in BOTH, is a
// classification defect and is always a finding, in report mode and
// --enforce alike.
//
//   node scripts/check-loop-matrix.mjs [--json] [--enforce] [<repoRoot>]
//
// REPORT MODE (default): a role with no packages/<pkg>/loop-matrix.json is
// printed and counted, never a failure -- adoption is Stage C. A role that
// DOES ship the file has its shape validated (every capability × every
// stage exactly once, applicable cells fully populated, n/a cells carry a
// reason, demand sub-fields in their declared enums) regardless of mode.
// When that role's skill/SKILL.md ALSO carries a `## Run the feedback loop`
// section, the section is regenerated from the matrix and diffed
// byte-for-byte against the committed one: a mismatch is ALWAYS a failure,
// in both modes (docs/contracts/loop-matrix.json's own enforcement rule) --
// the same discipline scripts/check-conversation-contract.mjs already
// applies to the shared conversation contract.
//
// --enforce additionally fails on absence: no loop-matrix.json, or a matrix
// with no corresponding generated section spliced into the skill, for a
// role package. A classification defect finding is unconditional in both
// modes already, so --enforce adds nothing further for it.
//
// Exit 0 = no findings for the mode in effect. Exit 1 = at least one
// finding. Exit 2 = the question could not be answered (unreadable role
// contract or workspace).
//
// Manifest, contract, and fixture reads only: no build, no child process.
// Belongs in check:gates alongside check-package-framework.mjs and
// check-capability-maps.mjs.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateLoopSection, loadStageActivities } from "./generate-loop-section.mjs";
import { loadToolingPackageNames, classifyPackage, classificationFinding, isInvalidClassification } from "./package-classification.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const STAGES = ["sense", "judge", "act", "verify", "learn"];
const REASONING_TIERS = ["light", "standard", "deep"];
const CONTEXT_SIZES = ["small", "medium", "large", "extra-large"];
const HEADING = "## Run the feedback loop";

function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isText(value) { return typeof value === "string" && value.trim() !== ""; }
function isSafeRelativePath(value) {
  if (!isText(value)) return false;
  if (value.startsWith("/")) return false;
  return !value.split("/").includes("..");
}
const roleShortName = (role) => role.split("/").pop();

/** Validates one cell's own `demand` sub-object. Returns finding rules (no role/path -- caller adds context). */
function validateDemand(demand, capability, role) {
  const findings = [];
  const fail = (rule, message) => findings.push({ rule, role, message: `capability "${capability}": ${message}` });
  if (!isRecord(demand)) { fail("invalid-cell-demand", "demand must be an object"); return findings; }
  if (!REASONING_TIERS.includes(demand.reasoningTier)) fail("invalid-cell-demand-reasoning-tier", `demand.reasoningTier must be one of: ${REASONING_TIERS.join(", ")}`);
  if (demand.minimumTierFloor !== undefined) {
    if (!REASONING_TIERS.includes(demand.minimumTierFloor)) fail("invalid-cell-demand-minimum-tier-floor", `demand.minimumTierFloor must be one of: ${REASONING_TIERS.join(", ")} (or omitted)`);
    else if (REASONING_TIERS.indexOf(demand.minimumTierFloor) > REASONING_TIERS.indexOf(demand.reasoningTier)) fail("cell-demand-floor-above-tier", "demand.minimumTierFloor must not exceed demand.reasoningTier");
  }
  if (typeof demand.visionRequired !== "boolean") fail("invalid-cell-demand-vision", "demand.visionRequired must be a boolean");
  if (!CONTEXT_SIZES.includes(demand.contextSize)) fail("invalid-cell-demand-context-size", `demand.contextSize must be one of: ${CONTEXT_SIZES.join(", ")}`);
  if (typeof demand.parallel !== "boolean") fail("invalid-cell-demand-parallel", "demand.parallel must be a boolean");
  if (typeof demand.independence !== "boolean") fail("invalid-cell-demand-independence", "demand.independence must be a boolean");
  return findings;
}

/**
 * Pure: validates one role's loop-matrix document shape against its own
 * declared `foundry.capabilities` ids. `capabilityIds` is that role's own
 * `foundry.capabilities[].id` array (already read from its manifest by the
 * caller) -- may be `null` when the role declares no capabilities yet, in
 * which case shape is still checked but coverage cannot be.
 */
export function validateLoopMatrixShape(role, matrixDoc, capabilityIds) {
  const findings = [];
  const fail = (rule, message) => findings.push({ rule, role, message });
  if (!isRecord(matrixDoc)) { fail("invalid-loop-matrix", "loop-matrix.json must be an object"); return findings; }
  if (matrixDoc.role !== role) fail("loop-matrix-role-mismatch", `loop-matrix.json role "${matrixDoc.role}" must equal this package's own manifest name "${role}"`);
  if (!Array.isArray(matrixDoc.cells) || matrixDoc.cells.length === 0) {
    fail("invalid-loop-matrix-cells", "loop-matrix.json cells must be a non-empty array");
    return findings;
  }

  const seen = new Set();
  for (const cell of matrixDoc.cells) {
    if (!isRecord(cell) || !isText(cell.capability) || !STAGES.includes(cell.stage)) {
      fail("invalid-loop-matrix-cell", "every cell must be an object with a nonempty capability and a stage in sense|judge|act|verify|learn");
      continue;
    }
    const key = `${cell.capability}\u0000${cell.stage}`;
    if (seen.has(key)) fail("duplicate-loop-matrix-cell", `cell (capability "${cell.capability}", stage "${cell.stage}") is declared more than once`);
    seen.add(key);

    if (cell.applicable === false) {
      if (!isText(cell.reason)) fail("cell-na-without-reason", `capability "${cell.capability}" stage "${cell.stage}" is n/a but declares no reason`);
      if (cell.inputs !== undefined || cell.check !== undefined || cell.output !== undefined || cell.proofCase !== undefined || cell.demand !== undefined) {
        fail("cell-na-carries-content", `capability "${cell.capability}" stage "${cell.stage}" is n/a but also declares inputs/check/output/proofCase/demand`);
      }
    } else if (cell.applicable === true) {
      if (!isText(cell.inputs)) fail("invalid-cell-inputs", `capability "${cell.capability}" stage "${cell.stage}": inputs must be a nonempty string`);
      if (!isText(cell.check)) fail("invalid-cell-check", `capability "${cell.capability}" stage "${cell.stage}": check must be a nonempty string`);
      const expectedPrefix = `clossys/${roleShortName(role)}/`;
      if (!isSafeRelativePath(cell.output) || !cell.output.startsWith(expectedPrefix)) {
        fail("cell-output-outside-role-folder", `capability "${cell.capability}" stage "${cell.stage}": output must be a package-relative path starting with "${expectedPrefix}"`);
      }
      if (!isText(cell.proofCase)) fail("invalid-cell-proof-case", `capability "${cell.capability}" stage "${cell.stage}": proofCase must be a nonempty string`);
      findings.push(...validateDemand(cell.demand, cell.capability, role).map((item) => ({ ...item, message: `stage "${cell.stage}": ${item.message}` })));
    } else {
      fail("invalid-cell-applicable", `capability "${cell.capability}" stage "${cell.stage}": applicable must be a boolean`);
    }
  }

  if (Array.isArray(capabilityIds)) {
    const expected = new Set();
    for (const id of capabilityIds) for (const stage of STAGES) expected.add(`${id}\u0000${stage}`);
    const missing = [...expected].filter((key) => !seen.has(key));
    for (const key of missing) {
      const [capability, stage] = key.split("\u0000");
      fail("loop-matrix-missing-cell", `no cell declared for capability "${capability}" stage "${stage}" -- every capability × every stage must appear exactly once`);
    }
    const extra = [...seen].filter((key) => !expected.has(key) && capabilityIds.length > 0);
    for (const key of extra) {
      const [capability, stage] = key.split("\u0000");
      fail("loop-matrix-unknown-capability", `cell names capability "${capability}" (stage "${stage}") which is not one of this role's own foundry.capabilities`);
    }
  }
  return findings;
}

/**
 * Pure evaluator over already-collected package descriptors. Each
 * descriptor: { role, matrixDoc: object|null, capabilityIds: string[]|null,
 *   skillSource: string|null, stageActivities: object|null,
 *   classification?: "role"|"tooling"|"unclassified"|"both"|"invalid-name"|
 *     "missing-manifest"|"invalid-manifest" }.
 * `stageActivities` is pre-resolved by the caller (it needs
 * role-loop-archetypes.json, a repository read) so this function stays pure.
 * `classification` defaults to "role" when omitted, so existing callers that
 * only ever passed role descriptors keep behaving exactly as before. A
 * "tooling" descriptor is reported excluded (Decision 1: no capability ×
 * stage loop applies to it). Every other non-"role" classification
 * (isInvalidClassification, scripts/package-classification.mjs) is always a
 * finding, in report mode and --enforce alike; for all of them except
 * "unclassified"/"both", `role` carries the package's directory name, since
 * there is no manifest name to use (no manifest at all, an unparseable one,
 * or one with no usable name).
 */
export function evaluateLoopMatrix(descriptors, options = {}) {
  const { enforce = false, allowlistedRoles = [] } = options;
  const allowlisted = new Set(allowlistedRoles);
  const findings = [];
  const table = [];

  for (const descriptor of [...descriptors].sort((a, b) => a.role.localeCompare(b.role))) {
    const { role } = descriptor;
    const classification = descriptor.classification ?? "role";

    if (classification === "tooling") {
      // Decision 1's own table marks the loop matrix "Not applicable: no
      // capability × stage loop" for both launcher and starter -- this is
      // not an absence to report, it is a declared exclusion.
      table.push({ role, classification, excluded: "executable-tooling", loopMatrix: "n/a", generatedSection: "n/a" });
      continue;
    }
    if (isInvalidClassification(classification)) {
      findings.push(classificationFinding(role, classification));
      table.push({ role, classification, excluded: null, loopMatrix: "n/a", generatedSection: "n/a" });
      continue;
    }

    const { matrixDoc, capabilityIds, skillSource, stageActivities } = descriptor;
    const row = { role, classification: "role", loopMatrix: "absent", generatedSection: "absent" };
    if (matrixDoc === null) {
      if (enforce && !allowlisted.has(role)) findings.push({ rule: "required-loop-matrix-absent", role, message: "packages/<pkg>/loop-matrix.json must declare this role's own capability × stage matrix" });
      table.push(row);
      continue;
    }

    const shapeFindings = validateLoopMatrixShape(role, matrixDoc, capabilityIds);
    row.loopMatrix = shapeFindings.length === 0 ? "declared" : "malformed";
    findings.push(...shapeFindings);

    const hasSection = typeof skillSource === "string" && skillSource.includes(HEADING);
    if (!hasSection) {
      row.generatedSection = "absent";
      if (enforce && !allowlisted.has(role)) findings.push({ rule: "required-generated-section-absent", role, message: `packages/${roleShortName(role)}/skill/SKILL.md must carry a "${HEADING}" section generated from loop-matrix.json` });
      table.push(row);
      continue;
    }
    if (shapeFindings.length > 0 || !isRecord(stageActivities)) {
      row.generatedSection = "unverifiable";
      table.push(row);
      continue;
    }
    const generated = generateLoopSection(role, matrixDoc, stageActivities);
    const committedSection = extractSection(skillSource);
    if (committedSection === generated.trim()) {
      row.generatedSection = "current";
    } else {
      row.generatedSection = "stale";
      findings.push({ rule: "loop-section-drifted", role, message: `packages/${roleShortName(role)}/skill/SKILL.md's "${HEADING}" section does not match what generate-loop-section.mjs produces from loop-matrix.json today -- run it with --write` });
    }
    table.push(row);
  }
  return { findings, table };
}

function extractSection(skillSource) {
  const lines = skillSource.split("\n");
  const start = lines.findIndex((line) => line.trim() === HEADING);
  if (start === -1) return "";
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const trimmed = (lines[index] ?? "").trim();
    if (trimmed.startsWith("## ") && trimmed !== HEADING) { end = index; break; }
  }
  return lines.slice(start, end).join("\n").trim();
}

function readJson(path) { return JSON.parse(readFileSync(path, "utf8")); }

function collect(root) {
  const contract = readJson(join(root, "docs/contracts/role-loop-archetypes.json"));
  const activeRoles = Object.keys(contract.roles ?? {});
  const toolingNames = loadToolingPackageNames(root);
  const packagesDir = join(root, "packages");
  const descriptors = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(packagesDir, entry.name, "package.json");
    if (!existsSync(manifestPath)) {
      // The directory itself is a package this gate must account for, even
      // with no package.json at all -- report it directly, using the
      // directory name as the only identity available
      // (scripts/package-classification.mjs's own "missing-manifest" case),
      // rather than silently skipping the directory.
      descriptors.push({ role: entry.name, matrixDoc: null, capabilityIds: null, skillSource: null, stageActivities: null, classification: "missing-manifest" });
      continue;
    }
    let manifest;
    try {
      manifest = readJson(manifestPath);
    } catch {
      // package.json exists but is not valid JSON -- fail closed on just
      // this one package (scripts/package-classification.mjs's own
      // "invalid-manifest" case) rather than aborting the entire gate run.
      descriptors.push({ role: entry.name, matrixDoc: null, capabilityIds: null, skillSource: null, stageActivities: null, classification: "invalid-manifest" });
      continue;
    }
    if (!isText(manifest.name)) {
      // The manifest exists but carries no usable name -- there is nothing
      // to classify, so report it directly rather than calling
      // classifyPackage. The directory name is the only identity available
      // (scripts/package-classification.mjs's own "invalid-name" case).
      descriptors.push({ role: entry.name, matrixDoc: null, capabilityIds: null, skillSource: null, stageActivities: null, classification: "invalid-name" });
      continue;
    }
    const role = manifest.name;
    const classification = classifyPackage(role, activeRoles, toolingNames);
    const skillPath = join(packagesDir, entry.name, "skill", "SKILL.md");
    const skillSource = existsSync(skillPath) ? readFileSync(skillPath, "utf8") : null;
    if (classification !== "role") {
      descriptors.push({ role, matrixDoc: null, capabilityIds: null, skillSource, stageActivities: null, classification });
      continue;
    }
    const matrixPath = join(packagesDir, entry.name, "loop-matrix.json");
    const matrixDoc = existsSync(matrixPath) ? readJson(matrixPath) : null;
    const capabilities = isRecord(manifest.foundry) && Array.isArray(manifest.foundry.capabilities) ? manifest.foundry.capabilities : null;
    const capabilityIds = capabilities ? capabilities.filter((item) => isRecord(item) && isText(item.id)).map((item) => item.id) : null;
    let stageActivities = null;
    try { ({ stageActivities } = loadStageActivities(root, role)); } catch { stageActivities = null; }
    descriptors.push({ role, matrixDoc, capabilityIds, skillSource, stageActivities, classification });
  }
  return descriptors;
}

function printTable(table) {
  const header = ["role", "loopMatrix", "generatedSection"];
  console.log(header.join("  |  "));
  for (const row of table) {
    if (row.classification === "tooling") { console.log(`${row.role}  |  excluded: executable-tooling`); continue; }
    if (isInvalidClassification(row.classification)) { console.log(`${row.role}  |  classification: ${row.classification} — see FAIL below`); continue; }
    console.log(header.map((key) => row[key]).join("  |  "));
  }
}

function main(argv) {
  const json = argv.includes("--json");
  const enforce = argv.includes("--enforce");
  const root = argv.find((value) => !value.startsWith("--")) ?? join(scriptDir, "..");
  let descriptors;
  try { descriptors = collect(root); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) console.log(JSON.stringify({ error: message }, null, 2));
    else console.error(`check-loop-matrix: ${message}`);
    return 2;
  }
  const result = evaluateLoopMatrix(descriptors, { enforce });
  if (json) { console.log(JSON.stringify(result, null, 2)); return result.findings.length === 0 ? 0 : 1; }
  printTable(result.table);
  for (const item of result.findings) console.log(`FAIL ${item.rule} ${item.role} — ${item.message}`);
  const roleRows = result.table.filter((row) => row.classification === "role");
  const toolingRows = result.table.filter((row) => row.classification === "tooling");
  const invalidRows = result.table.filter((row) => isInvalidClassification(row.classification));
  const declared = roleRows.filter((row) => row.loopMatrix === "declared").length;
  console.log(`\nloopMatrix: ${declared}/${roleRows.length} active role(s) declare a shaped loop-matrix.json.`);
  if (toolingRows.length > 0) console.log(`${toolingRows.length} package(s) excluded as executable tooling: ${toolingRows.map((row) => row.role).join(", ")}.`);
  if (invalidRows.length > 0) console.log(`${invalidRows.length} package(s) failed role/tooling classification: ${invalidRows.map((row) => row.role).join(", ")}.`);
  console.log(enforce ? "Running with --enforce: absence of a loop-matrix.json or its generated section is a finding, for a role package. Classification findings are unconditional in both modes." : "Report mode: absence is printed and counted, never a failure. A drifted generated section, and a classification defect, always fail, in both modes. Pass --enforce for the enforcing mode.");
  return result.findings.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exitCode = main(process.argv.slice(2));
}
