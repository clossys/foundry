import { describe, expect, it } from "vitest";
import { detectLinkedHosts, parseHostRecord, serializeHostRecord } from "./hosts.js";
import type { WorkspaceHost } from "./types.js";

function fakeHost(dirs: Set<string>, symlinks: Set<string> = new Set()): WorkspaceHost {
  return {
    cwd: "/repo",
    env: {},
    isTTY: false,
    now: () => "2026-09-22T00:00:00.000Z",
    exists: (p) => dirs.has(p) || symlinks.has(p),
    isDirectory: (p) => dirs.has(p),
    isSymlink: (p) => symlinks.has(p),
    readText: () => null,
    writeText: () => {},
    mkdirp: () => {},
    symlink: () => {},
    remove: () => {},
    readDir: () => [],
    run: () => ({ status: 0, stdout: "", stderr: "" }),
    prompt: () => null,
  };
}

describe("detectLinkedHosts", () => {
  it("returns an empty array, never undefined, when nothing is linked", () => {
    expect(detectLinkedHosts(fakeHost(new Set()), "/repo")).toEqual([]);
  });

  it("detects claude-code and cursor independently via symlink presence", () => {
    const host = fakeHost(new Set(), new Set(["/repo/.claude/skills", "/repo/.cursor/skills"]));
    const linked = detectLinkedHosts(host, "/repo");
    expect(linked).toContain("claude-code");
    expect(linked).toContain("cursor");
    expect(linked).toHaveLength(2);
  });

  it("a plain directory (not a symlink) still counts as linked for claude-code/cursor", () => {
    const host = fakeHost(new Set(["/repo/.claude/skills"]));
    expect(detectLinkedHosts(host, "/repo")).toEqual(["claude-code"]);
  });

  it("detects codex by the presence of .agents/skills itself, not a separate discovery link", () => {
    const host = fakeHost(new Set(["/repo/.agents/skills"]));
    expect(detectLinkedHosts(host, "/repo")).toEqual(["codex"]);
  });

  it("all three can be detected together", () => {
    const host = fakeHost(new Set(["/repo/.agents/skills"]), new Set(["/repo/.claude/skills", "/repo/.cursor/skills"]));
    const linked = detectLinkedHosts(host, "/repo");
    expect(linked).toHaveLength(3);
  });
});

describe("serializeHostRecord / parseHostRecord round-trip", () => {
  it("ends with exactly one trailing newline, matching every other launcher-written JSON file", () => {
    const serialized = serializeHostRecord({ schemaVersion: 1, linkedHosts: ["claude-code"], recordedAt: "2026-09-22T00:00:00.000Z" });
    expect(serialized.endsWith("\n")).toBe(true);
    expect(serialized.endsWith("\n\n")).toBe(false);
  });

  it("round-trips exactly", () => {
    const record = { schemaVersion: 1 as const, linkedHosts: ["codex", "cursor"] as const, recordedAt: "2026-09-22T00:00:00.000Z" };
    const parsed = parseHostRecord(serializeHostRecord(record));
    expect(parsed).toEqual(record);
  });

  it("malformed or missing input is undefined, never a throw or a guessed default", () => {
    expect(parseHostRecord(null)).toBeUndefined();
    expect(parseHostRecord("not json")).toBeUndefined();
    expect(parseHostRecord('{"schemaVersion":2,"linkedHosts":[]}')).toBeUndefined();
  });

  it("filters out an unrecognized host id rather than trusting it", () => {
    const parsed = parseHostRecord('{"schemaVersion":1,"linkedHosts":["codex","some-future-host"],"recordedAt":"x"}');
    expect(parsed?.linkedHosts).toEqual(["codex"]);
  });
});
