// The pinned-world seeder's own guards (B1-FOLLOW): the --out guard never replaces a folder the seeder did not
// write (checked at the start and again right before the delete), the unpinned base comes from one named file and
// must be an ancestor of HEAD, and a programmatic resume continues only a root the seeder kept, keeping its .git.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BASE, BASE_FILE, FIXTURE, MARK, assertBaseAncestor, extractBase, replaceOut, seed, treeFiles } from "../../scripts/seed-pinned-world.mjs";

const SCRIPT = fileURLToPath(new URL("../../scripts/seed-pinned-world.mjs", import.meta.url));
const DRIFT_TEST = fileURLToPath(new URL("./pinned-world.test.ts", import.meta.url));

let scratch: string;
beforeEach(() => { scratch = realpathSync(mkdtempSync(join(tmpdir(), "seed-guard-"))); });
afterEach(() => { if (scratch) rmSync(scratch, { recursive: true, force: true }); });

/** Every file under `dir` (or `dir` itself when it is a file) with its bytes, for a byte-identical comparison. */
function snapshot(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  try { readdirSync(path); } catch { return { ".": readFileSync(path).toString("base64") }; }
  return Object.fromEntries(treeFiles(path).map((file: string) => [file, readFileSync(join(path, file)).toString("base64")]));
}

/** Runs the seeder CLI with `--out <out>`; every case here is refused before any seeding starts. */
const cli = (out: string) => spawnSync(process.execPath, [SCRIPT, "--out", out], { cwd: scratch, encoding: "utf8", timeout: 60_000 });

describe("the seeder's --out guard", () => {
  it("refuses a non-empty folder without the seeder mark, exits 1 and leaves its files byte-identical", () => {
    const out = join(scratch, "out");
    mkdirSync(join(out, "nested"), { recursive: true });
    writeFileSync(join(out, "notes.txt"), "the user's own notes\n");
    writeFileSync(join(out, "nested", "data.bin"), Buffer.from([0, 1, 2, 254, 255]));
    const before = snapshot(out);
    const result = cli(out);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`is not empty and holds no ${MARK}`);
    expect(snapshot(out)).toEqual(before);
    expect(existsSync(`${out}.seeding`)).toBe(false);
  });

  it("refuses a leftover .seeding folder, exits 1 and leaves both trees byte-identical", () => {
    const out = join(scratch, "out");
    mkdirSync(out);
    writeFileSync(join(out, MARK), "written by scripts/seed-pinned-world.mjs\n");
    writeFileSync(join(out, "kept.txt"), "kept\n");
    mkdirSync(`${out}.seeding`);
    writeFileSync(join(`${out}.seeding`, "partial.json"), "{}\n");
    const before = [snapshot(out), snapshot(`${out}.seeding`)];
    const result = cli(out);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("a previous run stopped there");
    expect([snapshot(out), snapshot(`${out}.seeding`)]).toEqual(before);
  });

  it("refuses a plain file, exits 1 and leaves it byte-identical", () => {
    const out = join(scratch, "out.txt");
    writeFileSync(out, "a plain file, not a folder\n");
    const before = snapshot(out);
    const result = cli(out);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("is not a folder");
    expect(snapshot(out)).toEqual(before);
    expect(existsSync(`${out}.seeding`)).toBe(false);
  });

  it("checks the mark again right before it deletes: a folder that lost its mark during the run is kept", () => {
    const out = join(scratch, "out"), next = join(scratch, "out.seeding");
    mkdirSync(out);
    writeFileSync(join(out, "notes.txt"), "written after the run began\n");
    mkdirSync(next);
    writeFileSync(join(next, "pin.json"), "{}\n");
    const before = [snapshot(out), snapshot(next)];
    expect(() => replaceOut(out, next)).toThrow(`is not empty and holds no ${MARK}`);
    expect([snapshot(out), snapshot(next)]).toEqual(before);
  });

  it("replaces a marked folder with the pinned tree, marks it and removes the .seeding folder", () => {
    const out = join(scratch, "out"), next = join(scratch, "out.seeding");
    mkdirSync(out);
    writeFileSync(join(out, MARK), "written by scripts/seed-pinned-world.mjs\n");
    writeFileSync(join(out, "stale.json"), "{}\n");
    mkdirSync(next);
    writeFileSync(join(next, "pin.json"), "{\"fresh\":true}\n");
    replaceOut(out, next);
    expect(treeFiles(out)).toEqual([MARK, "pin.json"]);
    expect(existsSync(next)).toBe(false);
  });
});

