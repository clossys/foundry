import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create as createTarArchive } from "tar";
import {
  resolveGitleaksRelease,
  getKnownVersions,
  getCachedGitleaksPath,
  getPlatformArch,
  getAssetName,
  downloadAndVerifyGitleaks,
  type GitleaksBinaryOptions,
} from "./gitleaks.js";

/**
 * Hermetic on purpose, per this package's own rule: `fetch` is stubbed
 * globally rather than called for real in every test below that exercises
 * `downloadAndVerifyGitleaks` past its version check. Nothing here reaches
 * the network.
 *
 * Building a real, valid `.tar.gz` fixture (rather than an arbitrary byte
 * string) is deliberate: it is what lets the "downloads, verifies, extracts,
 * and caches" test exercise the actual extraction path — the one branch a
 * byte-string fixture could never reach — while staying entirely local.
 */
async function buildFakeGitleaksArchive(binaryName: string): Promise<Buffer> {
  const srcDir = mkdtempSync(join(tmpdir(), "fake-gitleaks-src-"));
  const outFile = join(srcDir, "..", `fake-gitleaks-${process.pid}-${Date.now()}.tar.gz`);
  try {
    writeFileSync(join(srcDir, binaryName), "#!/bin/sh\necho fake gitleaks\n");
    await createTarArchive({ gzip: true, file: outFile, cwd: srcDir }, [binaryName]);
    return readFileSync(outFile);
  } finally {
    rmSync(srcDir, { recursive: true, force: true });
    rmSync(outFile, { force: true });
  }
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

describe("secret-scan / gitleaks", () => {
  describe("getPlatformArch", () => {
    it("returns correct platform and arch for current process", () => {
      const result = getPlatformArch();
      expect(result.platform).toMatch(/^(linux|darwin|win32)$/);
      expect(result.arch).toMatch(/^(x64|arm64)$/);
    });
  });

  describe("getAssetName", () => {
    it("generates correct asset name for linux x64", () => {
      const name = getAssetName("8.30.1", "linux", "x64");
      expect(name).toBe("gitleaks_8.30.1_linux_x64.tar.gz");
    });

    it("generates correct asset name for darwin arm64", () => {
      const name = getAssetName("8.30.1", "darwin", "arm64");
      expect(name).toBe("gitleaks_8.30.1_darwin_arm64.tar.gz");
    });

    it("generates correct asset name for win32 x64", () => {
      const name = getAssetName("8.30.1", "win32", "x64");
      expect(name).toBe("gitleaks_8.30.1_windows_x64.zip");
    });
  });

  describe("resolveGitleaksRelease", () => {
    it("returns release for known version", () => {
      const release = resolveGitleaksRelease("8.30.1");
      expect(release).toBeDefined();
      expect(release?.version).toBe("8.30.1");
      expect(release?.sha256).toBeDefined();
    });

    it("returns undefined for unknown version", () => {
      const release = resolveGitleaksRelease("99.99.99");
      expect(release).toBeUndefined();
    });
  });

  describe("getKnownVersions", () => {
    it("returns array of known versions", () => {
      const versions = getKnownVersions();
      expect(versions).toContain("8.30.1");
      expect(Array.isArray(versions)).toBe(true);
    });
  });

  describe("getCachedGitleaksPath", () => {
    it("returns undefined for non-existent version", () => {
      const path = getCachedGitleaksPath("99.99.99");
      expect(path).toBeUndefined();
    });
  });

  describe("downloadAndVerifyGitleaks", () => {
    let cacheDir: string;

    beforeEach(() => {
      cacheDir = mkdtempSync(join(tmpdir(), "secret-scan-test-cache-"));
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      rmSync(cacheDir, { recursive: true, force: true });
    });

    it("throws for unknown version, without ever calling fetch", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const mockOptions: GitleaksBinaryOptions = { version: "99.99.99", sha256: "abc", cacheDir };
      await expect(downloadAndVerifyGitleaks(mockOptions)).rejects.toThrow("Unknown gitleaks version");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("downloads, verifies the checksum against the CALLER'S value, extracts, and caches the binary", async () => {
      const { platform, arch } = getPlatformArch();
      const binaryName = platform === "win32" ? "gitleaks.exe" : "gitleaks";
      // The win32 (.zip / adm-zip) branch is exercised only by shape here
      // (getAssetName above); building a fixture zip is not worth the extra
      // dependency surface in a test that only needs to prove the tar.gz
      // branch — the one the CI runner's own platform actually takes —
      // works end to end.
      if (platform === "win32") return;

      const archive = await buildFakeGitleaksArchive(binaryName);
      const sha256 = createHash("sha256").update(archive).digest("hex");
      const fetchMock = vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        arrayBuffer: async () => toArrayBuffer(archive),
      }));
      vi.stubGlobal("fetch", fetchMock);

      const result = await downloadAndVerifyGitleaks({ version: "8.30.1", sha256, cacheDir, platform, arch });
      expect(result.verified).toBe(true);
      expect(result.version).toBe("8.30.1");
      expect(existsSync(result.path)).toBe(true);
      expect(readFileSync(result.path, "utf8")).toContain("fake gitleaks");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // A second call for the same version/platform/arch must use the cache
      // rather than fetching again.
      const cached = await downloadAndVerifyGitleaks({ version: "8.30.1", sha256, cacheDir, platform, arch });
      expect(cached.path).toBe(result.path);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      expect(getCachedGitleaksPath("8.30.1", cacheDir)).toBe(result.path);
    });

    it("throws when the downloaded content does not match the caller's checksum, without writing a cached binary", async () => {
      const { platform, arch } = getPlatformArch();
      if (platform === "win32") return;
      const binaryName = platform === "win32" ? "gitleaks.exe" : "gitleaks";
      const archive = await buildFakeGitleaksArchive(binaryName);
      const wrongSha256 = createHash("sha256").update(Buffer.from("not the real archive")).digest("hex");
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          status: 200,
          statusText: "OK",
          arrayBuffer: async () => toArrayBuffer(archive),
        })),
      );

      await expect(
        downloadAndVerifyGitleaks({ version: "8.30.1", sha256: wrongSha256, cacheDir, platform, arch }),
      ).rejects.toThrow("Checksum verification failed");
      expect(getCachedGitleaksPath("8.30.1", cacheDir)).toBeUndefined();
    });

    it("throws when the download itself fails, without calling checksum verification", async () => {
      const { platform, arch } = getPlatformArch();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({ ok: false, status: 404, statusText: "Not Found" })),
      );
      await expect(
        downloadAndVerifyGitleaks({ version: "8.30.1", sha256: "irrelevant", cacheDir, platform, arch }),
      ).rejects.toThrow("Failed to download gitleaks");
    });

    it("uses an existing cached binary without calling fetch at all", async () => {
      const { platform, arch } = getPlatformArch();
      const binaryName = platform === "win32" ? "gitleaks.exe" : "gitleaks";
      const dir = join(cacheDir, `gitleaks-8.30.1-${platform}-${arch}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, binaryName), "already cached");

      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const result = await downloadAndVerifyGitleaks({ version: "8.30.1", sha256: "unused", cacheDir, platform, arch });
      expect(result.verified).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
