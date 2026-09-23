#!/usr/bin/env node
// check-launcher-catalogue-currency — the publish-time gate issue #1184
// asked for, closing the gap issue #1033 described: `packages/launcher`'s
// `build` (packages/launcher/scripts/pack-skills.mjs) packs every
// `packages/*/skill/SKILL.md` into a gitignored `skill-catalogue/` that the
// launcher tarball ships. A client repository without a given `@clossys/*`
// package installed gets that package's skill ONLY through a launcher
// release built from current skill sources — nothing forces a skill edit to
// ship with one, so the published launcher can silently lag behind
// `packages/*/skill/SKILL.md` on `main`.
//
//   node scripts/check-launcher-catalogue-currency.mjs --package <directory> [--tarball <path>] [--json]
//
// Two independent modes, selected by --package, mirroring the two publish
// paths this repository's publish.yml qualifies:
//
//   (a) --package launcher — PUBLISH GATE. Recomputes what the packed
//       catalogue SHOULD be from current packages/*/skill/SKILL.md sources
//       and compares it against the catalogue actually packed inside the
//       --tarball candidate being qualified for publish. Any mismatch is a
//       FAILURE (exit 1): the published launcher must carry current skills,
//       full stop. --tarball is required in this mode.
//
//   (b) --package <anything else> — LAG REPORT. Compares this package's
//       OWN current packages/<pkg>/skill/SKILL.md against the catalogue
//       entry inside the latest PUBLISHED @clossys/launcher tarball,
//       fetched anonymously from https://registry.npmjs.org. A difference
//       is only ever a WARNING (exit 0): launcher must build after its
//       sources, so a package publish can never be blocked on a launcher
//       release the package itself did not cause and cannot control. --tarball
//       is not used in this mode.
//
// EXIT CODES — the three-state contract every gate in this repository uses
// (see CONTRIBUTING.md and scripts/check-registry-parity.mjs's own header):
//   0 = current, or (mode b only) stale-but-warned — never a failure in mode b.
//   1 = FAIL — mode (a) only: the launcher candidate's packed catalogue does
//       not match current skill sources.
//   2 = INDETERMINATE — the check could not be completed at all (unreadable
//       candidate tarball, unreachable/malformed anonymous registry response,
//       or a zero-skill scan that would otherwise let an empty comparison
//       pass vacuously). Never conflated with a pass, in either mode.
//
// A zero-skill scan is deliberately fatal (exit 2) rather than a trivial
// "nothing differs" pass: `packages/*/skill/SKILL.md` currently exists for
// every shipped package, so finding none almost certainly means this script
// was pointed at the wrong root, not that the catalogue is genuinely empty.
// Comparing an empty candidate against an empty source list would otherwise
// report a silent, meaningless PASS.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PUBLIC_NPM_REGISTRY, publicNpmPackageUrl } from "./lib/public-npm-registry.mjs";

const MAX_LAUNCHER_TARBALL_BYTES = 64 * 1024 * 1024;

// ---------------------------------------------------------------- sources

/** Every packages/<dir>/skill/SKILL.md, sorted — the same scan pack-skills.mjs performs. */
export function discoverSkillSources(root) {
  const packagesDir = join(root, "packages");
  if (!existsSync(packagesDir)) return [];
  const entries = [];
  for (const dirent of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const skillPath = join(packagesDir, dirent.name, "skill", "SKILL.md");
    if (!existsSync(skillPath)) continue;
    entries.push({ packageDir: dirent.name, content: readFileSync(skillPath, "utf8") });
  }
  entries.sort((a, b) => a.packageDir.localeCompare(b.packageDir));
  return entries;
}

export function readLauncherPackageName(root) {
  const manifestPath = join(root, "packages", "launcher", "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (typeof manifest.name !== "string" || manifest.name.length === 0) {
    throw new Error(`${manifestPath} has no valid string "name"`);
  }
  return manifest.name;
}

// ------------------------------------------------------------------ digest

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** A deterministic digest over {packageDir -> sha256(content)}, sorted by packageDir. */
export function catalogueDigest(entries) {
  const sorted = [...entries].sort((a, b) => a.packageDir.localeCompare(b.packageDir));
  const perPackage = new Map(sorted.map((entry) => [entry.packageDir, sha256Hex(entry.content)]));
  const digest = sha256Hex(sorted.map((entry) => `${entry.packageDir}\0${perPackage.get(entry.packageDir)}`).join("\n"));
  return { digest, perPackage };
}

// ----------------------------------------------------------------- tarball