describe("the unpinned base", () => {
  it("is named once, in the base file the seeder and the drift test both read; neither source names a commit", () => {
    expect(BASE).toEqual(JSON.parse(readFileSync(BASE_FILE, "utf8")));
    for (const file of [SCRIPT, DRIFT_TEST]) {
      const text = readFileSync(file, "utf8");
      expect(text.match(/\b[0-9a-f]{40}\b/g) ?? [], file).toEqual([]);
      expect(text, file).toContain("BASE");
    }
    expect(readFileSync(DRIFT_TEST, "utf8")).toContain("BASE_FILE");
  });

  describe("ancestry", () => {
    let repo: string, onLine: string, offLine: string;
    beforeEach(() => {
      repo = join(scratch, "repo");
      mkdirSync(repo);
      const git = (...args: string[]) => execFileSync("git", ["-C", repo, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" }).trim();
      git("init", "-q", "-b", "line");
      mkdirSync(join(repo, "base"));
      writeFileSync(join(repo, "base", "slot.json"), "{}\n");
      git("add", "base");
      git("commit", "-q", "-m", "on the line");
      onLine = git("rev-parse", "HEAD");
      git("checkout", "-q", "-b", "elsewhere");
      writeFileSync(join(repo, "base", "slot.json"), "{\"elsewhere\":true}\n");
      git("commit", "-q", "-am", "off the line");
      offLine = git("rev-parse", "HEAD");
      git("checkout", "-q", "line");
    });

    it("refuses a base commit that is not an ancestor of HEAD, with a clear message, and extracts nothing", () => {
      expect(() => assertBaseAncestor(repo, offLine)).toThrow(`the unpinned base ${offLine}`);
      expect(() => assertBaseAncestor(repo, offLine)).toThrow("is not an ancestor of HEAD");
      const dir = join(scratch, "extract");
      expect(() => extractBase(dir, { repo, base: { commit: offLine, path: "base" } })).toThrow("is not an ancestor of HEAD");
      expect(readdirSync(dir)).toEqual([]);
    });

    it("extracts a base commit on the line", () => {
      expect(() => assertBaseAncestor(repo, onLine)).not.toThrow();
      const dir = join(scratch, "extract");
      extractBase(dir, { repo, base: { commit: onLine, path: "base" } });
      expect(readdirSync(dir)).toEqual(["slot.json"]);
    });
  });
});

describe("a programmatic resume", () => {
  it("is refused unless the root holds the seeder mark, and leaves the root and its .git as they were", async () => {
    const root = join(scratch, "root");
    mkdirSync(root);
    execFileSync("git", ["init", "-q"], { cwd: root });
    writeFileSync(join(root, "notes.txt"), "not a seeded root\n");
    const before = snapshot(root);
    await expect(seed({ resume: root })).rejects.toThrow(`holds no ${MARK}`);
    expect(snapshot(root)).toEqual(before);
    expect(existsSync(join(root, ".git", "HEAD"))).toBe(true);
  });

  it("keeps the .git a marked root holds", async () => {
    const root = join(scratch, "root");
    cpSync(FIXTURE, root, { recursive: true });
    writeFileSync(join(root, MARK), "written by scripts/seed-pinned-world.mjs\n");
    execFileSync("git", ["init", "-q"], { cwd: root });
    writeFileSync(join(root, ".git", "kept-by-resume"), "the root's own repository\n");
    const result = await seed({ resume: root, keep: true });
    expect(result.root).toBe(resolve(realpathSync(root)));
    expect(readFileSync(join(root, ".git", "kept-by-resume"), "utf8")).toBe("the root's own repository\n");
  }, 300_000);
});
