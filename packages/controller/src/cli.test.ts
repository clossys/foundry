import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliInputError, main } from "./cli.js";

let root: string;
let lifecycleFile: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "governance-cli-"));
  mkdirSync(join(root, "packages", "core"), { recursive: true });
  writeFileSync(join(root, "packages", "core", "package.json"), JSON.stringify({ name: "@example/core", version: "0.1.0" }));
  lifecycleFile = join(root, "lifecycle.json");
  writeFileSync(lifecycleFile, JSON.stringify({ schemaVersion: 1, packages: [{ name: "@example/core", status: "active" }] }));
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("foundry-governance", () => {
  it("prints a compact clean text report by default", () => {
    expect(main([lifecycleFile, root, "--scope", "@example"])).toBe(0);
    expect((console.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain("Package governance: PASS");
    expect((console.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).not.toContain('"catalog"');
  });

  it("supports compact JSON and verbose full reports", () => {
    expect(main([lifecycleFile, root, "--scope", "@example", "--format", "json"])).toBe(0);
    const compact = JSON.parse((console.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string);
    expect(compact).toMatchObject({ ok: true, packages: 1, lifecycleEntries: 1, buildOrder: "valid" });
    expect(compact).toMatchObject({ lifecycleMaturity: { active: 1 } });
    expect(compact.foundation).toBeUndefined();

    expect(main([lifecycleFile, root, "--scope", "@example", "--format", "json", "--verbose"])).toBe(0);
    const verbose = JSON.parse((console.log as ReturnType<typeof vi.fn>).mock.calls[1]?.[0] as string);
    expect(verbose.foundation.catalog.entries).toHaveLength(1);
  });

  it("distinguishes invalid invocation from governance findings", () => {
    expect(() => main([])).toThrow(CliInputError);
    expect(() => main([lifecycleFile, root, "--unknown"])).toThrow(CliInputError);
    expect(() => main([lifecycleFile, join(root, "missing")])).toThrow(CliInputError);
    writeFileSync(join(root, "not-a-directory"), "");
    expect(() => main([lifecycleFile, join(root, "not-a-directory")])).toThrow(CliInputError);
    expect(() => main([lifecycleFile, root, "--format", "yaml"])).toThrow(CliInputError);
    writeFileSync(lifecycleFile, "{");
    expect(() => main([lifecycleFile, root])).toThrow(CliInputError);
  });
});
