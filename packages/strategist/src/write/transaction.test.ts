import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { commitChanges, metadata, readBytes, safePath, withWriteLock } from "./transaction.js";
let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "strategy-transaction-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));
describe("root-scoped writes", () => {
  it("refuses traversal, root replacement and symbolic links", () => {
    expect(() => safePath(root, "../outside")).toThrow(); expect(() => safePath(root, ".")).toThrow();
    symlinkSync(tmpdir(), join(root, "linked")); expect(() => safePath(root, "linked/tree.json")).toThrow();
    symlinkSync(join(root, "absent"), join(root, "dangling")); expect(() => safePath(root, "dangling/tree.json")).toThrow();
  });
  it("refuses non-file reads", () => {
    mkdirSync(join(root, "directory")); expect(() => readBytes(root, "directory")).toThrow();
  });
  it("locks competing writers and releases after failure", () => {
    expect(() => withWriteLock(root, () => withWriteLock(root, () => {}))).toThrow();
    expect(existsSync(join(root, ".strategist-write.lock"))).toBe(false);
    expect(withWriteLock(root, () => 3)).toBe(3);
  });
  it("checks every source before mutation", () => {
    writeFileSync(join(root, "tree.json"), "changed");
    expect(() => commitChanges(root, [{ path: "new.json", after: "new" }, { path: "tree.json", before: "old", after: "updated" }])).toThrow();
    expect(existsSync(join(root, "new.json"))).toBe(false); expect(readFileSync(join(root, "tree.json"), "utf8")).toBe("changed");
  });
  it("rolls back earlier writes when a later destination cannot commit", () => {
    writeFileSync(join(root, "tree.json"), "old"); writeFileSync(join(root, "blocked"), "file");
    expect(() => commitChanges(root, [{ path: "tree.json", before: "old", after: "new" }, { path: "blocked/child.json", after: "new" }])).toThrow();
    expect(readFileSync(join(root, "tree.json"), "utf8")).toBe("old");
  });
  it("changes frontmatter alone and preserves CRLF body bytes", () => {
    const bytes = "---\r\nid: focus.segment.core\r\nstatus: draft\r\n---\r\n\r\n## Direction\r\n- status: draft\r\n";
    expect(metadata(bytes, { status: "active", confirmed: "msg:2026-10-29-1#U3" })).toBe(bytes.replace("status: draft\r\n---", "status: active\r\nconfirmed: msg:2026-10-29-1#U3\r\n---"));
  });
});
