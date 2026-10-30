import { afterEach, expect, it, vi } from "vitest";
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { compileBrief } from "../brief.js";
import { main } from "../cli.js";
import { readStrategyRoot } from "../store.js";
import { buildCitationIndex } from "./index.js";

const roots: string[] = [];
const id = "context.customer.need";
const ref = { cell: id, version: 1 };
const marker = (version: string | number = 1) => `strategy:${id}@${version}`;
const contract = { id: "fixture.brief", schemaVersion: 1 as const, owner: "fixture", requires: [id], optional: [] };
function put(root: string, path: string, text: string) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); }
function cell(version = 1, status = "active") {
  return `---\nid: ${id}\nversion: ${version}\nstatus: ${status}\nupdated: 2026-10-29\ncites: []\nfeeds: []\nfunctions: []\n${status === "active" ? "confirmed: msg:2026-10-29-1#U2\n" : ""}---\n\n## Direction\n- Need: Fictional studio scheduling.\n\n## Because\n- Fictional interviews.\n\n## Watch\n- Review monthly.\n`;
}
function fixture() {
  const project = mkdtempSync(join(tmpdir(), "strategy-citations-")); roots.push(project);
  const root = join(project, "strategy"); const surfaces = join(project, "surfaces"); mkdirSync(surfaces);
  put(root, "tree.json", JSON.stringify({ schemaVersion: 1, catalog: "@clossys/strategist#strategy-v1", archetype: "default", core: "archetype", active: { [id]: 1 } }));
  put(root, `cells/${id}/v1.md`, cell()); put(root, "contracts/fixture.json", JSON.stringify(contract));
  return { root, surfaces, project };
}
function invoke(root: string, ...args: string[]) { return main(["index", "--root", root, "--json", ...args]); }
function output() { return JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0])); }
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("indexes whole strategy markers with physical lines and recursive JSON objects", () => {
  const { root } = fixture(); const model = readStrategyRoot(root);
  const result = buildCitationIndex(model, { files: [
    { path: "copy.md", content: `Heading\n<!-- ${marker(1)} -->\n${marker("10x")} ${marker(0)} ${marker("9007199254740992")}\n` },
    { path: "manifest.json", content: JSON.stringify({ records: [{ strategy: { refs: [ref] } }] }) },
  ] });
  expect(result.entries).toEqual([
    { ref, by: { kind: "marker", path: "copy.md", line: 2 } },
    { ref, by: { kind: "json", path: "manifest.json", id: "/records/0/strategy/refs/0" } },
  ]);
  expect(result.stale).toEqual([]); expect(result.dangling).toEqual([]);
  expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
});

it("indexes compact HTML comment markers while rejecting malformed token boundaries", () => {
  const { root } = fixture();
  const valid = [`<!--${marker()}-->`, `<!-- ${marker()}-->`, `<!--${marker()} -->`, `<!-- ${marker()} -->`];
  const invalid = [`x${marker()}`, `-${marker()}`, `${marker()}-suffix`, `${marker()}x`, `${marker()}@2`, `${marker()}--suffix`];
  const result = buildCitationIndex(readStrategyRoot(root), { files: [{ path: "copy.md", content: [...valid, ...invalid].join("\n") }] });
  expect(result.entries).toEqual(valid.map((_, index) => ({ ref, by: { kind: "marker", path: "copy.md", line: index + 1 } })));
});

it.each(["stale", "dangling"])("index --check detects %s compact HTML comment markers", kind => {
  const { root, surfaces } = fixture();
  if (kind === "stale") put(root, `cells/${id}/v2.md`, cell(2, "draft"));
  const version = kind === "stale" ? 2 : 99;
  put(surfaces, "copy.md", `<!--${marker(version)}-->\n<!-- ${marker(version)}-->`);
  vi.spyOn(console, "log").mockImplementation(() => {});
  expect(invoke(root, "--check", "--scan", surfaces)).toBe(1);
  expect(output()[kind].map((entry: { by: { line: number } }) => entry.by.line)).toEqual([1, 2]);
  expect(existsSync(join(root, "citations.json"))).toBe(false);
});

it("separates unknown versions and cells from known non-active versions", () => {
  const { root } = fixture(); put(root, `cells/${id}/v2.md`, cell(2, "draft"));
  const result = buildCitationIndex(readStrategyRoot(root), { files: [{ path: "refs.json", content: JSON.stringify([ref, { cell: id, version: 2 }, { cell: id, version: 3 }, { cell: "unknown.cell.id", version: 1 }]) }] });
  expect(result.stale.map(entry => entry.ref)).toEqual([{ cell: id, version: 2 }]);
  expect(result.dangling.map(entry => entry.ref)).toEqual([{ cell: id, version: 3 }, { cell: "unknown.cell.id", version: 1 }]);
});

