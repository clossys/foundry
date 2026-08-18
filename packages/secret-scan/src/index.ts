import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");

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
const KNOWN_RELEASES: readonly GitleaksRelease[] = Object.freeze([
  {
    version: "8.30.1",
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
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
  const expectedSha256 = release.sha256;

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