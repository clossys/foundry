import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNodeInventoryFileSystem } from "./node-fs.js";

describe("createNodeInventoryFileSystem", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "integrator-node-fs-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads a real file's contents", () => {
    writeFileSync(join(dir, "package.json"), '{"name":"example"}');
    const fs = createNodeInventoryFileSystem();
    expect(fs.readFile(join(dir, "package.json"))).toBe('{"name":"example"}');
  });

  it("returns undefined for a path that does not exist, rather than throwing", () => {
    const fs = createNodeInventoryFileSystem();
    expect(fs.readFile(join(dir, "missing.json"))).toBeUndefined();
  });
});
