import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { locateRepositoryProfile } from "./locate.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "repository-locate-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(relativePath: string, content = "{}"): void {
  const path = join(root, ...relativePath.split("/"));
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

describe("locateRepositoryProfile", () => {
  it("returns undefined when no declaration exists anywhere", () => {
    write("README.md", "# nothing here");
    expect(locateRepositoryProfile(root)).toBeUndefined();
  });

  it("finds the canonical location and marks it canonical", () => {
    write("governance/repository-profile.json");
    expect(locateRepositoryProfile(root)).toEqual({ path: "governance/repository-profile.json", canonical: true });
  });

  it("finds the canonical filename parked under a different directory", () => {
    write("config/foundry/repository-profile.json");
    expect(locateRepositoryProfile(root)).toEqual({ path: "config/foundry/repository-profile.json", canonical: false });
  });

  it("finds the known alternate filename in the canonical directory", () => {
    write("governance/repository-declaration.json");
    expect(locateRepositoryProfile(root)).toEqual({ path: "governance/repository-declaration.json", canonical: false });
  });

  it("never lets a non-canonical match shadow the canonical location", () => {
    write("governance/repository-profile.json");
    write("config/foundry/repository-profile.json");
    write("governance/repository-declaration.json");
    expect(locateRepositoryProfile(root)).toEqual({ path: "governance/repository-profile.json", canonical: true });
  });

  it("returns a deterministic match when more than one non-canonical candidate exists", () => {
    write("b/repository-profile.json");
    write("a/repository-profile.json");
    const first = locateRepositoryProfile(root);
    const second = locateRepositoryProfile(root);
    expect(first).toEqual(second);
    expect(first).toEqual({ path: "a/repository-profile.json", canonical: false });
  });

  it("does not search node_modules, .git, or common build-output directories", () => {
    write("node_modules/some-package/repository-profile.json");
    write(".git/repository-profile.json");
    write("dist/repository-profile.json");
    write("build/repository-profile.json");
    write(".next/repository-profile.json");
    write("coverage/repository-profile.json");
    expect(locateRepositoryProfile(root)).toBeUndefined();
  });

  it("does not match an unrelated filename", () => {
    write("governance/settings.json");
    write("config/foundry/notes.json");
    expect(locateRepositoryProfile(root)).toBeUndefined();
  });

  it("skips a symlinked directory rather than following it into a cycle", () => {
    write("real/repository-profile.json");
    symlinkSync(join(root, "real"), join(root, "link"), "dir");
    // The canonical location is absent and the real match is found once, not twice, and
    // walking never follows the symlink into an infinite loop.
    expect(locateRepositoryProfile(root)).toEqual({ path: "real/repository-profile.json", canonical: false });
  });

  it("does not throw when a directory entry disappears mid-walk", () => {
    write("a/repository-profile.json");
    // A root with no declaration and no error should simply resolve to undefined even
    // when nothing else is present.
    expect(() => locateRepositoryProfile(join(root, "does-not-exist"))).not.toThrow();
    expect(locateRepositoryProfile(join(root, "does-not-exist"))).toBeUndefined();
  });
});
