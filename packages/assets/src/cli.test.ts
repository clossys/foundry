import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliInputError, main } from "./cli.js";

// Hermetic: every test operates on its own `mkdtemp` directory, removed
// afterward, and calls the exported `main(argv)` directly rather than
// spawning the real CLI process. Nothing here touches this repository's
// own source or the network.

let dir: string;

const validRecord = {
  id: "acme-app",
  entries: [
    {
      id: "marketing.hero-banner",
      src: "/images/hero-banner.png",
      width: 1600,
      height: 900,
      alt: "Illustration of a laptop showing a dashboard",
    },
  ],
};

function writeRecord(value: unknown): string {
  const path = join(dir, "assets.json");
  writeFileSync(path, JSON.stringify(value));
  return path;
}

function writeReferencedIds(value: unknown): string {
  const path = join(dir, "referenced.json");
  writeFileSync(path, JSON.stringify(value));
  return path;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "assets-cli-test-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("main — argument handling", () => {
  it("--help returns 0 without touching either path", () => {
    expect(main(["--help"])).toBe(0);
  });

  it("throws CliInputError when record-file is missing", () => {
    expect(() => main([])).toThrow(CliInputError);
  });

  it("throws CliInputError when referenced-ids-file is missing", () => {
    const recordFile = writeRecord(validRecord);
    expect(() => main([recordFile])).toThrow(CliInputError);
  });

  it("throws CliInputError on an unknown flag", () => {
    const recordFile = writeRecord(validRecord);
    const idsFile = writeReferencedIds(["marketing.hero-banner"]);
    expect(() => main([recordFile, idsFile, "--bogus"])).toThrow(CliInputError);
  });

  it("throws CliInputError when record-file does not exist", () => {
    const idsFile = writeReferencedIds(["marketing.hero-banner"]);
    expect(() => main([join(dir, "does-not-exist.json"), idsFile])).toThrow(CliInputError);
  });

  it("throws CliInputError when referenced-ids-file does not exist", () => {
    const recordFile = writeRecord(validRecord);
    expect(() => main([recordFile, join(dir, "nope.json")])).toThrow(CliInputError);
  });
});

describe("main — EXIT 0 (clean pass — proves the gate CAN pass)", () => {
  it("returns 0 when every referenced id is registered and every registered id is referenced", () => {
    const recordFile = writeRecord(validRecord);
    const idsFile = writeReferencedIds(["marketing.hero-banner"]);
    expect(main([recordFile, idsFile])).toBe(0);
  });
});

describe("main — EXIT 1 (at least one finding)", () => {
  it("returns 1 when a referenced id has no registered entry", () => {
    const recordFile = writeRecord(validRecord);
    const idsFile = writeReferencedIds(["marketing.hero-banner", "marketing.missing"]);
    expect(main([recordFile, idsFile])).toBe(1);
  });

  it("returns 1 when a registered entry is never referenced", () => {
    const recordFile = writeRecord({
      id: "acme-app",
      entries: [...validRecord.entries, { id: "marketing.footer-logo", src: "/logo.svg", width: 10, height: 10, alt: "logo" }],
    });
    const idsFile = writeReferencedIds(["marketing.hero-banner"]);
    expect(main([recordFile, idsFile])).toBe(1);
  });
});

describe("main — EXIT 2 (could not run)", () => {
  it("returns 2 when the record file does not parse as JSON", () => {
    const recordFile = join(dir, "assets.json");
    writeFileSync(recordFile, "{ not json");
    const idsFile = writeReferencedIds(["marketing.hero-banner"]);
    expect(main([recordFile, idsFile])).toBe(2);
  });

  it("returns 2 when the record fails schema validation", () => {
    const recordFile = writeRecord({ id: "acme", entries: [{ id: "bad" }] });
    const idsFile = writeReferencedIds(["marketing.hero-banner"]);
    expect(main([recordFile, idsFile])).toBe(2);
  });

  it("returns 2 when the referenced-ids file does not parse as JSON", () => {
    const recordFile = writeRecord(validRecord);
    const idsFile = join(dir, "referenced.json");
    writeFileSync(idsFile, "{ not json");
    expect(main([recordFile, idsFile])).toBe(2);
  });

  it("returns 2 when the referenced-ids file is not a JSON array", () => {
    const recordFile = writeRecord(validRecord);
    const idsFile = writeReferencedIds({ not: "an array" });
    expect(main([recordFile, idsFile])).toBe(2);
  });

  it("returns 2 when referenced-ids is an empty array (zero referenced ids must never report a clean pass)", () => {
    const recordFile = writeRecord(validRecord);
    const idsFile = writeReferencedIds([]);
    expect(main([recordFile, idsFile])).toBe(2);
  });

  it("returns 2 when a referenced-ids entry is malformed (lands in unchecked)", () => {
    const recordFile = writeRecord(validRecord);
    const idsFile = writeReferencedIds(["marketing.hero-banner", 42]);
    expect(main([recordFile, idsFile])).toBe(2);
  });
});
