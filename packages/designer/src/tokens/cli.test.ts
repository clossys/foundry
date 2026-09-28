import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

  it("returns 1 when --also redeclares a brandable slot with a different value", () => {
    const overlay = writeBrandCss(":root { --color-accent: #111111; --font-body: Inter, sans-serif; }\n");
    const also = writeBrandCss(":root { --color-accent: #222222; }\n");
    expect(main([overlay, "--also", also])).toBe(1);
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

// The multi-application contract, run as the installed command: the built
// `dist/tokens/cli.js` with its working directory set to a product root, so
// the default `brand/brand.css` and `apps/` are resolved the way a consumer's
// CI resolves them. `dist/` is built once by the package's vitest globalSetup.
const CLI_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "tokens", "cli.js");

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], { cwd: dir, encoding: "utf8", timeout: 30_000 });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function writeProductFile(rel: string, content: string): void {
  const path = join(dir, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

describe("command line — one brand overlay under apps/", () => {
  it("exits 1 and names the file when a second stylesheet binds a --color-* slot", () => {
    writeProductFile("brand/brand.css", ":root { --color-accent: #2a78d6; }\n");
    writeProductFile("apps/web/globals.css", ":root { --color-accent: #000000; }\n");
    const result = runCli([]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("second-brand-binding");
    expect(result.stdout).toContain("globals.css");
  });

  it("exits 2 when --apps names a directory that does not exist", () => {
    writeProductFile("brand/brand.css", ":root { --color-accent: #2a78d6; }\n");
    const result = runCli(["--apps", "missing-apps"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("missing-apps");
  });

  it("exits 2 when the default brand/brand.css does not exist", () => {
    writeProductFile("apps/web/globals.css", ".x { margin: 0; }\n");
    const result = runCli([]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("brand/brand.css");
  });

  it("exits 1, not 0, when the apps are clean but the brand file leaves template slots uncovered", () => {
    writeProductFile("brand/brand.css", ":root { --color-accent: #2a78d6; }\n");
    writeProductFile("apps/web/globals.css", '@import "../../../brand/designer.css";\n.x { color: var(--color-accent); }\n');
    const result = runCli([]);
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("second-brand-binding");
    expect(result.stdout).toContain("finding(s)");
  });
});
