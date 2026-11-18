/** foundry-build-0037: no live read of a retired id anywhere in the Publisher package; no baseline, no allowlist. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findRetiredReads, isRetiredData, retiredIds, retiredIdsFrom, retiredPattern } from "./check.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const scratch = (files: Record<string, string>): string => {
  const root = mkdtempSync(join(tmpdir(), "retired-reads-"));
  dirs.push(root);
  for (const [path, text] of Object.entries(files)) { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); }
  return root;
};
/** Scratch paths are assembled from parts so this file never names a real package path as a literal. */
const at = (...parts: string[]) => parts.join("/");
const ids = retiredIds();
const [first, second] = [...ids].sort();
/** Synthetic ids for the rule cases: none of them is a real retired id, so this file stays clean under the real scan. */
const zone = ["zone", "alpha"].join("."), other = ["zone", "beta"].join("."), live = ["zone", "gamma"].join(".");
const fake = new Set([zone, other]);
const entry = (id: string) => ({ id, retiredAt: "2026-11-17", decidedBy: "owner", reason: "replaced" });
const mark = { retiredAt: "2026-11-17", decidedBy: "owner", reason: "legacy" };

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
      [at("src", "a.ts")]: `export const x = "${first}";\n`,
      [at("src", "__fixtures__", "b.json")]: `{ "use": "designer/${second}" }\n`,
      "README.md": `intro\nsee ${first}\n`,
    });
    expect(findRetiredReads(root, ids)).toEqual([
      { file: "README.md", line: 2, id: first, kind: "id" },
      { file: at("src", "__fixtures__", "b.json"), line: 1, id: second, kind: "id" },
      { file: at("src", "a.ts"), line: 1, id: first, kind: "id" },
    ]);
  });

  it("mutation: an id planted under a nested build/ or dist/ folder fails; only root output folders are skipped", () => {
    const root = scratch({
      [at("src", "build", "x.ts")]: `"${zone}"\n`,
      [at("src", "dist", "y.ts")]: `"${zone}"\n`,
      [at("dist", "x.js")]: `"${zone}"\n`,
      [at("build", "x.js")]: `"${zone}"\n`,
      [at("node_modules", "p", "x.js")]: `"${zone}"\n`,
    });
    expect(findRetiredReads(root, fake).map(read => read.file)).toEqual([at("src", "build", "x.ts"), at("src", "dist", "y.ts")]);
  });

  it("mutation: source under a retired/ folder fails; only .json data there is exempt", () => {
    const root = scratch({
      [at("src", "core", "retired", "x.ts")]: `"${zone}"\n`,
      [at("src", "core", "retired", "y.tsx")]: `"${zone}"\n`,
      [at("src", "core", "retired", "map.json")]: JSON.stringify({ a: zone }),
    });
    expect(findRetiredReads(root, fake).map(read => read.file)).toEqual([at("src", "core", "retired", "x.ts"), at("src", "core", "retired", "y.tsx")]);
    expect(isRetiredData(at("src", "core", "retired", "map.json"), "{}", fake)).toBe(true);
    expect(isRetiredData(at("src", "core", "retired", "x.ts"), "", fake)).toBe(false);
  });

  it("mutation: a JSON document that marks itself retired is scanned like any other file", () => {
    const root = scratch({ [at("src", "marked.json")]: JSON.stringify({ retired: mark, nodes: [zone] }) });
    expect(findRetiredReads(root, fake)).toEqual([{ file: at("src", "marked.json"), line: 1, id: zone, kind: "id" }]);
  });

  it("mutation: a registry needs the full entry shape, and a leaf freeze is exempt only while every leaf is retired", () => {
    const root = scratch({
      [at("src", "catalog", "retired.json")]: JSON.stringify([entry(zone)]),
      [at("src", "other", "retired.json")]: JSON.stringify([{ id: other }]),
      [at("src", "content", "a.leaf-freeze.json")]: JSON.stringify({ leafIds: [zone, other] }),
      [at("src", "content", "b.leaf-freeze.json")]: JSON.stringify({ leafIds: [zone, live] }),
    });
    expect(findRetiredReads(root, fake)).toEqual([
      { file: at("src", "content", "b.leaf-freeze.json"), line: 1, id: zone, kind: "id" },
      { file: at("src", "other", "retired.json"), line: 1, id: other, kind: "id" },
    ]);
  });

  it("mutation: importing or naming the path of exempt or self-marked retired data fails as a live read; the registry may be read", () => {
    const freeze = at("src", "content", "a.leaf-freeze.json"), folder = at("src", "layouts", "retired", "map.json"), marked = at("src", "content", "tree.json");
    const root = scratch({
      [at("src", "catalog", "retired.json")]: JSON.stringify([entry(zone)]),
      [freeze]: JSON.stringify({ leafIds: [zone] }),
      [folder]: JSON.stringify({ a: zone }),
      [marked]: JSON.stringify({ retired: mark, nodes: [] }),
      [at("src", "content", "use.ts")]: [`import f from "./${"a.leaf-freeze.json"}";`, `import t from "./${"tree.json"}";`, `import r from "../catalog/${"retired.json"}";`].join("\n"),
      [at("src", "load.ts")]: `readFileSync(join(root, "${at("dist", "layouts", "retired", "map.json")}"));\n`,
      [at("scripts", "x.mjs")]: `const p = "/${freeze}";\n`,
    });
    expect(findRetiredReads(root, fake)).toEqual([
      { file: at("scripts", "x.mjs"), line: 1, id: freeze, kind: "retired-data-read" },
      { file: at("src", "content", "use.ts"), line: 1, id: freeze, kind: "retired-data-read" },
      { file: at("src", "content", "use.ts"), line: 2, id: marked, kind: "retired-data-read" },
      { file: at("src", "load.ts"), line: 1, id: folder, kind: "retired-data-read" },
    ]);
  });

  it("mutation: a retired <namespace>.<name> used as the bare name under a <namespace>/ folder fails as an alias", () => {
    const root = scratch({
      [at("src", "zone", "ids.ts")]: `export const IDS = ["alpha", "delta"] as const;\n`,
      [at("src", "web", "zone", "View.tsx")]: `const a = 'alpha';\n`,
      [at("src", "elsewhere", "ids.ts")]: `export const IDS = ["alpha"] as const;\n`,
    });
    expect(findRetiredReads(root, fake)).toEqual([
      { file: at("src", "web", "zone", "View.tsx"), line: 1, id: zone, kind: "alias" },
      { file: at("src", "zone", "ids.ts"), line: 1, id: zone, kind: "alias" },
    ]);
  });

  it("matches whole ids only, not a longer id or dotted name that contains one", () => {
    const pattern = retiredPattern(new Set([first]));
    expect(`"${first}"`.match(pattern)).toEqual([first]);
    expect(`${first}-next`.match(pattern)).toBeNull();
    expect(`prefix.${first}`.match(pattern)).toBeNull();
  });

  it("refuses to pass on missing retired data, including either list alone", () => {
    expect(() => findRetiredReads(scratch({}), new Set())).toThrow(/No retired ids/);
    expect(() => retiredIdsFrom([], [entry(zone)])).toThrow(/No Designer retired ids/);
    expect(() => retiredIdsFrom([zone], [])).toThrow(/No Publisher retired ids/);
    expect([...retiredIdsFrom([zone], [entry(other)])]).toEqual([zone, other]);
  });
});