it("indexes written brief cells and provenance and detects fresh fingerprint drift", () => {
  const { root } = fixture(); const written = compileBrief(readStrategyRoot(root), contract);
  const result = buildCitationIndex(readStrategyRoot(root), { briefs: [{ path: "briefs/fixture.brief.json", brief: written }], contracts: [contract] });
  expect(result.entries).toContainEqual({ ref, by: { kind: "brief", path: "briefs/fixture.brief.json", id: "/cells/0" } });
  expect(result.drift).toEqual([]);
  put(root, `cells/${id}/v1.md`, cell().replace("scheduling", "planning"));
  expect(buildCitationIndex(readStrategyRoot(root), { briefs: [{ path: "briefs/fixture.brief.json", brief: written }], contracts: [contract] }).drift).toEqual([{ path: "briefs/fixture.brief.json", contract: contract.id, written: written.fingerprint, fresh: compileBrief(readStrategyRoot(root), contract).fingerprint }]);
});

it("keeps citations and fingerprints current when a newer draft exists, until activation", () => {
  const { root } = fixture(); const written = compileBrief(readStrategyRoot(root), contract);
  const scan = { briefs: [{ path: "briefs/fixture.brief.json", brief: written }], contracts: [contract], files: [{ path: "copy.md", content: marker(1) }] };
  const before = buildCitationIndex(readStrategyRoot(root), scan);
  put(root, `cells/${id}/v2.md`, cell(2, "draft"));
  const draft = buildCitationIndex(readStrategyRoot(root), scan);
  put(root, "briefs/fixture.brief.json", JSON.stringify(written));
  vi.spyOn(console, "log").mockImplementation(() => {}); expect(invoke(root, "--check")).toBe(0);
  expect(draft.stale).toEqual([]); expect(draft.drift).toEqual([]); expect(draft.fingerprint).toBe(before.fingerprint);
  put(root, "tree.json", readFileSync(join(root, "tree.json"), "utf8").replace(`"${id}":1`, `"${id}":2`));
  put(root, `cells/${id}/v2.md`, cell(2));
  const activated = buildCitationIndex(readStrategyRoot(root), scan);
  expect(activated.stale).toHaveLength(2); expect(activated.drift).toHaveLength(1);
});

it("produces stable deterministic entries and fingerprint under scan order", () => {
  const { root } = fixture(); const files = [{ path: "z.md", content: marker(1) }, { path: "a.json", content: JSON.stringify(ref) }];
  const model = readStrategyRoot(root); const first = buildCitationIndex(model, { files }); const second = buildCitationIndex(model, { files: files.reverse() });
  expect(second.entries).toEqual(first.entries); expect(second.fingerprint).toBe(first.fingerprint);
});

it("builds citations.json and checks read-only, including briefs without --scan", () => {
  const { root } = fixture(); const written = compileBrief(readStrategyRoot(root), contract); put(root, "briefs/fixture.brief.json", JSON.stringify(written));
  vi.spyOn(console, "log").mockImplementation(() => {});
  expect(invoke(root, "--check")).toBe(0); expect(existsSync(join(root, "citations.json"))).toBe(false);
  expect(output().entries[0].by.kind).toBe("brief");
  expect(invoke(root)).toBe(0); const bytes = readFileSync(join(root, "citations.json"), "utf8");
  expect(JSON.parse(bytes).schemaVersion).toBe(1); expect(invoke(root, "--check")).toBe(0);
  expect(readFileSync(join(root, "citations.json"), "utf8")).toBe(bytes);
});

it.each(["stale", "dangling", "drift"])("index --check exits 1 for %s", kind => {
  const { root, surfaces } = fixture(); vi.spyOn(console, "log").mockImplementation(() => {});
  if (kind === "drift") {
    const written = compileBrief(readStrategyRoot(root), contract); put(root, "briefs/fixture.brief.json", JSON.stringify({ ...written, fingerprint: "0".repeat(64) }));
  } else {
    put(surfaces, "copy.md", marker(kind === "stale" ? 2 : 3));
    if (kind === "stale") put(root, `cells/${id}/v2.md`, cell(2, "draft"));
  }
  expect(invoke(root, "--check", "--scan", surfaces)).toBe(1);
  expect(existsSync(join(root, "citations.json"))).toBe(false);
});

