#!/usr/bin/env node
// check-package-conformance — the Stage B normalization-template gate
// (issue #1187's normalization direction, wave "Stage B: the normalization
// template"). For every package under packages/, this gate first classifies
// the package (scripts/package-classification.mjs) against
// docs/contracts/role-loop-archetypes.json's own `roles` map and
// docs/contracts/package-evidence.json's own `category: "executable-tooling"`
// field:
//
//   - a ROLE package is reported in full against the eight Stage A items
//     below, exactly as before;
//   - a TOOLING package (issue #1187 comment 5800189482, Decision 1: e.g.
//     launcher, starter) is reported as an "excluded: executable-tooling"
//     row, plus its own status on the two Stage A items the decision says
//     still apply to tooling -- the shared output envelope (item 2) and the
//     removed conversation-contract duplicate (item 6) -- report mode only,
//     never enforced yet;
//   - a package in NEITHER set, or in BOTH, is a classification defect and
//     is always a finding, in report mode and --enforce alike -- it is a
//     silent gap in the classification itself, not an absence this gate is
//     free to stay quiet about.
//
// For a role package, the eight Stage A items are:
//
//   1. the manifest block (docs/contracts/package-framework.json) is
//      present and complete: intake, outputs, status, fit, solves (as
//      verifiable claims), needs, feeds;
//   2. verdicts use the shared output envelope
//      (docs/contracts/check-output-envelope.json);
//   3. only the #1228 lifecycle words are used
//      (docs/contracts/lifecycle.json's six states, three conditions);
//   4. the skill's loop section is generated from the loop matrix
//      (docs/contracts/loop-matrix.json, issue #1197);
//   5. the clossys/<role>/ layout is used (docs/contracts/consumer-layout.json);
//   6. the duplicated conversation block is removed, in favour of the
//      #1182 shared contract (docs/contracts/conversation-contract.md);
//   7. a capability map is present (package-framework.json version 3,
//      issue #1196);
//   8. STATUS.md goes through the engine (docs/contracts/loop.json's
//      statusSections).
//
//   node scripts/check-package-conformance.mjs [--json] [--enforce] [--allowlist <path>] [<repoRoot>]
//
// REPORT MODE (default, matches every other framework gate in this
// repository): absence of any of the eight items above, on a role package,
// is printed and counted, never a failure. Likewise absence of the two
// applicable items on a tooling package. This gate fails only when a
// package DOES declare something in one of these shapes and it is malformed
// (reusing the same shape validators check-package-framework.mjs,
// check-capability-maps.mjs, and check-loop-matrix.mjs already apply, plus
// the structural checks 2, 3, 5, 6, and 8 own directly), when a generated
// loop section has drifted from its matrix (always a failure — see
// check-loop-matrix.mjs), or when a package's role/tooling classification
// is missing or contradictory (always a failure — see
// scripts/package-classification.mjs).
//
// --enforce additionally fails on absence of any of the eight items for
// every active role not named in the allowlist. The allowlist
// (governance/package-conformance-allowlist.json by default, or --allowlist
// <path>) is an explicit, reasoned exemption list: { "role": "reason" }.
// Converting packages into conformance is Stage C, tracked package by
// package (issue #1187's Stage C order); this gate's own --enforce mode is
// for once that conversion is complete. --enforce does NOT yet apply to a
// tooling package's two applicable items (Decision 1 keeps that for a later
// wave); it does still apply to the classification-defect finding, which is
// unconditional in both modes.
//
// Exit 0 = no findings for the mode in effect. Exit 1 = at least one
// finding. Exit 2 = the question could not be answered (unreadable
// contract, unreadable workspace).
//
// This gate is manifest-, contract-, and fixture-read only: no build, no
// child process. It composes three existing gates' own pure evaluators
// (check-package-framework.mjs's evaluatePackageFramework,
// check-capability-maps.mjs's evaluateCapabilityMaps, check-loop-matrix.mjs's
// evaluateLoopMatrix) rather than re-implementing their shape rules, and
// adds five checks of its own (envelope adoption, lifecycle-word adoption,
// layout adoption, conversation-block removal, STATUS.md shape).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluatePackageFramework, validateCheckOutputEnvelope } from "./check-package-framework.mjs";
import { evaluateCapabilityMaps } from "./check-capability-maps.mjs";
import { evaluateLoopMatrix } from "./check-loop-matrix.mjs";
import { loadStageActivities } from "./generate-loop-section.mjs";
import { loadToolingPackageNames, classifyPackage, classificationFinding } from "./package-classification.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));

