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
//      (docs/contracts/check-output-envelope.json) -- graded on real
//      emission through the canonical constructor, never a hand-written
//      sample (#1384; see envelopeGap below);
//   3. only the #1228 lifecycle words are used
//      (docs/contracts/lifecycle.json's six states, three conditions) --
//      NOT APPLICABLE to a producer package, reported n/a with its reason
//      (#1381; see NOT_APPLICABLE_TO_PRODUCER below);
//   4. the skill's loop section is generated from the loop matrix
//      (docs/contracts/loop-matrix.json, issue #1197);
//   5. the clossys/<role>/ layout is used (docs/contracts/consumer-layout.json),
//      graded on the paths the package's own manifest declares (#1381);
//   6. the duplicated conversation block is removed, in favour of the
//      #1182 shared contract (docs/contracts/conversation-contract.md);
//   7. a capability map is present (package-framework.json version 3,
//      issue #1196);
//   8. STATUS.md goes through the engine (docs/contracts/loop.json's
//      statusSections) -- NOT APPLICABLE to a producer package, reported
//      n/a with its reason (#1381).
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
// the structural checks 2, 5, and 6 own directly), when a generated
// loop section has drifted from its matrix, or a generated envelope copy
// from its canonical source (always a failure — see check-loop-matrix.mjs
// and scripts/sync-envelope-copies.mjs), or when a package's role/tooling classification
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
// This gate is manifest-, contract-, and source-read only: no build, no
// child process. It composes three existing gates' own pure evaluators
// (check-package-framework.mjs's evaluatePackageFramework,
// check-capability-maps.mjs's evaluateCapabilityMaps, check-loop-matrix.mjs's
// evaluateLoopMatrix) rather than re-implementing their shape rules, and
// adds three checks of its own (envelope emission, declared layout,
// conversation-block removal) plus two items it reports as not applicable
// to a producer (lifecycle words, STATUS.md).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluatePackageFramework } from "./check-package-framework.mjs";
import { ENVELOPE_COPY_PATH, renderEnvelopeCopyFromRoot } from "./sync-envelope-copies.mjs";
import { evaluateCapabilityMaps } from "./check-capability-maps.mjs";
import { evaluateLoopMatrix } from "./check-loop-matrix.mjs";
import { loadStageActivities } from "./generate-loop-section.mjs";
import { loadToolingPackageNames, classifyPackage, classificationFinding, isInvalidClassification, readManifest } from "./package-classification.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));

const LEGACY_CONTRACT_HEADINGS = ["## How we work together", "## One question at a time"];
const GAP_KEYS = ["manifestBlock", "outputEnvelope", "lifecycleWords", "loopSection", "layout", "conversationContract", "capabilityMap", "statusMd"];

function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isText(value) { return typeof value === "string" && value.trim() !== ""; }
const roleShortName = (role) => role.split("/").pop();

