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

async function localArchive(content = "hermetic fixture"): Promise<Buffer> {
  const root = mkdtempSync(join(tmpdir(), "inspector-gitleaks-archive-"));
  const output = join(root, "fixture.tar.gz");
  try {
    writeFileSync(join(root, "gitleaks"), `#!/bin/sh\necho ${content}\n`);
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

    // `resolveGitleaksRelease` is now keyed on platform/arch too (Finding
    // C), so the linux/x64 tuple this test names is asked for explicitly
    // rather than relied on as whatever this test happens to run on.
    expect(packed.resolveGitleaksRelease(VERSION, "linux", "x64")).toEqual({
      version: VERSION,
      platform: "linux",
      arch: "x64",
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

  // Audit pass 9 / #897, Finding B: the earlier version of this test (one
  // "it" covering platform, version, and hash controls) asserted that a
  // `platform: "darwin", arch: "arm64"` request against the LINUX checksum
  // throws `Checksum verification failed` -- true, but for a reason that had
  // nothing to do with platform: `fetch` was stubbed to return the same
  // hermetic local fixture regardless of which URL was requested, and that
  // fixture's digest can never equal ANY pinned value, real or not, so the
  // identical throw would have occurred for `platform: "linux"` too. The
  // only assertion in that block that was actually sensitive to the
  // `platform` argument was the fetched-URL check. A reader who distrusts
  // the README and reads this test suite instead could walk away believing
  // the platform mismatch itself was what got rejected, when the rejection
  // was really Finding C's unfixed defect (`KNOWN_RELEASES` had no platform
  // dimension) wearing a control's name.
  //
  // Split in two, below: the version and hash controls (genuinely
  // input-decisive on their own dimensions, kept) and a platform control,
  // below, that now genuinely exercises the packed
  // `resolveGitleaksRelease`/`KNOWN_RELEASES` fix for Finding C.
  //
  // CORRECTION (post-merge review of this same PR): an earlier version of
  // the next test's own comment claimed it "could not have been written
  // without first fixing" Finding C. That claim was false -- that version
  // built `darwinUrl`/`linuxUrl` from hardcoded template strings and never
  // called `resolveGitleaksRelease` at all, so it passed unchanged with
  // Finding C's exact bug reintroduced (`resolveGitleaksRelease` patched to
  // ignore its `platform`/`arch` arguments and always resolve the linux/x64
  // entry): reproduced by making that edit, rebuilding, and rerunning this
  // file -- all 5 tests here still passed, 0 failures. The real regression
  // coverage for Finding C lives in `gitleaks.test.ts`'s
  // "resolveGitleaksRelease" and "KNOWN_RELEASES integrity" `describe`
  // blocks, which fail (5 tests) under that identical mutation.
  //
  // The test below now asks the PACKED module's own `resolveGitleaksRelease`
  // for the darwin/arm64 and linux/x64 entries and asserts they are distinct
  // BEFORE doing anything else, then drives the fetch mock off the URLs
  // those calls returned rather than off hardcoded strings. Reproduced
  // fixed: with the same mutation applied, `resolveGitleaksRelease(VERSION,
  // "darwin", "arm64")` now returns the identical entry as
  // `resolveGitleaksRelease(VERSION, "linux", "x64")`, so the very first
  // `.url`/`.sha256` inequality assertions below fail immediately, before
  // the fetch mock is ever installed.
  it("rejects a substituted version before any download, and a substituted hash after one, without a live download", async () => {
    const archive = await localArchive();

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

  it("the SAME expected checksum verifies for the platform whose asset hashes to it and fails for a different platform (genuinely platform-decisive: sourced from the packed resolveGitleaksRelease/KNOWN_RELEASES, no live download)", async () => {
    // Ask the PACKED module itself -- not a hardcoded string -- which URL
    // each platform/arch resolves to. If Finding C's bug were reintroduced
    // (platform/arch ignored, always the linux/x64 entry), `darwinRelease`
    // and `linuxRelease` would be the SAME object and these four
    // assertions would fail here, before any fetch mock exists.
    const darwinRelease = packed.resolveGitleaksRelease(VERSION, "darwin", "arm64");
    const linuxRelease = packed.resolveGitleaksRelease(VERSION, "linux", "x64");
    expect(darwinRelease).toBeDefined();
    expect(linuxRelease).toBeDefined();
    expect(darwinRelease?.url).not.toBe(linuxRelease?.url);
    expect(darwinRelease?.sha256).not.toBe(linuxRelease?.sha256);
    const darwinUrl = darwinRelease!.url;
    const linuxUrl = linuxRelease!.url;

    // Two DIFFERENT archives with different content, hence different
    // digests. `matchingArchive` is served for the darwin/arm64 URL only;
    // `mismatchedArchive` (standing in for a genuine, differently-built
    // linux/x64 asset) is served for every other URL. Both are real,
    // extractable tar.gz fixtures -- this is not a byte string standing in
    // for "some download", it is what "the download differs by platform"
    // actually looks like.
    const matchingArchive = await localArchive("darwin arm64 fixture");
    const mismatchedArchive = await localArchive("linux x64 fixture");
    const expectedSha256 = sha256(matchingArchive);
    expect(sha256(mismatchedArchive)).not.toBe(expectedSha256);

    const platformFetch = vi.fn(async (url: string) =>
      response(url === darwinUrl ? matchingArchive : mismatchedArchive),
    );
    vi.stubGlobal("fetch", platformFetch);

    const darwinCache = mkdtempSync(join(tmpdir(), "inspector-gitleaks-platform-darwin-"));
    try {
      const result = await packed.downloadAndVerifyGitleaks({
        version: VERSION,
        sha256: expectedSha256,
        platform: "darwin",
        arch: "arm64",
        cacheDir: darwinCache,
      });
      expect(result.verified).toBe(true);
      expect(platformFetch).toHaveBeenCalledWith(darwinUrl);
      expect(readFileSync(result.path, "utf8")).toContain("darwin arm64 fixture");
    } finally {
      rmSync(darwinCache, { force: true, recursive: true });
    }

    const linuxCache = mkdtempSync(join(tmpdir(), "inspector-gitleaks-platform-linux-"));
    try {
      await expect(packed.downloadAndVerifyGitleaks({
        version: VERSION,
        sha256: expectedSha256,
        platform: "linux",
        arch: "x64",
        cacheDir: linuxCache,
      })).rejects.toThrow("Checksum verification failed");
      expect(platformFetch).toHaveBeenCalledWith(linuxUrl);
      expect(existsSync(cachedBinary(linuxCache))).toBe(false);
    } finally {
      rmSync(linuxCache, { force: true, recursive: true });
    }
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