it("honors repeated scan directories, extensions, additive skip dirs and excludes", () => {
  const { root, surfaces, project } = fixture(); const other = join(project, "other"); mkdirSync(other);
  put(surfaces, "copy.txt", marker(1)); put(other, "manifest.json", JSON.stringify({ nested: [ref] }));
  for (const path of ["omit.txt", "cache/bad.txt", "node_modules/bad.txt", "dist/bad.txt", "bad.md"]) put(surfaces, path, marker(99));
  vi.spyOn(console, "log").mockImplementation(() => {});
  expect(invoke(root, "--check", "--scan", surfaces, "--scan", other, "--extensions", ".txt", "--extensions", ".json", "--skip-dirs", "cache", "--exclude", "omit.txt")).toBe(0);
  expect(output().entries).toHaveLength(2);
});

it.each(["md", ".", ".md/path"])("rejects malformed extension %s instead of reporting an empty clean scan", extension => {
  const { root, surfaces } = fixture(); put(surfaces, "copy.md", marker(99));
  vi.spyOn(console, "log").mockImplementation(() => {});
  for (const args of [["--extensions", extension], [`--extensions=${extension}`]]) {
    expect(invoke(root, "--check", "--scan", surfaces, ...args)).toBe(2);
    expect(output().error).toMatch(/leading dot and name only/);
  }
  expect(existsSync(join(root, "citations.json"))).toBe(false);
});

it.each(["root", "scan", "brief-json", "scan-json", "contract", "brief-link"])("exits 2 for unreadable or invalid %s inputs", kind => {
  const { root, surfaces, project } = fixture(); vi.spyOn(console, "error").mockImplementation(() => {}); vi.spyOn(console, "log").mockImplementation(() => {});
  if (kind === "root") rmSync(join(root, "tree.json"));
  if (kind === "brief-json") put(root, "briefs/fixture.brief.json", "{");
  if (kind === "scan-json") put(surfaces, "bad.json", "{");
  if (kind === "contract") { put(root, "briefs/fixture.brief.json", JSON.stringify({ ...compileBrief(readStrategyRoot(root), contract), contract: "missing.contract" })); }
  if (kind === "brief-link") { put(project, "outside.json", JSON.stringify(compileBrief(readStrategyRoot(root), contract))); mkdirSync(join(root, "briefs")); symlinkSync(join(project, "outside.json"), join(root, "briefs/fixture.brief.json")); }
  expect(invoke(root, "--check", "--scan", kind === "scan" ? join(project, "missing") : surfaces)).toBe(2);
  expect(existsSync(join(root, "citations.json"))).toBe(false);
});

it("defaults the root and scans JSON by default; index --help is available", () => {
  const { root, surfaces, project } = fixture(); put(surfaces, "manifest.json", JSON.stringify(ref));
  vi.spyOn(console, "log").mockImplementation(() => {});
  expect(invoke(root, "--check", "--scan", surfaces)).toBe(0); expect(output().entries).toHaveLength(1);
  expect(main(["index", "--help"])).toBe(0);
  const cwd = process.cwd();
  try { process.chdir(project); mkdirSync(join(project, "clossys/agents"), { recursive: true }); renameSync(root, join(project, "clossys/agents/strategist")); expect(main(["index", "--check", "--json"])).toBe(0); }
  finally { process.chdir(cwd); }
});

it("keeps real marker and recursive JSON sources stable across safe builds and checks", () => {
  const { root, surfaces } = fixture(); put(surfaces, "copy.md", marker(1)); put(surfaces, "manifest.json", JSON.stringify({ nested: [ref] }));
  vi.spyOn(console, "log").mockImplementation(() => {});
  expect(invoke(root, "--scan", surfaces)).toBe(0); const first = output();
  expect(first.entries).toHaveLength(2);
  expect(first.entries.map((entry: { by: { kind: string } }) => entry.by.kind).sort()).toEqual(["json", "marker"]);
  expect(invoke(root, "--scan", surfaces)).toBe(0); expect(output().fingerprint).toBe(first.fingerprint);
  expect(output().entries).toEqual(first.entries);
  const bytes = readFileSync(join(root, "citations.json"), "utf8");
  expect(invoke(root, "--check", "--scan", surfaces)).toBe(0); expect(output().fingerprint).toBe(first.fingerprint);
  expect(readFileSync(join(root, "citations.json"), "utf8")).toBe(bytes);
});

it.each(["absent", "existing", "directory-link", "nested-directory-link", "root-link"])("refuses output inside scanned surfaces with a %s target", kind => {
  const { root, surfaces, project } = fixture(); put(root, "copy.md", marker(99));
  vi.spyOn(console, "log").mockImplementation(() => {});
  if (kind !== "absent") expect(invoke(root)).toBe(0);
  let scan = root;
  let commandRoot = root;
  if (kind === "directory-link") { scan = join(project, "root-alias"); symlinkSync(root, scan); }
  if (kind === "nested-directory-link") { scan = surfaces; symlinkSync(root, join(surfaces, "root-alias")); }
  if (kind === "root-link") { commandRoot = join(project, "root-alias"); symlinkSync(root, commandRoot); }
  const before = kind === "absent" ? undefined : readFileSync(join(root, "citations.json"), "utf8");
  for (const mode of [["--check"], []]) {
    expect(invoke(commandRoot, ...mode, "--scan", scan)).toBe(1);
    expect(output().error).toMatch(/^CitationIndexTargetError: .*inside a scanned surface/);
    expect(readFileSync(join(root, "copy.md"), "utf8")).toBe(marker(99));
    if (before === undefined) expect(existsSync(join(root, "citations.json"))).toBe(false);
    else expect(readFileSync(join(root, "citations.json"), "utf8")).toBe(before);
  }
});

