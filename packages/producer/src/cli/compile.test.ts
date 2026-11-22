import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "./main.js";
import { COMPILE_USAGE } from "./compile.js";
import { loadSchema, validateValue } from "../pipeline/schema.js";

/**
 * A consumer store shaped like the recut product snapshot: its Publisher IA places one page (`page.home` under
 * site/site-pages, clossys.slot/2, kind page, refs to a frame and three sections) and no publication, and the
 * Studio publication is not placed. `publications` adds placed publication slot ids to the same group.
 */
function snapshotStore(publications: string[] = []): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "compile-consumer-")));
  const publisher = join(root, "clossys", "agents", "publisher");
  mkdirSync(join(publisher, "page.home"), { recursive: true });
  writeFileSync(join(root, "clossys", "clossys.config.ts"), "export default {};\n");
  writeFileSync(join(publisher, "ia.json"), `${JSON.stringify({
    schema: "clossys.ia/1", source: "consumer#agents/publisher/tree.json", extensions: [],
    nodes: [{ id: "site", label: "Site", children: [{ id: "site-pages", label: "Pages", slots: ["page.home", ...publications] }] }],
  }, null, 2)}\n`);
  writeFileSync(join(publisher, "page.home", "slot.json"), `${JSON.stringify({
    schema: "clossys.slot/2", id: "page.home", agent: "publisher", kind: "page", status: "starter",
    ia: { l0: "page", l1: "page/site", l2: "page/site/site-pages", order: 0 },
    createdBy: { actor: "code", cli: "clossys migrate slot-1-to-2", version: "0.1.0" }, createdAt: "2026-11-17T06:47:33Z",
    refs: ["designer/frames.site-shell", "designer/sections.hero", "designer/sections.content", "designer/sections.call-to-action"].map(to => ({ to, rel: "uses" })),
    base: null, standard: "page",
    brief: { purpose: "Fill publisher/page.home to the page standard.", mustDo: [], inputs: [], acceptance: [] },
    contract: { kind: "page", route: "/", frame: "required", sections: "ordered" }, tighten: [],
  }, null, 2)}\n`);
  roots.push(root);
  return root;
}
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));

