/** foundry-build-0037: no live read of a retired id anywhere in the Publisher package; no baseline, no allowlist. */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PUBLISHER_RETIRED } from "../../catalog/ia/tree.js";
import { findRetiredReads, isRetiredData, retiredIds, retiredIdsFrom, retiredPattern } from "./check.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const scratch = (files: Record<string, string | Uint8Array>): string => {
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
/** The registry's file name and its declared place, assembled so this file never names the real registry path. */
const REGISTRY = ["retired", "json"].join("."), registry = at("src", "catalog", REGISTRY), reader = at("src", "catalog", "ia", "tree.ts");
const json = (value: unknown) => JSON.stringify(value);

describe("retired-id reads in Publisher", () => {
  it("loads the Designer and Publisher retired ids", () => {
    expect(ids.size).toBeGreaterThan(0);
    expect([...ids].some(id => id.startsWith("sections."))).toBe(true);
  });

  // Reads every file in the package, so it outlasts the 5s default when other suites share the machine.
  it("finds no live read of a retired id in the package", () => {
    expect(findRetiredReads()).toEqual([]);
  }, 60_000);

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
      [registry]: json([entry(zone)]),
      [at("src", "other", REGISTRY)]: json([{ id: other }]),
      [at("src", "content", "a.leaf-freeze.json")]: json({ leafIds: [zone, other] }),
      [at("src", "content", "b.leaf-freeze.json")]: json({ leafIds: [zone, live] }),
    });
    expect(findRetiredReads(root, fake)).toEqual([
      { file: at("src", "content", "b.leaf-freeze.json"), line: 1, id: zone, kind: "id" },
      { file: at("src", "other", REGISTRY), line: 0, id: at("src", "other", REGISTRY), kind: "registry-misplaced" },
      { file: at("src", "other", REGISTRY), line: 1, id: other, kind: "id" },
    ]);
  });

  it("mutation: importing or naming the path of exempt or self-marked retired data fails as a live read; the declared reader may read the registry", () => {
    const freeze = at("src", "content", "a.leaf-freeze.json"), folder = at("src", "layouts", "retired", "map.json"), marked = at("src", "notes", "marked.json");
    const root = scratch({
      [registry]: json([entry(zone)]),
      [reader]: `import r from "../${REGISTRY}";\n`,
      [freeze]: json({ leafIds: [zone] }),
      [folder]: json({ a: zone }),
      [marked]: json({ retired: mark, nodes: [] }),
      [at("src", "content", "use.ts")]: [`import f from "./${"a.leaf-freeze.json"}";`, `import t from "../${at("notes", "marked.json")}";`].join("\n"),
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

  it("mutation: every file kind is scanned; an unreadable or linked file fails", () => {
    const root = scratch({
      [at("bin", "publish")]: `#!/usr/bin/env node\nconsole.log("${zone}");\n`,
      [at("docs", "a.mdx")]: `${zone}\n`,
      [at("src", "a.svg")]: `<t>${zone}</t>\n`,
      [at("src", "b.bin")]: Uint8Array.from([0xff, 0xfe, 0x00]),
      // Valid UTF-8 source may hold a NUL byte (a template key, for example): it is scanned, never sniffed as binary.
      [at("src", "nul.ts")]: `export const key = (a: string) => \`\${a}\u0000\`;\n`,
    });
    symlinkSync(join(root, "src", "a.svg"), join(root, "src", "link"));
    expect(findRetiredReads(root, fake)).toEqual([
      { file: at("bin", "publish"), line: 2, id: zone, kind: "id" },
      { file: at("docs", "a.mdx"), line: 1, id: zone, kind: "id" },
      { file: at("src", "a.svg"), line: 1, id: zone, kind: "id" },
      { file: at("src", "b.bin"), line: 0, id: "not-utf8", kind: "unscannable" },
      { file: at("src", "link"), line: 0, id: "symlink-or-special", kind: "unscannable" },
    ]);
  });

  it("mutation: a registry outside a declared path is scanned, flagged and guarded", () => {
    const web = at("src", "web", REGISTRY), elsewhere = at("src", "other", REGISTRY);
    const root = scratch({
      [registry]: json([entry(zone)]),
      [reader]: `import r from "../${REGISTRY}";\n`,
      [web]: json([{ ...entry(other), contract: { engine: "stack" } }]),
      [at("src", "web", "c.ts")]: `import r from "./${REGISTRY}";\n`,
      [elsewhere]: json([entry(other)]),
    });
    expect(findRetiredReads(root, fake)).toEqual([
      { file: elsewhere, line: 0, id: elsewhere, kind: "registry-misplaced" },
      { file: elsewhere, line: 1, id: other, kind: "id" },
      { file: at("src", "web", "c.ts"), line: 1, id: web, kind: "retired-data-read" },
      { file: web, line: 0, id: web, kind: "registry-misplaced" },
      { file: web, line: 1, id: other, kind: "id" },
    ]);
  });

  it("mutation: a declared registry with an extra key loses its exemption; replacedBy is the one optional key", () => {
    for (const contract of [{}, "flow"]) {
      const extra = scratch({ [registry]: json([{ ...entry(zone), contract }]), [reader]: `import r from "../${REGISTRY}";\n` });
      expect(findRetiredReads(extra, fake)).toEqual([
        { file: reader, line: 1, id: registry, kind: "retired-data-read" },
        { file: registry, line: 0, id: registry, kind: "registry-schema" },
        { file: registry, line: 1, id: zone, kind: "id" },
      ]);
    }
    const successor = scratch({ [registry]: json([{ ...entry(zone), replacedBy: other }]), [reader]: `import r from "../${REGISTRY}";\n` });
    expect(findRetiredReads(successor, fake)).toEqual([]);
  });

  it("mutation: only the declared reader may import or name the registry; docs may name it", () => {
    const root = scratch({
      [registry]: json([entry(zone)]),
      [reader]: `import r from "../${REGISTRY}";\n`,
      [at("src", "z.ts")]: `import r from "./${at("catalog", REGISTRY)}";\n`,
      [at("scripts", "y.mjs")]: `readFileSync("${at("dist", "catalog", REGISTRY)}");\n`,
      "README.md": `The registry is ${registry}.\n`,
    });
    expect(findRetiredReads(root, fake)).toEqual([
      { file: at("scripts", "y.mjs"), line: 1, id: registry, kind: "registry-read" },
      { file: at("src", "z.ts"), line: 1, id: registry, kind: "registry-read" },
    ]);
  });

  it("mutation: a partial path, join fragments, a template or a bare file name of retired data fails as a live read", () => {
    const data = at("src", "layouts", "retired", "zone-map.json");
    const root = scratch({
      [data]: json({ a: zone }),
      [at("src", "x.ts")]: [
        `join(SRC, "${at("layouts", "retired", "zone-map.json")}");`,
        `join(SRC, "layouts", "retired", "zone-map.json");`,
        `resolve(here, "${at("retired", "zone-map.json")}");`,
        `const f = "zone-map.json";`,
        `const g = "${at("layouts", "live", "zone-map.json")}";`,
        `const t = \`\${SRC}/${at("layouts", "retired", "zone-map.json")}\`;`,
        `const b = "zone-map.json.bak";`,
        `resolve(here, "../${at("layouts", "retired", "zone-map.json")}");`,
        `const u = \`\${SRC}/${at("layouts", "live", "zone-map.json")}\`;`,
        `const v = \`\${SRC}/\${name}\`;`,
      ].join("\n") + "\n",
    });
    expect(findRetiredReads(root, fake)).toEqual([1, 2, 3, 4, 6, 8].map(line => ({ file: at("src", "x.ts"), line, id: data, kind: "retired-data-read" })));
  });

  it("mutation: comma-separated join or resolve arguments are read as one path, so the longest one decides which file is read", () => {
    const layouts = at("src", "layouts", "retired", "zone-map.json"), panels = at("src", "panels", "retired", "zone-map.json");
    const root = scratch({
      [layouts]: json({ a: zone }),
      [panels]: json({ a: zone }),
      [at("src", "y.ts")]: [
        `join(SRC, "layouts", "retired", "zone-map.json");`,
        `join(SRC, "panels", "retired", "zone-map.json");`,
        `readFileSync("zone-map.json", "utf8");`,
      ].join("\n") + "\n",
    });
    const read = (line: number, id: string) => ({ file: at("src", "y.ts"), line, id, kind: "retired-data-read" });
    expect(findRetiredReads(root, fake)).toEqual([read(1, layouts), read(2, panels), read(3, layouts), read(3, panels)]);
  });

  it("mutation: a missing Designer IA extension throws instead of dropping its retirements", () => {
    const designer: Record<string, string> = { [at("src", "catalog", REGISTRY)]: json([entry(zone)]) };
    for (const layer of ["themes", "assets", "components", "sections", "frames"]) designer[at("src", "catalog", "ia", `${layer}.json`)] = json({ nodes: [] });
    expect(() => retiredIds(scratch(designer))).toThrow(/ia\/slides\.json is missing/);
    const extended = scratch({ ...designer, [at("src", "catalog", "ia", "slides.json")]: json({ families: [], retired: [entry(other)] }) });
    expect([...retiredIds(extended)]).toEqual([zone, other, ...PUBLISHER_RETIRED.map(item => item.id)]);
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