it.each(["file-link", "hard-link"])("refuses generated output with %s scan aliases without dropping sources", kind => {
  const { root, surfaces } = fixture(); put(surfaces, "copy.md", marker(99));
  vi.spyOn(console, "log").mockImplementation(() => {});
  expect(invoke(root)).toBe(0);
  if (kind === "file-link") symlinkSync(join(root, "citations.json"), join(surfaces, "generated-alias.json"));
  else linkSync(join(root, "citations.json"), join(surfaces, "generated-alias.json"));
  const bytes = readFileSync(join(root, "citations.json"), "utf8");
  for (const mode of [["--check"], []]) {
    expect(invoke(root, ...mode, "--scan", surfaces)).toBe(1);
    expect(output().error).toMatch(/^CitationIndexTargetError:/);
    expect(readFileSync(join(root, "citations.json"), "utf8")).toBe(bytes);
    expect(readFileSync(join(surfaces, "copy.md"), "utf8")).toBe(marker(99));
  }
  rmSync(join(surfaces, "generated-alias.json"));
  expect(invoke(root, "--check", "--scan", surfaces)).toBe(1); expect(output().dangling).toHaveLength(1);
});

it.each(["symlink", "hardlink"])("refuses the exact dangling-source output %s before check suppression or write damage", kind => {
  const { root, surfaces } = fixture(); const source = join(surfaces, "copy.md"); const target = join(root, "citations.json");
  const bytes = "<!--strategy:focus.segment.core@99-->\n"; put(surfaces, "copy.md", bytes);
  vi.spyOn(console, "log").mockImplementation(() => {});
  expect(invoke(root, "--check", "--scan", surfaces)).toBe(1);
  expect(output().dangling[0].ref).toEqual({ cell: "focus.segment.core", version: 99 });
  if (kind === "symlink") symlinkSync(source, target); else linkSync(source, target);
  for (const mode of [["--check"], []]) {
    expect(invoke(root, ...mode, "--scan", surfaces)).toBe(1);
    expect(output().error).toMatch(/^CitationIndexTargetError:/);
    expect(readFileSync(source, "utf8")).toBe(bytes);
    expect(readFileSync(target, "utf8")).toBe(bytes);
  }
  rmSync(target);
  expect(invoke(root, "--check", "--scan", surfaces)).toBe(1); expect(output().dangling).toHaveLength(1);
});

it("refuses a dangling output symlink in JSON and human output without creating its target", () => {
  const { root, surfaces, project } = fixture(); const source = join(project, "missing.json"); const target = join(root, "citations.json");
  symlinkSync(source, target);
  vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {});
  for (const mode of [["--check"], []]) {
    expect(invoke(root, ...mode, "--scan", surfaces)).toBe(1);
    expect(output().error).toMatch(/^CitationIndexTargetError: .*symlink/);
    expect(main(["index", "--root", root, ...mode, "--scan", surfaces])).toBe(1);
    expect(vi.mocked(console.error).mock.calls.at(-1)?.[0]).toMatch(/CitationIndexTargetError: .*symlink/);
    expect(lstatSync(target).isSymbolicLink()).toBe(true); expect(readlinkSync(target)).toBe(source);
    expect(existsSync(source)).toBe(false);
  }
});

it.each([["--root"], ["--scan"], ["--unknown"], ["--check", "surprise"], ["--root", "one", "--root", "two"]])("rejects invalid index arguments %j", (...args: string[]) => {
  vi.spyOn(console, "error").mockImplementation(() => {}); expect(main(["index", ...args])).toBe(2);
});

it("accepts attached options and multiple scan directories after one --scan", () => {
  const { root, surfaces, project } = fixture(); const other = join(project, "other"); mkdirSync(other);
  put(surfaces, "copy.md", marker(1)); put(other, "copy.json", JSON.stringify(ref));
  vi.spyOn(console, "log").mockImplementation(() => {});
  expect(main(["index", `--root=${root}`, "--check", "--json", "--scan", surfaces, other])).toBe(0); expect(output().entries).toHaveLength(2);
});
