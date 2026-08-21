import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliInputError, main } from "./cli.js";

// Hermetic: every test operates on its own `mkdtemp` directory, removed
// afterward, and calls the exported `main(argv)` directly rather than
// spawning the real CLI process. Nothing here touches this repository's own
// source or the network.

let dir: string;

function writeBrandCss(content: string): string {
  const path = join(dir, "brand.css");
  writeFileSync(path, content);
  return path;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "designer-brand-check-cli-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("main — argument handling", () => {
  it("--help returns 0 without touching the filesystem", () => {
    expect(main(["--help"])).toBe(0);
  });

  it("throws CliInputError when brand-css-file is missing", () => {
    expect(() => main([])).toThrow(CliInputError);
  });

  it("throws CliInputError on an unknown flag", () => {
    const path = writeBrandCss(":root { --color-accent: #2a78d6; }\n");
    expect(() => main([path, "--bogus"])).toThrow(CliInputError);
  });

  it("throws CliInputError on an unexpected extra positional argument", () => {
    const path = writeBrandCss(":root { --color-accent: #2a78d6; }\n");
    expect(() => main([path, "extra"])).toThrow(CliInputError);
  });

  it("throws CliInputError when brand-css-file does not exist", () => {
    expect(() => main([join(dir, "nope.css")])).toThrow(CliInputError);
  });

  it("throws CliInputError when brand-css-file is a directory, not a file", () => {
    expect(() => main([dir])).toThrow(CliInputError);
  });
});

describe("main — the empty case and a nonexistent file must never exit 0", () => {
  it("a brand file with zero declarations does not exit 0 (real TOKENS has real brandable slots)", () => {
    const path = writeBrandCss("/* nothing here */\n");
    expect(main([path])).not.toBe(0);
  });

  it("a nonexistent file (caught earlier, as a thrown CliInputError -> exit 2 via run()) does not exit 0", () => {
    expect(() => main([join(dir, "nope.css")])).toThrow(CliInputError);
  });
});

describe("main — the third state: could not run", () => {
  it("returns 2 when the file contains an unterminated rule block", () => {
    const path = writeBrandCss(":root {\n  --color-accent: #2a78d6;\n"); // no closing brace
    expect(main([path])).toBe(2);
  });

  it("returns 2 when the file contains a malformed declaration (no colon)", () => {
    const path = writeBrandCss(':root {\n  --color-accent #2a78d6;\n  --font-body: Inter, sans-serif;\n}\n');
    expect(main([path])).toBe(2);
  });
});

describe("main — real runs", () => {
  it("returns 1 when declarations are present but incomplete/typo'd/non-brandable (never a false clean pass)", () => {
    const path = writeBrandCss(':root {\n  --color-surface-base: oklch(0.9 0 0);\n  --spacing-xs: 8px;\n}\n');
    expect(main([path])).toBe(1);
  });

  it("returns 1 for a typo'd slot name", () => {
    const path = writeBrandCss(':root {\n  --color-surfac-base: oklch(0.9 0 0);\n}\n');
    expect(main([path])).toBe(1);
  });
});
