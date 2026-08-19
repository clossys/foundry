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
  isWellFormedSha256,
  isKnownDegenerateSha256,
  assertUsableSha256,
  EMPTY_INPUT_SHA256,
  ALL_ZERO_SHA256,
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
      // Well-formed but arbitrary: this test is about the download failing
      // before checksum verification is reached, not about the checksum
      // itself, so the value only needs to pass the pre-flight
      // well-formedness/degeneracy guard rather than trip it.
      const wellFormedButArbitrarySha256 = "a".repeat(64);
      await expect(
        downloadAndVerifyGitleaks({ version: "8.30.1", sha256: wellFormedButArbitrarySha256, cacheDir, platform, arch }),
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

    // ----------------------------------------------- degenerate checksum rejection
    //
    // This is the regression this whole class of bug needs: a checksum pin
    // that cannot possibly name a real asset must fail LOUD before this
    // function ever attempts a real comparison — not download, not compare,
    // not silently pass. See `assertUsableSha256` and its own header.
    describe("rejects an unusable options.sha256 without ever calling fetch", () => {
      const cases: ReadonlyArray<[label: string, sha256: string | undefined]> = [
        ["the SHA-256 of empty input", EMPTY_INPUT_SHA256],
        ["the SHA-256 of empty input, uppercase", EMPTY_INPUT_SHA256.toUpperCase()],
        ["an all-zero digest", ALL_ZERO_SHA256],
        ["an empty string", ""],
        ["missing (undefined)", undefined],
        ["too short to be a sha256", "abc123"],
        ["the right length but not hex", "z".repeat(64)],
      ];

      it.each(cases)("rejects %s", async (_label, sha256) => {
        const { platform, arch } = getPlatformArch();
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        await expect(
          downloadAndVerifyGitleaks({
            version: "8.30.1",
            // `GitleaksBinaryOptions.sha256` is typed `string`; a caller
            // passing `undefined` anyway (a missing field from untyped JSON,
            // a stripped env var, ...) is exactly the "missing" case this
            // guard exists to catch, so it is exercised here too.
            sha256: sha256 as string,
            cacheDir,
            platform,
            arch,
          }),
        ).rejects.toThrow(/sha256/i);
        expect(fetchMock).not.toHaveBeenCalled();
        // Never cached either — a rejected pin must not leave behind
        // anything a later call could mistake for a verified binary.
        expect(getCachedGitleaksPath("8.30.1", cacheDir)).toBeUndefined();
      });
    });
  });
});

// ------------------------------------------------------- KNOWN_RELEASES integrity
//
// 0.1.0 shipped this table with the SHA-256 of EMPTY INPUT as gitleaks
// 8.30.1's checksum. It could not have admitted a bad binary — a real tarball
// never hashes to it, so verification failed closed — but a caller passing
// `resolveGitleaksRelease(v).sha256` straight through got a guaranteed,
// unexplained failure, and a reader got a value that looked revalidated and
// was not. The table's own comment said to revalidate before the first real
// consumer; nothing enforced it, so nothing did.
//
// These are cheap, hermetic, and make the specific mistake unrepeatable.

