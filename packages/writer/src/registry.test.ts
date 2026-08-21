import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readCopyRecord } from "./registry.js";

// Hermetic: every test operates on its own `mkdtemp` directory under the OS
// temp dir, created in beforeEach and removed in afterEach. Nothing here
// reads any path outside that directory — never this repository's own
// files, never the network.

let dir: string;
let recordPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "copy-registry-test-"));
  recordPath = join(dir, "copy.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const validRecordJson = {
  id: "acme-app",
  entries: [{ id: "pagination.no-results", text: "No results found for your search.", context: "search results page" }],
};

describe("readCopyRecord", () => {
  it("reads a valid CopyRecord file and reports complete", () => {
    writeFileSync(recordPath, JSON.stringify(validRecordJson));
    const result = readCopyRecord(recordPath);
    expect(result.issues).toEqual([]);
    expect(result.complete).toBe(true);
    expect(result.record?.id).toBe("acme-app");
    expect(result.record?.entries).toHaveLength(1);
    expect(result.path).toBe(recordPath);
  });

  it("reports a missing file as unreadable, not a throw, and record is undefined", () => {
    expect(() => readCopyRecord(recordPath)).not.toThrow();
    const result = readCopyRecord(recordPath);
    expect(result.record).toBeUndefined();
    expect(result.complete).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.reason).toBe("unreadable");
  });

  it("records unparseable JSON without throwing", () => {
    writeFileSync(recordPath, "{ not valid json");
    const result = readCopyRecord(recordPath);
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
          { id: "a.b", text: "x", context: "y" },
          { id: "a.b", text: "z", context: "w" },
        ],
      }),
    );
    const result = readCopyRecord(recordPath);
    expect(result.record).toBeUndefined();
    expect(result.complete).toBe(false);
    expect(result.issues[0]?.reason).toBe("invalid-schema");
    expect(result.issues[0]?.detail).toMatch(/duplicates/);
  });

  it("records a schema violation (placeholder dropped from text) as invalid-schema", () => {
    writeFileSync(
      recordPath,
      JSON.stringify({
        id: "acme-app",
        entries: [
          {
            id: "pagination.range",
            text: "Showing {start} of results.",
            context: "footer",
            placeholders: ["start", "total"],
          },
        ],
      }),
    );
    const result = readCopyRecord(recordPath);
    expect(result.complete).toBe(false);
    expect(result.issues[0]?.reason).toBe("invalid-schema");
    expect(result.issues[0]?.detail).toMatch(/"total"/);
  });

  it("applies the placeholders: [] default on a successful read", () => {
    writeFileSync(recordPath, JSON.stringify(validRecordJson));
    const result = readCopyRecord(recordPath);
    expect(result.record?.entries[0]?.placeholders).toEqual([]);
  });

  it("a zero-entry record is still a successful, complete read at the registry level — emptiness is checkCopyRecord's concern, not readCopyRecord's", () => {
    writeFileSync(recordPath, JSON.stringify({ id: "acme-app", entries: [] }));
    const result = readCopyRecord(recordPath);
    expect(result.complete).toBe(true);
    expect(result.record?.entries).toEqual([]);
  });
});
