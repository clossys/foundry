#!/usr/bin/env node
// check-package-skills — every published package ships a packed Agent Skill.
//
//   node scripts/check-package-skills.mjs [--json] [<repoRoot>]
//
// Exit 0 = every packages/*/package.json has skill/SKILL.md with valid frontmatter.
// Exit 1 = at least one package is missing a skill or frontmatter is invalid.
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

/** Pure evaluation for tests and CLI. */
export function evaluatePackageSkills(packages) {
  const findings = [];
  const passed = [];
  for (const { packageDir, skillPath, skillText, expectedName } of packages) {
    const pkgFindings = [];
    if (skillText === undefined && !existsSync(skillPath)) {
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
    packages.push({
      packageDir,
      skillPath: join(packagesDir, packageDir, "skill", "SKILL.md"),
      expectedName: `clossys-${packageDir}`,
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
