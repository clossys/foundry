import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "./cli.js";

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "migrate-cli-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(relativePath: string, content: unknown): void {
  const full = join(root, relativePath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, JSON.stringify(content));
}

describe("foundry-schema-migrate CLI", () => {
  it("prints usage and exits 0 on --help", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main(["--help"])).toBe(0);
    expect(log.mock.calls[0]?.[0]).toContain("Usage: foundry-schema-migrate");
    log.mockRestore();
  });

  it("exits 0 with a satisfied envelope when every record is current", () => {
    write("clossys/coverage.json", { schemaVersion: 1 });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main([root])).toBe(0);
    const envelope = JSON.parse(log.mock.calls[0]?.[0] as string);
    expect(envelope.verdict).toBe("satisfied");
    expect(envelope.package).toBe("@clossys/controller");
    expect(envelope.findings).toEqual([]);
    log.mockRestore();
  });

  it("exits 2 with an indeterminate envelope naming the bad record", () => {
    write("clossys/coverage.json", { schemaVersion: 99 });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main([root])).toBe(2);
    const envelope = JSON.parse(log.mock.calls[0]?.[0] as string);
    expect(envelope.verdict).toBe("indeterminate");
    expect(envelope.findings).toHaveLength(1);
    expect(envelope.findings[0].path).toBe("clossys/coverage.json");
    expect(envelope.nextAction).toBeTruthy();
    log.mockRestore();
  });

  it("--apply is required to write; without it the dry run leaves files untouched", () => {
    write("clossys/coverage.json", { schemaVersion: 1 });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    main([root]);
    expect(JSON.parse(readFileSync(join(root, "clossys/coverage.json"), "utf8"))).toEqual({ schemaVersion: 1 });
    log.mockRestore();
  });

  it("rejects more than one positional argument", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(main([root, "extra"])).toBe(2);
    error.mockRestore();
  });
});
