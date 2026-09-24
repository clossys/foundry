// conversation-contract-checks — static regression checks for #1185's
// second half: does each role's OWN skill content (not the shared block
// scripts/check-conversation-contract.mjs already gates) instruct the agent
// to do something docs/contracts/conversation-contract.md's rules forbid?
//
// packages/*/skill/SKILL.md is the AGENT's own operating instructions, not
// the client-facing transcript -- it legitimately discusses ids, paths,
// versions, and commands throughout (that is how it tells the agent to do
// its own work). The rules below are therefore NOT a jargon scan of the
// whole file; each one looks for a specific instruction that would make the
// agent itself violate one of #1182's four hard rules when it talks to a
// client:
//
//   - client-facing-jargon-request: an instruction telling the agent to ask
//     the CLIENT for an id, slug, path, version, sha, or command -- the
//     contract's own "Never ask for ids, slugs, paths, versions, commands,
//     or tool choices."
//   - multi-question-per-turn: an instruction to ask the client more than
//     one question in the same turn -- "One decision per turn; no forms."
//   - bare-loop-directive: the word `loop` presented, quoted or backticked,
//     as something to type or say, with no `/clossys-<role>` or
//     `@clossys-<role>` prefix on the same line -- #1194's "every
//     invocation carries the loop keyword ... never a bare skill name."
//
// Each is a narrow, mechanical regex over plain text: false negatives are
// expected (this cannot prove a skill NEVER violates the contract), but a
// match is real, specific instruction text worth a human's attention -- the
// same report-mode-first posture as check:package-framework and
// check:package-conformance in this repository.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { injectContract } from "../../scripts/check-conversation-contract.mjs";

/**
 * Strips the shared "How we work together" / legacy "One question at a
 * time" block from a raw skill/SKILL.md source, the same boundary
 * check-conversation-contract.mjs's own `injectContract` already detects
 * (start heading to the next `## ` heading or EOF) -- reused here by
 * injecting an empty contract in its place, rather than duplicating the
 * boundary logic a second time.
 */
export function roleOwnContent(skillBody) {
  return injectContract(skillBody, "").trim();
}

const JARGON_ASK_RE = /\bask\b[^.?!\n]{0,80}\b(client|sponsor|founder)\b[^.?!\n]{0,80}\b(id|slug|file path|exit code|sha\b|command|tool choice)/i;
const MULTI_QUESTION_RE = /\bask\b[^.?!\n]{0,60}\b(both|all three|the following questions|two questions|three questions|multiple questions|several questions)\b/i;
const BARE_LOOP_TOKEN_RE = /[`"]loop[`"]/i;
// A sentence that ALREADY names a `clossys-<role>`/`@clossys-<role>` prefix,
// or that is explaining the rule rather than invoking it (negation words:
// "never", "no bare", "without", "not a bare"), is not a bare-loop
// directive -- it is either the correct form or prose about the rule
// itself. Only a sentence with neither is flagged.
const ROLE_PREFIX_RE = /[@/]clossys-[a-z-]+/i;
const RULE_EXPLANATION_RE = /\b(never|without|not a bare|no bare)\b/i;

/** Splits on sentence-ending punctuation followed by whitespace, or a blank line -- coarse, but this is a heuristic scan, not a parser. */
function sentences(text) {
  return text.split(/(?<=[.!?])\s+(?=[A-Z`-])|\n{2,}/);
}

function findBareLoopDirectives(text) {
  const findings = [];
  for (const sentence of sentences(text)) {
    if (BARE_LOOP_TOKEN_RE.test(sentence) && !ROLE_PREFIX_RE.test(sentence) && !RULE_EXPLANATION_RE.test(sentence)) {
      findings.push(sentence.trim());
    }
  }
  return findings;
}

/**
 * Runs the three static rules above against one package's role-specific
 * skill content. Returns findings in
 * docs/contracts/check-output-envelope.json's findingShape.
 */
export function evaluateSkillContract(packageDir, skillBody) {
  const findings = [];
  const roleText = roleOwnContent(skillBody);
  const path = `packages/${packageDir}/skill/SKILL.md`;

  if (JARGON_ASK_RE.test(roleText)) {
    findings.push({
      rule: "client-facing-jargon-request",
      severity: "warning",
      message: "skill text appears to instruct the agent to ask the client for a technical identifier (id, slug, path, version, sha, command, or tool choice) -- the contract forbids this",
      path,
    });
  }

  if (MULTI_QUESTION_RE.test(roleText)) {
    findings.push({
      rule: "multi-question-per-turn",
      severity: "warning",
      message: "skill text appears to instruct the agent to ask more than one question in a single turn -- the contract requires one decision per turn",
      path,
    });
  }

  for (const line of findBareLoopDirectives(roleText)) {
    findings.push({
      rule: "bare-loop-directive",
      severity: "warning",
      message: `skill text quotes "loop" with no /clossys-<role> or @clossys-<role> prefix on the same line -- #1194 requires every invocation to carry the role prefix, never a bare skill name: ${JSON.stringify(line)}`,
      path,
    });
  }

  return findings;
}

/** Every packages/*\/skill/SKILL.md source, sorted by package directory name. */
export function collectSkillSources(root) {
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
 * Runs {@link evaluateSkillContract} over every package's skill. Report
 * mode only (issue #1185: "Start in report mode if the current tree
 * doesn't pass yet") -- every finding here is `severity: "warning"` and
 * never fails the gate on its own; see scripts/check-evals.mjs for how the
 * overall verdict folds this in.
 */
export function checkConversationContractStatics(root) {
  const sources = collectSkillSources(root);
  const findings = sources.flatMap(({ packageDir, skillBody }) => evaluateSkillContract(packageDir, skillBody));
  return { findings, scannedPackages: sources.map((source) => source.packageDir) };
}
