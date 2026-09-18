#!/usr/bin/env node
// check-install-docs — a current-scope package README that tells a consumer
// they need a GitHub token / GitHub Packages / read:packages to install THIS
// package is a blocking defect (#924). Every package here publishes to
// https://registry.npmjs.org anonymously.
//
//   node scripts/check-install-docs.mjs [--json] [<repoRoot>]
//
// Exit 0 = no package README instructs a token for installing the
//          current-scope package.
// Exit 1 = at least one does.
// Exit 2 = unreadable tree.
//
// ALWAYS printed, in both text and --json, and allowed to be nonzero: the
// packages that do not yet name the public npm registry AND state that
// install needs no authentication. Same visibility pattern as
// check-role-assessment-surfaces.mjs undeclared roles. A missing install
// claim is reported, never a failure — failing that would force README
// edits, version bumps, and qualification records a catalogue-integrity
// session cannot produce.
//
// Scans packages/*/README.md only. Root README, CONTRIBUTING, and CHANGELOG
// historical predecessor-scope GitHub Packages lanes are out of scope.
//
// WHAT THIS DOES NOT CLAIM
// ------------------------
// This is not qualification. It does not claim any package is published,
// adopted, grounded, or closed. A README that does not demand a token is
// not proof that the tarball is on the public registry.

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const PUBLIC_NPM_HOST = "registry.npmjs.org";
const GITHUB_PACKAGES_HOST = "npm.pkg.github.com";

function hostnamesInText(text) {
  const hosts = new Set();
  for (const match of text.matchAll(/\bhttps?:\/\/[^\s)`'"<>\]]+/gi)) {
    try {
      hosts.add(new URL(match[0].replace(/[.,;:]+$/, "")).hostname.toLowerCase());
    } catch {
      /* not a URL */
    }
  }
  for (const match of text.matchAll(/`((?:[a-z0-9-]+\.)+[a-z]{2,})`/gi)) {
    try {
      hosts.add(new URL(`https://${match[1]}`).hostname.toLowerCase());
    } catch {
      /* not a host */
    }
  }
  return hosts;
}

function textNamesHost(text, host) {
  return hostnamesInText(text).has(host.toLowerCase());
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isDirectInvocation(moduleUrl, argvPath) {
  if (argvPath === undefined) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(resolve(argvPath));
  } catch {
    return false;
  }
}

function asMap(readmeByPackageName) {
  if (readmeByPackageName instanceof Map) return readmeByPackageName;
  return new Map(Object.entries(readmeByPackageName ?? {}));
}

function splitParagraphs(text) {
  return text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
}

function isDisclaimer(text) {
  const t = text.toLowerCase();
  return (
    t.includes("not install instructions") ||
    t.includes("caller-supplied") ||
    t.includes("not honored by") ||
    /peerdependenciesmeta/.test(t.replace(/_/g, "").toLowerCase()) && textNamesHost(text, GITHUB_PACKAGES_HOST)
  );
}