const LIFECYCLE_STATES = ["absent", "found", "draft", "approved", "verified", "retired"];
const LIFECYCLE_CONDITIONS = ["current", "stale", "blocked"];
const STATUS_SECTIONS = ["Mandate", "Where we are", "Recommended next", "Decisions", "Blockers"];
const LEGACY_CONTRACT_HEADINGS = ["## How we work together", "## One question at a time"];
const GAP_KEYS = ["manifestBlock", "outputEnvelope", "lifecycleWords", "loopSection", "layout", "conversationContract", "capabilityMap", "statusMd"];

function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isText(value) { return typeof value === "string" && value.trim() !== ""; }
const roleShortName = (role) => role.split("/").pop();

function readJson(path) { return JSON.parse(readFileSync(path, "utf8")); }
function tryReadJson(path) {
  if (!existsSync(path)) return null;
  try { return readJson(path); } catch { return "malformed"; }
}

/**
 * Manifest fields 1 and 7 (manifest block, capability map) come from the
 * two Stage A gates' own pure evaluators, called once with --enforce
 * semantics internally regardless of THIS gate's own mode -- Stage B needs
 * to know the full gap, not just what those gates flag by default. Their
 * findings are grouped back onto the per-role row below; this gate's own
 * mode only controls whether absence is reported as a finding of ITS own.
 */
function frameworkAndCapabilityGaps(activeRoles, manifestsByName, extras, enforce) {
  const framework = evaluatePackageFramework(activeRoles, manifestsByName, { enforce, ...extras });
  const capabilities = evaluateCapabilityMaps(activeRoles, manifestsByName, { enforce });
  const frameworkByRole = new Map(framework.table.map((row) => [row.role, row]));
  const capabilitiesByRole = new Map(capabilities.table.map((row) => [row.role, row]));
  const findingsByRole = new Map();
  for (const item of [...framework.findings, ...capabilities.findings]) {
    if (!isText(item.role)) continue;
    if (!findingsByRole.has(item.role)) findingsByRole.set(item.role, []);
    findingsByRole.get(item.role).push(item);
  }
  return { frameworkByRole, capabilitiesByRole, findingsByRole };
}

/**
 * Check 2: verdicts use the shared output envelope
 * (docs/contracts/check-output-envelope.json). No runtime check command is
 * invoked here (this gate stays dependency-free, no build, no child
 * process) -- instead a package demonstrates adoption by shipping a sample
 * of its own check output at the fixed convention path
 * packages/<pkg>/check-output-envelope.fixture.json (same "ship a file at a
 * fixed path" pattern loop-matrix.json already uses), validated with
 * check-package-framework.mjs's own validateCheckOutputEnvelope. Absence is
 * printed and counted, never a report-mode failure -- most packages are
 * absent here today, exactly as docs/contracts/check-output-envelope.json's
 * own $comment says ("no package emits this envelope yet").
 */
function envelopeGap(root, packageDir, role) {
  const fixturePath = join(root, "packages", packageDir, "check-output-envelope.fixture.json");
  const document = tryReadJson(fixturePath);
  if (document === null) return { status: "absent", findings: [] };
  if (document === "malformed") return { status: "malformed", findings: [{ rule: "unreadable-envelope-fixture", role, message: `packages/${packageDir}/check-output-envelope.fixture.json is not readable JSON` }] };
  const findings = validateCheckOutputEnvelope(document, `packages/${packageDir}/check-output-envelope.fixture.json`).map((item) => ({ ...item, role }));
  return { status: findings.length === 0 ? "declared" : "malformed", findings };
}

