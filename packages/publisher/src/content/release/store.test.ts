import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeContentRelease } from "../store/release.js";
import { refreshReleaseInput, releaseInput } from "./__fixtures__/release.js";

vi.mock("node:fs/promises", async importOriginal => ({ ...(await importOriginal<typeof import("node:fs/promises")>()) }));

const roots: string[] = [];
async function root(): Promise<string> {
  const value = await fs.mkdtemp(join(tmpdir(), "publisher-release-"));
  roots.push(value);
  return value;
}
async function tree(path: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function visit(directory: string, prefix = ""): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await visit(join(directory, entry.name), `${name}/`);
      else result[name] = await fs.readFile(join(directory, entry.name), "utf8");
    }
  }
  await visit(path);
  return result;
}
afterEach(async () => { await Promise.all(roots.splice(0).map(value => fs.rm(value, { recursive: true, force: true }))); });

describe("immutable local release storage", () => {
  it("writes exactly the manifest, build manifest, and pending handover under _releases", async () => {
    const directory = await root();
    const input = releaseInput();
    const before = structuredClone(input);
    const result = await writeContentRelease(directory, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.releases).toHaveLength(1);
    const bundle = result.releases[0]!;
    expect(bundle.manifest.n).toBe(1);
    expect(await tree(directory)).toEqual({
      [`_releases/${bundle.manifest.targetId}/1.json`]: JSON.stringify(bundle.manifest, null, 2) + "\n",
      [`_releases/${bundle.manifest.targetId}/1.build.json`]: JSON.stringify(bundle.build, null, 2) + "\n",
      [`_releases/${bundle.manifest.targetId}/1.handover.json`]: JSON.stringify(bundle.handover, null, 2) + "\n",
    });
    expect(bundle.handover).toMatchObject({ matches: false, status: "pending", observedAt: null });
    expect(input).toEqual(before);
  });

  it("appends identical re-releases without changing any earlier bytes or other publisher files", async () => {
    const directory = await root();
    await fs.writeFile(join(directory, "workspace.json"), "unchanged\n");
    const first = await writeContentRelease(directory, releaseInput());
    expect(first.ok).toBe(true);
    const before = await tree(directory);
    const second = await writeContentRelease(directory, releaseInput());
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.releases[0]!.manifest.n).toBe(2);
    const after = await tree(directory);
    for (const [name, bytes] of Object.entries(before)) expect(after[name]).toBe(bytes);
    expect(Object.keys(after)).toHaveLength(Object.keys(before).length + 3);
  });

  it("preflights invalid release input before creating any files or directories", async () => {
    const directory = await root();
    const result = await writeContentRelease(directory, { ...releaseInput(), approvedBy: "" });
    expect(result.ok).toBe(false);
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it("numbers separate targets independently", async () => {
    const directory = await root();
    const input = releaseInput();
    const first = await writeContentRelease(directory, input);
    expect(first.ok).toBe(true);
    const slot = structuredClone(input.registry.slots[0]!);
    const candidate = structuredClone(input.registry.candidates[0]!);
    slot.id = "sl_bbbbbbbbbb";
    slot.aliases = ["websites/admin/second"];
    slot.route = "/second";
    slot.deployTarget = "second-admin";
    slot.activeCandidateId = "second-candidate";
    candidate.id = "second-candidate";
    candidate.slotId = slot.id;
    input.registry.slots.push(slot);
    input.registry.candidates.push(candidate);
    input.registry.workspace.deployTargets.push({ id: "second-admin", repo: "sample", app: "second" });
    input.selections.push({ candidateId: candidate.id, review: structuredClone(input.selections[0]!.review) });
    refreshReleaseInput(input);
    const second = await writeContentRelease(directory, input);
    expect(second.ok).toBe(true);
    if (second.ok) expect(Object.fromEntries(second.releases.map(bundle => [bundle.manifest.targetId, bundle.manifest.n]))).toEqual({ "product-admin": 2, "second-admin": 1 });
  });

  it("rolls back only newly created files after a later bundle write fails", async () => {
    const directory = await root();
    expect((await writeContentRelease(directory, releaseInput())).ok).toBe(true);
    const before = await tree(directory);
    const originalOpen = fs.open;
    const open = vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      if (String(args[0]).endsWith("2.build.json")) throw new Error("Simulated disk failure");
      return originalOpen(...args);
    });
    let result;
    try { result = await writeContentRelease(directory, releaseInput()); }
    finally { open.mockRestore(); }
    expect(result.ok).toBe(false);
    expect(result.findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "release-store-write-failed" })]));
    expect(await tree(directory)).toEqual(before);
    const next = await writeContentRelease(directory, releaseInput());
    expect(next.ok).toBe(true);
    if (next.ok) expect(next.releases[0]!.manifest.n).toBe(2);
  });

  it.each(["partial", "gap", "filename", "digest", "build", "handover"])("refuses an existing %s bundle without changing stored bytes", async fault => {
    const directory = await root();
    const first = await writeContentRelease(directory, releaseInput());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const target = join(directory, "_releases", first.releases[0]!.manifest.targetId);
    if (fault === "partial") await fs.unlink(join(target, "1.build.json"));
    if (fault === "gap") for (const suffix of [".json", ".build.json", ".handover.json"]) await fs.rename(join(target, `1${suffix}`), join(target, `2${suffix}`));
    if (fault === "filename") await fs.writeFile(join(target, "unknown.json"), "{}");
    if (fault === "digest") {
      const path = join(target, "1.json");
      const manifest = JSON.parse(await fs.readFile(path, "utf8"));
      await fs.writeFile(path, JSON.stringify({ ...manifest, approvedBy: "changed" }));
    }
    if (fault === "build") {
      const path = join(target, "1.build.json");
      const build = JSON.parse(await fs.readFile(path, "utf8"));
      await fs.writeFile(path, JSON.stringify({ ...build, routes: [] }));
    }
    if (fault === "handover") {
      const path = join(target, "1.handover.json");
      const handover = JSON.parse(await fs.readFile(path, "utf8"));
      await fs.writeFile(path, JSON.stringify({ ...handover, matches: true }));
    }
    const before = await tree(directory);
    const result = await writeContentRelease(directory, releaseInput());
    expect(result.ok).toBe(false);
    expect(result.findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "release-store-invalid" })]));
    expect(await tree(directory)).toEqual(before);
  });

  it("refuses a held lock and does not remove another writer's lock", async () => {
    const directory = await root();
    await fs.mkdir(join(directory, "_releases", ".lock"), { recursive: true });
    const result = await writeContentRelease(directory, releaseInput());
    expect(result.ok).toBe(false);
    expect(result.findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "release-store-busy" })]));
    expect((await fs.lstat(join(directory, "_releases", ".lock"))).isDirectory()).toBe(true);
    expect(await fs.readdir(join(directory, "_releases"))).toEqual([".lock"]);
  });

  it("serializes concurrent writers without clobbering a bundle", async () => {
    const directory = await root();
    const results = await Promise.all([writeContentRelease(directory, releaseInput()), writeContentRelease(directory, releaseInput())]);
    expect(results.some(result => result.ok)).toBe(true);
    const successful = results.filter(result => result.ok);
    const files = await tree(directory);
    expect(Object.keys(files)).toHaveLength(successful.length * 3);
    const next = await writeContentRelease(directory, releaseInput());
    expect(next.ok).toBe(true);
    if (next.ok) expect(next.releases[0]!.manifest.n).toBe(successful.length + 1);
  });

  it.each(["root", "ancestor", "releases", "target", "file"])("refuses a symlink at the %s boundary", async boundary => {
    const directory = await root();
    const outside = await root();
    let inputRoot = directory;
    if (boundary === "root") {
      inputRoot = join(directory, "linked");
      await fs.symlink(outside, inputRoot, "dir");
    } else if (boundary === "ancestor") {
      await fs.mkdir(join(outside, "publisher"));
      await fs.symlink(outside, join(directory, "linked"), "dir");
      inputRoot = join(directory, "linked", "publisher");
    } else if (boundary === "releases") {
      await fs.symlink(outside, join(directory, "_releases"), "dir");
    } else {
      const first = await writeContentRelease(directory, releaseInput());
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const target = join(directory, "_releases", first.releases[0]!.manifest.targetId);
      if (boundary === "target") {
        await fs.rm(target, { recursive: true });
        await fs.symlink(outside, target, "dir");
      } else {
        await fs.unlink(join(target, "1.json"));
        await fs.writeFile(join(outside, "manifest.json"), "{}");
        await fs.symlink(join(outside, "manifest.json"), join(target, "1.json"));
      }
    }
    const before = await tree(outside);
    const result = await writeContentRelease(inputRoot, releaseInput());
    expect(result.ok).toBe(false);
    expect(await tree(outside)).toEqual(before);
  });
});