describe("KNOWN_RELEASES integrity", () => {
  it("no entry carries the digest of empty input", () => {
    for (const version of getKnownVersions()) {
      expect(resolveGitleaksRelease(version)?.sha256).not.toBe(EMPTY_INPUT_SHA256);
    }
  });

  it("no entry carries an all-zero digest", () => {
    for (const version of getKnownVersions()) {
      expect(resolveGitleaksRelease(version)?.sha256).not.toBe(ALL_ZERO_SHA256);
    }
  });

  it("no entry carries a known-degenerate digest, by the same predicate the runtime guard uses", () => {
    // Belt-and-suspenders over the two explicit checks above: this asserts
    // the general predicate directly, so a THIRD degenerate shape added to
    // `isKnownDegenerateSha256` in the future is caught here too, without
    // this test needing to be told about it by name.
    for (const version of getKnownVersions()) {
      expect(isKnownDegenerateSha256(resolveGitleaksRelease(version)?.sha256)).toBe(false);
    }
  });

  it("8.30.1 carries the checksum published by the gitleaks project for the asset beside it", () => {
    // Verified 2026-08-18 two ways: against gitleaks_8.30.1_checksums.txt, and
    // by hashing the 8,230,402-byte asset directly. Pinned here so a future
    // edit to the table has to change this line too, deliberately.
    expect(resolveGitleaksRelease("8.30.1")?.sha256).toBe(
      "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
    );
  });

  it("every entry's checksum is a well-formed lowercase sha256 hex digest", () => {
    // Iterates whatever `getKnownVersions()` reports, not a hardcoded list —
    // a version added to the table later is covered automatically, rather
    // than silently skipped until this test is remembered to be updated too.
    expect(getKnownVersions().length).toBeGreaterThan(0);
    for (const version of getKnownVersions()) {
      const sha256 = resolveGitleaksRelease(version)?.sha256;
      expect(sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(isWellFormedSha256(sha256)).toBe(true);
    }
  });

  it("every entry's url names the exact asset its version and platform imply", () => {
    const release = resolveGitleaksRelease("8.30.1");
    expect(release?.url).toContain(getAssetName("8.30.1", "linux", "x64"));
    expect(release?.url).toContain("/v8.30.1/");
  });
});

// --------------------------------------------------- checksum-validity predicates
//
// Direct, hermetic coverage of the functions that decide whether a
// checksum is usable at all — the mechanism `KNOWN_RELEASES` validates
// itself against at import time, and that `downloadAndVerifyGitleaks`
// validates a caller's `options.sha256` against before any network call.
// This is the regression test issue #301 asked for: the empty-input digest
// and an all-zero digest are asserted REJECTED as pin values here, directly
// against the predicate itself, independent of any one table entry or any
// one call site — so this exact class of mistake cannot return through a
// NEW entry or a NEW call site either.

describe("isWellFormedSha256", () => {
  it("accepts a real, well-formed digest", () => {
    expect(isWellFormedSha256("551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb")).toBe(true);
  });

  it("accepts the empty-input and all-zero digests — well-formed is a syntax check, not a trust check", () => {
    expect(isWellFormedSha256(EMPTY_INPUT_SHA256)).toBe(true);
    expect(isWellFormedSha256(ALL_ZERO_SHA256)).toBe(true);
  });

  it("rejects uppercase hex, wrong length, non-hex characters, and non-strings", () => {
    expect(isWellFormedSha256(EMPTY_INPUT_SHA256.toUpperCase())).toBe(false);
    expect(isWellFormedSha256("abc123")).toBe(false);
    expect(isWellFormedSha256("z".repeat(64))).toBe(false);
    expect(isWellFormedSha256(undefined)).toBe(false);
    expect(isWellFormedSha256(null)).toBe(false);
    expect(isWellFormedSha256(12345)).toBe(false);
    expect(isWellFormedSha256("")).toBe(false);
  });
});

describe("isKnownDegenerateSha256", () => {
  it("rejects the SHA-256 of empty input as a pin value", () => {
    expect(isKnownDegenerateSha256(EMPTY_INPUT_SHA256)).toBe(true);
  });

  it("rejects the SHA-256 of empty input case-insensitively", () => {
    expect(isKnownDegenerateSha256(EMPTY_INPUT_SHA256.toUpperCase())).toBe(true);
  });

  it("rejects an all-zero digest as a pin value", () => {
    expect(isKnownDegenerateSha256(ALL_ZERO_SHA256)).toBe(true);
  });

  it("accepts a real, non-degenerate digest", () => {
    expect(isKnownDegenerateSha256("551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb")).toBe(false);
  });

  it("is false, not a throw, for a non-string", () => {
    expect(isKnownDegenerateSha256(undefined)).toBe(false);
    expect(isKnownDegenerateSha256(null)).toBe(false);
  });
});

describe("assertUsableSha256", () => {
  it("does not throw for a real, well-formed, non-degenerate digest", () => {
    expect(() =>
      assertUsableSha256("551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb", "test"),
    ).not.toThrow();
  });

  it("throws for the SHA-256 of empty input", () => {
    expect(() => assertUsableSha256(EMPTY_INPUT_SHA256, "test context")).toThrow(/empty input/i);
  });

  it("throws for an all-zero digest", () => {
    expect(() => assertUsableSha256(ALL_ZERO_SHA256, "test context")).toThrow(/all-zero/i);
  });

  it("throws for a missing, empty, or malformed value, naming the caller-supplied context", () => {
    expect(() => assertUsableSha256(undefined, "test context")).toThrow(/test context/);
    expect(() => assertUsableSha256("", "test context")).toThrow(/test context/);
    expect(() => assertUsableSha256("not-hex-at-all", "test context")).toThrow(/test context/);
  });
});