/** Check 3: only the #1228 lifecycle words are used. Looks at this role's own clossys/<role>/loop.json, when the repository (dogfooding itself) or a fixture ships one. */
function lifecycleGap(root, role) {
  const loopJsonPath = join(root, "clossys", roleShortName(role), "loop.json");
  const doc = tryReadJson(loopJsonPath);
  if (doc === null) return { status: "absent", findings: [] };
  if (doc === "malformed" || !isRecord(doc)) return { status: "malformed", findings: [{ rule: "unreadable-loop-json", role, message: `clossys/${roleShortName(role)}/loop.json is not readable JSON` }] };
  const findings = [];
  const states = collectStrings(doc, "state");
  const conditions = collectStrings(doc, "condition");
  for (const value of states) if (!LIFECYCLE_STATES.includes(value)) findings.push({ rule: "non-lifecycle-state-word", role, message: `clossys/${roleShortName(role)}/loop.json uses state "${value}", not one of docs/contracts/lifecycle.json's own six states` });
  for (const value of conditions) if (!LIFECYCLE_CONDITIONS.includes(value)) findings.push({ rule: "non-lifecycle-condition-word", role, message: `clossys/${roleShortName(role)}/loop.json uses condition "${value}", not one of docs/contracts/lifecycle.json's own three conditions` });
  return { status: findings.length === 0 ? "declared" : "malformed", findings };
}

function collectStrings(node, key, out = []) {
  if (Array.isArray(node)) { for (const item of node) collectStrings(item, key, out); return out; }
  if (isRecord(node)) {
    if (typeof node[key] === "string") out.push(node[key]);
    for (const value of Object.values(node)) collectStrings(value, key, out);
  }
  return out;
}

/** Check 5: the clossys/<role>/ layout is used. This is checked here as "does this repository's own clossys/<role>/ folder exist for a role whose manifest declares outputs/feeds/capability-outputs under it" — the outputs/feeds/capability path PREFIX rule itself is already enforced by the framework and capability-map gates (item 1 and 7 above); this check is the complementary "does the folder exist" half. */
function layoutGap(root, role) {
  const folder = join(root, "clossys", roleShortName(role));
  return { status: existsSync(folder) ? "declared" : "absent" };
}

/** Check 6: the duplicated conversation block is removed, in favour of the #1182 contract. A package's OWN packages/<pkg>/skill/SKILL.md source still carrying either legacy heading means composition has something to replace, which is fine pre-migration, but conformance means the source itself no longer carries a local copy. */
function conversationContractGap(skillSource) {
  if (skillSource === null) return { status: "absent" };
  const stillDuplicated = LEGACY_CONTRACT_HEADINGS.some((heading) => skillSource.includes(heading));
  return { status: stillDuplicated ? "not-removed" : "declared" };
}

/** Check 8: STATUS.md goes through the engine. Structural shape only (this Stage B wave does not invoke the loop engine, which is Controller's own runtime, per docs/contracts/loop.json's ownership rule) — the exact five sections, in order, docs/contracts/loop.json's statusSectionsRule requires. */
function statusMdGap(root, role) {
  const statusPath = join(root, "clossys", roleShortName(role), "STATUS.md");
  if (!existsSync(statusPath)) return { status: "absent", findings: [] };
  const body = readFileSync(statusPath, "utf8");
  const headings = [...body.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1].trim());
  const findings = [];
  if (headings.join("\u0000") !== STATUS_SECTIONS.join("\u0000")) {
    findings.push({ rule: "status-md-sections-mismatch", role, message: `clossys/${roleShortName(role)}/STATUS.md must carry exactly docs/contracts/loop.json's five sections, in order: ${STATUS_SECTIONS.join(", ")} — found: ${headings.join(", ") || "(none)"}` });
  }
  return { status: findings.length === 0 ? "declared" : "malformed", findings };
}

/**
 * Pure-ish core: takes already-collected per-package descriptors (manifest,
 * skill source, and the pre-resolved loop-matrix descriptor bundle
 * check-loop-matrix.mjs's own evaluator wants) plus the frameworkAndCapability
 * lookups, and returns the eight-column conformance report. Each descriptor
 * may carry `classification: "role"|"tooling"|"unclassified"|"both"`
 * (scripts/package-classification.mjs); it defaults to "role" when omitted,
 * so an existing caller that only ever built role descriptors keeps
 * behaving exactly as before. A "tooling" descriptor gets its own reduced
 * row (excluded: executable-tooling, only outputEnvelope and
 * conversationContract computed -- Decision 1). An "unclassified" or "both"
 * descriptor always produces a classificationFinding, in report mode and
 * --enforce alike.
 */
