/**
 * R-NO-HIDDEN-FALLBACKS for the status read model's file readers: an absent folder or file is
 * tolerated (no loops, no pin, drift for a missing candidate); a folder or file that cannot be read,
 * or a record that is not JSON, is thrown instead of shown as an empty or drifted default.
 */
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { statusView } from "./status.js";

let root: string;
const locked: string[] = [];
const lock = (path: string) => { chmodSync(path, 0o000); locked.push(path); };
const loop = () => join(root, "clossys", "agents", "producer", "loop.probe");
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "status-absent-")));
  mkdirSync(join(loop(), "candidates"), { recursive: true });
});
afterEach(() => {
  for (const path of locked.splice(0)) chmodSync(path, 0o755);
  rmSync(root, { recursive: true, force: true });
});

const producerSlot = () => statusView(root, { detail: true }).detail!.slots.find(slot => slot.ref === "producer/loop.probe");

describe("status file readers", () => {
  it("a loop with no pin is unresolved, and a pin whose candidate is absent is failing", () => {
    expect(producerSlot()?.state).toBe("unresolved");
    writeFileSync(join(loop(), "pin.json"), JSON.stringify({ candidate: "missing.md", sha256: "0".repeat(64), basis: "agent" }));
    expect(producerSlot()?.state).toBe("failing");
  });
  it("throws a producer folder it cannot list", () => {
    lock(join(root, "clossys", "agents", "producer"));
    expect(() => statusView(root)).toThrow(expect.objectContaining({ code: "EACCES", syscall: "scandir" }));
  });
  it("throws a pin.json that is not JSON, naming it", () => {
    writeFileSync(join(loop(), "pin.json"), "{ not json");
    expect(() => statusView(root)).toThrow(/loop\.probe[/\\]pin\.json: not JSON/);
  });
  it("throws a pinned candidate it cannot read", () => {
    writeFileSync(join(loop(), "candidates", "a.md"), "a");
    writeFileSync(join(loop(), "pin.json"), JSON.stringify({ candidate: "a.md", sha256: "0".repeat(64), basis: "agent" }));
    lock(join(loop(), "candidates", "a.md"));
    expect(() => statusView(root)).toThrow(expect.objectContaining({ code: "EACCES", syscall: "open" }));
  });
});
