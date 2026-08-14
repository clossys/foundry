import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readAssetRecord } from "./registry.js";

// Hermetic: every test operates on its own `mkdtemp` directory under the OS
// temp dir, created in beforeEach and removed in afterEach. Nothing here
// reads any path outside that directory — never this repository's own
// files, never the network.

let dir: string;
let recordPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "assets-registry-test-"));
  recordPath = join(dir, "assets.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const validRecordJson = {
  id: "acme-app",
  entries: [
    {
      id: "marketing.hero-banner", type: "image",
      src: "/images/hero-banner.png",
      width: 1600,
      height: 900,
      alt: "Illustration of a laptop showing a dashboard",
    },
  ],
};

describe("readAssetRecord", () => {
  it("reads a valid AssetRecord file and reports complete", () => {
    writeFileSync(recordPath, JSON.stringify(validRecordJson));
    const result = readAssetRecord(recordPath);
    expect(result.issues).toEqual([]);
    expect(result.complete).toBe(true);
    expect(result.record?.id).toBe("acme-app");
    expect(result.record?.entries).toHaveLength(1);
    expect(result.path).toBe(recordPath);
  });

  it("reports a missing file as unreadable, not a throw, and record is undefined", () => {
    expect(() => readAssetRecord(recordPath)).not.toThrow();
    const result = readAssetRecord(recordPath);
    expect(result.record).toBeUndefined();
    expect(result.complete).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.reason).toBe("unreadable");
  });

  it("records unparseable JSON without throwing (FIXTURE: unparseable input -> unchecked-equivalent state)", () => {
    writeFileSync(recordPath, "{ not valid json");
    const result = readAssetRecord(recordPath);
    expect(result.record).toBeUndefined();
    expect(result.complete).toBe(false);
    expect(result.issues[0]?.reason).toBe("unparseable");
  });

  it("records a schema violation (duplicate id) as invalid-schema, with the detail naming it", () => {
    writeFileSync(
      recordPath,
      JSON.stringify({
        id: "acme-app",
        entries: [
          { id: "a.b", type: "image", src: "x.png", width: 10, height: 10, alt: "x" },
          { id: "a.b", type: "image", src: "y.png", width: 10, height: 10, alt: "y" },
        ],
      }),
    );
    const result = readAssetRecord(recordPath);
    expect(result.record).toBeUndefined();
    expect(result.complete).toBe(false);
    expect(result.issues[0]?.reason).toBe("invalid-schema");
    expect(result.issues[0]?.detail).toMatch(/duplicates/);
  });

  it("records a schema violation (whitespace-only alt) as invalid-schema", () => {
    writeFileSync(
      recordPath,
      JSON.stringify({
        id: "acme-app",
        entries: [{ id: "a.b", type: "image", src: "x.png", width: 10, height: 10, alt: "   " }],
      }),
    );
    const result = readAssetRecord(recordPath);
    expect(result.complete).toBe(false);
    expect(result.issues[0]?.reason).toBe("invalid-schema");
    expect(result.issues[0]?.detail).toMatch(/whitespace-only/);
  });

  it("a zero-entry record is still a successful, complete read at the registry level", () => {
    writeFileSync(recordPath, JSON.stringify({ id: "acme-app", entries: [] }));
    const result = readAssetRecord(recordPath);
    expect(result.complete).toBe(true);
    expect(result.record?.entries).toEqual([]);
  });
});
