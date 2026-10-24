import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("compiled TreeView public contract", () => {
  it("exports TreeView through the atoms barrel and the root barrel", async () => {
    for (const entry of ["atoms/index.js", "index.js"]) {
      const api = await import(pathToFileURL(join(packageRoot, "dist", entry)).href);
      expect(api.TreeView).toBeTypeOf("function");
    }
  });

  it("emits TreeViewProps and TreeViewNode through both barrel declarations", () => {
    for (const entry of ["atoms/index.d.ts", "index.d.ts"]) {
      const text = readFileSync(join(packageRoot, "dist", entry), "utf8");
      expect(text).toMatch(/\bTreeViewProps\b/);
      expect(text).toMatch(/\bTreeViewNode\b/);
    }
  });
});
