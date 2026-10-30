import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runWriteCli } from "./cli.js";
import { main } from "../cli.js";
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "strategy-write-cli-"));
  writeFileSync(join(root, "tree.json"), JSON.stringify({schemaVersion: 1, catalog: "@clossys/strategist#strategy-v1", archetype: "default", core: "archetype", active: {}}));
  vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { rmSync(root, {recursive: true, force: true}); vi.restoreAllMocks(); });
it("delegates other units' commands", () => expect(runWriteCli(["status"])).toBeUndefined());
it("dispatches write commands through the actual CLI entry point", () => {
  expect(main(["propose", "focus.segment.core", "--root", root, "--json"])).toBe(0);
  expect(readFileSync(join(root, "cells/focus.segment.core/v1.md"), "utf8")).toContain("status: draft");
  expect(main(["request", "list", "--root", root, "--json"])).toBe(0);
  expect(JSON.parse(vi.mocked(console.log).mock.calls.at(-1)![0])).toEqual([]);
  expect(main(["activate", "focus.segment.core@1", "--root", root, "--force", "--json"])).toBe(2);
});
it("honors --root and --json for proposal and requests", () => {
  expect(runWriteCli(["propose", "focus.segment.core", "--root", root, "--option", "A", "--json"])).toBe(0);
  expect(JSON.parse(vi.mocked(console.log).mock.calls.at(-1)![0]).version).toBe(1);
  expect(readFileSync(join(root, "cells/focus.segment.core/v1.md"), "utf8")).toContain("note: option A");
  expect(runWriteCli(["request", "new", "--root", root, "--raised-by", "researcher", "--kind", "change", "--cells", "focus.segment.core", "--detail", "Clarify segment", "--json"])).toBe(0);
  expect(runWriteCli(["request", "list", "--root", root, "--json"])).toBe(0);
  expect(JSON.parse(vi.mocked(console.log).mock.calls.at(-1)![0])[0].status).toBe("open");
});
it.each([
  ["activate", "focus.segment.core@1", "--force"],
  ["activate", "focus.segment.core@1"],
  ["propose", "focus.segment.core", "--from", "NaN"],
  ["propose", "focus.segment.core", "--confirm", "msg:2026-10-29-1#U3"],
  ["request", "resolve", "REQ-0001"],
  ["request", "list", "--confirm", "msg:2026-10-29-1#U3"],
])("rejects unsafe or invalid arguments %j", (...args) => expect(runWriteCli([...args, "--root", root, "--json"])).toBe(2));
