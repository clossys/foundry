/**
 * Verified `gitleaks` binary acquisition — download, checksum, cache.
 *
 * Formerly the whole of `@vespeneventures/secret-scan` (see #283); every
 * export below is unchanged from that package's own shape. This module does
 * not scan anything and never did: it is pure, verified acquisition, kept
 * apart from `./attempt.ts` (which runs the binary this resolves) and from
 * this package's own root (`../secret-scan.ts`, which judges a record of an
 * attempt — by this binary or any other tool a caller names). See the
 * package README's "Composition" section for why the three stay separate
 * modules doing one job together rather than one module doing three.
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface GitleaksRelease {
  readonly version: string;
  readonly sha256: string;
  readonly url: string;
}

export interface GitleaksBinaryOptions {
  readonly version: string;
  readonly sha256: string;
  readonly cacheDir?: string;
  readonly platform?: "linux" | "darwin" | "win32";
  readonly arch?: "x64" | "arm64";
}

export interface GitleaksBinaryResult {
  readonly path: string;
  readonly version: string;
  readonly verified: boolean;
}

const DEFAULT_CACHE_DIR = join(tmpdir(), "vespeneventures", "secret-scan", "gitleaks");
/**
 * KNOWN, NOT TRUSTED
 * -------------------
 * This table is a lookup convenience for `resolveGitleaksRelease` — a place
 * for a caller to find the checksum this package's own maintainers last
 * recorded for a version, so they do not have to go and get it themselves.
 * It is never read by `downloadAndVerifyGitleaks` as the value verification
 * is performed against; `options.sha256`, which the caller states
 * explicitly, is (see that function). Two consequences follow, and both are
 * deliberate:
 *
 *   1. A caller who calls `resolveGitleaksRelease(v).sha256` and passes it
 *      straight through is trusting THIS TABLE, not this module's logic, to
 *      be current. Revalidate every entry against the gitleaks project's own
 *      published checksums for the exact asset URL beside it whenever one is
 *      added or changed.
 *
 *      That revalidation was owed before the first real consumer and was not
 *      done: this table shipped in 0.1.0 carrying
 *      `e3b0c442...b7852b855` for 8.30.1, which is the SHA-256 of EMPTY
 *      INPUT — a placeholder that reads exactly like a real digest. It could
 *      not have leaked a bad binary (a real tarball never hashes to it, so
 *      verification fails closed), but a caller passing it through got a
 *      guaranteed, unexplained failure, and a reader got a value that looked
 *      revalidated and was not. The entry below was verified two ways on
 *      2026-08-18: against the gitleaks project's own
 *      `gitleaks_8.30.1_checksums.txt`, and by hashing the 8,230,402-byte
 *      asset directly.
 *   2. A caller who already has the checksum from its own source of truth
 *      does not need an entry here at all — `downloadAndVerifyGitleaks`
 *      still requires the version to be present in this table (an
 *      allowlist of versions this package has been exercised against), but
 *      the checksum it verifies against is always the caller's, never this
 *      table's.
 */
const KNOWN_RELEASES: readonly GitleaksRelease[] = Object.freeze([
  {
    version: "8.30.1",
    sha256: "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
    url: "https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz",
  },
]);

export function getPlatformArch(): { platform: "linux" | "darwin" | "win32"; arch: "x64" | "arm64" } {
  const platform = process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return { platform, arch };
}

export function getAssetName(version: string, platform: "linux" | "darwin" | "win32", arch: "x64" | "arm64"): string {
  const ext = platform === "win32" ? ".zip" : ".tar.gz";
  const platformName = platform === "win32" ? "windows" : platform;
  const archName = arch === "arm64" ? "arm64" : "x64";
  return `gitleaks_${version}_${platformName}_${archName}${ext}`;
}

export function resolveGitleaksRelease(version: string): GitleaksRelease | undefined {
  return KNOWN_RELEASES.find((r) => r.version === version);
}

export async function downloadAndVerifyGitleaks(
  options: GitleaksBinaryOptions,
): Promise<GitleaksBinaryResult> {
  const release = resolveGitleaksRelease(options.version);
  if (!release) {
    throw new Error(`Unknown gitleaks version: ${options.version}. Known versions: ${KNOWN_RELEASES.map((r) => r.version).join(", ")}`);
  }

  const { platform, arch } = options.platform && options.arch
    ? { platform: options.platform, arch: options.arch }
    : getPlatformArch();

  const assetName = getAssetName(options.version, platform, arch);
  // The CALLER'S checksum is what gets verified, never `release.sha256` —
  // `sha256` is a required field on `GitleaksBinaryOptions` precisely so a
  // caller always states what it expects rather than this function silently
  // substituting its own bundled value. `release` above still gates which
  // VERSIONS are accepted at all (an allowlist this package has been
  // exercised against); it does not gate what content is trusted for one.
  // A caller who wants this package's own recorded checksum for a known
  // version still gets it, explicitly, via `resolveGitleaksRelease` — see
  // that function and the README's usage example.
  const expectedSha256 = options.sha256;

  const cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR;
  mkdirSync(cacheDir, { recursive: true });

  const binaryName = platform === "win32" ? "gitleaks.exe" : "gitleaks";
  const cachedBinaryPath = join(cacheDir, `gitleaks-${options.version}-${platform}-${arch}`, binaryName);

  if (existsSync(cachedBinaryPath)) {
    return { path: cachedBinaryPath, version: options.version, verified: true };
  }

  const downloadUrl = `https://github.com/gitleaks/gitleaks/releases/download/v${options.version}/${assetName}`;
  const archivePath = join(cacheDir, `gitleaks-${options.version}-${platform}-${arch}${platform === "win32" ? ".zip" : ".tar.gz"}`);

  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Failed to download gitleaks ${options.version} from ${downloadUrl}: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const actualSha256 = createHash("sha256").update(buffer).digest("hex");
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `Checksum verification failed for gitleaks ${options.version}: expected ${expectedSha256}, got ${actualSha256}. ` +
      `The downloaded asset may have been tampered with or the release metadata is outdated.`,
    );
  }

  writeFileSync(archivePath, buffer);

  const extractDir = join(cacheDir, `gitleaks-${options.version}-${platform}-${arch}`);
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });

  if (platform === "win32") {
    const AdmZip = await import("adm-zip");
    const zip = new AdmZip.default(buffer);
    zip.extractAllTo(extractDir, true);
  } else {
    const { extract } = await import("tar");
    await extract({
      file: archivePath,
      cwd: extractDir,
      strip: 0,
    });
  }

  rmSync(archivePath, { force: true });

  if (!existsSync(cachedBinaryPath)) {
    throw new Error(`Expected binary not found at ${cachedBinaryPath} after extraction`);
  }

  return { path: cachedBinaryPath, version: options.version, verified: true };
}

export function getCachedGitleaksPath(version: string, cacheDir?: string): string | undefined {
  const { platform, arch } = getPlatformArch();
  const dir = cacheDir ?? DEFAULT_CACHE_DIR;
  const binaryName = platform === "win32" ? "gitleaks.exe" : "gitleaks";
  const path = join(dir, `gitleaks-${version}-${platform}-${arch}`, binaryName);
  return existsSync(path) ? path : undefined;
}

export function getKnownVersions(): readonly string[] {
  return KNOWN_RELEASES.map((r) => r.version);
}