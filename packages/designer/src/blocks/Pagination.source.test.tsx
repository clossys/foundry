import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Pagination source copy boundary", () => {
  it("keeps default English copy out of the component source", () => {
    const source = readFileSync(join(import.meta.dirname, "Pagination.tsx"), "utf8");
    for (const literal of ["Previous page", "Next page", "No results", "Rows per page", "Showing ${", "Page ${"])
      expect(source).not.toContain(literal);
    expect(source).not.toMatch(/ariaLabel\s*=\s*["']Pagination["']/);
  });
});
