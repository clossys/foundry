import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "./cli.js";
import { main as libraryMain } from "../../../library-cli/cli.js";
import { fixture } from "./__fixtures__/catalog.js";
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const setup = () => {
  const root = mkdtempSync(join(tmpdir(), "ia-coverage-")); directories.push(root);
  const input = join(root, "catalog.json"), out = join(root, "ia-coverage.json");
  writeFileSync(input, JSON.stringify(fixture())); return { input, out };
};
const capture = () => { const output: string[] = [], errors: string[] = []; return { output, errors, io: { out: (text: string) => output.push(text), error: (text: string) => errors.push(text) } }; };
describe("shipped IA completeness command", () => {
  it("writes deterministic JSON and a summary table without changing input", async () => {
    const { input, out } = setup(), before = readFileSync(input, "utf8"), io = capture();
    expect(await main(["--input", input, "--out", out], io.io)).toBe(0);
    const first = readFileSync(out, "utf8");
    expect(JSON.parse(first).summary.states.draft).toBe(5);
    expect(JSON.parse(first).basis.inputMode).toBe("supplied-snapshot");
    expect(JSON.parse(first).basis.inputsHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(io.output.join("\n")).toContain("| Layer | L0 | L1 | L2 | L3 | absent | draft | checked | approved |");
    expect(await main(["--input", input, "--out", out], io.io)).toBe(0);
    expect(readFileSync(out, "utf8")).toBe(first); expect(readFileSync(input, "utf8")).toBe(before);
  });
  it("is reachable through the existing designer-library executable dispatch", async () => {
    const { input, out } = setup(), io = capture();
    expect(await libraryMain(["ia-coverage", "--input", input, "--out", out], io.io)).toBe(0);
    expect(JSON.parse(readFileSync(out, "utf8")).findings).toEqual([]);
  });
  it("retains named findings in the JSON and returns exit 1", async () => {
    const { input, out } = setup(), value = fixture(); value.edges.push({ from: "frames.example", to: "components.missing", evidence: "fixture" });
    writeFileSync(input, JSON.stringify(value));
    expect(await main(["--input", input, "--out", out], capture().io)).toBe(1);
    expect(JSON.parse(readFileSync(out, "utf8")).findings).toEqual([expect.objectContaining({ code: "IA-DANGLING-REF", priority: "P0" })]);
  });
  it("refuses to replace an input file and does not modify it", async () => {
    const { input } = setup(), before = readFileSync(input, "utf8"), io = capture();
    expect(await main(["--input", input, "--out", input], io.io)).toBe(2);
    expect(readFileSync(input, "utf8")).toBe(before); expect(io.errors.join()).toContain("input");
  });
  it("rejects bad arguments and malformed snapshots without producing a report", async () => {
    const io = capture(); expect(await main(["--unknown"], io.io)).toBe(2);
    const { input, out } = setup(); writeFileSync(input, "{}");
    expect(await main(["--input", input, "--out", out], io.io)).toBe(2);
  });
});
