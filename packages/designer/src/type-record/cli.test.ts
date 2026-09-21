import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliInputError, main } from "./cli.js";

let dir = "";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  dir = "";
  vi.restoreAllMocks();
});

function fixture(name: string, body: string): string {
  if (!dir) dir = mkdtempSync(join(tmpdir(), "designer-type-check-cli-"));
  const path = join(dir, name);
  writeFileSync(path, body, "utf8");
  return path;
}

describe("designer-type-check CLI", () => {
  it("maps satisfied, violated, and indeterminate to 0, 1, and 2", () => {
    const good = fixture(
      "good.json",
      JSON.stringify({
        schemaVersion: 1,
        displayFace: "Georgia",
        h1MinimumPx: 40,
        measureCapCh: 55,
        monoReservedFor: ["code"],
      }),
    );
    expect(main([good])).toBe(0);

    const missingFace = fixture(
      "no-face.json",
      JSON.stringify({
        schemaVersion: 1,
        h1MinimumPx: 40,
        measureCapCh: 55,
        monoReservedFor: ["code"],
      }),
    );
    expect(main([missingFace])).toBe(1);

    const badJson = fixture("bad.json", "{ not json");
    expect(() => main([badJson])).toThrow(CliInputError);
  });

  it("exits 1 when record and brand CSS disagree", () => {
    const record = fixture(
      "record.json",
      JSON.stringify({
        schemaVersion: 1,
        displayFace: "Georgia",
        h1MinimumPx: 48,
        measureCapCh: 60,
        monoReservedFor: ["data"],
      }),
    );
    const css = fixture(
      "brand.css",
      `:root {
  --font-display: Helvetica, sans-serif;
  --text-display-l: 48px;
}`,
    );
    expect(main([record, css])).toBe(1);
  });

  it("prints help and exits 0", () => {
    expect(main(["--help"])).toBe(0);
  });
});
