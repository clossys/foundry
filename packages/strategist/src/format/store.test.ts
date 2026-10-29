import { afterEach, describe, expect, it } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readStrategyRoot } from "../store.js";

const fixture = fileURLToPath(new URL("../../test-fixtures/strategy-v2/example/", import.meta.url));
const temps: string[] = [];
afterEach(() => { for (const path of temps.splice(0)) rmSync(path, { recursive: true, force: true }); });
function copy() { const path = mkdtempSync(join(tmpdir(), "strategy-format-")); temps.push(path); cpSync(fixture, path, { recursive: true }); return path; }

describe("root reader", () => {
  it("reads typed documents and exact bytes without treating missing referenced records as syntax errors", () => {
    const model = readStrategyRoot(fixture);
    expect(model.issues).toEqual([]);
    expect(model.tree!.active["focus.segment.core"]).toBe(2);
    expect(model.cells).toHaveLength(1);
    expect(model.sessions[0]!.index.U9!.text).toBe("Yes, both.");
    expect(model.findings[0]!.value).toBe(11);
    expect(model.files["cells/focus.segment.core/v2.md"]).toBe(readFileSync(join(fixture, "cells/focus.segment.core/v2.md"), "utf8"));
  });
  it("reports invalid documents by root-relative path and physical line", () => {
    const root = copy();
    const path = "cells/focus.segment.core/v2.md";
    writeFileSync(join(root, path), readFileSync(join(root, path), "utf8").replace("- Who:", "Who:"));
    const model = readStrategyRoot(root);
    expect(model.cells).toHaveLength(0);
    expect(model.issues).toContainEqual(expect.objectContaining({ path, line: 14, reason: "invalid-format" }));
  });
  it("reports malformed tree JSON and missing root without throwing", () => {
    const root = copy(); writeFileSync(join(root, "tree.json"), "{\n broken\n");
    expect(readStrategyRoot(root).issues).toContainEqual(expect.objectContaining({ path: "tree.json", line: expect.any(Number), reason: "invalid-json" }));
    expect(readStrategyRoot(join(root, "absent")).issues).toContainEqual(expect.objectContaining({ path: ".", reason: "unreadable" }));
  });
  it("rejects filename/id and filename/version mismatches, unknown cells and unsafe path versions", () => {
    const root = copy();
    cpSync(join(root, "cells/focus.segment.core/v2.md"), join(root, "cells/focus.segment.core/v3.md"));
    cpSync(join(root, "cells/focus.segment.core/v2.md"), join(root, "cells/focus.segment.core/v9007199254740992.md"));
    mkdirSync(join(root, "cells/focus.segment.unknown"));
    cpSync(join(root, "cells/focus.segment.core/v2.md"), join(root, "cells/focus.segment.unknown/v2.md"));
    const model = readStrategyRoot(root);
    expect(model.cells).toHaveLength(1);
    expect(model.issues.length).toBeGreaterThanOrEqual(3);
  });
  it.each(["tree.json", "cells/focus.segment.core/v2.md", "sessions/2026-10-29-1.md", "findings/studio-interviews-2026-10.md"])("refuses a symlink file at %s", relative => {
    const root = copy(); const outside = mkdtempSync(join(tmpdir(), "strategy-outside-")); temps.push(outside);
    const target = join(outside, "secret.md"); writeFileSync(target, "PRIVATE SENTINEL");
    rmSync(join(root, relative)); symlinkSync(target, join(root, relative));
    const model = readStrategyRoot(root);
    expect(model.issues).toContainEqual(expect.objectContaining({ path: relative, reason: "outside-root" }));
    expect(Object.values(model.files).join("")).not.toContain("PRIVATE SENTINEL");
  });
  it.each(["cells", "cells/focus.segment.core", "sessions", "findings", "requests"])("refuses a symlink directory at %s", relative => {
    const root = copy(); const outside = mkdtempSync(join(tmpdir(), "strategy-outside-")); temps.push(outside);
    writeFileSync(join(outside, "unread.md"), "PRIVATE SENTINEL");
    rmSync(join(root, relative), { recursive: true, force: true }); symlinkSync(outside, join(root, relative));
    const model = readStrategyRoot(root);
    expect(model.issues).toContainEqual(expect.objectContaining({ path: relative, reason: "outside-root" }));
    expect(Object.values(model.files).join("")).not.toContain("PRIVATE SENTINEL");
  });
});
