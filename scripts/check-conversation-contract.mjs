#!/usr/bin/env node
// check-conversation-contract — every package's skill, once composed, carries
// the one shared conversation contract (#1182) exactly once.
//
//   node scripts/check-conversation-contract.mjs [--json] [<repoRoot>]
//
// Exit 0 = composing every packages/*/skill/SKILL.md source (the same
//   replace-in-place `@clossys/launcher` performs; see
//   packages/launcher/src/contract.ts, which this gate deliberately
//   reimplements rather than imports — see WHY below) puts the current
//   docs/contracts/conversation-contract.md block into the result exactly
//   once, with no leftover `## One question at a time` block behind.
// Exit 1 = at least one composed skill is missing the contract, has it more
//   than once, or still carries the legacy heading.
// Exit 2 = the tree could not be read (missing packages/, missing the
//   contract document).
//
// WHY THIS SCRIPT REIMPLEMENTS THE SPLICE INSTEAD OF IMPORTING
// packages/launcher/src/contract.ts
// -----------------------------------------------------------------------
// This suite is wired into `check:gates`, which this repository's own
// AGENTS.md and package.json comments are explicit must stay dependency-free
// — no `npm run build` first (the `safety` CI job runs it before anything is
// compiled). `contract.ts` is TypeScript; importing it here would need
// either a prior `tsc` build or a transpile-on-import runtime, either of
// which is exactly the dependency this suite is not allowed to acquire.
// Every other gate in this repository that checks `packages/*/skill/SKILL.md`
// content (see check-package-skills.mjs) already follows the same pattern:
// a small, plain-JS reimplementation that reads the real files on disk,
// rather than a runtime import of the package it is checking. The splice
// algorithm is short and pure; keeping two copies in sync is a much smaller
// risk than teaching check:gates to depend on a build.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));

const CONTRACT_HEADING = "## How we work together";
const LEGACY_HEADING = "## One question at a time";
const INSTALLED_HEADING = "## When this package is installed";

function lineIndex(lines, heading, from = 0) {
  for (let index = from; index < lines.length; index += 1) {
    if ((lines[index] ?? "").trim() === heading) return index;
  }
  return -1;
}

/** Mirrors packages/launcher/src/contract.ts#extractContractBlock. */
export function extractContractBlock(rawDocText) {
  const lines = rawDocText.split("\n");
  const index = lineIndex(lines, CONTRACT_HEADING);
  if (index === -1) {
    throw new Error("conversation contract document is missing its `## How we work together` heading");
  }
  return lines.slice(index).join("\n").trim();
}

/** Mirrors packages/launcher/src/contract.ts#injectContract. */
export function injectContract(skillBody, contractBlock) {
  const contract = contractBlock.trim();
  const lines = skillBody.split("\n");
  const howIdx = lineIndex(lines, CONTRACT_HEADING);
  const oneIdx = lineIndex(lines, LEGACY_HEADING);

  let start;
  let end;
  if (howIdx !== -1 || oneIdx !== -1) {
    start = howIdx === -1 ? oneIdx : oneIdx === -1 ? howIdx : Math.min(howIdx, oneIdx);
    end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
      const trimmed = (lines[index] ?? "").trim();
      if (trimmed.startsWith("## ") && trimmed !== CONTRACT_HEADING && trimmed !== LEGACY_HEADING) {
        end = index;
        break;
      }
    }
  } else {
    const installedIdx = lineIndex(lines, INSTALLED_HEADING);
    start = installedIdx === -1 ? lines.length : installedIdx;
    end = start;
  }

  const before = lines.slice(0, start);
  const after = lines.slice(end);
  const needsLeadingBlank = before.length > 0 && (before[before.length - 1] ?? "").trim() !== "";
  const needsTrailingBlank = after.length > 0 && (after[0] ?? "").trim() !== "";
  const block = [
    ...(needsLeadingBlank ? [""] : []),
    ...contract.split("\n"),
    ...(needsTrailingBlank ? [""] : []),
  ];
  return [...before, ...block, ...after].join("\n");
}

