/**
 * R-NO-HIDDEN-FALLBACKS for the install next/image define and the compile `<out>` reads: only an
 * absent module or path is tolerated, and every other failure is thrown, not read as "no Next" or
 * "no file".
 */
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transformSync } from "esbuild";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compilePublications } from "./compile-publications.js";
import { NEXT_IMAGE_VITE_DEFINE, nextImageDefine } from "./install.js";

let dir: string;
const locked: string[] = [];
const lock = (path: string) => { chmodSync(path, 0o000); locked.push(path); };
beforeEach(() => { dir = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "absent-only-"))); });
afterEach(() => {
  for (const path of locked.splice(0)) chmodSync(path, 0o755);
  rmSync(dir, { recursive: true, force: true });
});

/** A substrate whose installed `next` image config module is `source`. */
function substrateWithNext(source: string): string {
  const substrate = join(dir, "substrate");
  const lib = join(substrate, "node_modules", "next", "dist", "shared", "lib");
  mkdirSync(lib, { recursive: true });
  writeFileSync(join(substrate, "package.json"), "{}\n");
  writeFileSync(join(substrate, "node_modules", "next", "package.json"), '{ "name": "next", "version": "0.0.0" }\n');
  writeFileSync(join(lib, "image-config.js"), source);
  return substrate;
}

describe("nextImageDefine (static render)", () => {
  it("is empty when the substrate has no next", () => {
    const substrate = join(dir, "bare");
    mkdirSync(substrate);
    writeFileSync(join(substrate, "package.json"), "{}\n");
    expect(nextImageDefine(substrate)).toEqual({});
  });
  it("defines next's default image config, unoptimized", () => {
    const substrate = substrateWithNext('exports.imageConfigDefault = { path: "/_next/image" };\n');
    expect(JSON.parse(nextImageDefine(substrate)["process.env.__NEXT_IMAGE_OPTS"]!)).toEqual({ path: "/_next/image", unoptimized: true });
  });
  it("throws when next is installed but its image config fails to load", () => {
    const substrate = substrateWithNext('throw new Error("image-config is broken");\n');
    expect(() => nextImageDefine(substrate)).toThrow("image-config is broken");
  });
});

describe("NEXT_IMAGE_VITE_DEFINE (the substrate Vite config)", () => {
  /** The generated helper, compiled and loaded from `substrate` (it resolves next from its own file). */
  async function generated(substrate: string): Promise<() => Record<string, string>> {
    const { code } = transformSync(`${NEXT_IMAGE_VITE_DEFINE}\nexport { nextImageDefine };\n`, { loader: "ts", format: "esm" });
    const file = join(substrate, `define-${locked.length}-${Date.now()}.mjs`);
    writeFileSync(file, code);
    return ((await import(pathToFileURL(file).href)) as { nextImageDefine: () => Record<string, string> }).nextImageDefine;
  }
  it("is empty when the substrate has no next", async () => {
    const substrate = join(dir, "bare");
    mkdirSync(substrate);
    expect((await generated(substrate))()).toEqual({});
  });
  it("throws when next is installed but its image config fails to load", async () => {
    const substrate = substrateWithNext('throw new Error("image-config is broken");\n');
    const define = await generated(substrate);
    expect(() => define()).toThrow("image-config is broken");
  });
});

describe("compilePublications <out> reads", () => {
  it("throws an lstat failure under <out> other than absent", async () => {
    const out = join(dir, "out");
    mkdirSync(out);
    lock(out);
    await expect(compilePublications(dir, out)).rejects.toMatchObject({ code: "EACCES", syscall: "lstat" });
  });
  it("throws when the prior compile lock cannot be read", async () => {
    const out = join(dir, "out");
    mkdirSync(out);
    writeFileSync(join(out, "compile.lock.json"), "{}\n");
    lock(join(out, "compile.lock.json"));
    await expect(compilePublications(dir, out)).rejects.toMatchObject({ code: "EACCES", syscall: "open" });
  });
  it("still refuses a prior lock that is not JSON as compile.out-unowned", async () => {
    const out = join(dir, "out");
    mkdirSync(out);
    writeFileSync(join(out, "compile.lock.json"), "{ not json");
    const result = await compilePublications(dir, out);
    expect(result.written).toBe(false);
    expect(result.findings.map(finding => finding.check)).toContain("compile.out-unowned");
  });
});
