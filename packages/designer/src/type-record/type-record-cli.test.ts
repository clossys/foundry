import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliInputError, main } from "./type-record-cli.js";

const green = {
  schemaVersion: 1,
  displayFace: "Display Sans",
  h1Minimum: "56px",
  measureCap: "48rem",
  monoReservedFor: ["eyebrow", "data", "code"],
  wrap: { orphanWords: "forbid-single" },
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "designer-type-cli-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function writeFixture(name: string, data: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, `${JSON.stringify(data)}\n`);
  return path;
}

function writeCss(name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(path, body);
  return path;
}

describe("main — argument handling", () => {
  it("--help returns 0", () => {
    expect(main(["--help"])).toBe(0);
  });

  it("throws CliInputError when the record file is missing", () => {
    expect(() => main([join(dir, "missing.json")])).toThrow(CliInputError);
  });
});

describe("main — type record contract", () => {
  it("returns 0 on a green fixture", () => {
    const path = writeFixture("green.json", green);
    expect(main([path])).toBe(0);
  });

  it("returns 1 when overlay lacks --font-display", () => {
    const record = writeFixture("green.json", green);
    const overlay = writeCss(
      "brand.css",
      `:root[data-brand-bound] {
  --color-accent: #336699;
}`,
    );
    expect(main([record, "--overlay", overlay])).toBe(1);
  });

  it("returns 0 when overlay declares --font-display", () => {
    const record = writeFixture("green.json", green);
    const overlay = writeCss(
      "brand.css",
      `:root[data-brand-bound] {
  --font-display: "Display Sans", sans-serif;
}`,
    );
    expect(main([record, "--overlay", overlay])).toBe(0);
  });
});
