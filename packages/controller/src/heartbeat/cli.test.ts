import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "./cli.js";

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "heartbeat-cli-"));
});
afterEach(() => {
  // best-effort cleanup; a real rmSync would need the import, but the OS
  // temp dir is not asserted on across tests, so leaving this to the
  // test runner's own tmp handling keeps this file focused.
});

function write(relativePath: string, content: unknown): void {
  const full = join(root, relativePath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, JSON.stringify(content));
}

describe("foundry-heartbeat CLI", () => {
  it("prints usage and exits 0 on --help", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main(["--help"])).toBe(0);
    expect(log.mock.calls[0]?.[0]).toContain("Usage: foundry-heartbeat");
    log.mockRestore();
  });

  it("exits 0 with a satisfied envelope when every loop.json is valid, and does not write by default", () => {
    write("clossys/advisor/loop.json", { schemaVersion: 1, role: "advisor", capabilities: {} });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main([root])).toBe(0);
    const envelope = JSON.parse(log.mock.calls[0]?.[0] as string);
    expect(envelope.verdict).toBe("satisfied");
    expect(envelope.findings).toEqual([]);
    expect(existsSync(join(root, "clossys/.state"))).toBe(false);
    log.mockRestore();
  });

  it("--write also renders the digest to clossys/.state/decisions-waiting-for-you.md", () => {
    write("clossys/advisor/loop.json", { schemaVersion: 1, role: "advisor", capabilities: {} });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main([root, "--write"])).toBe(0);
    expect(existsSync(join(root, "clossys/.state/decisions-waiting-for-you.md"))).toBe(true);
    const envelope = JSON.parse(log.mock.calls[0]?.[0] as string);
    expect(envelope.summary).toContain("digest written to");
    log.mockRestore();
  });

  it("exits 2 with an indeterminate envelope when a loop.json fails to validate", () => {
    write("clossys/advisor/loop.json", "{ not json");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main([root])).toBe(2);
    const envelope = JSON.parse(log.mock.calls[0]?.[0] as string);
    expect(envelope.verdict).toBe("indeterminate");
    expect(envelope.findings).toHaveLength(1);
    log.mockRestore();
  });

  it("a populated digest is never itself a violation: satisfied even with entries", () => {
    write("clossys/advisor/loop.json", {
      schemaVersion: 1,
      role: "advisor",
      capabilities: { c1: { id: "c1", state: "draft", condition: "current", stage: "judge", inputFingerprints: {}, lastWrittenFingerprints: {}, blockers: [], decisions: [] } },
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main([root])).toBe(0);
    const envelope = JSON.parse(log.mock.calls[0]?.[0] as string);
    expect(envelope.verdict).toBe("satisfied");
    log.mockRestore();
  });
});
