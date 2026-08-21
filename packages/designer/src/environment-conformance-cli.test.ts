import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliInputError, main } from "./environment-conformance-cli.js";

// Hermetic: every test operates on its own `mkdtemp` fixture directory,
// removed afterward, and calls the exported `main(argv)` directly rather
// than spawning the real CLI process — matching this package's own
// `cli.test.ts`. `environment-conformance.adversarial.test.ts` is the one
// suite that spawns the REAL compiled CLI by its compiled path, because
// that adversarial proof specifically needs to exercise the CLI the way
// this repository actually invokes it; this file only exercises the
// argv-to-exit-code contract itself, for which the exported `main` is
// sufficient and faster.

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "designer-environment-check-cli-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function writeFile(relPath: string, content: string): void {
  const abs = join(dir, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

function writeManifest(exportsMap: Record<string, unknown>): void {
  writeFile("package.json", JSON.stringify({ name: "@fixture/pkg", version: "0.0.0", type: "module", exports: exportsMap }, null, 2));
}

function writeDeclaration(map: Record<string, string>): void {
  const entries = Object.entries(map)
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
    .join("\n");
  writeFile("dist/render-environment.js", `export const RENDER_ENVIRONMENT = {\n${entries}\n};\n`);
}

describe("main — argument handling", () => {
  it("--help returns 0 without checking anything", async () => {
    expect(await main(["--help"])).toBe(0);
  });

  it("throws CliInputError on an unknown flag", async () => {
    await expect(main([dir, "--bogus"])).rejects.toThrow(CliInputError);
  });

  it("throws CliInputError when package-dir does not exist", async () => {
    await expect(main([join(dir, "nope")])).rejects.toThrow(CliInputError);
  });

  it("throws CliInputError on more than one positional argument", async () => {
    await expect(main([dir, "extra"])).rejects.toThrow(CliInputError);
  });
});

describe("main — exit code 0: satisfied", () => {
  it("returns 0 when RENDER_ENVIRONMENT and package.json#exports agree", async () => {
    writeManifest({ "./a": { import: "./dist/a.js" }, "./b": { import: "./dist/b.js" } });
    writeDeclaration({ "./a": "server-safe", "./b": "client-only" });
    expect(await main([dir])).toBe(0);
  });
});

describe("main — exit code 1: violated", () => {
  it("returns 1 when a real export subpath has no declaration", async () => {
    writeManifest({ "./a": { import: "./dist/a.js" }, "./b": { import: "./dist/b.js" } });
    writeDeclaration({ "./a": "server-safe" });
    expect(await main([dir])).toBe(1);
  });

  it("returns 1 when a declared subpath is not a real export (stale declaration)", async () => {
    writeManifest({ "./a": { import: "./dist/a.js" } });
    writeDeclaration({ "./a": "server-safe", "./ghost": "server-safe" });
    expect(await main([dir])).toBe(1);
  });

  it("returns 1 on a renamed subpath — undeclared and stale at once, never mistaken for satisfied by a count", async () => {
    writeManifest({ "./a": { import: "./dist/a.js" }, "./b-renamed": { import: "./dist/b.js" } });
    writeDeclaration({ "./a": "server-safe", "./b": "client-only" });
    expect(await main([dir])).toBe(1);
  });
});

describe("main — exit code 2: indeterminate", () => {
  it("returns 2 when package.json does not exist", async () => {
    mkdirSync(dir, { recursive: true });
    expect(await main([dir])).toBe(2);
  });

  it("returns 2 when the exports map is empty", async () => {
    writeManifest({});
    expect(await main([dir])).toBe(2);
  });

  it("returns 2 when dist/render-environment.js does not exist", async () => {
    writeManifest({ "./a": { import: "./dist/a.js" } });
    expect(await main([dir])).toBe(2);
  });
});
