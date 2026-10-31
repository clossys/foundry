import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runCli } from "../cli/main.js";
import { parseArgs } from "../cli/args.js";
import { recordSuitesSummary, runRecordSuites, slotContractSuite } from "./record-suites.js";

const temps: string[] = [];
afterAll(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });
function consumer(): string {
  const root = mkdtempSync(join(tmpdir(), "producer-record-suites-"));
  temps.push(root);
  mkdirSync(join(root, "clossys"), { recursive: true });
  writeFileSync(join(root, "clossys", "clossys.config.ts"), "export default {};\n");
  return root;
}

describe("check record-suite arguments", () => {
  it("accepts --suites alone or with the page lint, and keeps the flags on check", () => {
    expect(parseArgs(["check", "--suites"])).toMatchObject({ verb: "check", suites: true, strict: false });
    expect(parseArgs(["check", "--suites", "--strict", "--pages", "p.json", "--report", "r.json"])).toMatchObject({ suites: true, strict: true, pages: "p.json" });
    expect(() => parseArgs(["check", "--strict"])).toThrow(/--pages and --report, or --suites/);
    expect(() => parseArgs(["publish", "--target", "preview", "--suites"])).toThrow(/require check/);
    expect(() => parseArgs(["check", "--suites", "--records", "lib"])).toThrow(/--records requires publish/);
    expect(parseArgs(["publish", "--target", "preview", "--records", "a", "--records", "b"]).records).toEqual(["a", "b"]);
  });
});

describe("record suites", () => {
  it("validates every Writer and Director contract against clossys.slot-contract/1", async () => {
    const suite = await slotContractSuite();
    expect(suite.checked).toBeGreaterThan(50);
    expect(suite.findings).toEqual([]);
  });

  it("reports a suite that cannot run without failing the command unless strict", async () => {
    const root = consumer();
    const loose = await runRecordSuites(root);
    expect(loose.exitCode).toBe(0);
    expect(loose.suites.map(suite => suite.suite)).toEqual(["archetypes", "writer-slots", "director-slots", "slot-contracts"]);
    expect(loose.suites[0]).toMatchObject({ suite: "archetypes", status: "error" });
    expect(recordSuitesSummary(loose)).toMatch(/Archetypes: error: /);
    expect((await runRecordSuites(root, { strict: true })).exitCode).toBe(1);
  });

  it("runs through clossys check with the exit code unchanged unless --strict", async () => {
    const root = consumer();
    const result = await runCli(["check", "--suites", "--root", root]);
    expect(result).toMatchObject({ exitCode: 0, verb: "check" });
    expect(result.message).toContain("Record suites (report only)");
    expect(result.message).toMatch(/Slot contracts: \d+ contracts, errors=0/);
    expect(result.suites?.suites).toHaveLength(4);
    expect(await runCli(["check", "--suites", "--strict", "--root", root])).toMatchObject({ exitCode: 1 });
    const outside = mkdtempSync(join(tmpdir(), "producer-record-suites-none-"));
    temps.push(outside);
    expect(await runCli(["check", "--suites", "--root", outside])).toMatchObject({ exitCode: 2 });
  });
});
