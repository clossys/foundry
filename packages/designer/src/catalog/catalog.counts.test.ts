/** Count claims must not become a second, hand-maintained block inventory. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BLOCK_CATALOG, BLOCK_ENTRIES } from "./index.js";

const catalogRoot = dirname(fileURLToPath(import.meta.url));
const readme = readFileSync(join(catalogRoot, "..", "..", "README.md"), "utf8");
const blockSource = readFileSync(join(catalogRoot, "blocks.ts"), "utf8");
const coverage = readFileSync(join(catalogRoot, "catalog.coverage.test.ts"), "utf8");

describe("block inventory count ownership", () => {
  it("uses the real block catalog, not another catalog kind or a copied leaf list", () => {
    expect(BLOCK_CATALOG.kind).toBe("blocks");
    expect(BLOCK_CATALOG.entries).toBe(BLOCK_ENTRIES);
    expect(BLOCK_CATALOG.entries.length).toBeGreaterThan(0);
  });

  it("keeps the README free of a hand-maintained block inventory or shipping count", () => {
    // The package README is a short pointer; the catalog and its coverage test own the inventory.
    expect(readme).not.toMatch(/\*\*Blocks:\*\*|- \*\*`blocks`\*\*/);
    expect(readme).not.toMatch(/\b\d+\s+(?:blocks?|leaves|components|sections)\b/i);
    expect(readme).not.toMatch(/\b[\w-]+ ship\b/);
  });

  it("keeps the leaf header and lifecycle check free of hand-maintained count pins", () => {
    expect(blockSource).not.toMatch(/\/\/ Leaves:\s*\d/);
    const blockCoverage = coverage.split('describe("block catalog coverage"')[1];
    expect(blockCoverage).toBeDefined();
    expect(blockCoverage).not.toMatch(/toHaveLength\(\d+\)|toEqual\(\[\d/);
    expect(blockCoverage).not.toMatch(/counts \d+ deprecated/);
  });
});
