import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mainIACoverage } from "./cli.js";
import { fixture } from "./__fixtures__/catalog.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
describe("writer-check ia-coverage", () => {
  it("writes the read-only observation and prints its bottom-up summary; findings exit 1", async () => {
    const root = mkdtempSync(join(tmpdir(), "writer-ia-")); roots.push(root);
    const input = fixture(), before = structuredClone(input), output: string[] = [];
    const code = await mainIACoverage(["--out", root], { loadInput: async () => input, stdout: text => output.push(text), stderr: () => {} });
    expect(code).toBe(1);
    expect(JSON.parse(readFileSync(join(root, "ia-coverage.json"), "utf8")).summary.levels).toEqual({ L0: 1, L1: 1, L2: 1, L3: 1 });
    expect(output.join("")).toContain("| L3 | 1 |");
    expect(input).toEqual(before);
  });
  it("prints JSON with stable contents and preserves all finding identities", async () => {
    const root = mkdtempSync(join(tmpdir(), "writer-ia-")); roots.push(root);
    const output: string[] = [];
    await mainIACoverage(["--out", root, "--format", "json"], { loadInput: async () => fixture(), stdout: text => output.push(text), stderr: () => {} });
    expect(JSON.parse(output.join(""))).toEqual(JSON.parse(readFileSync(join(root, "ia-coverage.json"), "utf8")));
  });
  it("supports help without loading catalogs, and rejects unknown options", async () => {
    const ports = { loadInput: async () => { throw new Error("must not load"); }, stdout: () => {}, stderr: () => {} };
    expect(await mainIACoverage(["--help"], ports)).toBe(0);
    expect(await mainIACoverage(["--write"], ports)).toBe(2);
  });
  it("keeps derived reports outside the consumer library", async () => {
    const root = mkdtempSync(join(tmpdir(), "writer-ia-")); roots.push(root);
    const errors: string[] = [];
    expect(await mainIACoverage(["--root", root, "--out", join(root, "reports")], { loadInput: async () => fixture(), stdout: () => {}, stderr: text => errors.push(text) })).toBe(2);
    expect(errors.join("")).toContain("outside the library root");
    expect(readdirSync(root)).toEqual([]);
  });
});
