import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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


describe("agent loop layout", () => {
  it("skips an agents container that is a file or symbolic link", () => {
    write("clossys/agents", "not a directory");
    expect(loadLoopStates(root)).toEqual({ roles: {}, unreadable: [] });
    rmSync(join(root, "clossys/agents"));
    write("elsewhere/writer/loop.json", { ...VALID_STATE, role: "writer" });
    symlinkSync(join(root, "elsewhere"), join(root, "clossys/agents"), "dir");
    expect(loadLoopStates(root)).toEqual({ roles: {}, unreadable: [] });
  });

  it("loads all four nested agents alongside unchanged non-agent roles, ignoring legacy and unknown nested paths", () => {
    for (const agent of ["director", "designer", "writer", "publisher"]) {
      write(`clossys/agents/${agent}/loop.json`, { ...VALID_STATE, role: agent });
      write(`clossys/${agent}/loop.json`, "legacy must be ignored");
    }
    write("clossys/advisor/loop.json", VALID_STATE);
    write("clossys/strategist/loop.json", { ...VALID_STATE, role: "strategist" });
    write("clossys/agents/loop.json", "container must be ignored");
    write("clossys/agents/unknown/loop.json", VALID_STATE);
    write("clossys/.state/studio/loop.json", VALID_STATE);
    expect(loadLoopStates(root)).toEqual({
      roles: Object.fromEntries(["advisor", "designer", "director", "publisher", "strategist", "writer"].map((role) => [role, { ...VALID_STATE, role }])),
      unreadable: [],
    });
  });

  it.each(["director", "designer", "writer", "publisher"])("reports the nested path for invalid %s state", (agent) => {
    const path = `clossys/agents/${agent}/loop.json`;
    write(path, "{ invalid");
    expect(loadLoopStates(root)).toMatchObject({ roles: {}, unreadable: [{ path, reason: expect.stringContaining("could not parse JSON") }] });
  });
});
