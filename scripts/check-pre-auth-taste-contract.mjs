#!/usr/bin/env node
// check-pre-auth-taste-contract — PRE-AUTH-QUALITY must bound the taste pass after fold-check 3.
//
//   node scripts/check-pre-auth-taste-contract.mjs [--json] [<repoRoot>]
//
// Exit 0 = contract section and fixture-aligned markers present.
// Exit 1 = missing bounded taste control.
// Exit 2 = tree unreadable.

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(scriptDir, "fixtures", "pre-auth-expression-deliverability.json");

const BOUNDED_HEADING = /^## Bounded taste pass/m;

/** Shared with check-package-skills.mjs — expression-wave skills point here, not a longer skill loop. */
export const PRE_AUTH_TASTE_FOLD_PRECONDITION =
  /designer-fold-check[\s\S]{0,120}green|after[\s\S]{0,80}designer-fold-check[\s\S]{0,80}green/i;
export const PRE_AUTH_TASTE_ROUND_CAP = /\b3 inhabit rounds\b|\bat most 3 inhabit rounds\b/i;
export const PRE_AUTH_TASTE_WALL_CLOCK = /\b45 minutes\b|\b45-minute\b/i;
export const PRE_AUTH_TASTE_SCREENSHOTS = /screenshot/i;
export const PRE_AUTH_TASTE_SEPARATE_SESSION = /separate session/i;
export const PRE_AUTH_NO_SELF_CERTIFY_KEEP =
  /does not self-certify|do not self-certify|must not self-certify|does not grade its own/i;

function loadFixture() {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
}

export function evaluatePreAuthTasteContract(markdown, fixture = loadFixture()) {
  const findings = [];
  if (!BOUNDED_HEADING.test(markdown)) {
    findings.push({
      rule: "bounded-taste-heading",
      message:
        "PRE-AUTH-QUALITY.md must contain '## Bounded taste pass' — taste is gated prose, not a longer skill",
    });
  }
  for (const cli of fixture.floorGateClis) {
    if (!markdown.includes(cli)) {
      findings.push({
        rule: "floor-gate-cli",
        message: `PRE-AUTH-QUALITY.md must name floor gate ${cli} (fixture scripts/fixtures/pre-auth-expression-deliverability.json)`,
      });
    }
  }
  if (fixture.tasteStartsAfterFoldCheckGreen && !PRE_AUTH_TASTE_FOLD_PRECONDITION.test(markdown)) {
    findings.push({
      rule: "taste-after-fold-check",
      message:
        "PRE-AUTH-QUALITY.md must state taste/inhabit starts only after designer-fold-check (and floor gates) are green",
    });
  }
  if (fixture.inhabitRoundCap === 3 && !PRE_AUTH_TASTE_ROUND_CAP.test(markdown)) {
    findings.push({
      rule: "inhabit-round-cap",
      message: "PRE-AUTH-QUALITY.md must cap inhabit at 3 rounds (whichever-first with wall clock)",
    });
  }
  if (fixture.wallClockMinutesCap === 45 && !PRE_AUTH_TASTE_WALL_CLOCK.test(markdown)) {
    findings.push({
      rule: "wall-clock-cap",
      message: "PRE-AUTH-QUALITY.md must name a 45-minute wall-clock stop for the taste pass",
    });
  }
  if (fixture.requiresScreenshots && !PRE_AUTH_TASTE_SCREENSHOTS.test(markdown)) {
    findings.push({
      rule: "screenshot-inputs",
      message: "PRE-AUTH-QUALITY.md must require desktop and narrow-width screenshots for taste/inhabit",
    });
  }
  if (fixture.separateSessionFromDoer && !PRE_AUTH_TASTE_SEPARATE_SESSION.test(markdown)) {
    findings.push({
      rule: "separate-session",
      message: "PRE-AUTH-QUALITY.md must require a separate session from the doer walk",
    });
  }
  if (fixture.doerMustNotSelfCertifyKeep && !PRE_AUTH_NO_SELF_CERTIFY_KEEP.test(markdown)) {
    findings.push({
      rule: "no-self-certify",
      message: "PRE-AUTH-QUALITY.md must forbid the doer from self-certifying exceptional keep",
    });
  }
  return {
    exitCode: findings.length === 0 ? 0 : 1,
    findings,
  };
}

export function scanPreAuthTasteContract(root) {
  const docPath = join(root, "packages", "designer", "PRE-AUTH-QUALITY.md");
  if (!existsSync(docPath)) {
    throw new Error(`PRE-AUTH-QUALITY.md not found: ${docPath}`);
  }
  const markdown = readFileSync(docPath, "utf8");
  return evaluatePreAuthTasteContract(markdown);
}

function printText(result) {
  if (result.findings.length === 0) {
    console.log("check-pre-auth-taste-contract: PRE-AUTH-QUALITY bounded taste OK");
    return;
  }
  console.error(`check-pre-auth-taste-contract: ${result.findings.length} finding(s)`);
  for (const finding of result.findings) {
    console.error(`  [${finding.rule}] ${finding.message}`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const root = resolve(args.find((a) => a !== "--json") ?? join(scriptDir, ".."));
  let result;
  try {
    result = scanPreAuthTasteContract(root);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) {
      console.log(JSON.stringify({ exitCode: 2, error: message }, null, 2));
    } else {
      console.error(`check-pre-auth-taste-contract: cannot answer — ${message}`);
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