function readJson(path) { return JSON.parse(readFileSync(path, "utf8")); }

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
 * (docs/contracts/check-output-envelope.json). Issue #1384's decision: a
 * hand-written sample is NOT evidence of adoption -- it proves someone can
 * type the shape, not that the package emits it. Evidence is the package's
 * OWN shipped source (packages/<pkg>/src, tests excluded) calling the one
 * canonical constructor, `buildCheckOutputEnvelope`, imported from exactly
 * one of:
 *
 *   - `@clossys/controller`, accepted ONLY when the package's own manifest
 *     names it in `dependencies` or `peerDependencies` -- an undeclared
 *     import still resolves here through workspace hoisting, but the packed
 *     package would fail with ERR_MODULE_NOT_FOUND once installed;
 *   - packages/controller/src/envelope.ts itself (Controller's own code);
 *   - the package's own GENERATED copy at src/generated/check-output-envelope.ts
 *     (a zero-dependency package -- scripts/sync-envelope-copies.mjs), which
 *     must match what that generator produces from the canonical source now,
 *     byte for byte. A drifted or unverifiable copy is a finding in both
 *     modes, the same rule a drifted generated loop section follows.
 *
 * The constructor enforces the contract's own hard rules at construction
 * time, so a call through it is the strongest statement a no-build,
 * no-child-process gate can make about what the package emits. When the
 * package also declares a `foundry.status` probe (issue #1383: the status
 * probe emits exactly one envelope), the probe's own source -- its bin's
 * dist/<x>.js mapped back to src/<x>.ts -- must call the constructor itself
 * or import (one relative hop) a file that does; otherwise the row is
 * `partial`. A package that ships only the old sample file,
 * check-output-envelope.fixture.json, reports `sample-only`: counted as a
 * gap, never accepted as adoption. Absence is printed and counted, never a
 * report-mode failure.
 *
 * The call scan is static. Comments, string literals, and template-literal
 * text are blanked before matching (a `${...}` interpolation is still
 * scanned as code), so a literal "buildCheckOutputEnvelope(" never counts
 * as a call. What it still cannot prove: that a matched call is reachable
 * (a call in dead code such as `if (false) { ... }` counts), or that the
 * constructed envelope is what the process actually prints.
 */
const ENVELOPE_CONSTRUCTOR = "buildCheckOutputEnvelope";
const CANONICAL_ENVELOPE_MODULE = "packages/controller/src/envelope.ts";
const VALUE_IMPORT = /import\s+\{([^}]*)\}\s*from\s*["']([^"']+)["']\s*;?/g;

function listSourceFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== "generated" && entry.name !== "testing") listSourceFiles(path, out); continue; }
    if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

/** Resolves a relative TypeScript ESM specifier ("./x.js") from `fromFile` to the .ts source path it names. */
function resolveRelativeSource(fromFile, specifier) {
  return resolve(dirname(fromFile), specifier.replace(/\.js$/, ".ts"));
}

/** True when the package's own manifest declares a runtime dependency (or peer) on @clossys/controller -- the only way a bare import of it survives packing. */
function dependsOnController(manifest) {
  if (!isRecord(manifest)) return false;
  return [manifest.dependencies, manifest.peerDependencies].some((block) => isRecord(block) && Object.hasOwn(block, "@clossys/controller"));
}

/**
 * Blanks everything in TypeScript source that is not code -- line and block
 * comments, string literals, template-literal text, and regular-expression
 * literals -- replacing each with spaces (newlines kept), so a call pattern
 * matched afterwards can only match real code. A template literal's `${...}`
 * interpolations are kept as code. Pure; a heuristic tokenizer, not a parser:
 * a `/` counts as a regex literal when the previous significant character
 * cannot end an expression.
 *
 * With `commentsOnly`, only comments are blanked and every literal is kept
 * verbatim -- same tokenizing, so a `//` inside a string is still not a
 * comment. The import scan runs on that form: an import specifier is itself a
 * string literal, but a commented-out import is not an import (#1387 review).
 */
