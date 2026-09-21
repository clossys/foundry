#!/usr/bin/env node
// check-package-skills — every published package ships a packed Agent Skill.
//
//   node scripts/check-package-skills.mjs [--json] [<repoRoot>]
//
// Exit 0 = every packages/*/package.json has skill/SKILL.md with valid frontmatter
//   and lists "skill" in package.json "files" so the packed tarball ships it.
// Exit 1 = at least one package is missing a skill, frontmatter is invalid, or
//   "files" omits "skill".
// Exit 2 = the tree could not be read.
//
// Agent Skills spec: `name` is 1–64 chars, lowercase letters, digits, hyphens
// only. When composed into a consumer hub, the skill lives at
// `.agents/skills/clossys-<pkg>/SKILL.md` — there `name` matches the parent
// directory `clossys-<pkg>`. In this supplier tree the file sits at
// `packages/<pkg>/skill/SKILL.md`; the parent directory is `skill`, which is
// intentional; this gate checks frontmatter `name === clossys-<pkg>` instead.

import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const MAX_NAME_LEN = 64;
const MAX_DESCRIPTION_LEN = 1024;

function isText(value) {
  return typeof value === "string" && value.trim() !== "";
}

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { error: "missing YAML frontmatter delimiters" };
  const lines = match[1].split(/\r?\n/);
  const data = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) return { error: `unparseable frontmatter line: ${trimmed}` };
    const key = trimmed.slice(0, colon).trim();
    let value = trimmed.slice(colon + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key === "disable-model-invocation") {
      data[key] = value === "true";
    } else {
      data[key] = value;
    }
  }
  return { data };
}

function validateSkillName(name, expectedName, packageDir) {
  const findings = [];
  if (!isText(name)) {
    findings.push({ rule: "missing-name", packageDir, message: "frontmatter name is required" });
    return findings;
  }
  if (name.length > MAX_NAME_LEN) {
    findings.push({ rule: "name-too-long", packageDir, message: `name exceeds ${MAX_NAME_LEN} characters` });
  }
  if (name !== expectedName) {
    findings.push({
      rule: "name-mismatch",
      packageDir,
      message: `frontmatter name must be ${expectedName}, got ${name}`,
    });
  }
  if (name.includes("/") || name.includes("@")) {
    findings.push({ rule: "invalid-name-chars", packageDir, message: "name must not contain / or @" });
  }
  if (/[A-Z]/.test(name)) {
    findings.push({ rule: "name-uppercase", packageDir, message: "name must be lowercase" });
  }
  if (name.includes("--")) {
    findings.push({ rule: "name-consecutive-hyphens", packageDir, message: "name must not contain consecutive hyphens" });
  }
  if (!NAME_PATTERN.test(name)) {
    findings.push({
      rule: "name-pattern",
      packageDir,
      message: "name must use only a-z, 0-9, and single hyphens between segments",
    });
  }
  return findings;
}

const CUSTOMER_SESSION_WAVE = new Set(["designer", "writer", "publisher", "strategist"]);
/** Expression-wave skills own the pre-auth page contract. Frontmatter-only was not enough. */
const PRE_AUTH_EXPRESSION_WAVE = new Set(["designer", "writer", "publisher"]);
const PRE_AUTH_HEADING = /^## Pre-auth page[ \t]*$/m;
const PUBLISHER_PRE_AUTH_MARKETING_VIEW = /MarketingView/;
const PRE_AUTH_QUALITY_REF = /PRE-AUTH-QUALITY(?:\.md)?/;
const PRE_AUTH_EXCEPTIONAL = /\bexceptional\b/i;
const PRE_AUTH_SYNTHETIC_USER = /synthetic user/i;
const PRE_AUTH_NO_AUTHOR_KEEP = /does not author keep-review|do not author keep-review/i;
const INSPECTOR_USER_BOUNDARY = /synthetic user/i;

