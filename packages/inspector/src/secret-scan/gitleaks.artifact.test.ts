import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { create as createTarArchive, extract as extractTarArchive } from "tar";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const VERSION = "8.30.1";
const LINUX_X64_ASSET = `gitleaks_${VERSION}_linux_x64.tar.gz`;
const LINUX_X64_URL = `https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/${LINUX_X64_ASSET}`;
const LINUX_X64_SHA256 = "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb";
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

type PackedGitleaksModule = typeof import("./gitleaks.js");

let packed: PackedGitleaksModule;
let packRoot: string;
let extractRoot: string;
let tarball: string;

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function response(bytes: Buffer): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as Response;
}

async function localArchive(): Promise<Buffer> {
  const root = mkdtempSync(join(tmpdir(), "inspector-gitleaks-archive-"));
  const output = join(root, "fixture.tar.gz");
  try {
    writeFileSync(join(root, "gitleaks"), "#!/bin/sh\necho hermetic fixture\n");
    await createTarArchive({ cwd: root, file: output, gzip: true }, ["gitleaks"]);
    return readFileSync(output);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

function cachedBinary(cacheDir: string): string {
  return join(cacheDir, `gitleaks-${VERSION}-linux-x64`, "gitleaks");
}

beforeAll(async () => {
  packRoot = mkdtempSync(join(tmpdir(), "inspector-packed-provenance-"));
  extractRoot = mkdtempSync(join(packageRoot, ".packed-provenance-"));

  const output = execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", packRoot],
    { cwd: packageRoot, encoding: "utf8" },
  );
  const result = JSON.parse(output) as Array<{ filename?: string }>;
  const filename = result[0]?.filename;
  if (!filename) throw new Error("npm pack did not report an Inspector tarball");
  tarball = join(packRoot, filename);

  await extractTarArchive({ cwd: extractRoot, file: tarball });
  const packedModule = join(extractRoot, "package", "dist", "secret-scan", "gitleaks.js");
  packed = await import(`${pathToFileURL(packedModule).href}?artifact-proof=${Date.now()}`) as PackedGitleaksModule;
}, 30_000);

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => {
  rmSync(packRoot, { force: true, recursive: true });
  rmSync(extractRoot, { force: true, recursive: true });
});

describe("packed Inspector gitleaks provenance", () => {
  it("ships and exports the exact corrected linux_x64 platform tuple", () => {
    const listing = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" }).split("\n");
    expect(listing).toContain("package/dist/secret-scan/gitleaks.js");
    expect(listing).toContain("package/src/secret-scan/gitleaks.ts");

    for (const entry of ["package/dist/secret-scan/gitleaks.js", "package/src/secret-scan/gitleaks.ts"]) {
      const bytes = execFileSync("tar", ["-xOf", tarball, entry], { encoding: "utf8" });
      expect(bytes).toContain(LINUX_X64_URL);
      expect(bytes).toContain(LINUX_X64_SHA256);
    }

    expect(packed.resolveGitleaksRelease(VERSION)).toEqual({
      version: VERSION,
      url: LINUX_X64_URL,
      sha256: LINUX_X64_SHA256,
    });
  });

  it("uses the packed linux_x64 URL and rejects a substituted archive against its pinned hash", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "inspector-gitleaks-cache-"));
    const archive = await localArchive();
    const fetchMock = vi.fn(async () => response(archive));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(packed.downloadAndVerifyGitleaks({
        version: VERSION,
        sha256: LINUX_X64_SHA256,
        platform: "linux",
        arch: "x64",
        cacheDir,
      })).rejects.toThrow("Checksum verification failed");
      expect(fetchMock).toHaveBeenCalledWith(LINUX_X64_URL);
      expect(existsSync(cachedBinary(cacheDir))).toBe(false);
    } finally {
      rmSync(cacheDir, { force: true, recursive: true });
    }
  });

  it("rejects substituted platform, version, and hash controls without a live download", async () => {
    const archive = await localArchive();

    const platformCache = mkdtempSync(join(tmpdir(), "inspector-gitleaks-platform-"));
    const platformFetch = vi.fn(async () => response(archive));
    vi.stubGlobal("fetch", platformFetch);
    await expect(packed.downloadAndVerifyGitleaks({
      version: VERSION,
      sha256: LINUX_X64_SHA256,
      platform: "darwin",
      arch: "arm64",
      cacheDir: platformCache,
    })).rejects.toThrow("Checksum verification failed");
    expect(platformFetch).toHaveBeenCalledWith(
      `https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/gitleaks_${VERSION}_darwin_arm64.tar.gz`,
    );
    rmSync(platformCache, { force: true, recursive: true });

    const versionFetch = vi.fn();
    vi.stubGlobal("fetch", versionFetch);
    await expect(packed.downloadAndVerifyGitleaks({
      version: "8.30.2",
      sha256: LINUX_X64_SHA256,
    })).rejects.toThrow("Unknown gitleaks version");
    expect(versionFetch).not.toHaveBeenCalled();

    const hashCache = mkdtempSync(join(tmpdir(), "inspector-gitleaks-hash-"));
    const hashFetch = vi.fn(async () => response(archive));
    vi.stubGlobal("fetch", hashFetch);
    await expect(packed.downloadAndVerifyGitleaks({
      version: VERSION,
      sha256: "a".repeat(64),
      platform: "linux",
      arch: "x64",
      cacheDir: hashCache,
    })).rejects.toThrow("Checksum verification failed");
    expect(existsSync(cachedBinary(hashCache))).toBe(false);
    rmSync(hashCache, { force: true, recursive: true });
  });

  it("rejects a malformed archive even when the caller hash matches, while a local control extracts", async () => {
    const malformed = Buffer.from("not a tar archive");
    const malformedCache = mkdtempSync(join(tmpdir(), "inspector-gitleaks-malformed-"));
    vi.stubGlobal("fetch", vi.fn(async () => response(malformed)));
    await expect(packed.downloadAndVerifyGitleaks({
      version: VERSION,
      sha256: sha256(malformed),
      platform: "linux",
      arch: "x64",
      cacheDir: malformedCache,
    })).rejects.toThrow();
    expect(existsSync(cachedBinary(malformedCache))).toBe(false);
    rmSync(malformedCache, { force: true, recursive: true });

    const control = await localArchive();
    const controlCache = mkdtempSync(join(tmpdir(), "inspector-gitleaks-control-"));
    vi.stubGlobal("fetch", vi.fn(async () => response(control)));
    const result = await packed.downloadAndVerifyGitleaks({
      version: VERSION,
      sha256: sha256(control),
      platform: "linux",
      arch: "x64",
      cacheDir: controlCache,
    });
    expect(result).toEqual({ path: cachedBinary(controlCache), version: VERSION, verified: true });
    expect(readFileSync(result.path, "utf8")).toContain("hermetic fixture");
    rmSync(controlCache, { force: true, recursive: true });
  });
});
