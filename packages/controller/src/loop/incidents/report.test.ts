import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readCauses } from "./causes.js";
import { DEFAULT_CAUSES, PACKAGE_ROOT, healMain, readRecords, DEFAULT_RECORDS } from "./cli.js";
import { healReport, isRepeat } from "./report.js";
import { incidentRecord } from "./signature.js";

const causes = readCauses(DEFAULT_CAUSES).causes;
const orphan = causes.find(cause => cause.id === "orphan-test-child")!;
const output = "build slot is held by process 48121\nthe holder is an orphaned test child";

function recordsDir(...ats: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "heal-report-"));
  ats.forEach((at, index) => writeFileSync(join(dir, `r${index}.json`), JSON.stringify(incidentRecord({ stage: "build", command: "npm run build -w @clossys/producer", exit: 1, output, at }))));
  return dir;
}

describe("heal --report", () => {
  it("a cause with a guard that recurs reports REPEAT and exits 1", async () => {
    const landed = Date.parse(orphan.guard_landed!);
    const before = new Date(landed - 60_000).toISOString(), after = new Date(landed + 60_000).toISOString();

    const repeat = await healMain(["--report", "--records", recordsDir(before, after)], process.cwd());
    expect(repeat.exit).toBe(1);
    expect(repeat.out).toMatch(new RegExp(`^REPEAT orphan-test-child guard=R-FIXTURE-NO-ORPHAN at=${after.replace(/[.]/g, "\\.")} `, "m"));
    expect(repeat.out).toMatch(/^COUNT orphan-test-child 2$/m);
    // Only the record after the guard landed is a repeat: the one before it is history.
    expect(repeat.out.match(/^REPEAT /gm)).toHaveLength(1);

    const history = await healMain(["--report", "--records", recordsDir(before, orphan.guard_landed!)], process.cwd());
    expect(history.exit).toBe(0);
    expect(history.out).not.toMatch(/^REPEAT /m);
    expect(history.out).toMatch(/^COUNT orphan-test-child 2$/m);
    expect(isRepeat(orphan, before)).toBe(false);
    expect(isRepeat(orphan, after)).toBe(true);
  });

  it("windows the count with --since and --until", () => {
    const records = ["2026-11-27T10:00:00Z", "2026-11-28T01:00:00Z", "2026-11-28T03:00:00Z"].map(at => incidentRecord({ stage: "build", command: "npm run build", exit: 1, output, at }));
    expect(healReport(records, causes, { since: "2026-11-28T00:00:00Z" }).counts["orphan-test-child"]).toBe(2);
    expect(healReport(records, causes, { until: "2026-11-28T00:00:00Z" }).counts["orphan-test-child"]).toBe(1);
  });

  it("an unknown record is counted as NEW-CAUSE, not as a repeat", () => {
    const report = healReport([incidentRecord({ stage: "build", command: "npm run build", exit: 1, output: "something nobody has seen", at: "2026-12-01T00:00:00Z" })], causes);
    expect(report.newCauses).toEqual(["something nobody has seen"]);
    expect(report.exit).toBe(0);
  });

  it("the recorded fixtures hold every seed cause once and no repeat", async () => {
    const report = healReport(readRecords(DEFAULT_RECORDS), causes);
    expect(report.counts).toEqual(Object.fromEntries(causes.map(cause => [cause.id, 1])));
    expect(report.newCauses).toEqual([]);
    expect(report.repeats).toEqual([]);
    const fixture = await healMain(["check", "--records", resolve(PACKAGE_ROOT, "../../scripts/rules/fixtures/R-HEAL-NO-REPEAT/records")], process.cwd());
    expect(fixture.exit).toBe(1);
    expect(fixture.out).toMatch(/^\s+REPEAT orphan-test-child guard=R-FIXTURE-NO-ORPHAN/m);
  });
});
