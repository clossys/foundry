/**
 * The front door against the real, built `clossys` command (Producer's dist), not a fake host: init runs
 * `clossys config --init` and `clossys init`, and intake runs `clossys evidence ... --source user --observed`.
 * A flag Advisor passes that Producer does not take (for example `--date` for `--observed`) fails here.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { realHost, type Host } from "./host.js";
import { runInit } from "./init.js";
import { INSTALL_RECORD } from "./install.js";
import { INTAKE_RECORD, readIntakeRecord, runIntake } from "./intake.js";
import { loadTree, PACKAGE_ROOT } from "./tree.js";

const PRODUCER_CLI = join(PACKAGE_ROOT, "..", "producer", "dist", "cli", "index.js");
const DIRECTOR = join(PACKAGE_ROOT, "..", "director");
const SLOW = 300_000;
const host: Host = { ...realHost, today: () => "2026-11-17" };

let root = "";
beforeAll(() => {
  // A missing built Producer is a failure, not a skip: this file is the only check of the real CLI contract.
  expect(existsSync(PRODUCER_CLI), `build @clossys/producer first: ${PRODUCER_CLI}`).toBe(true);
  root = mkdtempSync(join(tmpdir(), "advisor-real-cli-"));
  expect(spawnSync("git", ["init", "--quiet"], { cwd: root }).status).toBe(0);
  mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
  const bin = join(root, "node_modules", ".bin", "clossys");
  writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${PRODUCER_CLI}" "$@"\n`);
  chmodSync(bin, 0o755);
  mkdirSync(join(root, "node_modules", "@clossys"), { recursive: true });
  symlinkSync(DIRECTOR, join(root, "node_modules", "@clossys", "director"), "dir");
  mkdirSync(join(root, "clossys", "advisor"), { recursive: true });
  writeFileSync(join(root, INSTALL_RECORD), `${JSON.stringify({ schema: "clossys.advisor-install/1", foundry: { head: "a".repeat(40), tree: "b".repeat(40) }, packages: [], at: "2026-11-17T00:00:00Z" })}\n`);
});
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

function answersFile(answers: Record<string, string>): string {
  const file = join(root, `answers-${Object.keys(answers).length}.json`);
  writeFileSync(file, JSON.stringify({ schema: "clossys.advisor-intake-answers/1", answers }));
  return file;
}

describe("front door against the real clossys command", () => {
  it("init runs Producer's clossys config --init and clossys init", () => {
    const result = runInit(root, host);
    expect(result.exitCode, result.lines.join("\n")).toBe(0);
    expect(existsSync(join(root, "clossys", "clossys.config.ts"))).toBe(true);
  }, SLOW);

  it("intake records answers as Director evidence with the owner's words, partial then resumed to complete", () => {
    const evidence = (topic: string) => join(root, "clossys", "evidence", "director", `owner-intake-${topic}-2026-11-17.md`);
    const existing = evidence("name");
    mkdirSync(join(root, "clossys", "evidence", "director"), { recursive: true });
    writeFileSync(existing, "earlier evidence\n");
    const first = runIntake(loadTree(), root, { answers: answersFile({ "intake.business.offer": "Bookkeeping for small cafes", "intake.business.name": "Ledger & Bean" }) }, host);
    expect(first.exitCode, first.lines.join("\n")).toBe(1);
    expect(first.lines.join("\n")).toContain("recorded clossys/evidence/director/owner-intake-offer-2026-11-17.md");
    expect(first.lines.join("\n")).toContain("failed intake.business.name");
    const offer = readFileSync(evidence("offer"), "utf8");
    expect(offer).toContain('Words: "Bookkeeping for small cafes"');
    expect(offer).toContain("focus.offer.included");
    expect(offer).toContain("source: user");
    expect(offer).toContain("observed: 2026-11-17");
    expect(readFileSync(existing, "utf8")).toBe("earlier evidence\n");
    expect(readIntakeRecord(root)).toMatchObject({ status: "partial" });

    const all = { "intake.business.offer": "Bookkeeping for small cafes", "intake.business.audience": "Cafe owners", "intake.business.name": "Ledger & Bean", "intake.limits.constraint": "One person, evenings only", "intake.limits.horizon": "Six months" };
    const second = runIntake(loadTree(), root, { answers: answersFile(all), observed: "2026-11-18" }, host);
    expect(second.exitCode, second.lines.join("\n")).toBe(0);
    expect(readFileSync(join(root, "clossys", "evidence", "director", "owner-intake-name-2026-11-18.md"), "utf8")).toContain('Words: "Ledger & Bean"');
    const record = JSON.parse(readFileSync(join(root, INTAKE_RECORD), "utf8"));
    expect(record.status).toBe("complete");
    expect(record.recorded).toHaveLength(5);
    expect(runIntake(loadTree(), root, { answers: answersFile(all) }, host).lines[0]).toContain("intake runs once");
  }, SLOW);
});
