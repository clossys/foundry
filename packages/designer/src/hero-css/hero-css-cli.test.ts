import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliInputError, main } from "./hero-css-cli.js";

const packageRoot = resolve(import.meta.dirname, "..", "..");
const shippedCompiledCss = resolve(packageRoot, "styles", "compiled.css");
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "designer-hero-css-cli-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("main — argument handling", () => {
  it("--help returns 0", () => {
    expect(main(["--help"])).toBe(0);
  });

  it("throws CliInputError when css file is missing", () => {
    expect(() => main([])).toThrow(CliInputError);
  });
});

describe("main — findings", () => {
  it("returns 1 when classes are missing", () => {
    const path = join(dir, "out.css");
    writeFileSync(path, "/* no utilities */\n");
    expect(main([path])).toBe(1);
  });

  it("returns 0 on this package's shipped styles/compiled.css", () => {
    expect(main([shippedCompiledCss])).toBe(0);
  });

  it("returns 1 when a stale subset of utilities is present but Hero grid classes are absent", () => {
    const path = join(dir, "partial.css");
    writeFileSync(
      path,
      readFileSync(shippedCompiledCss, "utf8").split("\n").slice(0, 40).join("\n"),
    );
    expect(main([path])).toBe(1);
  });
});