export function evaluateConformance(root, descriptors, options = {}) {
  const { enforce = false, allowlist = {} } = options;
  const allowlisted = new Set(Object.keys(allowlist));

  const roleDescriptors = descriptors.filter((d) => (d.classification ?? "role") === "role");
  const toolingDescriptors = descriptors.filter((d) => d.classification === "tooling");
  const invalidDescriptors = descriptors.filter((d) => d.classification === "unclassified" || d.classification === "both");

  const findings = [];
  const table = [];

  for (const descriptor of [...invalidDescriptors].sort((a, b) => a.role.localeCompare(b.role))) {
    const { role, classification } = descriptor;
    findings.push(classificationFinding(role, classification));
    const row = { role, classification, excluded: null, gaps: 0 };
    for (const key of GAP_KEYS) row[key] = "n/a";
    table.push(row);
  }

  for (const descriptor of [...toolingDescriptors].sort((a, b) => a.role.localeCompare(b.role))) {
    const { role } = descriptor;
    const row = { role, classification: "tooling", excluded: "executable-tooling" };
    for (const key of GAP_KEYS) row[key] = "n/a";

    const envelope = envelopeGap(root, descriptor.packageDir, role);
    row.outputEnvelope = envelope.status;
    findings.push(...(envelope.findings ?? []));

    const conversation = conversationContractGap(descriptor.skillSource);
    row.conversationContract = conversation.status === "declared" ? "declared" : (conversation.status === "absent" ? "absent" : "not-removed");

    row.gaps = ["outputEnvelope", "conversationContract"].filter((key) => row[key] !== "declared" && row[key] !== "n/a").length;
    table.push(row);
  }

  const activeRoles = roleDescriptors.map((d) => d.role);
  const manifestsByName = new Map(roleDescriptors.map((d) => [d.role, d.manifest]));
  const { frameworkByRole, capabilitiesByRole, findingsByRole } = frameworkAndCapabilityGaps(activeRoles, manifestsByName, options.frameworkExtras ?? {}, enforce);
  const loopMatrixResult = evaluateLoopMatrix(roleDescriptors.map((d) => ({ role: d.role, matrixDoc: d.loopMatrixDoc, capabilityIds: d.capabilityIds, skillSource: d.skillSource, stageActivities: d.stageActivities })), { enforce: false });
  const loopMatrixByRole = new Map(loopMatrixResult.table.map((row) => [row.role, row]));

  for (const descriptor of [...roleDescriptors].sort((a, b) => a.role.localeCompare(b.role))) {
    const { role } = descriptor;
    const row = { role, classification: "role", excluded: null };
    const gapCount = { role, gaps: 0 };
    const exempt = allowlisted.has(role);

    const frameworkRow = frameworkByRole.get(role);
    const frameworkComplete = frameworkRow !== undefined && ["intake", "outputs", "status", "fit", "solves", "needs", "feeds"].every((field) => frameworkRow[field] === "declared");
    row.manifestBlock = frameworkComplete ? "declared" : (frameworkRow === undefined ? "absent" : "partial");
    // required-*-absent findings are this gate's OWN --enforce concern (an
    // allowlisted role is exempt from them); any other finding from the
    // imported Stage A gates is a genuine malformation and always applies,
    // exemption or not.
    for (const item of findingsByRole.get(role) ?? []) {
      if (exempt && item.rule.startsWith("required-")) continue;
      findings.push(item);
    }

    const envelope = envelopeGap(root, descriptor.packageDir, role);
    row.outputEnvelope = envelope.status;
    findings.push(...(envelope.findings ?? []));

    const lifecycle = lifecycleGap(root, role);
    row.lifecycleWords = lifecycle.status;
    findings.push(...(lifecycle.findings ?? []));

    const loopRow = loopMatrixByRole.get(role) ?? { loopMatrix: "absent", generatedSection: "absent" };
    row.loopSection = loopRow.loopMatrix === "declared" && loopRow.generatedSection === "current" ? "declared" : (loopRow.loopMatrix === "absent" ? "absent" : "partial");
    for (const item of loopMatrixResult.findings) if (item.role === role) findings.push(item);

    const layout = layoutGap(root, role);
    row.layout = layout.status;

    const conversation = conversationContractGap(descriptor.skillSource);
    row.conversationContract = conversation.status === "declared" ? "declared" : (conversation.status === "absent" ? "absent" : "not-removed");

    const capabilitiesRow = capabilitiesByRole.get(role);
    row.capabilityMap = capabilitiesRow?.capabilities ?? "absent";

    const statusMd = statusMdGap(root, role);
    row.statusMd = statusMd.status;
    findings.push(...(statusMd.findings ?? []));

    for (const key of GAP_KEYS) if (row[key] !== "declared") gapCount.gaps += 1;
    row.gaps = gapCount.gaps;

    // manifestBlock and capabilityMap absence findings already come from the
    // imported Stage A gates above (required-*-absent, called with this same
    // enforce flag) — only the five checks this gate owns directly need their
    // own absence finding here, to avoid reporting the same gap twice under
    // two different rule names.
    if (enforce && !exempt) {
      for (const key of GAP_KEYS) {
        if (key === "manifestBlock" || key === "capabilityMap") continue;
        if (row[key] === "absent") findings.push({ rule: `conformance-gap-${key}`, role, message: `${key} is absent — required under --enforce` });
        if (row[key] === "not-removed") findings.push({ rule: "conversation-contract-not-removed", role, message: "packages/<pkg>/skill/SKILL.md still carries its own local conversation-contract heading — required removed under --enforce" });
      }
    }

    table.push(row);
  }
  return { findings, table };
}