function validateSkillBody(packageDir, text) {
  const findings = [];
  if (packageDir === "customer") {
    const inhabit =
      /\bi am\b/i.test(text) ||
      (/named/i.test(text) && /audience/i.test(text)) ||
      /synthetic/i.test(text);
    if (!inhabit) {
      findings.push({
        rule: "customer-inhabit-language",
        packageDir,
        message: "customer skill must speak first-person inhabit of a named Audience (I am / named Audience / synthetic)",
      });
    }
    if (!/clossys-customer/.test(text)) {
      findings.push({
        rule: "customer-invoke-name",
        packageDir,
        message: "customer skill must mention clossys-customer as the invoke name",
      });
    }
    if (/\b(?:you are|i am)(?: a| the)? reviewer\b/i.test(text)) {
      findings.push({
        rule: "customer-not-reviewer",
        packageDir,
        message: "customer skill must not describe itself as a reviewer",
      });
    }
    for (const intent of ["feedback", "compare", "refer", "churn", "adopt", "worth"]) {
      if (!new RegExp(`\\b${intent}\\b`, "i").test(text)) {
        findings.push({
          rule: "customer-speed-dial-intents",
          packageDir,
          message: `customer skill must name speed-dial intent "${intent}"`,
        });
      }
    }
  }
  if (CUSTOMER_SESSION_WAVE.has(packageDir) || packageDir === "inspector") {
    if (!/clossys-customer/.test(text)) {
      findings.push({
        rule: "expression-customer-session",
        packageDir,
        message: "must name clossys-customer as the independent first-person inhabit session",
      });
    }
  }
  return findings;
}

/** Pure evaluation for tests and CLI. */
export function evaluatePackageSkills(packages) {
  const findings = [];
  const passed = [];
  for (const {
    packageDir,
    skillPath,
    skillText,
    expectedName,
    cataloguePath,
    catalogueText,
    files,
  } of packages) {
    const pkgFindings = [];
    const hasSkill = skillText !== undefined || existsSync(skillPath);
    if (!hasSkill) {
      pkgFindings.push({
        rule: "missing-skill",
        packageDir,
        message: `expected skill/SKILL.md under packages/${packageDir}`,
      });
    } else {
      const text = skillText ?? readFileSync(skillPath, "utf8");
      const { data, error } = parseFrontmatter(text);
      if (error) {
        pkgFindings.push({ rule: "frontmatter-parse", packageDir, message: error });
      } else {
        pkgFindings.push(...validateSkillName(data.name, expectedName, packageDir));
        if (!isText(data.description)) {
          pkgFindings.push({ rule: "missing-description", packageDir, message: "description is required" });
        } else if (data.description.length > MAX_DESCRIPTION_LEN) {
          pkgFindings.push({
            rule: "description-too-long",
            packageDir,
            message: `description exceeds ${MAX_DESCRIPTION_LEN} characters`,
          });
        }
        if (packageDir !== "advisor" && data["disable-model-invocation"] !== true) {
          pkgFindings.push({
            rule: "disable-model-invocation",
            packageDir,
            message: "disable-model-invocation: true is required (advisor may omit or set false)",
          });
        }
        pkgFindings.push(...validateSkillBody(packageDir, text));
        if (PRE_AUTH_EXPRESSION_WAVE.has(packageDir) && !PRE_AUTH_HEADING.test(text)) {
          pkgFindings.push({
            rule: "pre-auth-page-heading",
            packageDir,
            message: "expression-wave skill must contain a '## Pre-auth page' heading — the brief the packed skill carries",
          });
        }
        if (PRE_AUTH_EXPRESSION_WAVE.has(packageDir) && PRE_AUTH_HEADING.test(text)) {
          if (!PRE_AUTH_QUALITY_REF.test(text)) {
            pkgFindings.push({
              rule: "pre-auth-quality-ref",
              packageDir,
              message: "expression-wave skill must reference PRE-AUTH-QUALITY (see packages/designer/PRE-AUTH-QUALITY.md)",
            });
          }
          if (!PRE_AUTH_EXCEPTIONAL.test(text)) {
            pkgFindings.push({
              rule: "pre-auth-exceptional",
              packageDir,
              message: "expression-wave skill must state that done is exceptional (5), not good (3)",
            });
          }
          if (!PRE_AUTH_SYNTHETIC_USER.test(text)) {
            pkgFindings.push({
              rule: "pre-auth-synthetic-user",
              packageDir,
              message: "expression-wave skill must name a synthetic user as the keep, not a hired QA or a self-review",
            });
          }
          if (!PRE_AUTH_NO_AUTHOR_KEEP.test(text)) {
            pkgFindings.push({
              rule: "pre-auth-no-author-keep",
              packageDir,
              message: "expression-wave skill must say this role does not author keep-review evidence",
            });
          }
        }
        if (packageDir === "publisher" && PRE_AUTH_HEADING.test(text) && !PUBLISHER_PRE_AUTH_MARKETING_VIEW.test(text)) {
          pkgFindings.push({
            rule: "publisher-pre-auth-marketing-view",
            packageDir,
            message: "publisher skill Pre-auth page section must name MarketingView as the pre-auth template",
          });
        }
        if (packageDir === "inspector" && !INSPECTOR_USER_BOUNDARY.test(text)) {
          pkgFindings.push({
            rule: "inspector-user-boundary",
            packageDir,
            message: "inspector skill must cede target-audience keep to a synthetic user — Inspector judges rules, not a person landing on the page",
          });
        }
      }
      if (cataloguePath !== undefined || catalogueText !== undefined) {
        const packed =
          catalogueText ??
          (cataloguePath && existsSync(cataloguePath) ? readFileSync(cataloguePath, "utf8") : undefined);
        if (packed === undefined) {
          pkgFindings.push({
            rule: "catalogue-missing",
            packageDir,
            message: `expected packages/launcher/skill-catalogue/${packageDir}/SKILL.md to mirror packages/${packageDir}/skill/SKILL.md`,
          });
        } else if (packed !== text) {
          pkgFindings.push({
            rule: "catalogue-drift",
            packageDir,
            message: `packages/launcher/skill-catalogue/${packageDir}/SKILL.md is not byte-identical to packages/${packageDir}/skill/SKILL.md — run packages/launcher/scripts/pack-skills.mjs`,
          });
        }
      }
      if (!Array.isArray(files) || !files.includes("skill")) {
        pkgFindings.push({
          rule: "files-missing-skill",
          packageDir,
          message: 'package.json "files" must include "skill" when skill/SKILL.md is shipped',
        });
      }
    }
    if (pkgFindings.length === 0) {
      passed.push({ packageDir, name: expectedName });
    } else {
      findings.push(...pkgFindings);
    }
  }
  return {
    exitCode: findings.length === 0 ? 0 : 1,
    findings,
    passed,
  };
}

