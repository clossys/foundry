import { describe, expect, it, vi } from "vitest";
import { parseReadArgs, runReadCommand, READ_COMMANDS, isReadCommand, type ReadServices } from "./read.js";

const progress = "MVS 9/24 · L1 unlocked 1/7 (Context) · L2 coherent 0/28 · active 9/57 · requests 1 open · next: Channel (unlocks Focus; Publisher waiting)";
function services(code: 0 | 1 | 2 = 0): ReadServices {
  return { execute: vi.fn(() => ({ code, data: { state: code === 0 ? "ready" : "missing" }, text: [progress] })) };
}

describe("read-only cell CLI", () => {
  it("routes contract handoff while preserving legacy path and help forms", () => {
    expect(isReadCommand(["handoff", "writer.messaging"])).toBe(true);
    expect(isReadCommand(["handoff", "--root", "custom", "writer.messaging"])).toBe(true);
    expect(isReadCommand(["handoff", "./records"])).toBe(false);
    expect(isReadCommand(["handoff", "/records"])).toBe(false);
    expect(isReadCommand(["handoff", "--help"])).toBe(false);
    expect(isReadCommand(["handoff"])).toBe(false);
    expect(isReadCommand(["brand-coverage"])).toBe(false);
    expect(isReadCommand(["status"])).toBe(true);
  });
  it("lists the seven read commands from the specification", () => {
    expect(READ_COMMANDS).toEqual(["status", "cell", "check", "cohere", "complete", "brief", "handoff"]);
  });
  for (const [command, args] of [
    ["status", []], ["cell", ["focus.segment.core", "--verb", "create"]],
    ["check", ["focus.segment.core@2"]], ["cohere", ["focus.segment"]],
    ["complete", ["--level", "mvs"]], ["brief", ["writer.messaging"]], ["handoff", ["writer.messaging"]],
  ] as const) {
    for (const code of [0, 1, 2] as const) {
      it(`${command} preserves exit ${code}, JSON and explicit root`, () => {
        const backend = services(code);
        const output = vi.fn();
        expect(runReadCommand([command, ...args, "--root", "custom-root", "--json"], backend, output)).toBe(code);
        expect(backend.execute).toHaveBeenCalledWith(expect.objectContaining({ command, root: "custom-root", json: true }));
        expect(JSON.parse(output.mock.calls[0]![0])).toEqual({ command, code, result: { state: code === 0 ? "ready" : "missing" } });
      });
    }
  }
  it.each([["cell-quality", "check"], ["coherence", "cohere"], ["completion", "complete"]])("accepts capability alias %s", (alias, command) => {
    expect(isReadCommand([alias!])).toBe(true);
    expect(parseReadArgs([alias!]).command).toBe(command);
  });
  it("prints the skill progress line", () => {
    const output = vi.fn();
    expect(runReadCommand(["status"], services(), output)).toBe(0);
    expect(output).toHaveBeenCalledWith(progress);
    expect(parseReadArgs(["status"]).root).toBe("clossys/strategist");
  });
  it.each(["--write", "--request"])("passes explicit brief %s to services", flag => {
    const backend = services();
    expect(runReadCommand(["brief", "writer.messaging", flag, "--json"], backend, vi.fn())).toBe(0);
    expect(backend.execute).toHaveBeenCalledWith(expect.objectContaining({ [flag.slice(2)]: true }));
  });
  it.each(["--write", "--request"])("restricts %s to brief and refuses duplicates", flag => {
    expect(() => parseReadArgs(["handoff", "writer.messaging", flag])).toThrow();
    expect(() => parseReadArgs(["status", flag])).toThrow();
    expect(() => parseReadArgs(["brief", "writer.messaging", flag, flag])).toThrow();
  });
  it.each([
    ["status", "--scope", "other"], ["complete", "--level", "other"], ["status", "--root"],
    ["cell", "focus.segment.core"], ["cell", "focus.segment.core", "--verb", "unlock"],
    ["cell", "focus.segment", "--verb", "create"], ["handoff"], ["brief", "one", "two"],
    ["check", "focus.segment.core@0"], ["cohere", "focus"], ["status", "--bogus"],
    ["status", "--level", "mvs"], ["check", "--scope", "full"],
  ])("rejects invalid arguments %j", (...args) => {
    expect(() => parseReadArgs(args)).toThrow();
  });
  it("returns machine-readable input and execution errors", () => {
    const output = vi.fn();
    const backend: ReadServices = { execute() { throw new Error("unreadable root"); } };
    expect(runReadCommand(["handoff", "writer.messaging", "--json"], backend, output)).toBe(2);
    expect(JSON.parse(output.mock.calls[0]![0])).toEqual({ command: "handoff", code: 2, error: "unreadable root" });
  });
  it("help lists SPEC subcommands without executing a check", () => {
    const backend = services(); const output = vi.fn();
    expect(runReadCommand(["status", "--help"], backend, output)).toBe(0);
    expect(backend.execute).not.toHaveBeenCalled();
    expect(output.mock.calls[0]![0]).toContain("status, cell, check, cohere, complete, brief, handoff");
  });
});