function isRedactionExample(text) {
  return /attributes\s*:\s*\{\s*token\s*:/.test(text) || /token:\s*"ghp_/.test(text);
}

function isHonestNegative(text) {
  const t = text.toLowerCase();
  return (
    /\bneeds no\b/.test(t) ||
    /\bneed no\b/.test(t) ||
    /\brequires no\b/.test(t) ||
    /\brequire no\b/.test(t) ||
    /\bdoes not (?:need|require)\b/.test(t) ||
    /\bdo not (?:need|add|create|require|supply|map)\b/.test(t) ||
    /\bdon't (?:need|add|create|require)\b/.test(t) ||
    /\bwithout (?:a )?(?:github )?token\b/.test(t) ||
    /\bno github token\b/.test(t) ||
    /\bno\b[^.]*\bor github token is needed\b/.test(t) ||
    /\bno github personal access token\b/.test(t) ||
    /\bno github credential\b/.test(t) ||
    /\bno authentication\b/.test(t) ||
    /\bcredentialless\b/.test(t) ||
    /\banonymously\b/.test(t) ||
    /\bnever (?:asks?|asked|needs?|required)\b/.test(t)
  );
}

function instructsGithubPackagesInstall(text) {
  if (isDisclaimer(text) || isHonestNegative(text)) return false;
  return (
    /published to github packages/i.test(text) ||
    /install(?:ing)? (?:it |this package )?from github packages/i.test(text) ||
    /@[\w.-]+:registry\s*=\s*https?:\/\/npm\.pkg\.github\.com/i.test(text) ||
    /\/\/npm\.pkg\.github\.com\/:_authtoken/i.test(text) ||
    /point(?:ed|s|ing)? (?:the )?scope at (?:that registry|github packages|npm\.pkg\.github\.com)/i.test(text)
  );
}

function instructsTokenForInstall(text) {
  if (isDisclaimer(text) || isRedactionExample(text)) return false;
  if (/create a classic personal access token/i.test(text) && !/do not create|don't create|never create/i.test(text)) {
    return true;
  }
  if (/\bGH_PACKAGES_TOKEN\b/.test(text) && !isHonestNegative(text)) return true;
  if (/you need a github token to install/i.test(text)) return true;
  if (/need a github token to install/i.test(text) && !isHonestNegative(text)) return true;
  if (/requires? a github (?:personal access )?token/i.test(text) && !isHonestNegative(text)) return true;
  if (/installing it requires\b[^.]*\bNODE_AUTH_TOKEN/i.test(text) && !isHonestNegative(text)) {
    return true;
  }
  if (/read:packages/.test(text) && /install/i.test(text) && !isHonestNegative(text)) return true;
  if (instructsGithubPackagesInstall(text)) return true;
  return false;
}

function extractInstallSection(readme) {
  const match = readme.match(/^## Install(?:ation)?\s*$/m);
  if (!match) return null;
  const start = match.index;
  const after = start + match[0].length;
  const rest = readme.slice(after);
  const next = rest.search(/^## /m);
  return readme.slice(start, next === -1 ? readme.length : after + next);
}

function extractNpmInstallVicinity(readme, packageName) {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`npm install[^\\n]*${escaped}`);
  const match = readme.match(re);
  if (!match || match.index === undefined) return null;
  const idx = match.index;
  const heading = readme.lastIndexOf("\n## ", idx);
  const from = heading === -1 ? Math.max(0, readme.lastIndexOf("\n\n", idx)) : heading + 1;
  const nextHeading = readme.indexOf("\n## ", idx);
  const nearby = idx + match[0].length + 1200;
  const to = nextHeading === -1 ? Math.min(readme.length, nearby) : Math.min(nextHeading, nearby);
  return readme.slice(from, to);
}

function namesPublicNpm(text) {
  return textNamesHost(text, PUBLIC_NPM_HOST);
}

function statesNoAuth(text) {
  return isHonestNegative(text);
}

function wholeReadmeRequiresTokenToInstall(paragraph) {
  if (isDisclaimer(paragraph) || isHonestNegative(paragraph) || isRedactionExample(paragraph)) return false;
  return (
    /you need a github token to install/i.test(paragraph) ||
    /need a github token to install/i.test(paragraph) ||
    /requires? read:packages to install/i.test(paragraph) ||
    /install(?:ing)?[^.]{0,160}read:packages/i.test(paragraph) ||
    /read:packages[^.]{0,160}install/i.test(paragraph) ||
    /requires? a github (?:personal access )?token[^.]{0,160}(?:to install|before this package would install)/i.test(paragraph)
  );
}

function evaluateOne(packageName, readme) {
  const installSection = extractInstallSection(readme);
  const npmVicinity = extractNpmInstallVicinity(readme, packageName);
  const regionText = [installSection, npmVicinity].filter((value) => isText(value)).join("\n\n");
  for (const paragraph of splitParagraphs(regionText)) {
    if (instructsTokenForInstall(paragraph)) {
      return {
        finding: {
          rule: "token-required-install",
          packageName,
          message: `README instructs a GitHub token, GitHub Packages, or read:packages to install ${packageName}`,
          excerpt: paragraph.slice(0, 280),
        },
        documented: false,
      };
    }
  }
  for (const paragraph of splitParagraphs(readme)) {
    if (wholeReadmeRequiresTokenToInstall(paragraph)) {
      return {
        finding: {
          rule: "token-required-install",
          packageName,
          message: `README instructs a GitHub token, GitHub Packages, or read:packages to install ${packageName}`,
          excerpt: paragraph.slice(0, 280),
        },
        documented: false,
      };
    }
  }
  const documented = namesPublicNpm(readme) && statesNoAuth(readme);
  return { finding: null, documented };
}

/**
 * Pure evaluation over already-read README text, so the regression test
 * needs no repository on disk.
 *
 * @param {Map<string, string>|Record<string, string>} readmeByPackageName
 */
export function evaluateInstallDocs(readmeByPackageName) {
  const map = asMap(readmeByPackageName);
  const findings = [];
  const documented = [];
  const undocumented = [];
  for (const packageName of [...map.keys()].sort()) {
    const readme = map.get(packageName);
    if (typeof readme !== "string") {
      findings.push({
        rule: "unreadable-readme",
        packageName,
        message: "README text is missing",
        kind: "cannot-answer",
      });
      continue;
    }
    const result = evaluateOne(packageName, readme);
    if (result.finding) {
      findings.push(result.finding);
      continue;
    }
    if (result.documented) documented.push({ packageName, reason: "names the public npm registry and that install needs no authentication" });
    else undocumented.push({ packageName, reason: "does not yet name the public npm registry and that install needs no authentication" });
  }
  const cannotAnswer = findings.filter((item) => item.kind === "cannot-answer");
  const exitCode = cannotAnswer.length > 0 ? 2 : findings.length > 0 ? 1 : 0;
  return { findings, documented, undocumented, exitCode };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function scanInstallDocs(repoRoot) {
  const packagesDir = join(repoRoot, "packages");
  if (!existsSync(packagesDir) || !statSync(packagesDir).isDirectory()) {
    throw new Error(`packages directory not found at ${packagesDir}`);
  }
  let scope = null;
  const scopePath = join(repoRoot, "package-scope.json");
  if (existsSync(scopePath)) {
    try {
      const doc = readJson(scopePath);
      if (isRecord(doc) && isText(doc.scope)) scope = doc.scope;
    } catch (error) {
      throw new Error(`cannot parse ${scopePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const readmeByPackageName = new Map();
  const entries = readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const dirName of entries) {
    const packageDir = join(packagesDir, dirName);
    const manifestPath = join(packageDir, "package.json");
    if (!existsSync(manifestPath)) continue;
    let manifest;
    try {
      manifest = readJson(manifestPath);
    } catch (error) {
      throw new Error(`cannot parse ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!isRecord(manifest) || !isText(manifest.name)) continue;
    if (manifest.private === true) continue;
    if (scope && !manifest.name.startsWith(`${scope}/`)) continue;
    const readmePath = join(packageDir, "README.md");
    if (!existsSync(readmePath)) {
      readmeByPackageName.set(manifest.name, "");
      continue;
    }
    try {
      readmeByPackageName.set(manifest.name, readFileSync(readmePath, "utf8"));
    } catch (error) {
      throw new Error(`cannot read ${readmePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const evaluated = evaluateInstallDocs(readmeByPackageName);
  return { ...evaluated, scanned: [...readmeByPackageName.keys()] };
}

function printText(evaluated) {
  for (const item of evaluated.documented) {
    console.log(`DOCUMENTED ${item.packageName} — ${item.reason}`);
  }
  for (const item of evaluated.undocumented) {
    console.log(`UNDOCUMENTED ${item.packageName} — ${item.reason}`);
  }
  for (const item of evaluated.findings) {
    console.log(`FAIL ${item.rule} ${item.packageName} — ${item.message}`);
  }
  const total = evaluated.documented.length + evaluated.undocumented.length + evaluated.findings.length;
  console.log(
    `\n${evaluated.documented.length} of ${total} package README(s) name the public npm registry and that install needs no authentication; ${evaluated.undocumented.length} do not yet.`,
  );
  console.log("A missing install claim is reported, never a failure.");
  console.log("This is not qualification and does not claim publication or adoption.");
}

export function main(argv) {
  const json = argv.includes("--json");
  const root = argv.find((value) => !value.startsWith("--")) ?? join(scriptDir, "..");
  let scanned;
  try {
    scanned = scanInstallDocs(root);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) console.log(JSON.stringify({ error: message }, null, 2));
    else console.error(`check-install-docs: ${message}`);
    return 2;
  }
  if (json) {
    console.log(JSON.stringify({
      findings: scanned.findings,
      documented: scanned.documented,
      undocumented: scanned.undocumented,
    }, null, 2));
  } else {
    printText(scanned);
  }
  return scanned.exitCode;
}

if (isDirectInvocation(import.meta.url, process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