function countOccurrences(haystack, needle) {
  if (needle === "") return 0;
  return haystack.split(needle).length - 1;
}

/** Grades an already-composed skill body against the contract block. */
export function evaluateComposedSkill(packageDir, composed, contractBlock) {
  const findings = [];
  const occurrences = countOccurrences(composed, contractBlock);
  if (occurrences === 0) {
    findings.push({ rule: "contract-missing", packageDir, message: "composed skill does not contain the current conversation contract" });
  } else if (occurrences > 1) {
    findings.push({ rule: "contract-duplicated", packageDir, message: `composed skill contains the contract ${occurrences} times, expected exactly once` });
  }
  if (composed.includes(LEGACY_HEADING)) {
    findings.push({ rule: "legacy-heading-leftover", packageDir, message: `composed skill still contains the legacy "${LEGACY_HEADING}" heading` });
  }
  return { packageDir, composed, findings };
}

export function collectPackageSkillSources(root) {
  const packagesDir = join(root, "packages");
  if (!existsSync(packagesDir)) throw new Error(`packages directory not found: ${packagesDir}`);
  const sources = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillPath = join(packagesDir, entry.name, "skill", "SKILL.md");
    if (!existsSync(skillPath)) continue;
    sources.push({ packageDir: entry.name, skillBody: readFileSync(skillPath, "utf8") });
  }
  sources.sort((a, b) => a.packageDir.localeCompare(b.packageDir));
  return sources;
}

/**
 * Composes every packages/*\/skill/SKILL.md source into a real temp
 * directory — `<tmp>/clossys-<pkg>/SKILL.md`, the same layout
 * `@clossys/launcher` writes under `.agents/skills/` — then reads each file
 * back and grades it against the current contract document. The temp
 * directory is removed before returning.
 */
export function scanConversationContract(root) {
  const contractPath = join(root, "docs", "contracts", "conversation-contract.md");
  if (!existsSync(contractPath)) throw new Error(`conversation contract document not found: ${contractPath}`);
  const contractBlock = extractContractBlock(readFileSync(contractPath, "utf8"));
  const sources = collectPackageSkillSources(root);

  const composeRoot = mkdtempSync(join(tmpdir(), "check-conversation-contract-"));
  let results;
  try {
    results = sources.map(({ packageDir, skillBody }) => {
      const composed = injectContract(skillBody, contractBlock);
      const skillDir = join(composeRoot, `clossys-${packageDir}`);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), composed);
      const writtenBack = readFileSync(join(skillDir, "SKILL.md"), "utf8");
      return evaluateComposedSkill(packageDir, writtenBack, contractBlock);
    });
  } finally {
    rmSync(composeRoot, { recursive: true, force: true });
  }

  const findings = results.flatMap((result) => result.findings);
  return {
    exitCode: findings.length === 0 ? 0 : 1,
    findings,
    passed: results.filter((result) => result.findings.length === 0).map((result) => result.packageDir),
  };
}

function printText(result) {
  if (result.findings.length === 0) {
    console.log(`check-conversation-contract: ${result.passed.length} composed skill(s) carry the contract exactly once`);
    return;
  }
  console.error(`check-conversation-contract: ${result.findings.length} finding(s)`);
  for (const finding of result.findings) {
    console.error(`  [${finding.packageDir}] ${finding.rule}: ${finding.message}`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const root = resolve(args.find((a) => a !== "--json") ?? join(scriptDir, ".."));
  let result;
  try {
    result = scanConversationContract(root);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) {
      console.log(JSON.stringify({ exitCode: 2, error: message }, null, 2));
    } else {
      console.error(`check-conversation-contract: cannot answer — ${message}`);
    }
    process.exit(2);
  }
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printText(result);
  }
  process.exit(result.exitCode);
}

if (process.argv[1]) {
  try {
    if (realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) {
      main();
    }
  } catch {
    if (fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
      main();
    }
  }
}