function collectDescriptors(root) {
  const contract = readJson(join(root, "docs/contracts/role-loop-archetypes.json"));
  const activeRoles = Object.keys(contract.roles ?? {});
  const toolingNames = loadToolingPackageNames(root);
  const packagesDir = join(root, "packages");
  const descriptors = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(packagesDir, entry.name, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = readJson(manifestPath);
    if (!isText(manifest.name)) continue;
    const role = manifest.name;
    const classification = classifyPackage(role, activeRoles, toolingNames);
    const skillPath = join(packagesDir, entry.name, "skill", "SKILL.md");
    const skillSource = existsSync(skillPath) ? readFileSync(skillPath, "utf8") : null;
    // loop-matrix.json / capabilities / stageActivities are only meaningful
    // for a role package -- a tooling or misclassified package skips these
    // reads entirely rather than reading files that, per Decision 1, don't
    // apply to it.
    const loopMatrixPath = join(packagesDir, entry.name, "loop-matrix.json");
    const loopMatrixDoc = classification === "role" && existsSync(loopMatrixPath) ? readJson(loopMatrixPath) : null;
    const capabilities = isRecord(manifest.foundry) && Array.isArray(manifest.foundry.capabilities) ? manifest.foundry.capabilities : null;
    const capabilityIds = classification === "role" && capabilities ? capabilities.filter((item) => isRecord(item) && isText(item.id)).map((item) => item.id) : null;
    let stageActivities = null;
    if (classification === "role") {
      try { ({ stageActivities } = loadStageActivities(root, role)); } catch { stageActivities = null; }
    }
    descriptors.push({ role, packageDir: entry.name, manifest, skillSource, loopMatrixDoc, capabilityIds, stageActivities, classification });
  }
  return descriptors;
}

function frameworkExtras(root, contract) {
  const roleMetricByRole = new Map();
  for (const [role, definition] of Object.entries(contract.roles ?? {})) {
    if (isRecord(definition) && isRecord(definition.metric) && isText(definition.metric.name)) roleMetricByRole.set(role, definition.metric.name);
  }
  const packagesDir = join(root, "packages");
  const packageDirByName = new Map();
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(packagesDir, entry.name, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = readJson(manifestPath);
    if (isText(manifest.name)) packageDirByName.set(manifest.name, join(packagesDir, entry.name));
  }
  const readPackageFile = (role, relativePath) => {
    const dir = packageDirByName.get(role);
    if (dir === undefined) throw new Error(`no package directory for ${role}`);
    return readFileSync(join(dir, relativePath), "utf8");
  };
  const readAdapterCases = (role) => {
    const adapterPath = join(root, "governance/release-qualification-adapters", roleShortName(role), "current-direct.json");
    if (!existsSync(adapterPath)) return null;
    try {
      const adapter = readJson(adapterPath);
      if (!isRecord(adapter) || !Array.isArray(adapter.cases)) return null;
      return adapter.cases.filter((item) => isRecord(item) && isText(item.id)).map((item) => item.id);
    } catch { return null; }
  };
  const clientProblemsPath = join(root, "docs/contracts/client-problems.json");
  const clientProblemIds = existsSync(clientProblemsPath) ? (() => { try { const doc = readJson(clientProblemsPath); return Array.isArray(doc.problems) ? doc.problems.map((item) => item.id).filter(isText) : null; } catch { return null; } })() : null;
  return { readPackageFile, roleMetricByRole, readAdapterCases, clientProblemIds };
}

