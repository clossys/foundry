import { afterEach, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
  try { process.chdir(project); mkdirSync(join(project, "clossys")); renameSync(root, join(project, "clossys/strategist")); expect(main(["index", "--check", "--json"])).toBe(0); }
  finally { process.chdir(cwd); }
});

it("does not re-index its generated citations file when scanning the root", () => {
  const { root } = fixture(); put(root, "copy.md", marker(1));
  vi.spyOn(console, "log").mockImplementation(() => {});
  expect(invoke(root, "--scan", root)).toBe(0); const first = output();
  expect(invoke(root, "--scan", root)).toBe(0); expect(output().fingerprint).toBe(first.fingerprint);
  expect(output().entries).toEqual(first.entries);
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
