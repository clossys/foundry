import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "./cli.js";
import type { LoopState } from "./types.js";

let root = "";
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "loop-cli-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function writeLoopState(state: LoopState): string {
  const path = join(root, "loop.json");
  writeFileSync(path, JSON.stringify(state));
  return path;
}

function writeMandate(text: string): string {
  const path = join(root, "mandate.txt");
  writeFileSync(path, text);
  return path;
}

const validState: LoopState = {
  schemaVersion: 1,
  role: "@clossys/advisor",
  capabilities: {
    "confirm-problems": { id: "confirm-problems", state: "draft", condition: "current", stage: "judge", inputFingerprints: {}, lastWrittenFingerprints: {}, blockers: [], decisions: [] },
  },
};

describe("foundry-loop-status CLI", () => {
  it("prints usage and exits 0 on --help", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main(["--help"])).toBe(0);
    expect(log.mock.calls[0]?.[0]).toContain("Usage: foundry-loop-status");
    log.mockRestore();
  });

  it("exits 2 with a usage message when arguments are missing", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(main([])).toBe(2);
    error.mockRestore();
  });

  it("renders STATUS.md to stdout and exits 0 for a valid loop.json", () => {
    const loopPath = writeLoopState(validState);
    const mandatePath = writeMandate("Confirm client problems.");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main([loopPath, mandatePath])).toBe(0);
    expect(log.mock.calls[0]?.[0]).toContain("## Mandate");
    expect(log.mock.calls[0]?.[0]).toContain("confirm-problems");
    log.mockRestore();
  });

  it("writes the rendered document to --out", () => {
    const loopPath = writeLoopState(validState);
    const mandatePath = writeMandate("Confirm client problems.");
    const outPath = join(root, "STATUS.md");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main([loopPath, mandatePath, "--out", outPath])).toBe(0);
    expect(readFileSync(outPath, "utf8")).toContain("## Blockers");
    log.mockRestore();
  });

  it("exits 2 with usage when --out has no path following it, rather than silently printing to stdout only", () => {
    const loopPath = writeLoopState(validState);
    const mandatePath = writeMandate("Confirm client problems.");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(main([loopPath, mandatePath, "--out"])).toBe(2);
    expect(error.mock.calls[0]?.[0]).toContain("Usage: foundry-loop-status");
    error.mockRestore();
  });

  it("exits 2 and names every finding for a malformed loop.json", () => {
    const loopPath = writeLoopState({ ...validState, schemaVersion: 2 } as unknown as LoopState);
    const mandatePath = writeMandate("m");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(main([loopPath, mandatePath])).toBe(2);
    expect(error.mock.calls.some((call) => String(call[0]).includes("invalid-schema-version"))).toBe(true);
    error.mockRestore();
  });

  it("exits 2 for unparseable JSON rather than throwing", () => {
    const loopPath = join(root, "broken.json");
    writeFileSync(loopPath, "{not json");
    const mandatePath = writeMandate("m");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(main([loopPath, mandatePath])).toBe(2);
    error.mockRestore();
  });
});
