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
  cpSync(join(packageRoot, "src", "blocks"), join(dir, "src", "blocks"), { recursive: true });
  cpSync(join(packageRoot, "src", "shell"), join(dir, "src", "shell"), { recursive: true });
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

  it("returns 2 when every compiled-css source dir is empty", async () => {
    for (const sub of ["atoms", "blocks", "shell"] as const) {
      rmSync(join(dir, "src", sub), { recursive: true, force: true });
      mkdirSync(join(dir, "src", sub), { recursive: true });
      writeFileSync(join(dir, "src", sub, "data.json"), "{}");
    }
    const code = await main(["--write", "--package-root", dir]);
    expect(code).toBe(2);
  });

  it("propagates a fail-closed error (as exit 2) when source dirs do not exist", async () => {
    rmSync(join(dir, "src"), { recursive: true, force: true });
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