function loadAllowlist(root, allowlistPath) {
  const path = allowlistPath ?? join(root, "governance/package-conformance-allowlist.json");
  if (!existsSync(path)) return {};
  const doc = readJson(path);
  return isRecord(doc.roles) ? doc.roles : {};
}

function printTable(table) {
  const header = ["role", ...GAP_KEYS, "gaps"];
  console.log(header.join("  |  "));
  for (const row of table) {
    if (row.classification === "tooling") {
      console.log(`${row.role}  |  excluded: executable-tooling  |  outputEnvelope=${row.outputEnvelope}  |  conversationContract=${row.conversationContract}  |  gaps=${row.gaps}`);
      continue;
    }
    if (row.classification === "unclassified" || row.classification === "both") {
      console.log(`${row.role}  |  classification: ${row.classification} — see FAIL below`);
      continue;
    }
    console.log(header.map((key) => row[key]).join("  |  "));
  }
}

function main(argv) {
  const json = argv.includes("--json");
  const enforce = argv.includes("--enforce");
  const allowlistIndex = argv.indexOf("--allowlist");
  const allowlistPath = allowlistIndex === -1 ? undefined : argv[allowlistIndex + 1];
  const root = argv.find((value, index) => !value.startsWith("--") && argv[index - 1] !== "--allowlist") ?? join(scriptDir, "..");
  let descriptors;
  let contract;
  try {
    contract = readJson(join(root, "docs/contracts/role-loop-archetypes.json"));
    descriptors = collectDescriptors(root);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) console.log(JSON.stringify({ error: message }, null, 2));
    else console.error(`check-package-conformance: ${message}`);
    return 2;
  }
  const allowlist = loadAllowlist(root, allowlistPath);
  const result = evaluateConformance(root, descriptors, { enforce, allowlist, frameworkExtras: frameworkExtras(root, contract) });
  if (json) { console.log(JSON.stringify(result, null, 2)); return result.findings.length === 0 ? 0 : 1; }
  printTable(result.table);
  for (const item of result.findings) console.log(`FAIL ${item.rule} ${item.role} — ${item.message}`);
  const roleRows = result.table.filter((row) => row.classification === "role");
  const toolingRows = result.table.filter((row) => row.classification === "tooling");
  const invalidRows = result.table.filter((row) => row.classification === "unclassified" || row.classification === "both");
  const totalGaps = roleRows.reduce((sum, row) => sum + row.gaps, 0);
  console.log(`\n${roleRows.length} active role(s), ${totalGaps} total gap(s) against Stage A (0 gaps = fully conforming).`);
  if (toolingRows.length > 0) console.log(`${toolingRows.length} package(s) excluded as executable tooling: ${toolingRows.map((row) => row.role).join(", ")}.`);
  if (invalidRows.length > 0) console.log(`${invalidRows.length} package(s) failed role/tooling classification: ${invalidRows.map((row) => row.role).join(", ")}.`);
  if (Object.keys(allowlist).length > 0) console.log(`Allowlist: ${Object.keys(allowlist).join(", ")}`);
  console.log(enforce ? "Running with --enforce: any gap on a non-allowlisted role is a finding. Tooling-row items and classification findings are unconditional in both modes." : "Report mode: gaps are printed and counted, never a failure, except a drifted generated loop section and a classification defect (always a failure). Pass --enforce for the enforcing mode.");
  return result.findings.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exitCode = main(process.argv.slice(2));
}