describe("clossys compile", () => {
  it("prints its own usage and refuses unknown or valueless flags", async () => {
    await expect(runCli(["compile", "--help"])).resolves.toMatchObject({ exitCode: 0, message: COMPILE_USAGE });
    await expect(runCli(["compile", "--model", "x"])).resolves.toMatchObject({ exitCode: 2, message: expect.stringContaining("Unknown compile argument: --model") });
    await expect(runCli(["compile", "--out"])).resolves.toMatchObject({ exitCode: 2, message: expect.stringContaining("--out needs a directory") });
  });

  it("skips the Studio on a consumer that does not place it, and with no publication placed exits 1 naming the seating step", async () => {
    const root = snapshotStore();
    const result = await runCli(["compile", "--root", root]);
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("the Studio is not placed, so it is skipped");
    expect(result.message).toContain("compile.no-publication: publisher/ia.json:");
    expect(result.message).toContain("clossys ia publisher/publication.<id> --under <l1>/<l2>");
    const out = join(root, "clossys", ".state", "generated");
    // Nothing of the Studio compile: no generated/ or app/ tree, only this compile's own files.
    expect(existsSync(join(out, "generated"))).toBe(false);
    expect(existsSync(join(out, "app"))).toBe(false);
    expect(readJson(join(out, "publications.json"))).toEqual({ schema: "clossys.compiled-publications/1", publications: [] });
    const lock = readJson(join(out, "compile.lock.json"));
    const ia = readFileSync(join(root, "clossys", "agents", "publisher", "ia.json"), "utf8");
    expect(lock).toMatchObject({ schema: "clossys.compile-lock/1", decisionInputs: ["clossys/agents/publisher/ia.json"] });
    expect(lock.inputs).toEqual([{ path: "clossys/agents/publisher/ia.json", sha256: createHash("sha256").update(ia).digest("hex") }]);
    expect(lock.outputs.map((row: { path: string }) => row.path)).toEqual(["publications.json"]);
    expect(lock.pinSetHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("writes a lock the compile-lock port schema accepts, and that schema requires the pinSetHash R12.1 reads", async () => {
    const root = snapshotStore();
    await runCli(["compile", "--root", root]);
    const lock = readJson(join(root, "clossys", ".state", "generated", "compile.lock.json"));
    const schema = loadSchema("compile-lock");
    expect(validateValue(lock, schema)).toEqual([]);
    const { pinSetHash: _dropped, ...unhashed } = lock;
    expect(validateValue(unhashed, schema).map(issue => issue.message).join("; ")).toMatch(/pinSetHash/);
    expect(validateValue({ ...lock, pinSetHash: "not-a-hash" }, schema)).not.toEqual([]);
  });

  it("records a placed publication with no pin as unresolved, not a finding, and exits 0", async () => {
    const root = snapshotStore(["publication.site"]);
    const out = join(root, "out");
    const result = await runCli(["compile", "--root", root, "--out", out]);
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("unresolved publisher/publication.site: publisher/publication.site has no pin yet");
    expect(readJson(join(out, "publications.json")).publications).toEqual([
      { id: "site", slot: "publisher/publication.site", state: "unresolved", reason: "publisher/publication.site has no pin yet; pins.resolve judges it at release" },
    ]);
    expect(existsSync(join(root, "clossys/.state"))).toBe(false);
  });

  it("records lock outputs relative to --out, also when --out is outside the root", async () => {
    const root = snapshotStore(["publication.site"]);
    const out = join(realpathSync(mkdtempSync(join(tmpdir(), "compile-out-"))), "site");
    roots.push(join(out, ".."));
    expect((await runCli(["compile", "--root", root, "--out", out])).exitCode).toBe(0);
    const text = readFileSync(join(out, "publications.json"), "utf8");
    expect(readJson(join(out, "compile.lock.json")).outputs).toEqual([{ path: "publications.json", sha256: createHash("sha256").update(text).digest("hex") }]);
  });

  it("skips a retired publication slot: neither listed as unresolved nor hiding compile.no-publication", async () => {
    const root = snapshotStore(["publication.old"]);
    const slot = join(root, "clossys", "agents", "publisher", "publication.old");
    mkdirSync(slot, { recursive: true });
    writeFileSync(join(slot, "slot.json"), `${JSON.stringify({ schema: "clossys.slot/2", id: "publication.old", agent: "publisher", kind: "publication", status: "retired" })}\n`);
    const result = await runCli(["compile", "--root", root]);
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("compile.no-publication: publisher/ia.json:");
    expect(result.message).not.toContain("publication.old");
    expect(readJson(join(root, "clossys", ".state", "generated", "publications.json")).publications).toEqual([]);
  });
});

describe("clossys compile --out deletes only what a previous compile recorded", () => {
  const userFile = (dir: string, name = "user-essay.md") => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, name), "my own words\n"); return join(dir, name); };

  it("refuses, deleting and writing nothing, when <out>/publications exists and no prior lock lists it (--out = root)", async () => {
    const root = snapshotStore(["publication.site"]);
    const essay = userFile(join(root, "publications"));
    const result = await runCli(["compile", "--root", root, "--out", root]);
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("compile.out-unowned:");
    expect(result.message).toContain("publications/user-essay.md");
    expect(readFileSync(essay, "utf8")).toBe("my own words\n");
    expect(existsSync(join(root, "compile.lock.json"))).toBe(false);
    expect(existsSync(join(root, "publications.json"))).toBe(false);
  });

  it("keeps a user file added next to a prior compile's projections and refuses rather than delete it", async () => {
    const root = snapshotStore(["publication.site"]);
    const out = join(root, "out");
    expect((await runCli(["compile", "--root", root, "--out", out])).exitCode).toBe(0);
    const lockBefore = readFileSync(join(out, "compile.lock.json"), "utf8");
    const essay = userFile(join(out, "publications"), "notes.json");
    const result = await runCli(["compile", "--root", root, "--out", out]);
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("compile.out-unowned:");
    expect(readFileSync(essay, "utf8")).toBe("my own words\n");
    expect(readFileSync(join(out, "compile.lock.json"), "utf8")).toBe(lockBefore);
  });

  it("clears the projections a prior compile recorded, and only those", async () => {
    const root = snapshotStore(["publication.site"]);
    const out = join(root, "out");
    expect((await runCli(["compile", "--root", root, "--out", out])).exitCode).toBe(0);
    // A projection the previous compile wrote and recorded (as a pinned publication would), now left the IA.
    const stale = "{\"publicationId\":\"gone\"}\n";
    writeFileSync(join(out, "publications", "gone.json"), stale);
    const lockFile = join(out, "compile.lock.json");
    const lock = readJson(lockFile);
    lock.outputs.push({ path: "publications/gone.json", sha256: createHash("sha256").update(stale).digest("hex") });
    writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
    const result = await runCli(["compile", "--root", root, "--out", out]);
    expect(result.exitCode).toBe(0);
    expect(readdirSync(join(out, "publications"))).toEqual([]);
    expect(readJson(lockFile).outputs.map((row: { path: string }) => row.path)).toEqual(["publications.json"]);
  });

  it("refuses to delete a recorded projection whose bytes changed since that compile", async () => {
    const root = snapshotStore(["publication.site"]);
    const out = join(root, "out");
    expect((await runCli(["compile", "--root", root, "--out", out])).exitCode).toBe(0);
    const lockFile = join(out, "compile.lock.json");
    const lock = readJson(lockFile);
    lock.outputs.push({ path: "publications/gone.json", sha256: createHash("sha256").update("as compiled\n").digest("hex") });
    writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
    writeFileSync(join(out, "publications", "gone.json"), "edited by hand\n");
    expect((await runCli(["compile", "--root", root, "--out", out])).exitCode).toBe(1);
    expect(readFileSync(join(out, "publications", "gone.json"), "utf8")).toBe("edited by hand\n");
  });

  it("is safe through a symlinked --out and a symlinked <out>/publications: nothing outside is deleted", async () => {
    const root = snapshotStore(["publication.site"]);
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "compile-elsewhere-")));
    roots.push(elsewhere);
    const essay = userFile(join(elsewhere, "publications"));
    symlinkSync(elsewhere, join(root, "out-link"));
    const viaLink = await runCli(["compile", "--root", root, "--out", join(root, "out-link")]);
    expect(viaLink.exitCode).toBe(1);
    expect(viaLink.message).toContain("compile.out-unowned:");
    expect(readFileSync(essay, "utf8")).toBe("my own words\n");
    expect(existsSync(join(elsewhere, "compile.lock.json"))).toBe(false);

    // A real --out whose publications/ is a link out: a lock that even records the target's file does not reach it.
    const out = join(root, "out");
    expect((await runCli(["compile", "--root", root, "--out", out])).exitCode).toBe(0);
    rmSync(join(out, "publications"), { recursive: true });
    const keep = userFile(join(elsewhere, "linked"), "keep.json");
    symlinkSync(join(elsewhere, "linked"), join(out, "publications"));
    const lockFile = join(out, "compile.lock.json");
    const lock = readJson(lockFile);
    lock.outputs.push({ path: "publications/keep.json", sha256: createHash("sha256").update("my own words\n").digest("hex") });
    writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
    const linked = await runCli(["compile", "--root", root, "--out", out]);
    expect(linked.exitCode).toBe(1);
    expect(linked.message).toContain("compile.out-unowned:");
    expect(readFileSync(essay, "utf8")).toBe("my own words\n");
    expect(readFileSync(keep, "utf8")).toBe("my own words\n");
  });
});
