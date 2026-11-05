import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { storeFault } from "@clossys/director";
import { directorStoreReader as reader } from "./slots.js";
import { directorStore, directorStoreWriter as writer } from "./slot-write.js";

/** The single reader and writer `clossys director …` injects into @clossys/director. */
let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "director-store-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));
const fault = (action: () => unknown) => { try { action(); } catch (error) { return storeFault(error); } return undefined; };

describe("director store reader", () => {
  it("reads confined files and sorted directories, and reports absence as undefined", () => {
    mkdirSync(join(root, "cells/b"), { recursive: true }); mkdirSync(join(root, "cells/a"));
    writeFileSync(join(root, "tree.json"), "{}");
    expect(reader.read(root, "tree.json")).toBe("{}");
    expect(reader.list(root, "cells")).toEqual(["a", "b"]);
    expect(reader.read(root, "absent.json")).toBeUndefined();
    expect(reader.list(root, "absent")).toBeUndefined();
    expect(reader.stat(root, "tree.json")).toMatchObject({ type: "file", links: 1 });
    expect(reader.stat(join(root, "missing"), ".")).toBeUndefined();
    expect(directorStore.reader).toBe(reader);
  });
  it("refuses traversal, symbolic links and the wrong entry type with a fault", () => {
    symlinkSync(tmpdir(), join(root, "linked")); mkdirSync(join(root, "directory")); writeFileSync(join(root, "file"), "x");
    expect(fault(() => reader.read(root, "../outside"))).toBe("outside");
    expect(fault(() => reader.read(root, "linked/tree.json"))).toBe("symlink");
    expect(fault(() => reader.read(root, "directory"))).toBe("not-file");
    expect(fault(() => reader.list(root, "file"))).toBe("not-directory");
    const link = join(mkdtempSync(join(tmpdir(), "director-store-link-")), "root");
    symlinkSync(root, link);
    expect(fault(() => reader.read(link, "file"))).toBe("root-symlink");
    expect(reader.stat(link, ".")).toMatchObject({ type: "symlink", real: realpathSync(root) });
    symlinkSync(join(root, "file"), join(root, "file-link"));
    expect(reader.stat(root, "file-link")).toMatchObject({ type: "symlink", real: join(realpathSync(root), "file-link") });
    expect(fault(() => reader.read(root, "file-link"))).toBe("symlink");
    expect(fault(() => reader.stat(root, "linked/tree.json"))).toBe("symlink");
    expect(fault(() => reader.read(join(root, "missing"), "file"))).toBe("root-unreadable");
  });
});

describe("director store writer", () => {
  it("refuses traversal, root replacement and symbolic links", () => {
    expect(() => writer.commit(root, [{ path: "../outside", after: "x" }])).toThrow("Write path escapes the strategy root");
    expect(() => writer.commit(root, [{ path: ".", after: "x" }])).toThrow("Write path escapes the strategy root");
    symlinkSync(tmpdir(), join(root, "linked"));
    expect(() => writer.commit(root, [{ path: "linked/tree.json", after: "x" }])).toThrow("Strategy writes refuse symbolic links");
    symlinkSync(join(root, "absent"), join(root, "dangling"));
    expect(() => writer.commit(root, [{ path: "dangling/tree.json", after: "x" }])).toThrow("Strategy writes refuse symbolic links");
  });
  it("refuses a non-file source", () => {
    mkdirSync(join(root, "directory"));
    expect(() => writer.commit(root, [{ path: "directory", before: "x", after: "y" }])).toThrow();
  });
  it("locks competing writers and releases after failure", () => {
    expect(() => writer.locked(root, () => writer.locked(root, () => {}))).toThrow("another write is in progress");
    expect(existsSync(join(root, ".director-write.lock"))).toBe(false);
    expect(writer.locked(root, () => 3)).toBe(3);
  });
  it("checks every source before mutation", () => {
    writeFileSync(join(root, "tree.json"), "changed");
    expect(() => writer.commit(root, [{ path: "new.json", after: "new" }, { path: "tree.json", before: "old", after: "updated" }])).toThrow("Strategy file changed during write: tree.json");
    expect(existsSync(join(root, "new.json"))).toBe(false); expect(readFileSync(join(root, "tree.json"), "utf8")).toBe("changed");
  });
  it("rolls back earlier writes when a later destination cannot commit", () => {
    writeFileSync(join(root, "tree.json"), "old"); writeFileSync(join(root, "blocked"), "file");
    expect(() => writer.commit(root, [{ path: "tree.json", before: "old", after: "new" }, { path: "blocked/child.json", after: "new" }])).toThrow();
    expect(readFileSync(join(root, "tree.json"), "utf8")).toBe("old");
  });
  it("refuses a duplicate path", () => {
    expect(() => writer.commit(root, [{ path: "a.json", after: "1" }, { path: "a.json", after: "2" }])).toThrow("Duplicate transaction path");
  });
  it("replaces a generated file in place, creating its directory, with the requested mode", () => {
    writer.replace(root, "reports/coherence.json", "{}\n", { mode: 0o600 });
    expect(readFileSync(join(root, "reports/coherence.json"), "utf8")).toBe("{}\n");
    expect(statSync(join(root, "reports/coherence.json")).mode & 0o777).toBe(0o600);
    writer.replace(root, "reports/coherence.json", "[]\n");
    expect(readFileSync(join(root, "reports/coherence.json"), "utf8")).toBe("[]\n");
  });
  it("refuses a hard-linked or symbolic generated destination", () => {
    mkdirSync(join(root, "reports")); writeFileSync(join(root, "outside.json"), "keep");
    linkSync(join(root, "outside.json"), join(root, "reports/completion.json"));
    expect(() => writer.replace(root, "reports/completion.json", "x")).toThrow("Report destination must be a regular file");
    symlinkSync(join(root, "outside.json"), join(root, "reports/coherence.json"));
    expect(() => writer.replace(root, "reports/coherence.json", "x")).toThrow();
    expect(readFileSync(join(root, "outside.json"), "utf8")).toBe("keep");
  });
});