export function stripNonCode(text, { commentsOnly = false } = {}) {
  const out = [];
  const blankComment = (chunk) => chunk.replace(/[^\n]/g, " ");
  const blank = commentsOnly ? (chunk) => chunk : blankComment;
  const braceStack = []; // for each open `{`: true when it opened a template interpolation
  let i = 0;
  let lastSignificant = "";
  const readQuoted = (quote) => {
    let j = i + 1;
    while (j < text.length && text[j] !== quote && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
    return Math.min(j + 1, text.length);
  };
  // Reads template text from i (just after ` or }) to the next ${ or closing `; returns [end, opensInterpolation].
  const readTemplate = (start) => {
    let j = start;
    while (j < text.length) {
      if (text[j] === "\\") { j += 2; continue; }
      if (text[j] === "`") return [j + 1, false];
      if (text[j] === "$" && text[j + 1] === "{") return [j + 2, true];
      j += 1;
    }
    return [text.length, false];
  };
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "/" && next === "/") { const end = text.indexOf("\n", i); const stop = end === -1 ? text.length : end; out.push(blankComment(text.slice(i, stop))); i = stop; continue; }
    if (c === "/" && next === "*") { const end = text.indexOf("*/", i + 2); const stop = end === -1 ? text.length : end + 2; out.push(blankComment(text.slice(i, stop))); i = stop; continue; }
    if (c === "\"" || c === "'") { const stop = readQuoted(c); out.push(blank(text.slice(i, stop))); i = stop; lastSignificant = "a"; continue; }
    if (c === "`" || (c === "}" && braceStack.at(-1) === true)) {
      if (c === "}") braceStack.pop();
      const [stop, opens] = readTemplate(i + 1);
      out.push(blank(text.slice(i, stop)));
      if (opens) braceStack.push(true);
      i = stop; lastSignificant = opens ? "{" : "a"; continue;
    }
    if (c === "/" && (lastSignificant === "" || /[(,=:[!&|?{};+\-*%<>~^]/.test(lastSignificant))) {
      let j = i + 1;
      let inClass = false;
      while (j < text.length && text[j] !== "\n") {
        if (text[j] === "\\") { j += 2; continue; }
        if (text[j] === "[") inClass = true;
        else if (text[j] === "]") inClass = false;
        else if (text[j] === "/" && !inClass) break;
        j += 1;
      }
      if (j < text.length && text[j] === "/") {
        const stop = j + 1;
        out.push(blank(text.slice(i, stop)));
        i = stop; lastSignificant = "a"; continue;
      }
    }
    if (c === "{") braceStack.push(false);
    else if (c === "}") braceStack.pop();
    if (!/\s/.test(c)) lastSignificant = /[\w$]/.test(c) ? "a" : c;
    out.push(c);
    i += 1;
  }
  return out.join("");
}

/** Where a value import of the canonical constructor comes from, or null when the specifier is not one of the three accepted sources. */
function envelopeImportSource(root, packageRoot, file, specifier, manifest) {
  if (specifier === "@clossys/controller") return dependsOnController(manifest) ? "@clossys/controller" : null;
  if (!specifier.startsWith(".")) return null;
  const target = resolveRelativeSource(file, specifier);
  // Only Controller's own code may import the canonical module by relative path; any other package reaching across packages/ would not survive packing.
  if (target === join(root, CANONICAL_ENVELOPE_MODULE) && packageRoot === join(root, "packages", "controller")) return "canonical-module";
  if (target === join(packageRoot, ENVELOPE_COPY_PATH)) return "generated-copy";
  return null;
}

/** Pure over one file's text: the local names under which `buildCheckOutputEnvelope` is value-imported, each with its specifier, plus every relative value-import specifier. */
function scanImports(text) {
  const constructorImports = [];
  const relativeSpecifiers = [];
  for (const match of text.matchAll(VALUE_IMPORT)) {
    const specifier = match[2];
    if (specifier.startsWith(".")) relativeSpecifiers.push(specifier);
    for (const raw of match[1].split(",")) {
      const [imported, local] = raw.trim().split(/\s+as\s+/);
      if (imported === ENVELOPE_CONSTRUCTOR) constructorImports.push({ local: (local ?? imported).trim(), specifier });
    }
  }
  return { constructorImports, relativeSpecifiers };
}

/** A plain JavaScript identifier; the only thing an import binding can be. */
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * A call of `local` as a bare identifier: not part of a longer name, not a
 * property of some other object (`o.name(` -- a single `.`, so a spread
 * `...name(` still counts), and not the name in a local `function name(`
 * definition, which only looks like a call (#1387 review).
 *
 * `local` comes from source text, so it is untrusted: anything that is not
 * a plain identifier (for example a crafted `x|.*`) matches nothing, and
 * every regular-expression metacharacter is escaped as well, so no binding
 * text can widen the pattern into a false adoption.
 */
function callPattern(local) {
  if (!IDENTIFIER.test(local)) return null;
  const escaped = local.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w$])(?<!(?<!\\.)\\.\\s*)(?<!\\bfunction(?:\\s*\\*\\s*|\\s+))${escaped}\\s*\\(`);
}

export function envelopeGap(root, packageDir, role, manifest) {
  // Every path compared below must be absolute: resolveRelativeSource always
  // returns one, so a relative root would never match it (#1387 review).
  root = resolve(root);
  const packageRoot = join(root, "packages", packageDir);
  const findings = [];
  const copyPath = join(packageRoot, ENVELOPE_COPY_PATH);
  let copyCurrent = false;
  if (existsSync(copyPath)) {
    let expected = null;
    try { expected = renderEnvelopeCopyFromRoot(root); } catch (error) {
      findings.push({ rule: "envelope-copy-unverifiable", role, message: `packages/${packageDir}/${ENVELOPE_COPY_PATH} cannot be verified: ${error instanceof Error ? error.message : String(error)}` });
    }
    if (expected !== null) {
      copyCurrent = readFileSync(copyPath, "utf8") === expected;
      if (!copyCurrent) findings.push({ rule: "envelope-copy-drifted", role, message: `packages/${packageDir}/${ENVELOPE_COPY_PATH} differs from what scripts/sync-envelope-copies.mjs generates from ${CANONICAL_ENVELOPE_MODULE} now -- regenerate it with --write, never edit it by hand` });
    }
  }

  const emitters = new Set();
  const relativeImportsByFile = new Map();
  for (const file of listSourceFiles(join(packageRoot, "src"))) {
    // Comments blanked first, so a commented-out import is never an import.
    const code = stripNonCode(readFileSync(file, "utf8"), { commentsOnly: true });
    const { constructorImports, relativeSpecifiers } = scanImports(code);
    relativeImportsByFile.set(file, relativeSpecifiers.map((specifier) => resolveRelativeSource(file, specifier)));
    // Imports removed, then string/template/regex literal text blanked too, so a mention of the constructor in a string is never mistaken for a call.
    const body = stripNonCode(code.replace(VALUE_IMPORT, ""));
    for (const { local, specifier } of constructorImports) {
      const source = envelopeImportSource(root, packageRoot, file, specifier, manifest);
      if (source === null || (source === "generated-copy" && !copyCurrent)) continue;
      const pattern = callPattern(local);
      if (pattern !== null && pattern.test(body)) emitters.add(file);
    }
  }
  const evidence = [...emitters].map((file) => relative(root, file)).sort();

  if (findings.length > 0) return { status: existsSync(copyPath) && !copyCurrent ? "drifted" : "malformed", evidence, findings };
  if (emitters.size === 0) {
    const sample = existsSync(join(packageRoot, "check-output-envelope.fixture.json"));
    return { status: sample ? "sample-only" : "absent", evidence, findings };
  }

  const status = isRecord(manifest) && isRecord(manifest.foundry) ? manifest.foundry.status : undefined;
  if (isRecord(status) && isText(status.bin)) {
    const target = isRecord(manifest.bin) ? manifest.bin[status.bin] : undefined;
    const probeSource = isText(target) && /^(?:\.\/)?dist\/.+\.js$/.test(target) ? join(packageRoot, target.replace(/^(?:\.\/)?dist\//, "src/").replace(/\.js$/, ".ts")) : null;
    const reaches = probeSource !== null && (emitters.has(probeSource) || (relativeImportsByFile.get(probeSource) ?? []).some((path) => emitters.has(path)));
    if (!reaches) return { status: "partial", evidence, findings, reason: `the foundry.status probe (${status.bin}) does not construct the envelope itself or through one relative import` };
  }
  return { status: "declared", evidence, findings };
}

/**
 * Checks 3 and 8 do not apply to a producer package (issue #1381's
 * decision). Both grade CONSUMER state: clossys/<role>/loop.json (where the
 * lifecycle words live) and clossys/<role>/STATUS.md are written by
 * @clossys/controller's loop engine inside a staffed repository
 * (docs/contracts/loop.json's `state.machineFile` / `state.humanFile`). A
 * role package ships neither file, and this repository staffs no role (it
 * has no clossys/brief.json), so grading this repository's own root
 * clossys/<role>/ would grade state that does not exist here -- and the
 * only way to "pass" would be to write placeholder state, which is
 * fabricated. The producer-side guarantee for both already lives in the
 * engine's own typed code (packages/controller/src/loop/lifecycle.ts and
 * loop/status.ts). These two items are reported `n/a` with this reason and
 * never counted as gaps; the consumer-side check belongs to the engine
 * running in a staffed repository.
 */
export const NOT_APPLICABLE_TO_PRODUCER = Object.freeze({
  lifecycleWords: "not applicable to a producer package: the lifecycle words live in clossys/<role>/loop.json, consumer state the loop engine (@clossys/controller) writes in a staffed repository; a role package ships no loop.json, and the engine's own lifecycle.ts types every word it writes (#1381)",
  statusMd: "not applicable to a producer package: clossys/<role>/STATUS.md is consumer state the loop engine renders in a staffed repository (docs/contracts/loop.json state.humanFile); a role package ships no STATUS.md, and writing one here would be fabricated state (#1381)",
});

/**
 * Check 5: the clossys/<role>/ layout is used -- graded on what the PACKAGE
 * declares it will write (issue #1381's decision), not on whether this
 * repository happens to have a clossys/<role>/ folder of its own. Every
 * path the manifest declares (`outputs`, `feeds[].path`,
 * `capabilities[].outputs`) must sit under clossys/<role>/. `declared` when
 * at least one path is declared and all of them do; `absent` when none is
 * declared; `malformed` otherwise (the misplaced path itself is already a
 * finding from the Stage A gates composed above, so it is not reported
 * twice).
 */
function layoutGap(role, manifest) {
  const foundry = isRecord(manifest) && isRecord(manifest.foundry) ? manifest.foundry : {};
  const paths = [];
  if (Array.isArray(foundry.outputs)) paths.push(...foundry.outputs);
  if (Array.isArray(foundry.feeds)) for (const item of foundry.feeds) paths.push(isRecord(item) ? item.path : item);
  if (Array.isArray(foundry.capabilities)) for (const item of foundry.capabilities) if (isRecord(item) && Array.isArray(item.outputs)) paths.push(...item.outputs);
  if (paths.length === 0) return { status: "absent" };
  const prefix = `clossys/${roleShortName(role)}/`;
  const inside = paths.every((path) => isText(path) && path.startsWith(prefix) && !path.split("/").includes(".."));
  return { status: inside ? "declared" : "malformed" };
}

/** Check 6: the duplicated conversation block is removed, in favour of the #1182 contract. A package's OWN packages/<pkg>/skill/SKILL.md source still carrying either legacy heading means composition has something to replace, which is fine pre-migration, but conformance means the source itself no longer carries a local copy. */
function conversationContractGap(skillSource) {
  if (skillSource === null) return { status: "absent" };
  const stillDuplicated = LEGACY_CONTRACT_HEADINGS.some((heading) => skillSource.includes(heading));
  return { status: stillDuplicated ? "not-removed" : "declared" };
}

/**
 * Pure-ish core: takes already-collected per-package descriptors (manifest,
 * skill source, and the pre-resolved loop-matrix descriptor bundle
 * check-loop-matrix.mjs's own evaluator wants) plus the frameworkAndCapability
 * lookups, and returns the eight-column conformance report. Each descriptor
 * may carry
 * `classification: "role"|"tooling"|"unclassified"|"both"|"invalid-name"|
 * "missing-manifest"|"invalid-manifest"|"symlinked-package"`
 * (scripts/package-classification.mjs);
 * it defaults to "role" when omitted, so an existing caller that only ever
 * built role descriptors keeps behaving exactly as before. A "tooling"
 * descriptor gets its own reduced row (excluded: executable-tooling, only
 * outputEnvelope and conversationContract computed -- Decision 1). Every
 * other non-"role" classification (isInvalidClassification) always produces
 * a classificationFinding, in report mode and --enforce alike; for all of
 * them except "unclassified"/"both", `role` carries the package's directory
 * name, since there is no manifest name to use (no manifest at all, an
 * unparseable one, or one with no usable name).
 */
export function evaluateConformance(root, descriptors, options = {}) {
  const { enforce = false, allowlist = {} } = options;
  const allowlisted = new Set(Object.keys(allowlist));

  const roleDescriptors = descriptors.filter((d) => (d.classification ?? "role") === "role");
  const toolingDescriptors = descriptors.filter((d) => d.classification === "tooling");
  const invalidDescriptors = descriptors.filter((d) => isInvalidClassification(d.classification));

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

    const envelope = envelopeGap(root, descriptor.packageDir, role, descriptor.manifest);
    row.outputEnvelope = envelope.status;
    row.envelopeEvidence = envelope.evidence;
    findings.push(...envelope.findings);

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

    const envelope = envelopeGap(root, descriptor.packageDir, role, descriptor.manifest);
    row.outputEnvelope = envelope.status;
    row.envelopeEvidence = envelope.evidence;
    if (envelope.reason !== undefined) row.envelopeReason = envelope.reason;
    findings.push(...envelope.findings);

    row.lifecycleWords = "n/a";

    const loopRow = loopMatrixByRole.get(role) ?? { loopMatrix: "absent", generatedSection: "absent" };
    row.loopSection = loopRow.loopMatrix === "declared" && loopRow.generatedSection === "current" ? "declared" : (loopRow.loopMatrix === "absent" ? "absent" : "partial");
    for (const item of loopMatrixResult.findings) if (item.role === role) findings.push(item);

    row.layout = layoutGap(role, descriptor.manifest).status;

    const conversation = conversationContractGap(descriptor.skillSource);
    row.conversationContract = conversation.status === "declared" ? "declared" : (conversation.status === "absent" ? "absent" : "not-removed");

    const capabilitiesRow = capabilitiesByRole.get(role);
    row.capabilityMap = capabilitiesRow?.capabilities ?? "absent";

    row.statusMd = "n/a";
    row.notApplicable = { ...NOT_APPLICABLE_TO_PRODUCER };

    for (const key of GAP_KEYS) if (row[key] !== "declared" && row[key] !== "n/a") gapCount.gaps += 1;
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
        if (key === "outputEnvelope" && (row[key] === "sample-only" || row[key] === "partial")) findings.push({ rule: "conformance-gap-outputEnvelope", role, message: row[key] === "sample-only" ? "outputEnvelope has only a hand-written sample file, not emission through the canonical constructor — required under --enforce (#1384)" : `outputEnvelope is partial: ${row.envelopeReason} — required under --enforce (#1383)` });
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
    if (entry.isSymbolicLink()) {
      // packages/<dir> itself is a symlink -- Dirent.isDirectory() would
      // say false even if it points at a real directory with a valid
      // manifest (it reflects the entry's own type, not its target's), so
      // a plain `!entry.isDirectory()` check would silently drop this the
      // same way a missing manifest used to. Report it directly and never
      // follow it (scripts/package-classification.mjs's own
      // "symlinked-package" case) -- a git-stored symlink under packages/
      // is itself the defect, independent of wherever it points.
      descriptors.push({ role: entry.name, packageDir: entry.name, manifest: null, skillSource: null, loopMatrixDoc: null, capabilityIds: null, stageActivities: null, classification: "symlinked-package" });
      continue;
    }
    if (!entry.isDirectory()) continue; // a plain file under packages/ -- ignored, as always; never a package
    const manifestPath = join(packagesDir, entry.name, "package.json");
    if (!existsSync(manifestPath)) {
      // The directory itself is a package this gate must account for, even
      // with no package.json at all -- report it directly, using the
      // directory name as the only identity available
      // (scripts/package-classification.mjs's own "missing-manifest" case),
      // rather than silently skipping the directory.
      descriptors.push({ role: entry.name, packageDir: entry.name, manifest: null, skillSource: null, loopMatrixDoc: null, capabilityIds: null, stageActivities: null, classification: "missing-manifest" });
      continue;
    }
    const { ok: manifestOk, manifest } = readManifest(manifestPath);
    if (!manifestOk) {
      // package.json exists but readManifest couldn't turn it into a usable
      // manifest object -- unreadable, not valid JSON, or valid JSON that
      // isn't a plain object (null, an array, a primitive). Fail closed on
      // just this one package (scripts/package-classification.mjs's own
      // "invalid-manifest" case) rather than crashing or aborting the
      // entire gate run.
      descriptors.push({ role: entry.name, packageDir: entry.name, manifest: null, skillSource: null, loopMatrixDoc: null, capabilityIds: null, stageActivities: null, classification: "invalid-manifest" });
      continue;
    }
    if (!isText(manifest.name)) {
      // The manifest exists but carries no usable name -- there is nothing
      // to classify, so report it directly rather than calling
      // classifyPackage. The directory name is the only identity available
      // (scripts/package-classification.mjs's own "invalid-name" case).
      descriptors.push({ role: entry.name, packageDir: entry.name, manifest, skillSource: null, loopMatrixDoc: null, capabilityIds: null, stageActivities: null, classification: "invalid-name" });
      continue;
    }
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
    // A symlink, a missing manifest, or an unusable manifest (unreadable,
    // unparseable, or not a plain object -- e.g. `null`) is already
    // reported as its own finding by collectDescriptors() above
    // (symlinked-package / missing-manifest / invalid-manifest) -- this
    // second, role-name-keyed lookup only needs to skip each of those
    // here, not report them again, and must never follow a symlink or let
    // a broken package.json crash the whole run.
    if (entry.isSymbolicLink()) continue;
    if (!entry.isDirectory()) continue;
    const manifestPath = join(packagesDir, entry.name, "package.json");
    if (!existsSync(manifestPath)) continue;
    const { ok: manifestOk, manifest } = readManifest(manifestPath);
    if (!manifestOk) continue;
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
    if (isInvalidClassification(row.classification)) {
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
  const invalidRows = result.table.filter((row) => isInvalidClassification(row.classification));
  const totalGaps = roleRows.reduce((sum, row) => sum + row.gaps, 0);
  console.log(`\n${roleRows.length} active role(s), ${totalGaps} total gap(s) against Stage A (0 gaps = fully conforming).`);
  if (toolingRows.length > 0) console.log(`${toolingRows.length} package(s) excluded as executable tooling: ${toolingRows.map((row) => row.role).join(", ")}.`);
  if (invalidRows.length > 0) console.log(`${invalidRows.length} package(s) failed role/tooling classification: ${invalidRows.map((row) => row.role).join(", ")}.`);
  for (const [key, reason] of Object.entries(NOT_APPLICABLE_TO_PRODUCER)) console.log(`${key} = n/a on every role row — ${reason}.`);
  if (Object.keys(allowlist).length > 0) console.log(`Allowlist: ${Object.keys(allowlist).join(", ")}`);
  console.log(enforce ? "Running with --enforce: any gap on a non-allowlisted role is a finding. Tooling-row items and classification findings are unconditional in both modes." : "Report mode: gaps are printed and counted, never a failure, except a drifted generated loop section or envelope copy and a classification defect (always a failure). Pass --enforce for the enforcing mode.");
  return result.findings.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exitCode = main(process.argv.slice(2));
}