/** Reads one packed skill-catalogue entry out of an in-memory .tgz, or undefined if absent. */
export function extractCatalogueEntry(tarballBytes, packageDir) {
  const entryPath = `package/skill-catalogue/${packageDir}/SKILL.md`;
  const result = spawnSync("tar", ["-xOzf", "-", entryPath], {
    input: tarballBytes,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.status !== 0 || result.signal || result.error) return undefined;
  return result.stdout;
}

export function extractCatalogue(tarballBytes, packageDirs) {
  const catalogue = new Map();
  for (const packageDir of packageDirs) {
    const content = extractCatalogueEntry(tarballBytes, packageDir);
    if (content !== undefined) catalogue.set(packageDir, content);
  }
  return catalogue;
}

export function compareCatalogue(sourceEntries, catalogue) {
  const missing = [];
  const stale = [];
  for (const { packageDir, content } of sourceEntries) {
    const packed = catalogue.get(packageDir);
    if (packed === undefined) missing.push(packageDir);
    else if (packed !== content) stale.push(packageDir);
  }
  return { ok: missing.length === 0 && stale.length === 0, missing, stale };
}

// ------------------------------------------------------------- mode (a)

/** Pure: everything already resolved to bytes/entries in memory. */
export function evaluateLauncherGate({ sourceEntries, tarballBytes }) {
  if (sourceEntries.length === 0) {
    return {
      status: "indeterminate",
      exitCode: 2,
      message:
        "found zero packages/*/skill/SKILL.md sources under packages/ — refusing to compare a possibly-broken scan against the candidate tarball.",
    };
  }
  const { digest: sourceDigest } = catalogueDigest(sourceEntries);
  const catalogue = extractCatalogue(tarballBytes, sourceEntries.map((entry) => entry.packageDir));
  const { digest: packedDigest } = catalogueDigest(
    [...catalogue.entries()].map(([packageDir, content]) => ({ packageDir, content })),
  );
  const { ok, missing, stale } = compareCatalogue(sourceEntries, catalogue);
  if (!ok || sourceDigest !== packedDigest) {
    const parts = [];
    if (missing.length) parts.push(`missing from the packed catalogue: ${missing.join(", ")}`);
    if (stale.length) parts.push(`stale in the packed catalogue (source changed since packing): ${stale.join(", ")}`);
    return {
      status: "fail",
      exitCode: 1,
      message:
        `launcher candidate catalogue digest ${packedDigest} does not match current skill sources' digest ${sourceDigest}` +
        (parts.length ? ` (${parts.join("; ")})` : "") +
        `. Re-run \`npm run build\` (packages/launcher/scripts/pack-skills.mjs) so the launcher candidate being qualified is packed from current packages/*/skill/SKILL.md before it can publish.`,
    };
  }
  return {
    status: "pass",
    exitCode: 0,
    message: `launcher candidate catalogue digest ${packedDigest} matches all ${sourceEntries.length} current packages/*/skill/SKILL.md source(s).`,
  };
}

export function checkLauncherGate({ root, tarballPath, readSources = discoverSkillSources, readTarball = (path) => readFileSync(path) }) {
  const sourceEntries = readSources(root);
  if (sourceEntries.length === 0) return evaluateLauncherGate({ sourceEntries, tarballBytes: Buffer.alloc(0) });
  let tarballBytes;
  try {
    tarballBytes = readTarball(tarballPath);
  } catch (error) {
    return {
      status: "indeterminate",
      exitCode: 2,
      message: `could not read candidate tarball at ${tarballPath}: ${error.message}`,
    };
  }
  return evaluateLauncherGate({ sourceEntries, tarballBytes });
}

// ------------------------------------------------------------- mode (b)

/** Anonymous fetch of the latest published launcher tarball's exact bytes. Never throws. */
export async function fetchLatestLauncherTarball({ launcherName, fetchImpl = fetch }) {
  let packageUrl;
  try {
    packageUrl = publicNpmPackageUrl(PUBLIC_NPM_REGISTRY, launcherName);
  } catch (error) {
    return { kind: "unreachable", detail: error.message };
  }
  let response;
  try {
    response = await fetchImpl(packageUrl, {
      headers: { Accept: "application/vnd.npm.install-v1+json" },
      redirect: "error",
    });
  } catch (error) {
    return { kind: "unreachable", detail: `anonymous packument request failed: ${error.message}` };
  }
  if (!response.ok) return { kind: "unreachable", detail: `anonymous packument request returned HTTP ${response.status}` };
  let document;
  try {
    document = await response.json();
  } catch (error) {
    return { kind: "unreachable", detail: `anonymous packument response was not JSON: ${error.message}` };
  }
  const version = document?.["dist-tags"]?.latest;
  if (typeof version !== "string" || version.length === 0) {
    return { kind: "unreachable", detail: "anonymous packument response has no dist-tags.latest" };
  }
  const dist = document?.versions?.[version]?.dist;
  if (!dist || typeof dist.tarball !== "string" || typeof dist.shasum !== "string") {
    return { kind: "unreachable", detail: `anonymous packument response has no exact dist tuple for latest version ${version}` };
  }
  let tarballResponse;
  try {
    tarballResponse = await fetchImpl(dist.tarball, { headers: { Accept: "application/octet-stream" }, redirect: "error" });
  } catch (error) {
    return { kind: "unreachable", detail: `anonymous tarball request failed: ${error.message}` };
  }
  if (!tarballResponse.ok) return { kind: "unreachable", detail: `anonymous tarball request returned HTTP ${tarballResponse.status}` };
  let bytes;
  try {
    bytes = Buffer.from(await tarballResponse.arrayBuffer());
  } catch (error) {
    return { kind: "unreachable", detail: `anonymous tarball body could not be read: ${error.message}` };
  }
  if (bytes.length === 0 || bytes.length > MAX_LAUNCHER_TARBALL_BYTES) {
    return { kind: "unreachable", detail: "registry tarball is empty or exceeds the bounded verification size" };
  }
  const sha1 = createHash("sha1").update(bytes).digest("hex");
  if (sha1 !== dist.shasum) {
    return { kind: "unreachable", detail: "registry-served launcher tarball bytes do not match the packument shasum" };
  }
  return { kind: "found", version, bytes };
}

/** Pure: the fetch is already resolved. */
export function evaluateLagReport({ entry, packageDir, launcherResult }) {
  if (launcherResult.kind !== "found") {
    return {
      status: "indeterminate",
      exitCode: 2,
      message: `could not confirm the published @clossys/launcher skill-catalogue anonymously (${launcherResult.detail}). Not treated as current or stale.`,
    };
  }
  const packed = extractCatalogueEntry(launcherResult.bytes, packageDir);
  if (packed === undefined) {
    return {
      status: "warn",
      exitCode: 0,
      message:
        `packages/${packageDir}/skill/SKILL.md has no counterpart in the latest published @clossys/launcher@${launcherResult.version} skill-catalogue. ` +
        `A client repository without ${packageDir} installed still composes an old or missing skill from that launcher release. ` +
        "A launcher release built from current skill sources is needed (see issues #1033 and #1184).",
    };
  }
  if (packed !== entry.content) {
    return {
      status: "warn",
      exitCode: 0,
      message:
        `packages/${packageDir}/skill/SKILL.md has changed since @clossys/launcher@${launcherResult.version}'s skill-catalogue was packed. ` +
        `A client repository without ${packageDir} installed still composes the old skill from that launcher release. ` +
        "A launcher release built from current skill sources is needed (see issues #1033 and #1184).",
    };
  }
  return {
    status: "pass",
    exitCode: 0,
    message: `@clossys/launcher@${launcherResult.version}'s skill-catalogue entry for ${packageDir} matches current source.`,
  };
}

export async function checkLauncherCatalogueLag({
  root,
  packageDir,
  launcherName,
  fetchImpl = fetch,
  readSources = discoverSkillSources,
  fetchLauncher = fetchLatestLauncherTarball,
}) {
  const sourceEntries = readSources(root);
  if (sourceEntries.length === 0) {
    return {
      status: "indeterminate",
      exitCode: 2,
      message:
        "found zero packages/*/skill/SKILL.md sources under packages/ — refusing to report either a current or stale launcher catalogue from a possibly-broken scan.",
    };
  }
  const entry = sourceEntries.find((candidate) => candidate.packageDir === packageDir);
  if (!entry) {
    return {
      status: "pass",
      exitCode: 0,
      message: `packages/${packageDir}/skill/SKILL.md does not exist; nothing to compare against the launcher catalogue.`,
    };
  }
  const launcherResult = await fetchLauncher({ launcherName, fetchImpl });
  return evaluateLagReport({ entry, packageDir, launcherResult });
}

// ---------------------------------------------------------------------- CLI

const usage = "Usage: check-launcher-catalogue-currency.mjs --package <directory> [--tarball <path>] [--json]";

export function parseArgs(argv) {
  const result = { json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      result.json = true;
    } else if (arg === "--package") {
      result.package = argv[++index];
    } else if (arg === "--tarball") {
      result.tarball = argv[++index];
    } else {
      throw new Error(usage);
    }
  }
  if (!result.package || !/^[a-z0-9][a-z0-9-]*$/.test(result.package)) throw new Error(usage);
  return result;
}

function printResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const label = { pass: "PASS", warn: "WARN", fail: "FAIL", indeterminate: "INDETERMINATE" }[result.status] ?? result.status.toUpperCase();
  const stream = result.status === "fail" || result.status === "indeterminate" ? console.error : console.log;
  stream(`check-launcher-catalogue-currency [${label}]: ${result.message}`);
}

async function main() {
  const root = process.cwd();
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`check-launcher-catalogue-currency: ${error.message}`);
    process.exit(2);
  }

  let result;
  if (args.package === "launcher") {
    if (!args.tarball) {
      console.error("check-launcher-catalogue-currency: --tarball is required when --package launcher (the exact candidate tarball being qualified for publish).");
      process.exit(2);
    }
    result = checkLauncherGate({ root, tarballPath: resolve(args.tarball) });
  } else {
    let launcherName;
    try {
      launcherName = readLauncherPackageName(root);
    } catch (error) {
      console.error(`check-launcher-catalogue-currency: ${error.message}`);
      process.exit(2);
    }
    result = await checkLauncherCatalogueLag({ root, packageDir: args.package, launcherName, fetchImpl: fetch });
  }

  printResult(result, args.json);
  process.exit(result.exitCode);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`check-launcher-catalogue-currency: unexpected error: ${error?.stack ?? error}`);
    process.exit(2);
  });
}
