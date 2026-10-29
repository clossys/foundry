import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, mkdirSync, linkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { persistReport } from "./reports.js";

const roots: string[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), "strategist-reports-")); roots.push(dir); return dir; }
afterEach(() => roots.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
describe("scoped CLI report persistence", () => {
  it.each(["cell-quality", "coherence", "completion", "wont-claim"] as const)("writes only the exact %s report and preserves the returned report shape", capability => {
    const dir = root();
    writeFileSync(join(dir, "tree.json"), "untouched");
    mkdirSync(join(dir, "cells"));
    writeFileSync(join(dir, "cells", "cell.md"), "untouched");
    const report = { findings: [], state: "pending", nested: { value: 2 } };
    const before = JSON.stringify(report);
    persistReport(dir, capability, report);
    expect(JSON.parse(readFileSync(join(dir, "reports", `${capability}.json`), "utf8"))).toEqual(report);
    expect(JSON.stringify(report)).toBe(before);
    expect(readdirSync(dir).sort()).toEqual(["cells", "reports", "tree.json"]);
    expect(readdirSync(join(dir, "reports"))).toEqual([`${capability}.json`]);
    expect(readFileSync(join(dir, "tree.json"), "utf8")).toBe("untouched");
    expect(readFileSync(join(dir, "cells", "cell.md"), "utf8")).toBe("untouched");
    const bytes = readFileSync(join(dir, "reports", `${capability}.json`), "utf8");
    persistReport(dir, capability, report);
    expect(readFileSync(join(dir, "reports", `${capability}.json`), "utf8")).toBe(bytes);
  });
  it("rejects unknown capability names before creating directories", () => {
    const dir = root();
    expect(() => persistReport(dir, "../escape" as never, {})).toThrow();
    expect(readdirSync(dir)).toEqual([]);
  });
  it("refuses a reports symlink even when its target is inside the root", () => {
    const dir = root(); const outside = root();
    symlinkSync(outside, join(dir, "reports"));
    expect(() => persistReport(dir, "completion", {})).toThrow();
    expect(readdirSync(outside)).toEqual([]);
  });
  it("refuses a report file symlink and leaves its target unchanged", () => {
    const dir = root(); const outside = root(); const target = join(outside, "target");
    writeFileSync(target, "unchanged"); mkdirSync(join(dir, "reports"));
    symlinkSync(target, join(dir, "reports", "completion.json"));
    expect(() => persistReport(dir, "completion", {})).toThrow();
    expect(readFileSync(target, "utf8")).toBe("unchanged");
  });
  it("truncates an older longer report on replacement", () => {
    const dir = root();
    persistReport(dir, "completion", { text: "a long older report" });
    persistReport(dir, "completion", {});
    expect(readFileSync(join(dir, "reports", "completion.json"), "utf8")).toBe("{}\n");
  });
  it("rejects hard-linked report destinations before changing their contents", () => {
    const dir = root(); const outside = root(); const target = join(outside, "target");
    writeFileSync(target, "unchanged"); mkdirSync(join(dir, "reports"));
    linkSync(target, join(dir, "reports", "completion.json"));
    expect(() => persistReport(dir, "completion", {})).toThrow();
    expect(readFileSync(target, "utf8")).toBe("unchanged");
  });
  it("requires an existing readable strategy directory", () => {
    const dir = root();
    expect(() => persistReport(join(dir, "absent"), "completion", {})).toThrow();
    expect(readdirSync(dir)).toEqual([]);
  });
});
