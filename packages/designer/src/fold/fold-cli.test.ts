import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliInputError, main } from "./fold-cli.js";

const green = {
  viewport: { width: 1440, height: 900 },
  h1Clipped: false,
  overlayIntersectingFold: [],
  primaryCtaCount: 1,
  heroMediaKind: "product-surface",
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "designer-fold-cli-"));
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

describe("main — argument handling", () => {
  it("--help returns 0", () => {
    expect(main(["--help"])).toBe(0);
  });

  it("throws CliInputError when measurement file is missing from argv", () => {
    expect(() => main([])).toThrow(CliInputError);
  });
});

describe("main — fold contract", () => {
  it("returns 0 on a green fixture", () => {
    const path = writeFixture("green.json", green);
    expect(main([path])).toBe(0);
  });

  it("returns 1 when H1 is clipped", () => {
    const path = writeFixture("clipped.json", { ...green, h1Clipped: true });
    expect(main([path])).toBe(1);
  });

  it("returns 1 when an overlay intersects the fold", () => {
    const path = writeFixture("overlay.json", {
      ...green,
      overlayIntersectingFold: ["#locale-picker"],
    });
    expect(main([path])).toBe(1);
  });

  it("returns 1 when primary CTA count is 0", () => {
    const path = writeFixture("zero-cta.json", { ...green, primaryCtaCount: 0 });
    expect(main([path])).toBe(1);
  });

  it("returns 1 when primary CTA count is 2", () => {
    const path = writeFixture("two-cta.json", { ...green, primaryCtaCount: 2 });
    expect(main([path])).toBe(1);
  });

  it("returns 2 when the file is missing", () => {
    expect(main([join(dir, "missing.json")])).toBe(2);
  });

  it("returns 2 for invalid heroMediaKind", () => {
    const path = writeFixture("bad-kind.json", { ...green, heroMediaKind: "stock-metaphor" });
    expect(main([path])).toBe(2);
  });

  it("checks --also viewport independently", () => {
    const desktop = writeFixture("desktop.json", green);
    const mobile = writeFixture("mobile.json", {
      ...green,
      viewport: { width: 390, height: 844 },
      primaryCtaCount: 2,
    });
    expect(main([desktop, "--also", mobile])).toBe(1);
  });
});
