/** @vitest-environment node */
import { beforeAll, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { installedSurfaceDependencies, installedSurfaceDependency } from "./surface-installed-dependencies.js";

// Count every file read the authentication makes; reads pass through unchanged.
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

// One installed package (Designer's own built dist) reached through three of its subpaths.
const SUBPATHS = ["@clossys/designer/components", "@clossys/designer/shell", "@clossys/designer/specimen"] as const;
const entries = SUBPATHS.map(module => fileURLToPath(import.meta.resolve(module)));
const distribution = entries[0]!.slice(0, entries[0]!.lastIndexOf("/dist/") + "/dist".length);
const reads = vi.mocked(readFile);
const counted = () => {
  const counts = new Map<string, number>();
  for (const [path] of reads.mock.calls) counts.set(String(path), (counts.get(String(path)) ?? 0) + 1);
  reads.mockClear();
  return counts;
};

beforeAll(async () => { for (const module of SUBPATHS) await import(module); }, 30_000);

it("one prepare hashes a package's files once for all three subpaths, with the un-memoized digests", async () => {
  expect(entries.every(entry => entry.startsWith(`${distribution}/`))).toBe(true);
  counted();
  // Un-memoized: each subpath authenticated on its own hashes the whole distribution again.
  const separate = [];
  for (const module of SUBPATHS) separate.push(await installedSurfaceDependency(module));
  const separateReads = counted();
  // One prepare: the three subpaths share the per-prepare memo.
  const shared = await installedSurfaceDependencies(SUBPATHS);
  const sharedReads = counted();

  const hashed = separate[0]!.identity.files.map(file => `${distribution}/${file.path}`);
  expect(hashed.length).toBeGreaterThan(100);
  expect(separate.every(row => row.identity.files.length === hashed.length)).toBe(true);
  // Each entry is read once more for its own entry digest.
  const entryReads = (path: string) => entries.filter(entry => entry === path).length;
  expect(hashed.filter(path => separateReads.get(path) !== SUBPATHS.length + entryReads(path))).toEqual([]);
  expect(hashed.filter(path => sharedReads.get(path) !== 1 + entryReads(path))).toEqual([]);
  // Same records, same order, same digests.
  expect(shared).toEqual(separate);
  expect(shared.map(row => row.artifactSha256)).toEqual(separate.map(row => row.artifactSha256));
}, 60_000);

it("never keeps a distribution across prepares: a second prepare hashes the files again", async () => {
  counted();
  const [row] = await installedSurfaceDependencies(SUBPATHS);
  const first = counted();
  await installedSurfaceDependencies(SUBPATHS);
  const second = counted();
  // The manifest walk also probes for package.json files; only the hashed distribution files count here.
  const hashed = row!.identity.files.map(file => `${distribution}/${file.path}`).filter(path => !entries.includes(path));
  expect(hashed.length).toBeGreaterThan(100);
  expect(hashed.filter(path => first.get(path) !== 1 || second.get(path) !== 1)).toEqual([]);
}, 60_000);
