import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { healMain } from "./cli.js";
import { incidentRecord, normalizeSignature, recordFindings } from "./signature.js";

describe("incident records", () => {
  it("one failure on two machines at two times gives one signature", () => {
    const a = "FAIL /home/a/tree-1/packages/x/src/a.test.ts:12:5 at 2026-11-27T10:00:01Z\nbase 1a2b3c4d5e exit 1 after 5000ms\nFAIL /home/a/tree-1/packages/x/src/a.test.ts:12:5 at 2026-11-27T10:00:01Z";
    const b = "FAIL /tmp/scratch-9/packages/x/src/a.test.ts:40:1 at 2026-11-28T23:59:59Z\nbase 9f8e7d6c5b exit 1 after 61s";
    expect(normalizeSignature(a)).toBe(normalizeSignature(b));
    expect(normalizeSignature(a)).toBe("FAIL <path> at <time>\nbase <sha> exit # after <duration>");
    // Ids that carry digits stay: they name which thing failed.
    expect(normalizeSignature("check:rules R-E2E-CONSUMER h1 claude/r2f-int2")).toBe("check:rules R-E2E-CONSUMER h1 claude/r2f-int2");
  });

  it("writes the fixed form: stage, command, exit, signature, time", () => {
    const record = incidentRecord({ stage: "test", command: "npm test", exit: 1, output: "boom 12", at: "2026-11-28T00:00:00Z" });
    expect(record).toEqual({ schema: "foundry.incident/1", stage: "test", command: "npm test", exit: 1, signature: "boom #", at: "2026-11-28T00:00:00Z" });
    expect(recordFindings(record)).toEqual([]);
    expect(recordFindings({ ...record, exit: "1" })).toEqual(["exit must be an integer"]);
  });

  it("clossys heal run records a failing command and nothing for a passing one", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "heal-run-")), "incidents");
    const pass = await healMain(["run", "--stage", "test", "--dir", dir, "--", "true"], process.cwd());
    expect(pass.exit).toBe(0);
    expect(existsSync(dir)).toBe(false);
    const fail = await healMain(["run", "--stage", "test", "--dir", dir, "--", "echo 'Error: Test timed out in 5000ms.'; exit 3"], process.cwd());
    expect(fail.exit).toBe(1);
    const [name] = readdirSync(dir);
    const record = JSON.parse(readFileSync(join(dir, name!), "utf8"));
    expect(record).toMatchObject({ schema: "foundry.incident/1", stage: "test", exit: 3, signature: "Error: Test timed out in <duration>." });
    expect(fail.out).toMatch(/^INCIDENT test exit 3: recorded /m);
  });
});
