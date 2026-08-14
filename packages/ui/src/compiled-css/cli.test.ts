import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliInputError, main } from "./cli.js";

const packageRoot = resolve(import.meta.dirname, "..", "..");
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ui-compiled-css-cli-"));
  cpSync(join(packageRoot, "styles"), join(dir, "styles"), { recursive: true });
  cpSync(join(packageRoot, "src", "atoms"), join(dir, "src", "atoms"), { recursive: true });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("main — argument handling", () => {
  it("--help returns 0 without doing anything", async () => {
    expect(await main(["--help"])).toBe(0);
  });

  it("throws CliInputError on an unknown argument", async () => {
    await expect(main(["--bogus"])).rejects.toThrow(CliInputError);
  });

  it("throws CliInputError when --package-root is missing its value", async () => {
    await expect(main(["--package-root"])).rejects.toThrow(CliInputError);
  });
});

describe("main --write", () => {
  it("writes a fresh styles/compiled.css and returns 0", async () => {
    rmSync(join(dir, "styles", "compiled.css"), { force: true });
    const code = await main(["--write", "--package-root", dir]);
    expect(code).toBe(0);
    const written = readFileSync(join(dir, "styles", "compiled.css"), "utf8");
    expect(written).toContain("@layer foundry-ui-compiled");
    expect(written).toContain(".bg-accent {");
  });

  it("returns 2 when src/atoms/ has no matching files (nothing to derive a compiled.css from)", async () => {
    rmSync(join(dir, "src", "atoms"), { recursive: true, force: true });
    mkdirSync(join(dir, "src", "atoms"), { recursive: true });
    writeFileSync(join(dir, "src", "atoms", "data.json"), "{}"); // not a .ts/.tsx file — matches zero
    const code = await main(["--write", "--package-root", dir]);
    expect(code).toBe(2);
  });

  it("propagates a fail-closed error (as exit 2) when src/atoms/ does not exist at all", async () => {
    rmSync(join(dir, "src", "atoms"), { recursive: true, force: true });
    const code = await main(["--write", "--package-root", dir]);
    expect(code).toBe(2);
  });
});

describe("main --check (default)", () => {
  it("returns 0 when the file is fresh (just written)", async () => {
    await main(["--write", "--package-root", dir]);
    const code = await main(["--check", "--package-root", dir]);
    expect(code).toBe(0);
  });

  it("returns 1 when the file is stale", async () => {
    await main(["--write", "--package-root", dir]);
    writeFileSync(join(dir, "styles", "compiled.css"), "/* stale */\n");
    const code = await main(["--check", "--package-root", dir]);
    expect(code).toBe(1);
  });

  it("returns 2 when styles/compiled.css does not exist yet", async () => {
    rmSync(join(dir, "styles", "compiled.css"), { force: true });
    const code = await main(["--package-root", dir]);
    expect(code).toBe(2);
  });
});
