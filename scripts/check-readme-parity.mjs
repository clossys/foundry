#!/usr/bin/env node
// Package READMEs are five-line installation and documentation pointers.
// Detailed API documentation belongs at the public docs URL, rather than
// being duplicated from the package's exports inside its packed README.
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { changelogPublicUrl } from "./lib/changelog-location.mjs";

export function evaluatePackageReadme({ manifest, packageDir, readme, licenseExists, noticesExist = false }) {
  const lines = readme.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  const findings = [];
  const fail = (rule, message) => findings.push({ rule, severity: "high", message });
  if (lines.length !== 5) fail("five-lines", `README must contain five physical lines; found ${lines.length}`);
  if (lines[0] !== `# ${manifest.name}`) fail("package-name", "README heading must name the manifest's package");
  if (!lines[1]?.trim() || /[#`|<>]|https?:\/\//.test(lines[1])) fail("purpose", "README line 2 must state a plain one-line purpose");
  if (lines[2] !== "") fail("spacing", "README line 3 must be blank");
  const install = manifest.private === true
    ? "Install: local workspace only; run `npm install` at the repository root. This package is unpublished."
    : `Install: \`npm install ${manifest.name} --registry=https://registry.npmjs.org\` (no authentication).`;
  if (lines[3] !== install) fail("install", "README install line must match the package identity and publication status");
  const changelog = changelogPublicUrl(manifest.repository, packageDir);
  if (changelog === null) fail("repository", "Manifest repository must identify the public changelog URL");
  let links = `[Documentation](https://clossys.com/docs/${packageDir}) · [Changelog](${changelog}) · [License](./LICENSE)`;
  if (noticesExist) links += " · [Third-party notices](./THIRD-PARTY-NOTICES.md)";
  if (lines[4] !== links) fail("links", "README line 5 must link the package docs, public changelog, license, and any third-party notices");
  if (!licenseExists) fail("license", "Package LICENSE must remain present");
  return findings;
}

export function main(argv) {
  const args = argv.filter((arg) => !arg.startsWith("--"));
  const flags = argv.filter((arg) => arg.startsWith("--"));
  if (args.length !== 1 || flags.some((flag) => flag !== "--json")) {
    console.error("usage: check-readme-parity.mjs <packageDir> [--json] (exactly one package dir)");
    return 2;
  }
  const packagePath = resolve(args[0]);
  let manifest, readme;
  try {
    manifest = JSON.parse(readFileSync(join(packagePath, "package.json"), "utf8"));
    readme = readFileSync(join(packagePath, "README.md"), "utf8");
    if (typeof manifest.name !== "string" || !/^@[^/\s]+\/[^/\s]+$/.test(manifest.name)) throw new Error("manifest name must be scoped");
  } catch (error) {
    console.error(`check-readme-parity: ${error.message}`);
    return 2;
  }
  const findings = evaluatePackageReadme({
    manifest, packageDir: basename(packagePath), readme,
    licenseExists: existsSync(join(packagePath, "LICENSE")),
    noticesExist: existsSync(join(packagePath, "THIRD-PARTY-NOTICES.md")),
  });
  if (flags.includes("--json")) console.log(JSON.stringify({ package: manifest.name, packageDir: args[0], findings, ok: findings.length === 0 }, null, 2));
  else {
    for (const finding of findings) console.log(`FAIL ${finding.rule}: ${finding.message}`);
    console.log(`check-readme-parity: ${manifest.name}: ${findings.length ? "FAIL" : "OK"} — five-line documentation pointer`);
  }
  return findings.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
