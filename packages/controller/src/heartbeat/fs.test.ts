import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeHeartbeatForRepo, loadLoopStates, writeHeartbeatDigest } from "./fs.js";

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "heartbeat-fs-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(relativePath: string, content: unknown): void {
  const full = join(root, relativePath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, typeof content === "string" ? content : JSON.stringify(content));
}

const VALID_STATE = { schemaVersion: 1, role: "advisor", capabilities: {} };

describe("loadLoopStates", () => {
  it("returns nothing when clossys/ does not exist", () => {
    expect(loadLoopStates(root)).toEqual({ roles: {}, unreadable: [] });
  });

  it("loads a valid loop.json per role directory, skipping a role with none", () => {
    write("clossys/advisor/loop.json", VALID_STATE);
    write("clossys/strategist/facts.json", { x: 1 }); // no loop.json here
    const { roles, unreadable } = loadLoopStates(root);
    expect(Object.keys(roles)).toEqual(["advisor"]);
    expect(unreadable).toEqual([]);
  });

  it("reports unparseable JSON as unreadable rather than throwing", () => {
    write("clossys/advisor/loop.json", "{ not json");
    const { roles, unreadable } = loadLoopStates(root);
    expect(roles).toEqual({});
    expect(unreadable).toEqual([{ path: "clossys/advisor/loop.json", reason: expect.stringContaining("could not parse JSON") }]);
  });

  it("reports a well-formed-JSON-but-invalid loop.json as unreadable", () => {
    write("clossys/advisor/loop.json", { schemaVersion: 2, role: "advisor", capabilities: {} });
    const { roles, unreadable } = loadLoopStates(root);
    expect(roles).toEqual({});
    expect(unreadable[0]!.reason).toContain("does not validate");
  });

  it("skips clossys/.state", () => {
    write("clossys/.state/loop.json", VALID_STATE);
    expect(loadLoopStates(root).roles).toEqual({});
  });
});

describe("computeHeartbeatForRepo / writeHeartbeatDigest", () => {
  it("computes without writing anything to disk", () => {
    write("clossys/advisor/loop.json", VALID_STATE);
    const { digest, unreadable } = computeHeartbeatForRepo(root);
    expect(unreadable).toEqual([]);
    expect(digest.entries).toEqual([]);
    expect(existsSync(join(root, "clossys/.state"))).toBe(false);
  });

  it("writeHeartbeatDigest writes the rendered digest to clossys/.state/decisions-waiting-for-you.md", () => {
    write("clossys/advisor/loop.json", VALID_STATE);
    const { digest } = computeHeartbeatForRepo(root);
    const path = writeHeartbeatDigest(root, digest, new Date("2026-09-23T12:00:00Z"));
    expect(path).toBe("clossys/.state/decisions-waiting-for-you.md");
    const written = readFileSync(join(root, path), "utf8");
    expect(written).toContain("Decisions waiting for you");
    expect(written).toContain("Nothing is waiting on you right now.");
  });
});
