import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverRoot, RootDiscoveryError } from "./root.js";

let fixture: string;
beforeEach(() => { fixture = mkdtempSync(join(tmpdir(), "producer-root-")); });
afterEach(() => { rmSync(fixture, { recursive: true, force: true }); });

function configAt(root: string): void {
  mkdirSync(join(root, "clossys"), { recursive: true });
  writeFileSync(join(root, "clossys", "clossys.config.ts"), "export default {};\n");
}

describe("root discovery", () => {
  it("finds the ancestor from a nested directory", () => {
    configAt(fixture);
    const nested = join(fixture, "apps", "example", "src");
    mkdirSync(nested, { recursive: true });
    expect(discoverRoot(nested)).toBe(fixture);
  });

  it("chooses the nearest qualifying ancestor", () => {
    configAt(fixture);
    const inner = join(fixture, "nested");
    configAt(inner);
    const nested = join(inner, "apps", "example");
    mkdirSync(nested, { recursive: true });
    expect(discoverRoot(nested)).toBe(inner);
    expect(discoverRoot(inner)).toBe(inner);
  });

  it("requires the config file, not an empty clossys directory", () => {
    configAt(fixture);
    const inner = join(fixture, "nested");
    mkdirSync(join(inner, "clossys"), { recursive: true });
    expect(discoverRoot(inner)).toBe(fixture);
  });

  it("refuses a directory named clossys.config.ts", () => {
    mkdirSync(join(fixture, "clossys", "clossys.config.ts"), { recursive: true });
    expect(() => discoverRoot(fixture)).toThrow(RootDiscoveryError);
  });

  it("reports missing roots as usage exit 2", () => {
    let failure: unknown;
    try { discoverRoot(fixture); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(RootDiscoveryError);
    expect(failure).toMatchObject({ exitCode: 2 });
    expect((failure as Error).message).toContain("clossys/clossys.config.ts");
  });
});
