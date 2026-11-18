/** foundry-build-0037: no live read of a retired id anywhere in the Publisher package; no baseline, no allowlist. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findRetiredReads, isRetiredData, retiredIds, retiredPattern } from "./check.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const scratch = (files: Record<string, string>): string => {
  const root = mkdtempSync(join(tmpdir(), "retired-reads-"));
  dirs.push(root);
  for (const [path, text] of Object.entries(files)) { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); }
  return root;
};
const ids = retiredIds();
const [first, second] = [...ids].sort();

describe("retired-id reads in Publisher", () => {
  it("loads the Designer and Publisher retired ids", () => {
    expect(ids.size).toBeGreaterThan(0);
    expect([...ids].some(id => id.startsWith("sections."))).toBe(true);
  });

  it("finds no live read of a retired id in the package", () => {
    expect(findRetiredReads()).toEqual([]);
  });

  it("mutation: a source, test, fixture or doc that names a retired id fails, with its file and line", () => {
    const root = scratch({
      "src/a.ts": `export const x = "${first}";\n`,
      "src/__fixtures__/b.json": `{ "use": "designer/${second}" }\n`,
      "README.md": `intro\nsee ${first}\n`,
    });
    expect(findRetiredReads(root, ids)).toEqual([
      { file: "README.md", line: 2, id: first },
      { file: "src/__fixtures__/b.json", line: 1, id: second },
      { file: "src/a.ts", line: 1, id: first },
    ]);
  });

  it("skips only retired data, recognised by shape", () => {
    const marked = JSON.stringify({ retired: { retiredAt: "2026-11-17", decidedBy: "owner", reason: "legacy" }, nodes: [first] });
    const half = JSON.stringify({ retired: { retiredAt: "2026-11-17" }, nodes: [first] });
    const root = scratch({
      "src/catalog/retired.json": JSON.stringify([{ id: first }]),
      "src/legacy/retired/map.json": JSON.stringify({ a: first }),
      "src/content/slots.leaf-freeze.json": JSON.stringify({ leafIds: [first] }),
      "src/marked.json": marked,
      "src/half.json": half,
    });
    expect(findRetiredReads(root, ids)).toEqual([{ file: "src/half.json", line: 1, id: first }]);
    expect(isRetiredData("src/retired-reads/check.ts", "")).toBe(false);
  });

  it("matches whole ids only, not a longer id or dotted name that contains one", () => {
    const pattern = retiredPattern(new Set([first]));
    expect(`"${first}"`.match(pattern)).toEqual([first]);
    expect(`${first}-next`.match(pattern)).toBeNull();
    expect(`prefix.${first}`.match(pattern)).toBeNull();
  });

  it("refuses to pass on missing retired data", () => {
    expect(() => findRetiredReads(scratch({}), new Set())).toThrow(/No retired ids/);
  });
});