export function collectPackageSkills(root) {
  const packagesDir = join(root, "packages");
  if (!existsSync(packagesDir)) throw new Error(`packages directory not found: ${packagesDir}`);
  const packages = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageDir = entry.name;
    const manifestPath = join(packagesDir, packageDir, "package.json");
    if (!existsSync(manifestPath)) continue;
    const cataloguePath = join(packagesDir, "launcher", "skill-catalogue", packageDir, "SKILL.md");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    packages.push({
      packageDir,
      skillPath: join(packagesDir, packageDir, "skill", "SKILL.md"),
      // Generated by launcher `build` (`pack-skills.mjs`) and gitignored. When
      // the files exist locally, they must match source; a clean CI clone has
      // none, and must not fail for that.
      ...(existsSync(cataloguePath) ? { cataloguePath } : {}),
      expectedName: `clossys-${packageDir}`,
      files: manifest.files,
    });
  }
  packages.sort((a, b) => a.packageDir.localeCompare(b.packageDir));
  return packages;
}

export function scanPackageSkills(root) {
  return evaluatePackageSkills(collectPackageSkills(root));
}

function printText(result) {
  if (result.findings.length === 0) {
    console.log(`check-package-skills: ${result.passed.length} package skill(s) OK`);
    return;
  }
  console.error(`check-package-skills: ${result.findings.length} finding(s)`);
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
    result = scanPackageSkills(root);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) {
      console.log(JSON.stringify({ exitCode: 2, error: message }, null, 2));
    } else {
      console.error(`check-package-skills: cannot answer — ${message}`);
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
